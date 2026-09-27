import { describe, expect, it } from 'vitest';
import {
  CYCLE_BUDGET,
  LOCALS_LIMIT,
  STACK_LIMIT,
  compile,
  formatDiagnostic,
  tokenize,
  type Diagnostic,
  type IrNode,
  type IrProgram,
} from './compiler';

// Unit: one module, no I/O, no tick loop (AGENTS.md § 4). Tags follow the
// six required categories: normal, boundary, invalid, state, repeat,
// determinism. For a pure compiler, "state" means: no cross-call
// contamination of module or result state, and diagnostics that carry the
// position state the editor gutter needs.
//
// Cost expectations throughout are derived by hand from 09-AI-DSL.md § 4:
// a builtin call bills its table cost plus its argument nodes; a user call
// bills 4 + nargs plus the callee body; entry dispatch bills 4 + body;
// loop/while bill 4 + bound × body; if bills 2 + worst branch.

const okSrc = (body: string): string => `(defn step [] ${body})\n(every-tick step)`;

function compileOk(src: string, options?: Parameters<typeof compile>[1]) {
  const result = compile(src, options);
  if (!result.ok) {
    throw new Error(`expected compile success, got: ${result.errors.map((e) => e.code).join(', ')}`);
  }
  return result;
}

function compileErr(src: string) {
  const result = compile(src);
  if (result.ok) {
    throw new Error('expected compile failure');
  }
  return result;
}

function codes(errors: Diagnostic[]): string {
  return errors.map((e) => e.code).join(',');
}

function findNode(node: IrNode, predicate: (n: IrNode) => boolean): IrNode | undefined {
  if (predicate(node)) return node;
  switch (node.op) {
    case 'store':
      return findNode(node.value, predicate);
    case 'do':
      return node.body.map((n) => findNode(n, predicate)).find((n) => n !== undefined);
    case 'if':
      return (
        findNode(node.cond, predicate) ??
        findNode(node.then, predicate) ??
        (node.else === undefined ? undefined : findNode(node.else, predicate))
      );
    case 'let':
      return (
        node.bindings.map((b) => findNode(b.value, predicate)).find((n) => n !== undefined) ??
        findNode(node.body, predicate)
      );
    case 'while':
      return findNode(node.cond, predicate) ?? findNode(node.body, predicate);
    case 'loop':
      return findNode(node.body, predicate);
    case 'call':
      return node.args.map((n) => findNode(n, predicate)).find((n) => n !== undefined);
    case 'return':
      return node.value === undefined ? undefined : findNode(node.value, predicate);
    default:
      return undefined;
  }
}

describe('tokenize', () => {
  it('[normal] emits every token kind with positions', () => {
    const tokens = tokenize('(move-at [x 1]) ; trailing\n(self.x)');
    expect(tokens.map((t) => t.kind)).toEqual([
      'open', 'name', 'open', 'name', 'number', 'close', 'close', 'open', 'name', 'close',
    ]);
    expect(tokens[1]).toMatchObject({ text: 'move-at', line: 1, col: 2 });
    expect(tokens[8]).toMatchObject({ text: 'self.x', line: 2, col: 2 });
  });

  it('[normal] lexes comparison operators and negative literals', () => {
    const tokens = tokenize('(< 1 2) (<= 3 4) (> 5 6) (>= 7 8) (== 9 10) (!= -11 12) (- 1)');
    expect(tokens.filter((t) => t.kind === 'name').map((t) => t.text)).toEqual([
      '<', '<=', '>', '>=', '==', '!=', '-',
    ]);
    const negative = tokens.find((t) => t.kind === 'number' && (t.value ?? 0) < 0);
    expect(negative).toMatchObject({ value: -11, text: '-11' });
  });

  it('[normal] treats parens and brackets as interchangeable delimiters (D21)', () => {
    const parens = tokenize('(let ((x 5)) x)');
    const brackets = tokenize('(let ([x 5]) x)');
    expect(parens.map((t) => t.kind)).toEqual(brackets.map((t) => t.kind));
  });

  it('[boundary] empty and comment-only sources produce zero tokens', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize('   \t\r\n ; nothing here\n;; at all')).toEqual([]);
  });

  it('[boundary] column state resets per line and advances inside tokens', () => {
    const tokens = tokenize('  ab\n  c');
    expect(tokens[0]).toMatchObject({ line: 1, col: 3 });
    expect(tokens[1]).toMatchObject({ line: 2, col: 3 });
  });

  it('[invalid] rejects float literals with a position (determinism, 10 § 2.2)', () => {
    expect(() => tokenize('1.5')).toThrowError(/Float literals/);
  });

  it('[invalid] rejects strings, stray characters and dotted garbage', () => {
    expect(() => tokenize('"no strings"')).toThrowError(/String literals/);
    expect(() => tokenize('a#b')).toThrowError(/Unexpected character '#'/);
    expect(() => tokenize('(. x)')).toThrowError(/only valid inside the reserved self/);
    expect(() => tokenize('self.')).toThrowError(/only valid inside the reserved self/);
  });

  it('[invalid] rejects integer literals beyond the 32-bit range', () => {
    expect(() => tokenize('2147483648')).toThrowError(/outside the 32-bit range/);
    expect(() => tokenize('-2147483648')).toThrowError(/outside the 32-bit range/);
    expect(tokenize('2147483647')[0]).toMatchObject({ value: 2147483647 });
    expect(tokenize('-2147483647')[0]).toMatchObject({ value: -2147483647 });
  });

  it('[repeat] lexing the same source twice gives identical tokens', () => {
    const src = '(defn step [] (move 65536 0))';
    expect(tokenize(src)).toEqual(tokenize(src));
  });

  it('[determinism] tokenize is pure: no module state between calls', () => {
    const first = tokenize('(radar)');
    tokenize('( completely (different) source )');
    expect(tokenize('(radar)')).toEqual(first);
  });
});

describe('compile — forms and IR shape', () => {
  it('[normal] pebble compiles to the pinned IR (09 § 3 example shape)', () => {
    const result = compileOk(okSrc('(move 0 0)'));
    expect(result.ir).toEqual({
      fns: [
        {
          name: 'step',
          params: [],
          body: {
            op: 'call',
            fn: 'move',
            args: [{ op: 'num', v: 0 }, { op: 'num', v: 0 }],
          },
        },
      ],
      tick: 'step',
    });
    expect(result.cycleEstimate).toBe(4 + 30 + 1 + 1);
  });

  it('[normal] both let bracket styles lower to byte-identical IR (D21)', () => {
    const brackets = compileOk(okSrc('(let [x 5] x)'));
    const parens = compileOk(okSrc('(let ((x 5)) x)'));
    expect(JSON.stringify(brackets.ir)).toBe(JSON.stringify(parens.ir));
  });

  it('[normal] multi-binding let stores each binding in order', () => {
    const result = compileOk(okSrc('(let [a 1 b 2] (+ a b))'));
    const letNode = result.ir.fns[0]!.body;
    expect(letNode.op).toBe('let');
    if (letNode.op === 'let') {
      expect(letNode.bindings.map((b) => b.name)).toEqual(['a', 'b']);
    }
  });

  it('[normal] if without else omits the else key; with else keeps both branches', () => {
    const bare = compileOk(okSrc('(if true (fire))'));
    expect(bare.ir.fns[0]!.body).toEqual({
      op: 'if',
      cond: { op: 'bool', v: true },
      then: { op: 'call', fn: 'fire', args: [] },
    });
    const full = compileOk(okSrc('(if true (fire) (eat))'));
    expect(full.ir.fns[0]!.body).toMatchObject({ op: 'if', else: { op: 'call', fn: 'eat', args: [] } });
  });

  it('[normal] cond desugars to nested ifs with else innermost (D21)', () => {
    const result = compileOk(okSrc('(cond [false 1] [true 2] [else 3])'));
    const outer = result.ir.fns[0]!.body;
    expect(outer).toMatchObject({
      op: 'if',
      cond: { op: 'bool', v: false },
      then: { op: 'num', v: 1 },
      else: {
        op: 'if',
        cond: { op: 'bool', v: true },
        then: { op: 'num', v: 2 },
        else: { op: 'num', v: 3 },
      },
    });
  });

  it('[normal] when lowers to an if without else; repeat and loop are the same IR', () => {
    const when = compileOk(okSrc('(when true (fire))'));
    const iff = compileOk(okSrc('(if true (fire))'));
    expect(JSON.stringify(when.ir)).toBe(JSON.stringify(iff.ir));
    const loop = compileOk(okSrc('(loop 3 (fire))'));
    const repeat = compileOk(okSrc('(repeat 3 (fire))'));
    expect(JSON.stringify(loop.ir)).toBe(JSON.stringify(repeat.ir));
  });

  it('[normal] set lowers to store; return carries its value', () => {
    const result = compileOk(okSrc('(let [x 1] (do (set x 2) (return x)))'));
    const body = result.ir.fns[0]!.body;
    expect(body).toMatchObject({ op: 'let' });
    if (body.op === 'let') {
      expect(body.body.op).toBe('do');
      if (body.body.op === 'do') {
        expect(body.body.body[0]).toEqual({
          op: 'store',
          name: 'x',
          value: { op: 'num', v: 2 },
        });
        expect(body.body.body[1]).toEqual({
          op: 'return',
          value: { op: 'var', name: 'x' },
        });
      }
    }
  });

  it('[normal] self reads, sensors and actuators lower to call/self nodes', () => {
    const result = compileOk(okSrc('(aim (atan2 (- (self.y) 1) (self.x)))'));
    const aimCall = result.ir.fns[0]!.body;
    expect(aimCall).toMatchObject({ op: 'call', fn: 'aim' });
  });

  it('[normal] negative literals and unary minus both parse', () => {
    const result = compileOk(okSrc('(move -65536 (- 0 1))'));
    const move = result.ir.fns[0]!.body;
    expect(move).toMatchObject({
      op: 'call',
      fn: 'move',
      args: [{ op: 'num', v: -65536 }, { op: 'call', fn: '-' }],
    });
  });

  it('[normal] a program with no every-tick compiles with tick null (19 § 2.1)', () => {
    const result = compileOk('(defn step [] (move 0 0))');
    expect(result.ir.tick).toBeNull();
    expect(result.cycleEstimate).toBe(0);
    expect(compileOk('; nothing but comments\n').ir.tick).toBeNull();
  });

  it('[normal] every-tick may reference a defn that appears later in the file', () => {
    const result = compileOk('(every-tick step)\n(defn step [] (move 0 0))');
    expect(result.ir.tick).toBe('step');
  });

  it('[normal] defn with parameters resolves calls and their types', () => {
    const result = compileOk(
      '(defn sum2 [a b] (+ a b))\n(defn step [] (rng-int (call sum2 10 20)))\n(every-tick step)',
    );
    expect(result.ir.fns).toHaveLength(2);
    expect(result.ir.fns[0]).toMatchObject({ name: 'sum2', params: ['a', 'b'] });
  });

  it('[normal] the 19 § 3.1 pattern library compiles: payload access on a parameter', () => {
    const result = compileOk(
      '(defn within-range? [h d] (< (dist (self.x) (self.y) (hit-x h) (hit-y h)) d))' +
        '\n(defn step [] true)\n(every-tick step)',
    );
    expect(result.ir.fns[0]!.params).toEqual(['h', 'd']);
  });
});

describe('compile — boundary cases', () => {
  it('[boundary] integer literals at ±2147483647 compile; beyond is rejected', () => {
    expect(compileOk(okSrc('(move 2147483647 0)')).ok).toBe(true);
    expect(codes(compileErr(okSrc('(move 2147483648 0)')).errors)).toContain('E_LEX_RANGE');
    expect(codes(compileErr(okSrc('(move -2147483648 0)')).errors)).toContain('E_LEX_RANGE');
  });

  it('[boundary] static estimate exactly 1000 passes; 1001 is rejected (09 § 5 rule 3)', () => {
    // entry(4) + loop(4) + 31 × (move 30 + num 1 + num 1) = 1000
    const atBudget = compileOk(okSrc('(loop 31 (move 0 0))'));
    expect(atBudget.cycleEstimate).toBe(1000);
    expect(atBudget.cycleEstimate).toBeLessThanOrEqual(CYCLE_BUDGET);
    // one (time) node (1 cycle) pushes the same program to 1001
    const overBudget = compileErr(okSrc('(do (time) (loop 31 (move 0 0)))'));
    expect(overBudget.errors[0]).toMatchObject({
      code: 'E_BUDGET',
      params: { estimate: 1001, budget: 1000 },
    });
  });

  it('[boundary] nested evaluation depth 64 passes; 65 exceeds the stack contract', () => {
    const nest = (n: number): string => (n === 0 ? '1' : `(+ 1 ${nest(n - 1)})`);
    expect(compileOk(okSrc(nest(STACK_LIMIT - 1))).ok).toBe(true);
    const over = compileErr(okSrc(nest(STACK_LIMIT)));
    expect(over.errors[0]).toMatchObject({
      code: 'E_STACK_DEPTH',
      params: { depth: STACK_LIMIT + 1, limit: STACK_LIMIT },
    });
  });

  it('[boundary] 32 locals pass; 33 exceeds the per-frame contract', () => {
    const bindings = (n: number): string =>
      `(let [${Array.from({ length: n }, (_, i) => `x${i} 1`).join(' ')}] x0)`;
    expect(compileOk(okSrc(bindings(LOCALS_LIMIT))).ok).toBe(true);
    expect(codes(compileErr(okSrc(bindings(LOCALS_LIMIT + 1))).errors)).toContain('E_LOCALS');
  });

  it('[boundary] a zero loop bound is legal and its body is still checked', () => {
    expect(compileOk(okSrc('(loop 0 (move 0 0))')).ok).toBe(true);
    expect(codes(compileErr(okSrc('(loop 0 (nobody))')).errors)).toContain('E_SYM_UNKNOWN');
  });

  it('[boundary] variadic math folds; division requires at least two arguments', () => {
    expect(compileOk(okSrc('(+ 1 2 3 4)')).ok).toBe(true);
    expect(codes(compileErr(okSrc('(/ 1)')).errors)).toContain('E_ARITY');
    expect(codes(compileErr(okSrc('(mod 1)')).errors)).toContain('E_ARITY');
  });

  it('[boundary] an empty defn parameter list is the one legal empty list', () => {
    expect(compileOk('(defn step [] (fire))\n(every-tick step)').ok).toBe(true);
    expect(codes(compileErr(okSrc('()')).errors)).toContain('E_EMPTY_LIST');
  });
});

describe('compile — invalid input (verifier, 09 § 5)', () => {
  it('[invalid] rule 1: direct and mutual recursion are rejected with the cycle path', () => {
    const direct = compileErr(okSrc('(call step)'));
    expect(direct.errors[0]).toMatchObject({ code: 'E_RECURSION', params: { path: 'step → step' } });
    const mutual = compileErr(
      '(defn a [] (call b))\n(defn b [] (call a))\n(every-tick a)',
    );
    expect(mutual.errors.map((e) => e.code)).toContain('E_RECURSION');
    expect(mutual.errors[0]?.params?.path).toBe('a → b → a');
  });

  it('[invalid] rule 2: while/loop bounds must be literal non-negative integers', () => {
    expect(compileOk(okSrc('(while true 64 (time))')).ok).toBe(true);
    expect(codes(compileErr(okSrc('(while true n (fire))')).errors)).toContain('E_LOOP_BOUND');
    expect(codes(compileErr(okSrc('(while true -1 (fire))')).errors)).toContain('E_LOOP_BOUND');
    expect(codes(compileErr(okSrc('(loop n (fire))')).errors)).toContain('E_LOOP_BOUND');
    expect(codes(compileErr(okSrc('(while true (time) (fire))')).errors)).toContain('E_LOOP_BOUND');
  });

  it('[invalid] rule 6 + arity: unknown names are compile errors, not runtime traps', () => {
    expect(codes(compileErr(okSrc('(nobody 1)')).errors)).toContain('E_SYM_UNKNOWN');
    expect(codes(compileErr(okSrc('nothere')).errors)).toContain('E_SYM_UNKNOWN');
    expect(codes(compileErr(okSrc('(move 1)')).errors)).toContain('E_ARITY');
    expect(codes(compileErr(okSrc('(dist 1 2 3)')).errors)).toContain('E_ARITY');
    expect(codes(compileErr(okSrc('(radar 1)')).errors)).toContain('E_ARITY');
    expect(codes(compileErr('(defn f [x] x)\n(defn step [] (call f))\n(every-tick step)').errors)).toContain('E_ARITY');
  });

  it('[invalid] rule 8: entry point shape is enforced', () => {
    expect(
      codes(compileErr('(defn step [] (move 0 0))\n(every-tick step)\n(every-tick step)').errors),
    ).toContain('E_ENTRY_MULTIPLE');
    expect(codes(compileErr('(every-tick ghost)').errors)).toContain('E_ENTRY_UNKNOWN');
    expect(codes(compileErr('(defn step [x] x)\n(every-tick step)').errors)).toContain('E_ENTRY_ARGS');
    expect(codes(compileErr('(defn step [] (move 0 0))\n(every-tick (move 0 0))').errors)).toContain('E_ENTRY_INLINE');
  });

  it('[invalid] rule 5: an Option is not a bool — branching on one is a compile error', () => {
    expect(codes(compileErr(okSrc('(if (radar) (fire) (eat))')).errors)).toContain(
      'E_OPTION_CONDITION',
    );
    expect(codes(compileErr(okSrc('(while (food) 4 (fire))')).errors)).toContain(
      'E_OPTION_CONDITION',
    );
    expect(formatDiagnostic(compileErr(okSrc('(if (radar) (fire) (eat))')).errors[0]!)).toMatch(
      /test it with some\? first/,
    );
  });

  it('[invalid] rule 5: some? tests an Option and nothing else', () => {
    expect(codes(compileErr(okSrc('(if (some? 5) (fire) (eat))')).errors)).toContain(
      'E_SOME_NON_OPTION',
    );
    expect(codes(compileErr(okSrc('(if (some? true) (fire) (eat))')).errors)).toContain(
      'E_SOME_NON_OPTION',
    );
  });

  it('[invalid] rule 7: payload reads need a some?-true branch (or a parameter)', () => {
    expect(codes(compileErr(okSrc('(hit-x (radar))')).errors)).toContain('E_PAYLOAD_UNPROVEN');
    const letBound = compileErr(
      okSrc('(let [e (radar)] (hit-x e))'),
    );
    expect(letBound.errors.map((e) => e.code)).toContain('E_PAYLOAD_UNPROVEN');
    const elseBranch = compileErr(
      okSrc('(let [f (food)] (if (some? f) (move 0 0) (food-x f)))'),
    );
    expect(elseBranch.errors.map((e) => e.code)).toContain('E_PAYLOAD_UNPROVEN');
    const afterIf = compileErr(
      okSrc('(let [f (food)] (do (if (some? f) (fire)) (food-x f)))'),
    );
    expect(afterIf.errors.map((e) => e.code)).toContain('E_PAYLOAD_UNPROVEN');
    expect(compileOk(okSrc('(let [f (food)] (if (some? f) (food-x f) 0))')).ok).toBe(true);
  });

  it('[invalid] type-domain errors: conditions are bools, math is int, void is not a value', () => {
    expect(codes(compileErr(okSrc('(if 1 (fire) (eat))')).errors)).toContain('E_CONDITION_TYPE');
    expect(codes(compileErr(okSrc('(if (fire) (fire) (eat))')).errors)).toContain('E_CONDITION_TYPE');
    expect(codes(compileErr(okSrc('(+ true 1)')).errors)).toContain('E_TYPE');
    expect(codes(compileErr(okSrc('(and 1 true)')).errors)).toContain('E_TYPE');
    expect(codes(compileErr(okSrc('(move (radar) 0)')).errors)).toContain('E_TYPE');
    expect(codes(compileErr(okSrc('(let [x (fire)] x)')).errors)).toContain('E_TYPE');
    expect(codes(compileErr(okSrc('(if true 1 true)')).errors)).toContain('E_TYPE');
    expect(compileOk(okSrc('(if true (radar) (food))')).ok).toBe(true);
  });

  it('[invalid] set targets must be existing locals of a stable type', () => {
    expect(codes(compileErr(okSrc('(set ghost 1)')).errors)).toContain('E_SET_TARGET');
    expect(codes(compileErr(okSrc('(set self.x 1)')).errors)).toContain('E_DOT_NAME');
    expect(codes(compileErr(okSrc('(let [x 1] (set x (radar)))')).errors)).toContain('E_TYPE');
    expect(compileOk(okSrc('(let [x 1] (set x 2))')).ok).toBe(true);
  });

  it('[invalid] names: reserved words, dotted identifiers, duplicates', () => {
    expect(codes(compileErr('(defn move [] (fire))\n(every-tick move)').errors)).toContain(
      'E_NAME_RESERVED',
    );
    expect(codes(compileErr('(defn bad.name [] (fire))\n(every-tick bad.name)').errors)).toContain(
      'E_DOT_NAME',
    );
    expect(codes(compileErr(okSrc('(self.z)')).errors)).toContain('E_SELF_FIELD');
    expect(codes(compileErr('(defn step [] (fire))\n(defn step [] (eat))\n(every-tick step)').errors)).toContain(
      'E_DEFN_DUP',
    );
    expect(codes(compileErr(okSrc('(let [x 1 x 2] x)')).errors)).toContain('E_DUP_BINDING');
    expect(codes(compileErr('(defn f [x x] x)\n(every-tick f)').errors)).toContain('E_DUP_BINDING');
  });

  it('[invalid] impossible states: negative build index and empty rng-int range', () => {
    expect(codes(compileErr(okSrc('(build -1)')).errors)).toContain('E_BUILD_INDEX');
    expect(codes(compileErr(okSrc('(rng-int 0)')).errors)).toContain('E_RNG_BOUND');
    expect(codes(compileErr(okSrc('(rng-int -5)')).errors)).toContain('E_RNG_BOUND');
  });

  it('[invalid] top-level and structural shapes', () => {
    expect(codes(compileErr('(move 0 0)').errors)).toContain('E_TOP_LEVEL');
    expect(codes(compileErr(okSrc('(defn inner [] 1)')).errors)).toContain('E_TOP_LEVEL');
    expect(codes(compileErr(okSrc('(every-tick step)')).errors)).toContain('E_TOP_LEVEL');
    expect(codes(compileErr('((move 0 0))').errors)).toContain('E_FORM_HEAD');
    expect(codes(compileErr('(5 6)').errors)).toContain('E_FORM_HEAD');
    expect(codes(compileErr('(defn step [] (move 0 0)').errors)).toContain('E_EOF_UNCLOSED');
    expect(codes(compileErr('))').errors)).toContain('E_STRAY_CLOSE');
    expect(codes(compileErr(okSrc('(call (move 0 0))')).errors)).toContain('E_CALL_TARGET');
    expect(codes(compileErr(okSrc('(call if 1)')).errors)).toContain('E_CALL_TARGET');
  });

  it('[invalid] diagnostics carry line and column for the editor gutter', () => {
    const result = compileErr('(defn step []\n   (nobody))\n(every-tick step)');
    expect(result.errors[0]).toMatchObject({ code: 'E_SYM_UNKNOWN', line: 2, col: 4 });
  });
});

describe('compile — state changes', () => {
  it('[state] compiling bot B after bot A with the same fn name is not contaminated', () => {
    const botA = compileOk('(defn g [] 1)\n(defn step [] (call g))\n(every-tick step)');
    expect(botA.cycleEstimate).toBe(4 + (4 + 0 + 1));
    const botB = compileOk('(defn g [] (move 0 0))\n(defn step [] (call g))\n(every-tick step)');
    expect(botB.cycleEstimate).toBe(4 + (4 + 0 + 32));
    // and back again — no memoised cost from either run survives
    expect(compileOk('(defn g [] 1)\n(defn step [] (call g))\n(every-tick step)').cycleEstimate).toBe(9);
  });

  it('[state] a failed compile leaves no residue for the next compile', () => {
    expect(compileErr(okSrc('(call step)')).ok).toBe(false);
    const after = compileOk(okSrc('(move 0 0)'));
    expect(after.cycleEstimate).toBe(36);
    expect(Array.isArray(after.warnings)).toBe(true);
  });

  it('[state] the returned IR is a fresh value every call', () => {
    const src = okSrc('(move 0 0)');
    const first = compileOk(src);
    const second = compileOk(src);
    expect(first.ir).not.toBe(second.ir);
    expect(first.ir).toEqual(second.ir);
  });

  it('[state] warnings are per-compile, never accumulated across calls', () => {
    const tiny = okSrc('(move 1 0)');
    compileOk(tiny);
    compileOk(tiny);
    const third = compileOk(tiny);
    expect(third.warnings).toHaveLength(1);
    expect(compileOk(okSrc('(move 65536 0)')).warnings).toHaveLength(0);
  });

  it('[state] diagnostics carry the position state the editor gutter needs', () => {
    const result = compileErr('(defn step []\n  (if (radar)\n    (fire)))\n(every-tick step)');
    expect(result.errors[0]).toMatchObject({ code: 'E_OPTION_CONDITION', line: 2, col: 7 });
  });
});

describe('compile — repeated calls', () => {
  it('[repeat] compiling the same source twice gives deep-equal results', () => {
    const src = okSrc('(let [f (food)] (if (some? f) (move-at (food-x f) (food-y f)) (move 0 0)))');
    const first = compileOk(src);
    const second = compileOk(src);
    expect(first.ir).toEqual(second.ir);
    expect(first.cycleEstimate).toBe(second.cycleEstimate);
    expect(first.warnings).toEqual(second.warnings);
  });

  it('[repeat] repeated compiles of a verifier-rejecting source are stable', () => {
    const first = compileErr(okSrc('(if (radar) (fire))'));
    const second = compileErr(okSrc('(if (radar) (fire))'));
    expect(first.errors).toEqual(second.errors);
  });

  it('[repeat] tokenizing inside compile matches standalone tokenize output', () => {
    const src = okSrc('(radar)');
    expect(tokenize(src)).toEqual(tokenize(src));
  });
});

describe('compile — determinism', () => {
  const sample = okSrc(
    '(let [e (radar)] (if (some? e) (do (aim (atan2 (- (hit-y e) (self.y)) (- (hit-x e) (self.x)))) (fire)) (move 65536 0)))',
  );

  it('[determinism] the IR is byte-stable for a given source (23 § 5.2.5)', () => {
    const first = JSON.stringify(compileOk(sample).ir);
    for (let i = 0; i < 5; i += 1) {
      expect(JSON.stringify(compileOk(sample).ir)).toBe(first);
    }
  });

  it('[determinism] IR is JSON-serialisable and round-trips identically (20 T05.5)', () => {
    const result = compileOk(sample);
    const ir: IrProgram = JSON.parse(JSON.stringify(result.ir)) as IrProgram;
    expect(ir).toEqual(result.ir);
    expect(ir.tick).toBe('step');
  });

  it('[determinism] key order is stable: fns before tick, op before value', () => {
    const json = JSON.stringify(compileOk(okSrc('(move 0 0)')).ir);
    expect(json.startsWith('{"fns":[{"name":"step","params":[],"body":{"op":"call","fn":"move"')).toBe(true);
    expect(json.endsWith(',"tick":"step"}')).toBe(true);
  });

  it('[determinism] positions ride along but never reach the JSON', () => {
    const result = compileOk(sample);
    expect(JSON.stringify(result.ir)).not.toContain('"line"');
    expect(JSON.stringify(result.ir)).not.toContain('"col"');
  });

  it('[determinism] diagnostics are sorted by position, then code', () => {
    const result = compileErr(
      '(defn step []\n  (do\n    (ghost2)\n    (ghost1)\n    (ghost2)))\n(every-tick step)',
    );
    expect(result.errors.map((e) => `${e.line}:${e.col}:${e.code}`)).toEqual([
      '3:5:E_SYM_UNKNOWN',
      '4:5:E_SYM_UNKNOWN',
      '5:5:E_SYM_UNKNOWN',
    ]);
  });

  it('[determinism] formatDiagnostic substitutes params from the catalog (i18n seam)', () => {
    const diagnostic: Diagnostic = {
      code: 'E_BUDGET',
      line: 3,
      col: 7,
      params: { estimate: 1234, budget: 1000 },
    };
    expect(formatDiagnostic(diagnostic)).toBe(
      '3:7: Static worst-case estimate 1234 cycles/tick exceeds the 1000 budget (09 § 5 rule 3).',
    );
    const arabicLike: Partial<Record<DiagnosticCodeForTest, string>> = {
      E_BUDGET: 'تجاوز البرنامج ميزانية {estimate} دورة',
    };
    expect(formatDiagnostic(diagnostic, arabicLike)).toBe('3:7: تجاوز البرنامج ميزانية 1234 دورة');
    expect(formatDiagnostic({ code: 'E_LEX_STRING' })).toBe(
      'String literals are not part of the DSL.',
    );
  });

  it('[determinism] missing params leave the template intact instead of crashing', () => {
    expect(formatDiagnostic({ code: 'E_SYM_UNKNOWN', params: { name: 'ghost' } })).toContain(
      "Unknown symbol 'ghost' —",
    );
  });
});

type DiagnosticCodeForTest = Parameters<typeof formatDiagnostic>[0]['code'];

describe('warnings (09 § 5 rule 9 and the § 2.4 editor hint)', () => {
  it('[normal] compiling without chassis context emits only source-derived warnings', () => {
    const result = compileOk(okSrc('(do (fire) (build 0))'));
    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it('[normal] fire and build warn against a chassis that lacks the parts', () => {
    const result = compileOk(okSrc('(do (fire) (build 0))'), {
      chassis: { hasWeapon: false, hasConstructor: false, designCount: 1 },
    });
    expect(result.warnings.map((w) => w.code)).toEqual(['W_FIRE_NO_WEAPON', 'W_BUILD_NO_CONSTRUCTOR']);
    expect(result.ok).toBe(true);
  });

  it('[normal] a chassis that owns the parts silences the part warnings', () => {
    const result = compileOk(okSrc('(do (fire) (build 0))'), {
      chassis: { hasWeapon: true, hasConstructor: true, designCount: 2 },
    });
    expect(result.warnings).toHaveLength(0);
  });

  it('[boundary] build index at the designCount edge passes; one past it warns', () => {
    const within = compileOk(okSrc('(build 1)'), {
      chassis: { hasWeapon: true, hasConstructor: true, designCount: 2 },
    });
    expect(within.warnings).toHaveLength(0);
    const outside = compileOk(okSrc('(build 2)'), {
      chassis: { hasWeapon: true, hasConstructor: true, designCount: 2 },
    });
    expect(outside.warnings[0]).toMatchObject({
      code: 'W_BUILD_DESIGN_RANGE',
      params: { index: 2, designs: 2 },
    });
  });

  it('[normal] the move-throttle hint warns below 1000 and not at full throttle', () => {
    expect(compileOk(okSrc('(move 1 0)')).warnings[0]).toMatchObject({
      code: 'W_MOVE_TINY',
      params: { value: 1 },
    });
    expect(compileOk(okSrc('(move 65536 0)')).warnings).toHaveLength(0);
    expect(compileOk(okSrc('(move -65536 0)')).warnings).toHaveLength(0);
    expect(compileOk(okSrc('(move 0 0)')).warnings).toHaveLength(0);
  });

  it('[normal] warnings format through the same i18n seam as errors', () => {
    const result = compileOk(okSrc('(move 1 0)'));
    expect(formatDiagnostic(result.warnings[0]!)).toContain('throttle is Q16.16');
  });
});

describe('static cycle estimator — pinned against 09 § 4', () => {
  // estimate = 4 (entry dispatch) + body; each call bills its table cost
  // plus its argument nodes.
  const cases: [string, number][] = [
    ['(radar)', 4 + 25],
    ['(scan 90)', 4 + 20 + 1],
    ['(food)', 4 + 18],
    ['(ally)', 4 + 25],
    ['(enemy)', 4 + 25],
    ['(fire)', 4 + 40],
    ['(eat)', 4 + 25],
    ['(build 0)', 4 + 50 + 1],
    ['(aim 100)', 4 + 20 + 1],
    ['(say 1 2)', 4 + 10 + 1 + 1],
    ['(move 65536 0)', 4 + 30 + 1 + 1],
    ['(move-at 1 2)', 4 + 30 + 1 + 1],
    ['(time)', 4 + 1],
    ['(rng-int 10)', 4 + 4 + 1],
    ['(dist 1 2 3 4)', 4 + 6 + 4],
    ['(sin 1)', 4 + 6 + 1],
    ['(cos 1)', 4 + 6 + 1],
    ['(atan2 1 2)', 4 + 6 + 2],
    ['(+ 1 2)', 4 + 1 + 2],
    ['(- 1 2)', 4 + 1 + 2],
    ['(* 2 3)', 4 + 2 + 2],
    ['(/ 6 3)', 4 + 3 + 2],
    ['(mod 7 3)', 4 + 3 + 2],
    ['(abs -3)', 4 + 2 + 1],
    ['(min 1 2)', 4 + 2 + 2],
    ['(max 1 2)', 4 + 2 + 2],
    ['(< 1 2)', 4 + 1 + 2],
    ['(== 1 2)', 4 + 1 + 2],
    ['(not true)', 4 + 1 + 1],
    ['(and true false)', 4 + 2 + 2],
    ['(or true false)', 4 + 2 + 2],
    ['(if true 1 2)', 4 + 2 + 1],
    ['(do (time) (time))', 4 + 1 + 1],
    ['(let [x 5] x)', 4 + 1 + 2 + 1],
    ['(self.x)', 4 + 3],
    ['(loop 10 (move 0 0))', 4 + 4 + 10 * 32],
    ['(while true 5 (move 0 0))', 4 + 4 + 5 * (1 + 32)],
  ];

  it.each(cases)('[normal] %s estimates %i cycles/tick', (body, expected) => {
    const result = compileOk(okSrc(body));
    expect(result.cycleEstimate).toBe(expected);
    expect(result.cycleEstimate).toBeLessThanOrEqual(CYCLE_BUDGET);
  });

  it('[normal] a user call bills 4 + nargs plus the callee body (DAG-memoised)', () => {
    const program = compileOk(
      '(defn helper [] (move 0 0))\n(defn step [] (call helper))\n(every-tick step)',
    );
    expect(program.cycleEstimate).toBe(4 + (4 + 0 + 32));
    const twoCalls = compileOk(
      '(defn helper [] (move 0 0))\n(defn step [] (do (call helper) (call helper)))\n(every-tick step)',
    );
    expect(twoCalls.cycleEstimate).toBe(4 + (4 + 0 + 32) + (4 + 0 + 32));
  });

  it('[normal] the estimator takes the worst branch of an if, not the sum', () => {
    const result = compileOk(okSrc('(if true (move 0 0) (eat))'));
    expect(result.cycleEstimate).toBe(4 + 2 + 32);
  });
});

describe('T6 regressions — the starter-bot bugs (AGENTS.md § 3)', () => {
  it('[state] dist keeps its four-argument two-point signature', () => {
    // The shipped bug: (dist 0 0 dx dy) measured from the arena origin. The
    // two-point signature makes the compiler reject the wrong-arity forms
    // and the golden test pins the from-the-bot argument order.
    expect(codes(compileErr(okSrc('(dist 1 2 3)')).errors)).toContain('E_ARITY');
    const pouncer = compileOk(
      '(defn step [] (if (< (dist (self.x) (self.y) 5 6) 30000) (fire)))\n(every-tick step)',
    );
    const dist = findNode(pouncer.ir.fns[0]!.body, (n) => n.op === 'call' && n.fn === 'dist');
    expect(dist).toBeDefined();
    if (dist?.op === 'call') {
      expect(dist.args.slice(0, 2)).toEqual([
        { op: 'self', field: 'x' },
        { op: 'self', field: 'y' },
      ]);
    }
  });

  it('[state] cond without a final else is rejected (the swarm-mind syntax trap)', () => {
    expect(codes(compileErr(okSrc('(cond [(== (time) 0) 0])')).errors)).toContain('E_ARITY');
    expect(compileOk(okSrc('(cond [(== (time) 0) 0] [else 0])')).ok).toBe(true);
  });
});

describe('parser error surface — every malformed shape reports a positioned error', () => {
  it('[invalid] lexer tails: digits glued to letters and double-dotted names', () => {
    expect(() => tokenize('123abc')).toThrowError(/Unexpected character 'a'/);
    expect(() => tokenize('a.b.c')).toThrowError(/only valid inside the reserved self/);
  });

  it('[invalid] top-level shapes: bare symbol, unclosed open, empty list', () => {
    expect(codes(compileErr('step').errors)).toContain('E_TOP_LEVEL');
    expect(codes(compileErr('(').errors)).toContain('E_EMPTY_LIST');
    expect(codes(compileErr('()').errors)).toContain('E_EMPTY_LIST');
  });

  it('[invalid] defn shapes: missing name, non-name name, missing param list, bad params', () => {
    expect(codes(compileErr('(defn)').errors)).toContain('E_FORM_HEAD');
    expect(codes(compileErr('(defn 5 [] 1)').errors)).toContain('E_FORM_HEAD');
    expect(codes(compileErr('(defn step 5 1)').errors)).toContain('E_ARITY');
    expect(codes(compileErr('(defn step [5] 1)').errors)).toContain('E_FORM_HEAD');
    expect(codes(compileErr('(defn step [x').errors)).toContain('E_EOF_UNCLOSED');
    expect(codes(compileErr('(defn step [] 1 2').errors)).toContain('E_ARITY');
  });

  it('[invalid] every-tick shapes: empty, inline form, number, dotted name, extra args', () => {
    expect(codes(compileErr('(defn step [] 1)\n(every-tick)').errors)).toContain('E_ENTRY_INLINE');
    expect(codes(compileErr('(defn step [] 1)\n(every-tick (fire))').errors)).toContain('E_ENTRY_INLINE');
    expect(codes(compileErr('(defn step [] 1)\n(every-tick 5)').errors)).toContain('E_ENTRY_INLINE');
    expect(codes(compileErr('(defn step [] 1)\n(every-tick self.x)').errors)).toContain('E_DOT_NAME');
    expect(
      codes(compileErr('(defn step [] 1)\n(every-tick step step)').errors),
    ).toContain('E_ARITY');
  });

  it('[invalid] expression shapes: empty list, non-name head, stray close', () => {
    expect(codes(compileErr(okSrc('()')).errors)).toContain('E_EMPTY_LIST');
    expect(codes(compileErr(okSrc('(5 6)')).errors)).toContain('E_FORM_HEAD');
    expect(codes(compileErr(okSrc('(if)')).errors)).toContain('E_STRAY_CLOSE');
  });

  it('[invalid] self-head shapes: dotted user name, unknown field, extra argument, eof', () => {
    expect(codes(compileErr(okSrc('(bad.name 1)')).errors)).toContain('E_DOT_NAME');
    expect(codes(compileErr(okSrc('(self.x 1)')).errors)).toContain('E_ARITY');
    expect(codes(compileErr('(defn step [] (self.x').errors)).toContain('E_EOF_UNCLOSED');
  });

  it('[invalid] names in value position: bare self and builtin-as-value get reasons', () => {
    expect(formatDiagnostic(compileErr(okSrc('self.x')).errors[0]!)).toContain('(self.x), (self.y)');
    expect(codes(compileErr(okSrc('self')).errors)).toContain('E_NAME_RESERVED');
    expect(formatDiagnostic(compileErr(okSrc('radar')).errors[0]!)).toContain('call it as (radar)');
    expect(codes(compileErr(okSrc('else')).errors)).toContain('E_NAME_RESERVED');
  });

  it('[invalid] let shapes: eof, pair-mode junk, flat-mode junk, empty bindings', () => {
    expect(codes(compileErr(okSrc('(let')).errors)).toContain('E_ARITY');
    expect(codes(compileErr('(defn step [] (let ([x 5]').errors)).toContain('E_EOF_UNCLOSED');
    expect(codes(compileErr(okSrc('(let ([x 5] 6) x)')).errors)).toContain('E_ARITY');
    expect(codes(compileErr(okSrc('(let [5 6] x)')).errors)).toContain('E_ARITY');
    expect(codes(compileErr('(defn step [] (let [x 5').errors)).toContain('E_EOF_UNCLOSED');
    expect(codes(compileErr(okSrc('(let () x)')).errors)).toContain('E_ARITY');
    // flat bindings also work inside parens — brackets are interchangeable (D21)
    expect(compileOk(okSrc('(let (x 5) x)')).ok).toBe(true);
  });

  it('[invalid] if/while/loop/set arity tails', () => {
    expect(codes(compileErr(okSrc('(if true 1 2 3)')).errors)).toContain('E_ARITY');
    expect(codes(compileErr(okSrc('(while true 4 (fire) (eat))')).errors)).toContain('E_ARITY');
    expect(codes(compileErr(okSrc('(loop 3 (fire) (eat))')).errors)).toContain('E_ARITY');
    expect(codes(compileErr(okSrc('(set)')).errors)).toContain('E_FORM_HEAD');
    expect(codes(compileErr(okSrc('(set x 1 2)')).errors)).toContain('E_ARITY');
  });

  it('[invalid] do/when/return/call tails', () => {
    expect(codes(compileErr('(defn step [] (do (fire)').errors)).toContain('E_EOF_UNCLOSED');
    expect(codes(compileErr('(defn step [] (when true').errors)).toContain('E_EOF_UNCLOSED');
    expect(codes(compileErr(okSrc('(when true)')).errors)).toContain('E_ARITY');
    expect(compileOk(okSrc('(let [x 1] (do (return) x))')).ok).toBe(true);
    expect(codes(compileErr(okSrc('(return 1 2)')).errors)).toContain('E_ARITY');
    expect(codes(compileErr(okSrc('(call)')).errors)).toContain('E_CALL_TARGET');
    expect(codes(compileErr(okSrc('(call self.x)')).errors)).toContain('E_DOT_NAME');
    expect(codes(compileErr('(defn step [] (move 0').errors)).toContain('E_EOF_UNCLOSED');
  });

  it('[invalid] cond clause shapes: eof, clause after else, non-list clause, extra items, empty', () => {
    expect(codes(compileErr('(defn step [] (cond [else 1]').errors)).toContain('E_EOF_UNCLOSED');
    expect(codes(compileErr(okSrc('(cond [else 1] [true 2])')).errors)).toContain('E_ARITY');
    expect(codes(compileErr(okSrc('(cond true [else 1])')).errors)).toContain('E_ARITY');
    expect(codes(compileErr(okSrc('(cond [else 1 2])')).errors)).toContain('E_ARITY');
    expect(codes(compileErr(okSrc('(cond [true 1 2] [else 1])')).errors)).toContain('E_ARITY');
    expect(codes(compileErr(okSrc('(cond)')).errors)).toContain('E_ARITY');
  });

  it('[invalid] formatDiagnostic handles the minimal no-position, no-params shape', () => {
    expect(formatDiagnostic({ code: 'E_ENTRY_INLINE' })).toContain('takes a function name');
  });
});

describe('verifier corner paths', () => {
  it('[state] an untyped parameter flowing through a condition constrains to bool', () => {
    const result = compileOk(
      '(defn check [p] (while p 4 (fire)))\n(defn step [] (call check true))\n(every-tick step)',
    );
    expect(result.ir.fns[0]!.params).toEqual(['p']);
  });

  it('[state] set on an untyped parameter fixes its type from the assigned value', () => {
    const result = compileOk(
      '(defn bump [p] (do (set p 5) p))\n(defn step [] (rng-int (call bump 1)))\n(every-tick step)',
    );
    expect(result.cycleEstimate).toBeGreaterThan(0);
  });

  it('[state] branch unification constrains an untyped parameter from either branch', () => {
    expect(compileOk('(defn f [p] (if true p 5))\n(defn step [] (rng-int (call f 1)))\n(every-tick step)').ok).toBe(true);
    expect(compileOk('(defn f [p] (if true 5 p))\n(defn step [] (rng-int (call f 1)))\n(every-tick step)').ok).toBe(true);
  });

  it('[state] some? on an untyped parameter constrains it to Option', () => {
    const result = compileOk(
      '(defn decide [p] (if (some? p) 1 0))\n(defn step [] (rng-int (+ 1 (call decide (radar)))))\n(every-tick step)',
    );
    expect(result.ok).toBe(true);
  });

  it('[invalid] a payload getter with no argument reports arity, not a payload fault', () => {
    expect(codes(compileErr(okSrc('(hit-x)')).errors)).toContain('E_ARITY');
  });

  it('[normal] rng-int with a computed bound has no static range check', () => {
    expect(compileOk(okSrc('(rng-int (time))')).ok).toBe(true);
  });

  it('[boundary] 33 parameters exceed the locals contract at frame setup', () => {
    const params = Array.from({ length: LOCALS_LIMIT + 1 }, (_, i) => `p${i}`).join(' ');
    const result = compileErr(`(defn f [${params}] p0)\n(every-tick f)`);
    expect(result.errors[0]).toMatchObject({
      code: 'E_LOCALS',
      params: { count: LOCALS_LIMIT + 1, limit: LOCALS_LIMIT },
    });
  });

  it('[state] a function returning an unconstrained parameter is typed Option (safe direction)', () => {
    const result = compileOk(
      '(defn identity [p] p)\n(defn step [] (if (some? (call identity (radar))) (fire) (eat)))\n(every-tick step)',
    );
    expect(result.ok).toBe(true);
    const misused = compileErr(
      '(defn identity [p] p)\n(defn step [] (rng-int (call identity 5)))\n(every-tick step)',
    );
    expect(misused.errors.map((e) => e.code)).toContain('E_TYPE');
  });
});
