// The ForgeBots DSL compiler: source text (or blocks) → verified IR.
//
// One file by design: 23-WEB-CLIENT-PLAN.md § 5 overrides the 300-line
// target (AGENTS.md § 9 resolution 2) — tokenize, parse, lower, verify and
// error formatting are one responsibility, so they live in one file.
//
// Grammar and verifier rules: 09-AI-DSL.md § 2 and § 5. Bracket styles:
// 22-DECISIONS.md D21 (parens and brackets are interchangeable everywhere).
// IR shape: 09 § 3 (JSON-serialisable tree, no bytecode, D2).
// Cost table: 09 § 4, charged identically by the static estimator and
// (in Phase 3) by the VM. The 09 § 4 band "1–2" for cheap arithmetic is
// pinned in BUILTINS: single-step integer ops (+, -, comparisons, not)
// cost 1; shift- or multi-operand ops (*, abs, min, max, and, or) cost 2.
// The table has no `let` or `return` row: a `let` binding is a local write
// and bills COST_STORE; `return` bills nothing — leaving a frame is not a
// step.
//
// Reconciliations this file records (spec is upstream; none are silent):
// - 23 § 5.2 lists set / repeat / return among the parser's forms; 09 § 2.2
//   does not name them. Both surfaces are honoured: `set` stores to a local
//   (23 § 6.1 expects locals for let/set), `repeat` is the plan's spelling
//   of the bounded `loop` form, `return` leaves the enclosing defn.
// - D21 assigns cond's required else to "the verifier". Lowering desugars
//   cond into nested ifs, after which the requirement is not expressible,
//   so the check runs at parse time — same contract (compile error, before
//   save), one stage earlier.
// - 09 § 5 rule 2 requires literal loop bounds. The IR stores bounds as
//   literal numbers by construction, so literalness is checked where the
//   number is extracted (lower), not re-checked later.
// - 09 § 2.3: "the verifier inserts a bounds check before every
//   hit-x/hit-y/food-x/food-y call". The payload getter node itself is that
//   check: the VM traps on a none tag, so its 3-cycle table cost includes
//   the guard and a none read can never yield garbage.
// - A program with zero (every-tick …) forms compiles with tick = null and
//   does nothing (19 § 2.1, pebble: "a different (also supported) case").
// - 19 § 2.1 quotes "~12 cycles/tick" for pebble; 09 § 4 is the canonical
//   table and puts (move 0 0) at 30 + 1 + 1, so the compiled estimate is 36.
//   The table wins (22-DECISIONS.md preamble: the specific doc beats prose).

export interface At {
  line: number;
  col: number;
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

const EN_MESSAGES = {
  E_LEX_FLOAT:
    'Float literals are not allowed — the DSL has integers only (10-DETERMINISM.md § 2.2).',
  E_LEX_STRING: 'String literals are not part of the DSL.',
  E_LEX_CHAR: "Unexpected character '{ch}'.",
  E_LEX_DOT:
    "'.' is only valid inside the reserved self.* namespace (09-AI-DSL.md § 2.2).",
  E_LEX_RANGE: 'Integer literal {v} is outside the 32-bit range (±2147483647).',
  E_EOF_UNCLOSED: 'Unclosed list — reached end of input.',
  E_STRAY_CLOSE:
    "Unmatched '{ch}' — brackets and parens are interchangeable but must balance (D21).",
  E_EMPTY_LIST:
    '() is not a valid form — an empty list is only allowed as a defn parameter list.',
  E_FORM_HEAD: 'The first element of a form must be a name, got {got}.',
  E_TOP_LEVEL:
    'Only (defn …) and (every-tick …) are allowed at the top level, got {form}.',
  E_ARITY: '{form} expects {expected}, got {got}.',
  E_DUP_BINDING: "Duplicate name '{name}' in this scope.",
  E_NAME_RESERVED: "'{name}' is reserved and cannot be used as a name.",
  E_DOT_NAME:
    "User identifiers may not contain '.' — got '{name}' (only self.* is dotted).",
  E_SELF_FIELD:
    "Unknown self field '{field}' — known fields: x, y, hp, shield, energy, biomass, alive.",
  E_SYM_BUILTIN_VALUE:
    "'{name}' is a builtin — builtins are not values, call it as ({name}).",
  E_SYM_FN_VALUE:
    "'{name}' is a defn — functions are not values, use (call {name}).",
  E_SYM_UNRESOLVED:
    "Unknown symbol '{name}' — no local with this name is in scope.",
  E_SYM_NO_TARGET:
    "Unknown symbol '{name}' — no builtin or defn with this name.",
  E_SYM_SELF_BARE:
    "'self' is a namespace, not a value — read it as (self.x), (self.y), …",
  E_ARITY_MIN: '{form} expects at least {min} argument(s), got {got}.',
  E_ARITY_EXACT: '{form} expects exactly {count} argument(s), got {got}.',
  E_ARITY_RANGE:
    '{form} expects between {min} and {max} arguments, got {got}.',
  E_DEFN_DUP: "Function '{name}' is defined more than once.",
  E_ENTRY_MULTIPLE:
    'Exactly one (every-tick …) is allowed per program, found {count} (09 § 5 rule 8).',
  E_ENTRY_UNKNOWN: '(every-tick {name}) does not resolve to a defn.',
  E_ENTRY_ARGS:
    '(every-tick {name}) must name a function that takes zero arguments, got {count}.',
  E_ENTRY_INLINE:
    '(every-tick …) takes a function name, not an inline form (D21).',
  E_RECURSION: 'Calls must form a DAG, found a cycle: {path} (09 § 5 rule 1).',
  E_LOOP_BOUND:
    '{form} needs a literal non-negative integer bound, got {got} (09 § 5 rule 2).',
  E_BUDGET:
    'Static worst-case estimate {estimate} cycles/tick exceeds the {budget} budget (09 § 5 rule 3).',
  E_STACK_DEPTH:
    'Stack depth {depth} exceeds the {limit}-slot limit (09 § 5 rule 4).',
  E_LOCALS:
    '{count} locals exceeds the {limit}-per-frame limit (09 § 5 rule 4).',
  E_OPTION_CONDITION:
    'This condition returns an Option — test it with some? first (09 § 2.3).',
  E_CONDITION_TYPE: 'A condition must be bool, got {got}.',
  E_PAYLOAD_UNPROVEN:
    "'{fn}' reads an Option payload — it is only reachable on a some?-true branch (09 § 5 rule 7).",
  E_SOME_NON_OPTION: '(some? …) tests an Option, got {got}.',
  E_TYPE: 'Type error: expected {expected}, got {got}.',
  E_SET_TARGET: "(set …) target must be a let-bound local, got '{name}'.",
  E_CALL_TARGET: "(call …) target must be a function name, got '{name}'.",
  E_BUILD_INDEX: 'build design index must be 0 or more, got {index}.',
  E_RNG_BOUND:
    'rng-int needs n ≥ 1 — it returns a uniform int in [0, n), got {n} (09 § 2.2).',
  W_MOVE_TINY:
    'move argument {value} is below 1000 — throttle is Q16.16, 65536 = 100 % of top speed (09 § 2.4).',
  W_FIRE_NO_WEAPON:
    'fire has no effect on this chassis: no weapon part (09 § 5 rule 9).',
  W_BUILD_NO_CONSTRUCTOR:
    'build has no effect on this chassis: no Constructor part (09 § 5 rule 9).',
  W_BUILD_DESIGN_RANGE:
    "build design index {index} is outside this bot's {designs} design(s) (09 § 5 rule 9).",
} as const;

export type DiagnosticCode = keyof typeof EN_MESSAGES;

export interface Diagnostic {
  code: DiagnosticCode;
  line?: number;
  col?: number;
  params?: Record<string, string | number>;
}

function diagnostic(
  code: DiagnosticCode,
  at: At | undefined,
  params?: Record<string, string | number>,
): Diagnostic {
  if (at === undefined) {
    return params === undefined ? { code } : { code, params };
  }
  const withPos: Diagnostic = { code, line: at.line, col: at.col };
  if (params !== undefined) withPos.params = params;
  return withPos;
}

// The compiler owns error CODES (tier-2 domain strings, AGENTS.md rule 4);
// the wording lives in a catalog so the i18n layer can swap languages
// without touching this file. formatDiagnostic is the seam the editor calls.
export function formatDiagnostic(
  d: Diagnostic,
  catalog: Partial<Record<DiagnosticCode, string>> = EN_MESSAGES,
): string {
  const template = catalog[d.code] ?? EN_MESSAGES[d.code];
  const message = template.replace(/\{(\w+)\}/g, (whole, key: string) => {
    if (d.params !== undefined && key in d.params) {
      return String(d.params[key]);
    }
    return whole;
  });
  if (d.line === undefined) return message;
  return `${d.line}:${d.col ?? 0}: ${message}`;
}

class CompileError extends Error {
  readonly diagnostic: Diagnostic;

  constructor(broken: Diagnostic) {
    super(formatDiagnostic(broken));
    this.diagnostic = broken;
  }
}

function fail(
  code: DiagnosticCode,
  at: At | undefined,
  params?: Record<string, string | number>,
): never {
  throw new CompileError(diagnostic(code, at, params));
}

function sortDiagnostics(list: Diagnostic[]): Diagnostic[] {
  return [...list].sort((a, b) => {
    const lineDelta = (a.line ?? 0) - (b.line ?? 0);
    if (lineDelta !== 0) return lineDelta;
    const colDelta = (a.col ?? 0) - (b.col ?? 0);
    if (colDelta !== 0) return colDelta;
    return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
  });
}

// ---------------------------------------------------------------------------
// Contracts and cost table (09-AI-DSL.md § 4-5; G4: never widened)
// ---------------------------------------------------------------------------

export const CYCLE_BUDGET = 1000;
export const STACK_LIMIT = 64;
export const LOCALS_LIMIT = 32;
export const INT_LITERAL_LIMIT = 2147483647;

type ValType = 'int' | 'bool' | 'option' | 'void' | 'unknown';

// Display names for the verifier's types — the DSL's published vocabulary
// (tier-2 domain strings, rule 4), owned here and nowhere else.
const TYPENAMES: Readonly<Record<ValType, string>> = {
  int: 'int',
  bool: 'bool',
  option: 'Option',
  void: 'void',
  unknown: 'an untyped parameter',
};

// 09 § 4 costs for the IR ops that are not builtin calls. The table gives
// `if` and the loop forms their own rows; it has no `let` or `return` row —
// a let binding is a local write and bills COST_STORE; return bills
// nothing, since leaving a frame is not a step.
const COST_LITERAL = 1;
const COST_VAR_READ = 1;
const COST_SELF = 3;
const COST_STORE = 2;
const COST_IF = 2;
const COST_LOOP = 4;
const COST_USER_CALL = 4;

// 09 § 2.4: the editor hints when a move axis is a non-zero literal below
// 1000 — the "move 1 0" beginner bug. Throttle is Q16.16: 65536 = 100 %.
const MOVE_TINY_THRESHOLD = 1000;

// The DSL builtin vocabulary is typed exactly once (tier-2 domain strings,
// rule 4); the cost/arity/signature table below is keyed through it, so a
// name can never be present in one table and missing from another (G5).
const BUILTIN_NAME = {
  add: '+',
  sub: '-',
  mul: '*',
  div: '/',
  mod: 'mod',
  abs: 'abs',
  min: 'min',
  max: 'max',
  lessThan: '<',
  lessOrEqual: '<=',
  greaterThan: '>',
  greaterOrEqual: '>=',
  equals: '==',
  notEquals: '!=',
  not: 'not',
  and: 'and',
  or: 'or',
  some: 'some?',
  radar: 'radar',
  scan: 'scan',
  food: 'food',
  ally: 'ally',
  enemy: 'enemy',
  move: 'move',
  moveAt: 'move-at',
  aim: 'aim',
  fire: 'fire',
  eat: 'eat',
  build: 'build',
  say: 'say',
  time: 'time',
  rngInt: 'rng-int',
  dist: 'dist',
  sin: 'sin',
  cos: 'cos',
  atan2: 'atan2',
  hitX: 'hit-x',
  hitY: 'hit-y',
  foodX: 'food-x',
  foodY: 'food-y',
} as const;

type BuiltinName = (typeof BUILTIN_NAME)[keyof typeof BUILTIN_NAME];

export interface BuiltinSpec {
  cost: number;
  // (min, max) argument count; a max of -1 means variadic.
  arity: readonly [number, number];
  arg: ValType;
  ret: ValType;
}

// One row per builtin: 09 § 4's cost column plus § 5's operand signature.
// Argument nodes bill separately; the estimator and the Phase 3 VM both
// charge through this table.
export const BUILTINS: Readonly<Record<BuiltinName, BuiltinSpec>> = {
  [BUILTIN_NAME.add]: { cost: 1, arity: [1, -1], arg: 'int', ret: 'int' },
  [BUILTIN_NAME.sub]: { cost: 1, arity: [1, -1], arg: 'int', ret: 'int' },
  [BUILTIN_NAME.mul]: { cost: 2, arity: [1, -1], arg: 'int', ret: 'int' },
  [BUILTIN_NAME.div]: { cost: 3, arity: [2, -1], arg: 'int', ret: 'int' },
  [BUILTIN_NAME.mod]: { cost: 3, arity: [2, 2], arg: 'int', ret: 'int' },
  [BUILTIN_NAME.abs]: { cost: 2, arity: [1, 1], arg: 'int', ret: 'int' },
  [BUILTIN_NAME.min]: { cost: 2, arity: [1, -1], arg: 'int', ret: 'int' },
  [BUILTIN_NAME.max]: { cost: 2, arity: [1, -1], arg: 'int', ret: 'int' },
  [BUILTIN_NAME.lessThan]: { cost: 1, arity: [2, 2], arg: 'int', ret: 'bool' },
  [BUILTIN_NAME.lessOrEqual]: { cost: 1, arity: [2, 2], arg: 'int', ret: 'bool' },
  [BUILTIN_NAME.greaterThan]: { cost: 1, arity: [2, 2], arg: 'int', ret: 'bool' },
  [BUILTIN_NAME.greaterOrEqual]: { cost: 1, arity: [2, 2], arg: 'int', ret: 'bool' },
  [BUILTIN_NAME.equals]: { cost: 1, arity: [2, 2], arg: 'int', ret: 'bool' },
  [BUILTIN_NAME.notEquals]: { cost: 1, arity: [2, 2], arg: 'int', ret: 'bool' },
  [BUILTIN_NAME.not]: { cost: 1, arity: [1, 1], arg: 'bool', ret: 'bool' },
  [BUILTIN_NAME.and]: { cost: 2, arity: [1, -1], arg: 'bool', ret: 'bool' },
  [BUILTIN_NAME.or]: { cost: 2, arity: [1, -1], arg: 'bool', ret: 'bool' },
  [BUILTIN_NAME.some]: { cost: 3, arity: [1, 1], arg: 'option', ret: 'bool' },
  [BUILTIN_NAME.radar]: { cost: 25, arity: [0, 0], arg: 'int', ret: 'option' },
  [BUILTIN_NAME.scan]: { cost: 20, arity: [1, 1], arg: 'int', ret: 'option' },
  [BUILTIN_NAME.food]: { cost: 18, arity: [0, 0], arg: 'int', ret: 'option' },
  [BUILTIN_NAME.ally]: { cost: 25, arity: [0, 0], arg: 'int', ret: 'option' },
  [BUILTIN_NAME.enemy]: { cost: 25, arity: [0, 0], arg: 'int', ret: 'option' },
  [BUILTIN_NAME.move]: { cost: 30, arity: [2, 2], arg: 'int', ret: 'void' },
  [BUILTIN_NAME.moveAt]: { cost: 30, arity: [2, 2], arg: 'int', ret: 'void' },
  [BUILTIN_NAME.aim]: { cost: 20, arity: [1, 1], arg: 'int', ret: 'void' },
  [BUILTIN_NAME.fire]: { cost: 40, arity: [0, 0], arg: 'int', ret: 'void' },
  [BUILTIN_NAME.eat]: { cost: 25, arity: [0, 0], arg: 'int', ret: 'void' },
  [BUILTIN_NAME.build]: { cost: 50, arity: [1, 1], arg: 'int', ret: 'void' },
  [BUILTIN_NAME.say]: { cost: 10, arity: [2, 2], arg: 'int', ret: 'void' },
  [BUILTIN_NAME.time]: { cost: 1, arity: [0, 0], arg: 'int', ret: 'int' },
  [BUILTIN_NAME.rngInt]: { cost: 4, arity: [1, 1], arg: 'int', ret: 'int' },
  [BUILTIN_NAME.dist]: { cost: 6, arity: [4, 4], arg: 'int', ret: 'int' },
  [BUILTIN_NAME.sin]: { cost: 6, arity: [1, 1], arg: 'int', ret: 'int' },
  [BUILTIN_NAME.cos]: { cost: 6, arity: [1, 1], arg: 'int', ret: 'int' },
  [BUILTIN_NAME.atan2]: { cost: 6, arity: [2, 2], arg: 'int', ret: 'int' },
  [BUILTIN_NAME.hitX]: { cost: 3, arity: [1, 1], arg: 'option', ret: 'int' },
  [BUILTIN_NAME.hitY]: { cost: 3, arity: [1, 1], arg: 'option', ret: 'int' },
  [BUILTIN_NAME.foodX]: { cost: 3, arity: [1, 1], arg: 'option', ret: 'int' },
  [BUILTIN_NAME.foodY]: { cost: 3, arity: [1, 1], arg: 'option', ret: 'int' },
};

const BUILTIN_NAMES: ReadonlySet<string> = new Set(Object.keys(BUILTINS));

// Option payload getters (09 § 2.3) fall out of the table — arg Option,
// return int — instead of a second hand-written list (G5).
const PAYLOAD_GETTERS: ReadonlySet<string> = new Set(
  Object.entries(BUILTINS)
    .filter(([, spec]) => spec.arg === 'option' && spec.ret === 'int')
    .map(([name]) => name),
);

// Own-property lookup: a plain record answers for 'toString' and friends
// through Object.prototype, which would forge a builtin out of thin air.
function builtinSpec(name: string): BuiltinSpec | undefined {
  if (!Object.prototype.hasOwnProperty.call(BUILTINS, name)) return undefined;
  return BUILTINS[name as BuiltinName];
}

// ---------------------------------------------------------------------------
// Tokenizer (09 § 2.1 surface; every token carries line and column)
// ---------------------------------------------------------------------------

export interface Token {
  kind: 'open' | 'close' | 'number' | 'name';
  text: string;
  value?: number;
  line: number;
  col: number;
}

const isDigit = (ch: string): boolean => ch >= '0' && ch <= '9';
const isNameStart = (ch: string): boolean =>
  (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
const isNameChar = (ch: string): boolean =>
  isNameStart(ch) || isDigit(ch) || ch === '-' || ch === '_' || ch === '?';

export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  let col = 1;

  while (i < src.length) {
    const ch = src[i] as string;
    if (ch === '\n') {
      i += 1;
      line += 1;
      col = 1;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      i += 1;
      col += 1;
      continue;
    }
    if (ch === ';') {
      while (i < src.length && src[i] !== '\n') {
        i += 1;
        col += 1;
      }
      continue;
    }
    if (ch === '(' || ch === '[') {
      tokens.push({ kind: 'open', text: ch, line, col });
      i += 1;
      col += 1;
      continue;
    }
    if (ch === ')' || ch === ']') {
      tokens.push({ kind: 'close', text: ch, line, col });
      i += 1;
      col += 1;
      continue;
    }
    if (ch === '"') {
      fail('E_LEX_STRING', { line, col });
    }
    if (ch === '.') {
      fail('E_LEX_DOT', { line, col });
    }
    if (isDigit(ch) || (ch === '-' && isDigit(src[i + 1] ?? ''))) {
      const startLine = line;
      const startCol = col;
      const start = i;
      if (ch === '-') {
        i += 1;
      }
      while (i < src.length && isDigit(src[i] as string)) {
        i += 1;
      }
      col += i - start;
      const text = src.slice(start, i);
      // Lexer errors point at the offending character: after the digit run,
      // col is exactly the column of the next unread character.
      if (src[i] === '.') {
        fail('E_LEX_FLOAT', { line, col });
      }
      if (i < src.length && isNameChar(src[i] as string)) {
        fail('E_LEX_CHAR', { line, col }, { ch: src[i] as string });
      }
      const value = Number(text);
      if (
        !Number.isInteger(value) ||
        value > INT_LITERAL_LIMIT ||
        value < -INT_LITERAL_LIMIT
      ) {
        fail('E_LEX_RANGE', { line: startLine, col: startCol }, { v: text });
      }
      tokens.push({
        kind: 'number',
        text,
        value,
        line: startLine,
        col: startCol,
      });
      continue;
    }
    if (isNameStart(ch)) {
      const startLine = line;
      const startCol = col;
      const start = i;
      while (i < src.length && isNameChar(src[i] as string)) {
        i += 1;
      }
      col += i - start;
      if (src[i] === '.') {
        // A dotted name is exactly one dot plus a field: self.x — never
        // a.b.c, never a trailing dot (09 § 2.2 naming rules).
        if (!isNameChar(src[i + 1] ?? '')) {
          fail('E_LEX_DOT', { line, col });
        }
        const dotStart = i;
        i += 1;
        while (i < src.length && isNameChar(src[i] as string)) {
          i += 1;
        }
        col += i - dotStart;
        if (src[i] === '.') {
          fail('E_LEX_DOT', { line, col });
        }
      }
      tokens.push({
        kind: 'name',
        text: src.slice(start, i),
        line: startLine,
        col: startCol,
      });
      continue;
    }
    if (ch === '-' || ch === '+' || ch === '*' || ch === '/') {
      tokens.push({ kind: 'name', text: ch, line, col });
      i += 1;
      col += 1;
      continue;
    }
    if (ch === '<' || ch === '>' || ch === '=' || ch === '!') {
      const startCol = col;
      let text = ch;
      i += 1;
      col += 1;
      if (src[i] === '=') {
        text += '=';
        i += 1;
        col += 1;
      }
      tokens.push({ kind: 'name', text, line, col: startCol });
      continue;
    }
    fail('E_LEX_CHAR', { line, col }, { ch });
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Parser (09 § 2.2 forms; recursive descent, 20-IMPLEMENTATION-PLAN T04.3)
// ---------------------------------------------------------------------------

type Ast =
  | { kind: 'num'; value: number; at: At }
  | { kind: 'bool'; value: boolean; at: At }
  | { kind: 'name'; id: string; at: At }
  | { kind: 'self'; field: string; at: At }
  | { kind: 'call'; callee: string; args: Ast[]; at: At }
  | { kind: 'if'; cond: Ast; then: Ast; else: Ast | null; at: At }
  | { kind: 'do'; body: Ast[]; at: At }
  | { kind: 'let'; bindings: BindingAst[]; body: Ast; at: At }
  | { kind: 'set'; target: string; value: Ast; at: At }
  | { kind: 'while'; cond: Ast; maxIters: Ast; body: Ast; at: At }
  | { kind: 'loop'; count: Ast; body: Ast; at: At }
  | { kind: 'return'; value: Ast | null; at: At };

interface BindingAst {
  name: string;
  value: Ast;
  at: At;
}

interface DefnAst {
  name: string;
  params: string[];
  body: Ast;
  at: At;
}

const SELF_PREFIX = 'self.';

const SELF_FIELDS: Readonly<Record<string, 'int' | 'bool'>> = {
  x: 'int',
  y: 'int',
  hp: 'int',
  shield: 'int',
  energy: 'int',
  biomass: 'int',
  alive: 'bool',
};

const isDotted = (name: string): boolean => name.includes('.');

function checkPlainName(name: string, at: At): void {
  if (isDotted(name)) {
    fail('E_DOT_NAME', at, { name });
  }
  if (RESERVED_NAMES.has(name)) {
    fail('E_NAME_RESERVED', at, { name });
  }
}

interface ParsedProgram {
  defns: DefnAst[];
  entries: { name: string; at: At }[];
}

// One row per top-level form; the keys are the single owner of those
// strings, and SPECIAL_FORMS derives from both maps (G5).
type TopLevelAst =
  | { kind: 'defn'; defn: DefnAst }
  | { kind: 'entry'; entry: { name: string; at: At } };

const TOP_LEVEL_PARSERS: ReadonlyMap<
  string,
  (cursor: TokenCursor, at: At) => TopLevelAst
> = new Map<string, (cursor: TokenCursor, at: At) => TopLevelAst>([
  ['defn', (cursor, at) => ({ kind: 'defn', defn: parseDefn(cursor, at) })],
  [
    'every-tick',
    (cursor, at) => ({ kind: 'entry', entry: parseEveryTick(cursor, at) }),
  ],
]);

// One row per special form (09 § 2.2 plus 23 § 5.2's set/repeat/return);
// parseExpr dispatches through this map instead of an if-chain (G23), and
// the reserved-name sets derive from it. `repeat` is the plan's spelling of
// the bounded `loop` form.
type FormParser = (cursor: TokenCursor, at: At) => Ast;

const FORM_PARSERS: ReadonlyMap<string, FormParser> = new Map([
  ['let', parseLet],
  ['set', parseSet],
  ['if', parseIf],
  ['while', parseWhile],
  ['loop', (cursor, at) => parseLoop(cursor, at, 'loop')],
  ['repeat', (cursor, at) => parseLoop(cursor, at, 'repeat')],
  ['do', parseDo],
  ['cond', parseCond],
  ['when', parseWhen],
  ['return', parseReturn],
  ['call', parseCall],
]);

const SPECIAL_FORMS: ReadonlySet<string> = new Set([
  ...FORM_PARSERS.keys(),
  ...TOP_LEVEL_PARSERS.keys(),
]);

const RESERVED_NAMES: ReadonlySet<string> = new Set([
  ...SPECIAL_FORMS,
  ...BUILTIN_NAMES,
  'else',
  'true',
  'false',
  'self',
]);

class TokenCursor {
  readonly tokens: Token[];
  private index = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  peek(): Token | undefined {
    return this.tokens[this.index];
  }

  next(): Token | undefined {
    const token = this.tokens[this.index];
    if (token !== undefined) this.index += 1;
    return token;
  }
}

function parseProgram(tokens: Token[]): ParsedProgram {
  const cursor = new TokenCursor(tokens);
  const defns: DefnAst[] = [];
  const entries: { name: string; at: At }[] = [];

  for (;;) {
    const token = cursor.peek();
    if (token === undefined) break;
    if (token.kind === 'close') {
      cursor.next();
      fail('E_STRAY_CLOSE', { line: token.line, col: token.col }, { ch: token.text });
    }
    if (token.kind !== 'open') {
      cursor.next();
      fail('E_TOP_LEVEL', { line: token.line, col: token.col }, { form: token.text });
    }
    const head = cursor.next();
    const inner = cursor.peek();
    if (head === undefined || inner === undefined) {
      fail('E_EMPTY_LIST', { line: token.line, col: token.col });
    }
    if (inner.kind === 'close') {
      cursor.next();
      fail('E_EMPTY_LIST', { line: token.line, col: token.col });
    }
    if (inner.kind !== 'name') {
      cursor.next();
      fail('E_FORM_HEAD', { line: inner.line, col: inner.col }, { got: inner.text });
    }
    cursor.next();
    const at: At = { line: inner.line, col: inner.col };
    const parseTop = TOP_LEVEL_PARSERS.get(inner.text);
    if (parseTop === undefined) {
      fail('E_TOP_LEVEL', at, { form: inner.text });
    }
    const parsed = parseTop(cursor, at);
    if (parsed.kind === 'defn') {
      defns.push(parsed.defn);
    } else {
      entries.push(parsed.entry);
    }
  }

  if (defns.length + entries.length === 0) {
    // A source with nothing but comments is legal and does nothing; it
    // behaves like the no-entry-point program pebble documents.
    return { defns, entries };
  }

  const seen = new Set<string>();
  for (const defn of defns) {
    if (seen.has(defn.name)) {
      fail('E_DEFN_DUP', defn.at, { name: defn.name });
    }
    seen.add(defn.name);
  }
  return { defns, entries };
}

function parseDefn(cursor: TokenCursor, at: At): DefnAst {
  const nameToken = cursor.next();
  if (nameToken === undefined || nameToken.kind !== 'name') {
    const got = nameToken?.text ?? 'end of input';
    fail('E_FORM_HEAD', at, { got });
  }
  checkPlainName(nameToken.text, { line: nameToken.line, col: nameToken.col });

  const open = cursor.next();
  if (open === undefined || open.kind !== 'open') {
    const at2 =
      open === undefined
        ? { line: at.line, col: at.col }
        : { line: open.line, col: open.col };
    fail('E_ARITY', at2, { form: 'defn', expected: 'a parameter list', got: open?.text ?? 'end of input' });
  }
  const params: string[] = [];
  const paramSeen = new Set<string>();
  for (;;) {
    const token = cursor.peek();
    if (token === undefined) {
      fail('E_EOF_UNCLOSED', { line: at.line, col: at.col });
    }
    if (token.kind === 'close') {
      cursor.next();
      break;
    }
    cursor.next();
    if (token.kind !== 'name') {
      fail('E_FORM_HEAD', { line: token.line, col: token.col }, { got: token.text });
    }
    checkPlainName(token.text, { line: token.line, col: token.col });
    if (paramSeen.has(token.text)) {
      fail('E_DUP_BINDING', { line: token.line, col: token.col }, { name: token.text });
    }
    paramSeen.add(token.text);
    params.push(token.text);
  }

  const body = parseBody(cursor, 'defn', at);
  return { name: nameToken.text, params, body, at };
}

function parseEveryTick(cursor: TokenCursor, at: At): { name: string; at: At } {
  const token = cursor.next();
  if (token === undefined) {
    fail('E_ARITY', at, { form: 'every-tick', expected: 'a function name', got: 'end of input' });
  }
  if (token.kind !== 'name') {
    fail('E_ENTRY_INLINE', { line: token.line, col: token.col });
  }
  if (isDotted(token.text)) {
    fail('E_DOT_NAME', { line: token.line, col: token.col }, { name: token.text });
  }
  const close = cursor.next();
  if (close === undefined || close.kind !== 'close') {
    fail('E_ARITY', at, { form: 'every-tick', expected: 'exactly one function name', got: 'more than one argument' });
  }
  return { name: token.text, at };
}

// Parses 1+ expressions as a defn body, wrapping multiples in an implicit do.
function parseBody(cursor: TokenCursor, form: string, at: At): Ast {
  const first = parseExpr(cursor);
  const token = cursor.peek();
  if (token === undefined) {
    fail('E_EOF_UNCLOSED', at);
  }
  if (token.kind === 'close') {
    cursor.next();
    return first;
  }
  const rest: Ast[] = [first];
  for (;;) {
    const nextToken = cursor.peek();
    if (nextToken === undefined) {
      fail('E_ARITY', at, { form, expected: 'a closing bracket', got: 'end of input' });
    }
    if (nextToken.kind === 'close') {
      cursor.next();
      break;
    }
    rest.push(parseExpr(cursor));
  }
  return { kind: 'do', body: rest, at };
}

function parseExpr(cursor: TokenCursor): Ast {
  const token = cursor.next();
  if (token === undefined) {
    fail('E_EOF_UNCLOSED', undefined);
  }
  const at: At = { line: token.line, col: token.col };

  if (token.kind === 'number') {
    return { kind: 'num', value: token.value ?? 0, at };
  }
  if (token.kind === 'close') {
    fail('E_STRAY_CLOSE', at, { ch: token.text });
  }
  if (token.kind === 'name') {
    return parseNameExpr(token.text, at);
  }

  // token.kind === 'open': a form.
  const head = cursor.next();
  if (head === undefined) {
    fail('E_EOF_UNCLOSED', at);
  }
  if (head.kind === 'close') {
    fail('E_EMPTY_LIST', at);
  }
  if (head.kind !== 'name') {
    fail('E_FORM_HEAD', { line: head.line, col: head.col }, { got: head.text });
  }
  const headAt: At = { line: head.line, col: head.col };

  if (isDotted(head.text)) {
    const field = parseSelfHead(head.text, headAt, cursor);
    return { kind: 'self', field, at };
  }
  if (TOP_LEVEL_PARSERS.has(head.text)) {
    fail('E_TOP_LEVEL', headAt, { form: head.text });
  }
  const parseForm = FORM_PARSERS.get(head.text);
  if (parseForm !== undefined) return parseForm(cursor, at);
  return parseCallArgs(cursor, head.text, at);
}

// A dotted head must be exactly self.<known field>; anything else is either
// a misspelled field or a dotted user identifier (09 § 2.2 naming rules).
// Own-property check: 'toString' in SELF_FIELDS is true through
// Object.prototype and must not pass as a field.
function parseSelfHead(text: string, at: At, cursor: TokenCursor): string {
  if (!text.startsWith(SELF_PREFIX)) {
    fail('E_DOT_NAME', at, { name: text });
  }
  const field = text.slice(SELF_PREFIX.length);
  if (!Object.prototype.hasOwnProperty.call(SELF_FIELDS, field)) {
    fail('E_SELF_FIELD', at, { field });
  }
  const extra = cursor.peek();
  if (extra === undefined) {
    fail('E_EOF_UNCLOSED', at);
  }
  if (extra.kind === 'close') {
    cursor.next();
    return field;
  }
  fail('E_ARITY', at, { form: `self.${field}`, expected: 'no arguments', got: 'an argument' });
}

function parseNameExpr(text: string, at: At): Ast {
  if (text === 'true') return { kind: 'bool', value: true, at };
  if (text === 'false') return { kind: 'bool', value: false, at };
  if (BUILTIN_NAMES.has(text)) {
    fail('E_SYM_BUILTIN_VALUE', at, { name: text });
  }
  if (RESERVED_NAMES.has(text)) {
    fail('E_NAME_RESERVED', at, { name: text });
  }
  if (text === 'self' || text.startsWith(SELF_PREFIX)) {
    fail('E_SYM_SELF_BARE', at, { name: text });
  }
  return { kind: 'name', id: text, at };
}

function parseLet(cursor: TokenCursor, at: At): Ast {
  const open = cursor.next();
  if (open === undefined || open.kind !== 'open') {
    fail('E_ARITY', at, { form: 'let', expected: 'a bindings list', got: open?.text ?? 'end of input' });
  }
  const bindings: BindingAst[] = [];
  const bindingSeen = new Set<string>();
  const parseBindingName = (): Token => {
    const nameToken = cursor.next();
    if (nameToken === undefined || nameToken.kind !== 'name') {
      fail('E_FORM_HEAD', at, { got: nameToken?.text ?? 'end of input' });
    }
    checkPlainName(nameToken.text, { line: nameToken.line, col: nameToken.col });
    if (bindingSeen.has(nameToken.text)) {
      fail('E_DUP_BINDING', { line: nameToken.line, col: nameToken.col }, { name: nameToken.text });
    }
    bindingSeen.add(nameToken.text);
    return nameToken;
  };

  const first = cursor.peek();
  if (first === undefined) {
    fail('E_EOF_UNCLOSED', at);
  }
  if (first.kind === 'open') {
    // Pair style: (let ((x 5) (y 7)) body) — the starter bots' spelling.
    for (;;) {
      const token = cursor.peek();
      if (token === undefined) {
        fail('E_EOF_UNCLOSED', at);
      }
      if (token.kind === 'close') {
        cursor.next();
        break;
      }
      if (token.kind !== 'open') {
        cursor.next();
        fail('E_ARITY', { line: token.line, col: token.col }, {
          form: 'let binding',
          expected: 'a (name expr) pair',
          got: token.text,
        });
      }
      cursor.next();
      const nameToken = parseBindingName();
      const value = parseExpr(cursor);
      const close = cursor.next();
      if (close === undefined || close.kind !== 'close') {
        fail('E_ARITY', at, { form: 'let binding', expected: 'a (name expr) pair', got: 'the wrong shape' });
      }
      bindings.push({ name: nameToken.text, value, at: { line: nameToken.line, col: nameToken.col } });
    }
  } else {
    // Flat style: (let [x 5 y 7] body) — the 09 § 2.2 surface grammar.
    for (;;) {
      const token = cursor.peek();
      if (token === undefined) {
        fail('E_EOF_UNCLOSED', at);
      }
      if (token.kind === 'close') {
        cursor.next();
        break;
      }
      if (token.kind !== 'name') {
        cursor.next();
        fail('E_ARITY', { line: token.line, col: token.col }, {
          form: 'let bindings',
          expected: 'name expr alternation',
          got: token.text,
        });
      }
      const nameToken = parseBindingName();
      const value = parseExpr(cursor);
      bindings.push({ name: nameToken.text, value, at: { line: nameToken.line, col: nameToken.col } });
    }
  }
  if (bindings.length === 0) {
    fail('E_ARITY', at, { form: 'let', expected: 'one or more bindings', got: 'none' });
  }
  const body = parseBody(cursor, 'let', at);
  return { kind: 'let', bindings, body, at };
}

function parseSet(cursor: TokenCursor, at: At): Ast {
  const target = cursor.next();
  if (target === undefined || target.kind !== 'name') {
    fail('E_FORM_HEAD', at, { got: target?.text ?? 'end of input' });
  }
  checkPlainName(target.text, { line: target.line, col: target.col });
  const value = parseExpr(cursor);
  const close = cursor.next();
  if (close === undefined || close.kind !== 'close') {
    fail('E_ARITY', at, { form: 'set', expected: 'exactly 2 arguments', got: 'more' });
  }
  return { kind: 'set', target: target.text, value, at };
}

function parseIf(cursor: TokenCursor, at: At): Ast {
  const cond = parseExpr(cursor);
  const then = parseExpr(cursor);
  const maybeElse = cursor.peek();
  if (maybeElse !== undefined && maybeElse.kind === 'close') {
    cursor.next();
    return { kind: 'if', cond, then, else: null, at };
  }
  const elseAst = parseExpr(cursor);
  const close = cursor.next();
  if (close === undefined || close.kind !== 'close') {
    fail('E_ARITY', at, { form: 'if', expected: '2 or 3 arguments', got: 'more' });
  }
  return { kind: 'if', cond, then, else: elseAst, at };
}

function parseWhile(cursor: TokenCursor, at: At): Ast {
  const cond = parseExpr(cursor);
  const maxIters = parseExpr(cursor);
  const body = parseExpr(cursor);
  const close = cursor.next();
  if (close === undefined || close.kind !== 'close') {
    fail('E_ARITY', at, { form: 'while', expected: 'exactly 3 arguments (cond, max-iters, body)', got: 'more' });
  }
  return { kind: 'while', cond, maxIters, body, at };
}

function parseLoop(cursor: TokenCursor, at: At, form: string): Ast {
  const count = parseExpr(cursor);
  const body = parseExpr(cursor);
  const close = cursor.next();
  if (close === undefined || close.kind !== 'close') {
    fail('E_ARITY', at, { form, expected: 'exactly 2 arguments (count, body)', got: 'more' });
  }
  return { kind: 'loop', count, body, at };
}

function parseDo(cursor: TokenCursor, at: At): Ast {
  const body: Ast[] = [];
  for (;;) {
    const token = cursor.peek();
    if (token === undefined) {
      fail('E_EOF_UNCLOSED', at);
    }
    if (token.kind === 'close') {
      cursor.next();
      break;
    }
    body.push(parseExpr(cursor));
  }
  return { kind: 'do', body, at };
}

function parseCond(cursor: TokenCursor, at: At): Ast {
  interface Clause {
    test: Ast | null;
    expr: Ast;
  }
  const clauses: Clause[] = [];
  let sawElse = false;
  for (;;) {
    const token = cursor.peek();
    if (token === undefined) {
      fail('E_EOF_UNCLOSED', at);
    }
    if (token.kind === 'close') {
      cursor.next();
      break;
    }
    if (sawElse) {
      fail('E_ARITY', { line: token.line, col: token.col }, {
        form: 'cond',
        expected: 'the else clause to be final',
        got: 'a clause after else',
      });
    }
    if (token.kind !== 'open') {
      cursor.next();
      fail('E_ARITY', { line: token.line, col: token.col }, {
        form: 'cond clause',
        expected: 'a [test expr] list',
        got: token.text,
      });
    }
    cursor.next();
    // `else` is only recognised as a clause HEAD; parse it before the test
    // so the reserved-name guard in parseNameExpr does not fire first.
    const head = cursor.peek();
    if (head !== undefined && head.kind === 'name' && head.text === 'else') {
      cursor.next();
      const elseExpr = parseExpr(cursor);
      const elseClose = cursor.next();
      if (elseClose === undefined || elseClose.kind !== 'close') {
        fail('E_ARITY', at, { form: 'cond clause', expected: 'exactly 2 expressions', got: 'more' });
      }
      sawElse = true;
      clauses.push({ test: null, expr: elseExpr });
      continue;
    }
    const test = parseExpr(cursor);
    const expr = parseExpr(cursor);
    const close = cursor.next();
    if (close === undefined || close.kind !== 'close') {
      fail('E_ARITY', at, { form: 'cond clause', expected: 'exactly 2 expressions', got: 'more' });
    }
    clauses.push({ test, expr });
  }
  if (clauses.length === 0) {
    fail('E_ARITY', at, {
      form: 'cond',
      expected: 'at least one [test expr] and a final [else expr]',
      got: 'no clauses',
    });
  }
  if (!sawElse) {
    // D21: "at least one else required by the verifier" — see the file
    // header for why this check runs here rather than after lowering.
    fail('E_ARITY', at, { form: 'cond', expected: 'a final [else expr] clause', got: 'none' });
  }
  return desugarCond(clauses, at);
}

// (cond [t1 e1] … [else en]) → nested ifs, else innermost. Desugaring keeps
// the IR small (D2) and makes the § 4 estimator's "worst branch of every
// if/cond" rule fall out of the plain if rule.
function desugarCond(clauses: { test: Ast | null; expr: Ast }[], at: At): Ast {
  let chain: Ast = clauses[clauses.length - 1]!.expr;
  for (let i = clauses.length - 2; i >= 0; i -= 1) {
    const clause = clauses[i]!;
    chain = { kind: 'if', cond: clause.test!, then: clause.expr, else: chain, at };
  }
  return chain;
}

function parseWhen(cursor: TokenCursor, at: At): Ast {
  const cond = parseExpr(cursor);
  const body: Ast[] = [];
  for (;;) {
    const token = cursor.peek();
    if (token === undefined) {
      fail('E_EOF_UNCLOSED', at);
    }
    if (token.kind === 'close') {
      cursor.next();
      break;
    }
    body.push(parseExpr(cursor));
  }
  if (body.length === 0) {
    fail('E_ARITY', at, { form: 'when', expected: 'a condition and at least one body expression', got: 'no body' });
  }
  const then: Ast = body.length === 1 ? body[0]! : { kind: 'do', body, at };
  return { kind: 'if', cond, then, else: null, at };
}

function parseReturn(cursor: TokenCursor, at: At): Ast {
  const token = cursor.peek();
  if (token !== undefined && token.kind === 'close') {
    cursor.next();
    return { kind: 'return', value: null, at };
  }
  const value = parseExpr(cursor);
  const close = cursor.next();
  if (close === undefined || close.kind !== 'close') {
    fail('E_ARITY', at, { form: 'return', expected: '0 or 1 arguments', got: 'more' });
  }
  return { kind: 'return', value, at };
}

function parseCall(cursor: TokenCursor, at: At): Ast {
  const target = cursor.next();
  if (target === undefined) {
    fail('E_ARITY', at, { form: 'call', expected: 'a function name', got: 'end of input' });
  }
  if (target.kind !== 'name') {
    fail('E_CALL_TARGET', { line: target.line, col: target.col }, { name: target.text });
  }
  if (isDotted(target.text)) {
    fail('E_DOT_NAME', { line: target.line, col: target.col }, { name: target.text });
  }
  if (SPECIAL_FORMS.has(target.text)) {
    fail('E_CALL_TARGET', { line: target.line, col: target.col }, { name: target.text });
  }
  return parseCallArgs(cursor, target.text, at);
}

function parseCallArgs(cursor: TokenCursor, callee: string, at: At): Ast {
  const args: Ast[] = [];
  for (;;) {
    const token = cursor.peek();
    if (token === undefined) {
      fail('E_EOF_UNCLOSED', at);
    }
    if (token.kind === 'close') {
      cursor.next();
      break;
    }
    args.push(parseExpr(cursor));
  }
  return { kind: 'call', callee, args, at };
}

// ---------------------------------------------------------------------------
// IR (09 § 3: a JSON-serialisable tree; D2: no bytecode, the VM walks this)
// ---------------------------------------------------------------------------

export type IrNode =
  | { op: 'num'; v: number }
  | { op: 'bool'; v: boolean }
  | { op: 'var'; name: string }
  | { op: 'self'; field: string }
  | { op: 'store'; name: string; value: IrNode }
  | { op: 'do'; body: IrNode[] }
  | { op: 'if'; cond: IrNode; then: IrNode; else?: IrNode }
  | { op: 'let'; bindings: { name: string; value: IrNode }[]; body: IrNode }
  | { op: 'while'; cond: IrNode; maxIters: number; body: IrNode }
  | { op: 'loop'; count: number; body: IrNode }
  | { op: 'call'; fn: string; args: IrNode[] }
  | { op: 'return'; value?: IrNode };

export interface IrFn {
  name: string;
  params: string[];
  body: IrNode;
}

export interface IrProgram {
  fns: IrFn[];
  tick: string | null;
}

// Source positions ride along as a non-enumerable property: they are
// available to diagnostics on the text path, invisible to JSON.stringify
// (byte-stable IR) and absent on the blocks path, which has no lines.
function withAt<T extends IrNode>(node: T, at: At): T {
  Object.defineProperty(node, 'at', {
    value: at,
    enumerable: false,
    writable: true,
    configurable: true,
  });
  return node;
}

function atOf(node: object): At | undefined {
  return (node as { at?: At }).at;
}

interface LoweredProgram {
  fns: IrFn[];
  entryName: string | null;
  entryAt: At | undefined;
}

function lowerProgram(parsed: ParsedProgram): LoweredProgram {
  const fns = parsed.defns.map((defn) => ({
    name: defn.name,
    params: defn.params,
    body: lowerNode(defn.body),
  }));
  const entry = parsed.entries[0];
  return {
    fns,
    entryName: entry?.name ?? null,
    entryAt: entry === undefined ? undefined : { line: entry.at.line, col: entry.at.col },
  };
}

function lowerNode(ast: Ast): IrNode {
  switch (ast.kind) {
    case 'num':
      return withAt({ op: 'num', v: ast.value }, ast.at);
    case 'bool':
      return withAt({ op: 'bool', v: ast.value }, ast.at);
    case 'name':
      return withAt({ op: 'var', name: ast.id }, ast.at);
    case 'self':
      return withAt({ op: 'self', field: ast.field }, ast.at);
    case 'call':
      return withAt(
        { op: 'call', fn: ast.callee, args: ast.args.map(lowerNode) },
        ast.at,
      );
    case 'if': {
      const cond = lowerNode(ast.cond);
      const then = lowerNode(ast.then);
      if (ast.else === null) {
        return withAt({ op: 'if', cond, then }, ast.at);
      }
      return withAt({ op: 'if', cond, then, else: lowerNode(ast.else) }, ast.at);
    }
    case 'do':
      return withAt({ op: 'do', body: ast.body.map(lowerNode) }, ast.at);
    case 'let':
      return withAt(
        {
          op: 'let',
          bindings: ast.bindings.map((binding) => ({
            name: binding.name,
            value: lowerNode(binding.value),
          })),
          body: lowerNode(ast.body),
        },
        ast.at,
      );
    case 'set':
      return withAt(
        { op: 'store', name: ast.target, value: lowerNode(ast.value) },
        ast.at,
      );
    case 'while':
      return withAt(
        {
          op: 'while',
          cond: lowerNode(ast.cond),
          maxIters: literalBound(ast.maxIters, 'while', ast.at),
          body: lowerNode(ast.body),
        },
        ast.at,
      );
    case 'loop':
      return withAt(
        {
          op: 'loop',
          count: literalBound(ast.count, 'loop', ast.at),
          body: lowerNode(ast.body),
        },
        ast.at,
      );
    case 'return': {
      if (ast.value === null) return withAt({ op: 'return' }, ast.at);
      return withAt({ op: 'return', value: lowerNode(ast.value) }, ast.at);
    }
  }
}

// 09 § 5 rule 2: a missing or non-literal bound is a compile error — there
// is no runtime discovery path. The IR field is a literal number by
// construction, so this is where the rule lives (see the file header).
function literalBound(ast: Ast, form: string, at: At): number {
  if (ast.kind === 'num') {
    if (ast.value < 0) {
      fail('E_LOOP_BOUND', at, { form, got: String(ast.value) });
    }
    return ast.value;
  }
  const got =
    ast.kind === 'name' ? `'${ast.id}' (not a literal)` : 'a non-literal form';
  fail('E_LOOP_BOUND', at, { form, got });
}

// ---------------------------------------------------------------------------
// Verifier (09 § 5, the nine rules) and the static cycle estimator
// ---------------------------------------------------------------------------

// An Option occupies two stack slots (tag + payload, 09 § 2.3); a value one;
// void nothing. An unconstrained parameter may be an Option, so it reserves
// two — the conservative direction (G4).
function slotsOf(t: ValType): number {
  if (t === 'option' || t === 'unknown') return 2;
  if (t === 'void') return 0;
  return 1;
}

const max2 = (a: number, b: number): number => (a > b ? a : b);

export interface ChassisContext {
  hasWeapon: boolean;
  hasConstructor: boolean;
  designCount: number;
}

export interface CompileOptions {
  chassis?: ChassisContext;
}

interface VarInfo {
  type: ValType;
  provenSome: boolean;
  isParam: boolean;
}

interface Scope {
  vars: Map<string, VarInfo>;
  parent: Scope | null;
}

function resolve(scope: Scope, name: string): VarInfo | undefined {
  let current: Scope | null = scope;
  while (current !== null) {
    const info = current.vars.get(name);
    if (info !== undefined) return info;
    current = current.parent;
  }
  return undefined;
}

interface FnInfo {
  fn: IrFn;
  state: 'unchecked' | 'open' | 'done';
  bodyCost: number;
  retType: ValType;
  paramTypes: ValType[];
}

interface VerifyFrame {
  errors: Diagnostic[];
  warnings: Diagnostic[];
  fns: Map<string, FnInfo>;
  callStack: string[];
  chassis: ChassisContext | null;
}

interface FnCheck {
  localsUsed: number;
  depthReported: boolean;
  localsReported: boolean;
}

interface WalkResult {
  type: ValType;
  cost: number;
  depth: number;
  varInfo?: VarInfo;
}

function expectType(
  result: WalkResult,
  expected: ValType,
  frame: VerifyFrame,
  at: At | undefined,
): WalkResult {
  if (expected === 'unknown' || result.type === expected) return result;
  if (result.type === 'unknown') {
    if (result.varInfo !== undefined) result.varInfo.type = expected;
    return { ...result, type: expected };
  }
  frame.errors.push(
    diagnostic('E_TYPE', at, {
      expected: TYPENAMES[expected],
      got: TYPENAMES[result.type],
    }),
  );
  return { ...result, type: expected };
}

function checkCondition(
  result: WalkResult,
  frame: VerifyFrame,
  at: At | undefined,
): void {
  if (result.type === 'bool') return;
  if (result.type === 'option') {
    frame.errors.push(diagnostic('E_OPTION_CONDITION', at));
    return;
  }
  if (result.type === 'unknown') {
    if (result.varInfo !== undefined) result.varInfo.type = 'bool';
    return;
  }
  frame.errors.push(
    diagnostic('E_CONDITION_TYPE', at, { got: TYPENAMES[result.type] }),
  );
}

// Own-property lookup for the walk: the blocks path feeds the verifier
// without the parser, and a plain record answers for 'toString' through
// Object.prototype.
function selfFieldType(field: string): 'int' | 'bool' | undefined {
  if (!Object.prototype.hasOwnProperty.call(SELF_FIELDS, field)) {
    return undefined;
  }
  return SELF_FIELDS[field];
}

function walk(node: IrNode, scope: Scope, base: number, fn: FnCheck, frame: VerifyFrame): WalkResult {
  const result = walkInner(node, scope, base, fn, frame);
  if (result.depth > STACK_LIMIT && !fn.depthReported) {
    fn.depthReported = true;
    frame.errors.push(
      diagnostic('E_STACK_DEPTH', atOf(node), { depth: result.depth, limit: STACK_LIMIT }),
    );
  }
  return result;
}

function walkInner(node: IrNode, scope: Scope, base: number, fn: FnCheck, frame: VerifyFrame): WalkResult {
  switch (node.op) {
    case 'num':
      return { type: 'int', cost: COST_LITERAL, depth: base + 1 };
    case 'bool':
      return { type: 'bool', cost: COST_LITERAL, depth: base + 1 };
    case 'self':
      return { type: selfFieldType(node.field) ?? 'int', cost: COST_SELF, depth: base + 1 };
    case 'var': {
      const info = resolve(scope, node.name);
      const at = atOf(node);
      if (info === undefined) {
        const code: DiagnosticCode = frame.fns.has(node.name)
          ? 'E_SYM_FN_VALUE'
          : 'E_SYM_UNRESOLVED';
        frame.errors.push(diagnostic(code, at, { name: node.name }));
        return { type: 'int', cost: COST_VAR_READ, depth: base + 1 };
      }
      return {
        type: info.type,
        cost: COST_VAR_READ,
        depth: base + slotsOf(info.type),
        varInfo: info,
      };
    }
    case 'store': {
      const target = resolve(scope, node.name);
      const value = walk(node.value, scope, base, fn, frame);
      const at = atOf(node);
      if (target === undefined) {
        frame.errors.push(diagnostic('E_SET_TARGET', at, { name: node.name }));
      } else if (target.type !== 'unknown' && target.type !== value.type) {
        // A local keeps one type: the VM's slot layout depends on it — an
        // Option occupies two slots, an int one (09 § 2.3).
        frame.errors.push(
          diagnostic('E_TYPE', at, {
            expected: TYPENAMES[target.type],
            got: TYPENAMES[value.type],
          }),
        );
      } else if (target.type === 'unknown' && value.type !== 'void') {
        target.type = value.type;
      }
      if (target !== undefined) target.provenSome = false;
      return { type: 'void', cost: COST_STORE + value.cost, depth: value.depth };
    }
    case 'do': {
      let type: ValType = 'void';
      let cost = 0;
      let depth = base;
      for (const child of node.body) {
        const childResult = walk(child, scope, base, fn, frame);
        type = childResult.type;
        cost += childResult.cost;
        depth = max2(depth, childResult.depth);
      }
      return { type, cost, depth: max2(depth, base + slotsOf(type)) };
    }
    case 'let': {
      const childScope: Scope = { vars: new Map(), parent: scope };
      let cursor = base;
      let cost = 0;
      let depth = base;
      for (const binding of node.bindings) {
        const value = walk(binding.value, childScope, cursor, fn, frame);
        if (value.type === 'void') {
          frame.errors.push(
            diagnostic('E_TYPE', atOf(binding.value), {
              expected: 'a value',
              got: TYPENAMES.void,
            }),
          );
        }
        cursor += slotsOf(value.type);
        cost += COST_STORE + value.cost;
        depth = max2(depth, value.depth);
        fn.localsUsed += 1;
        if (fn.localsUsed > LOCALS_LIMIT && !fn.localsReported) {
          fn.localsReported = true;
          frame.errors.push(
            diagnostic('E_LOCALS', atOf(node), { count: fn.localsUsed, limit: LOCALS_LIMIT }),
          );
        }
        childScope.vars.set(binding.name, {
          type: value.type,
          provenSome: false,
          isParam: false,
        });
      }
      const body = walk(node.body, childScope, cursor, fn, frame);
      return { type: body.type, cost: cost + body.cost, depth: max2(depth, body.depth) };
    }
    case 'if': {
      const cond = walk(node.cond, scope, base, fn, frame);
      checkCondition(cond, frame, atOf(node.cond));
      let provenVar: VarInfo | undefined;
      let priorProven = false;
      if (node.cond.op === 'call' && node.cond.fn === BUILTIN_NAME.some && node.cond.args.length === 1) {
        const arg = node.cond.args[0];
        if (arg !== undefined && arg.op === 'var') {
          const info = resolve(scope, arg.name);
          if (info !== undefined && !info.isParam) {
            provenVar = info;
            priorProven = info.provenSome;
            info.provenSome = true;
          }
        }
      }
      const thenScope: Scope = { vars: new Map(), parent: scope };
      const then = walk(node.then, thenScope, base + 1, fn, frame);
      if (provenVar !== undefined) provenVar.provenSome = priorProven;
      const elseResult =
        node.else === undefined
          ? undefined
          : walk(node.else, { vars: new Map(), parent: scope }, base + 1, fn, frame);
      let type: ValType = 'void';
      if (elseResult === undefined) {
        type = 'void';
      } else if (then.type === elseResult.type) {
        type = then.type;
      } else if (then.type === 'unknown') {
        if (then.varInfo !== undefined) then.varInfo.type = elseResult.type;
        type = elseResult.type;
      } else if (elseResult.type === 'unknown') {
        if (elseResult.varInfo !== undefined) elseResult.varInfo.type = then.type;
        type = then.type;
      } else {
        frame.errors.push(
          diagnostic('E_TYPE', atOf(node), {
            expected: TYPENAMES[then.type],
            got: TYPENAMES[elseResult.type],
          }),
        );
        type = then.type;
      }
      const cost = COST_IF + max2(then.cost, elseResult?.cost ?? 0);
      const depth = max2(cond.depth, max2(then.depth, elseResult?.depth ?? base + 1));
      return { type, cost, depth };
    }
    case 'while': {
      const cond = walk(node.cond, scope, base, fn, frame);
      checkCondition(cond, frame, atOf(node.cond));
      const body = walk(node.body, scope, base + 1, fn, frame);
      // Worst case charges the condition every iteration too — the § 4
      // formula "body × iterations" plus the re-tested guard (a worst-case
      // estimate may not under-count, D4).
      const cost = COST_LOOP + node.maxIters * (cond.cost + body.cost);
      const depth = max2(cond.depth, body.depth);
      return { type: 'void', cost, depth };
    }
    case 'loop': {
      const body = walk(node.body, scope, base, fn, frame);
      const cost = COST_LOOP + node.count * body.cost;
      return { type: 'void', cost, depth: max2(body.depth, base) };
    }
    case 'return': {
      if (node.value === undefined) {
        return { type: 'void', cost: 0, depth: base };
      }
      const value = walk(node.value, scope, base, fn, frame);
      return { type: 'void', cost: value.cost, depth: value.depth };
    }
    case 'call':
      return walkCall(node, scope, base, fn, frame);
  }
}

function walkCall(
  node: Extract<IrNode, { op: 'call' }>,
  scope: Scope,
  base: number,
  fn: FnCheck,
  frame: VerifyFrame,
): WalkResult {
  const at = atOf(node);

  let prefix = 0;
  let argCost = 0;
  let depth = base;
  const argResults: WalkResult[] = [];
  for (const arg of node.args) {
    const result = walk(arg, scope, base + prefix, fn, frame);
    prefix += slotsOf(result.type);
    argCost += result.cost;
    depth = max2(depth, result.depth);
    argResults.push(result);
  }

  if (SPECIAL_FORMS.has(node.fn)) {
    frame.errors.push(diagnostic('E_CALL_TARGET', at, { name: node.fn }));
  }

  const spec = builtinSpec(node.fn);
  if (spec !== undefined) {
    const [minArgs, maxArgs] = spec.arity;
    if (
      node.args.length < minArgs ||
      (maxArgs !== -1 && node.args.length > maxArgs)
    ) {
      frame.errors.push(
        arityDiagnostic(node.fn, spec.arity, node.args.length, at),
      );
    }
    for (const result of argResults) {
      if (node.fn === BUILTIN_NAME.some) {
        if (result.type === 'option') continue;
        if (result.type === 'unknown') {
          if (result.varInfo !== undefined) result.varInfo.type = 'option';
          continue;
        }
        frame.errors.push(
          diagnostic('E_SOME_NON_OPTION', at, { got: TYPENAMES[result.type] }),
        );
        continue;
      }
      expectType(result, spec.arg, frame, at);
    }
    if (PAYLOAD_GETTERS.has(node.fn)) {
      const first = node.args[0];
      const firstResult = argResults[0];
      if (first !== undefined && firstResult !== undefined) {
        const info = firstResult.varInfo;
        const proven =
          first.op === 'var' &&
          info !== undefined &&
          (info.provenSome || info.isParam);
        if (!proven) {
          frame.errors.push(diagnostic('E_PAYLOAD_UNPROVEN', at, { fn: node.fn }));
        }
      }
    }
    if (node.fn === BUILTIN_NAME.move) {
      // 09 § 2.4: the editor warns when a move argument's magnitude is
      // below MOVE_TINY_THRESHOLD — the "move 1 0" beginner bug. A literal 0
      // axis is the standard "no thrust on this axis" idiom (pebble, glow,
      // reaper all ship (move v 0)), so only a non-zero tiny throttle hints
      // at a units mistake.
      for (const arg of node.args) {
        if (
          arg.op === 'num' &&
          arg.v !== 0 &&
          arg.v > -MOVE_TINY_THRESHOLD &&
          arg.v < MOVE_TINY_THRESHOLD
        ) {
          frame.warnings.push(diagnostic('W_MOVE_TINY', at, { value: arg.v }));
          break;
        }
      }
    }
    if (node.fn === BUILTIN_NAME.fire && frame.chassis !== null && !frame.chassis.hasWeapon) {
      frame.warnings.push(diagnostic('W_FIRE_NO_WEAPON', at));
    }
    if (node.fn === BUILTIN_NAME.build) {
      if (frame.chassis !== null && !frame.chassis.hasConstructor) {
        frame.warnings.push(diagnostic('W_BUILD_NO_CONSTRUCTOR', at));
      }
      const index = node.args[0];
      if (index !== undefined && index.op === 'num') {
        if (index.v < 0) {
          frame.errors.push(diagnostic('E_BUILD_INDEX', at, { index: index.v }));
        } else if (frame.chassis !== null && index.v >= frame.chassis.designCount) {
          frame.warnings.push(
            diagnostic('W_BUILD_DESIGN_RANGE', at, {
              index: index.v,
              designs: frame.chassis.designCount,
            }),
          );
        }
      }
    }
    if (node.fn === BUILTIN_NAME.rngInt) {
      const bound = node.args[0];
      if (bound !== undefined && bound.op === 'num' && bound.v < 1) {
        frame.errors.push(diagnostic('E_RNG_BOUND', at, { n: bound.v }));
      }
    }
    return {
      type: spec.ret,
      cost: spec.cost + argCost,
      depth: max2(depth, base + slotsOf(spec.ret)),
    };
  }

  const info = frame.fns.get(node.fn);
  if (info === undefined) {
    frame.errors.push(diagnostic('E_SYM_NO_TARGET', at, { name: node.fn }));
    return {
      type: 'int',
      cost: COST_USER_CALL + node.args.length + argCost,
      depth: max2(depth, base + 1),
    };
  }
  if (info.state === 'open') {
    frame.errors.push(
      diagnostic('E_RECURSION', at, {
        path: [...frame.callStack, node.fn].join(' → '),
      }),
    );
    return {
      type: 'int',
      cost: COST_USER_CALL + node.args.length + argCost,
      depth: max2(depth, base + 1),
    };
  }
  if (info.state === 'unchecked') {
    checkFn(info, frame);
  }
  if (node.args.length !== info.fn.params.length) {
    frame.errors.push(
      diagnostic('E_ARITY', at, {
        form: node.fn,
        expected: `exactly ${info.fn.params.length} argument(s)`,
        got: node.args.length,
      }),
    );
  }
  info.paramTypes.forEach((paramType, i) => {
    const result = argResults[i];
    if (result !== undefined) expectType(result, paramType, frame, at);
  });
  return {
    type: info.retType,
    cost: COST_USER_CALL + node.args.length + info.bodyCost,
    depth: max2(depth, base + slotsOf(info.retType)),
  };
}

// The three arity shapes get catalog sentences of their own — assembling
// user-facing wording from fragments at the call site was a rule 3
// violation, and the i18n catalog can now translate each shape as a whole.
function arityDiagnostic(
  form: string,
  arity: readonly [number, number],
  got: number,
  at: At | undefined,
): Diagnostic {
  const [minArgs, maxArgs] = arity;
  if (maxArgs === -1) {
    return diagnostic('E_ARITY_MIN', at, { form, min: minArgs, got });
  }
  if (minArgs === maxArgs) {
    return diagnostic('E_ARITY_EXACT', at, { form, count: minArgs, got });
  }
  return diagnostic('E_ARITY_RANGE', at, { form, min: minArgs, max: maxArgs, got });
}

function checkFn(info: FnInfo, frame: VerifyFrame): void {
  if (info.state !== 'unchecked') return;
  info.state = 'open';
  frame.callStack.push(info.fn.name);
  const scope: Scope = { vars: new Map(), parent: null };
  const check: FnCheck = { localsUsed: 0, depthReported: false, localsReported: false };
  for (const param of info.fn.params) {
    scope.vars.set(param, { type: 'unknown', provenSome: false, isParam: true });
    check.localsUsed += 1;
  }
  if (check.localsUsed > LOCALS_LIMIT) {
    check.localsReported = true;
    frame.errors.push(
      diagnostic('E_LOCALS', atOf(info.fn.body), { count: check.localsUsed, limit: LOCALS_LIMIT }),
    );
  }
  const result = walk(info.fn.body, scope, 0, check, frame);
  // A body whose type is still an unconstrained parameter normalises to
  // Option — the safe direction: callers must some?-test it rather than
  // assume an int (G4: never guess a wider type than was proven).
  if (result.type === 'unknown') {
    if (result.varInfo !== undefined) result.varInfo.type = 'option';
    result.type = 'option';
  }
  info.retType = result.type;
  info.bodyCost = result.cost;
  info.paramTypes = info.fn.params.map(
    (param) => scope.vars.get(param)?.type ?? 'unknown',
  );
  frame.callStack.pop();
  info.state = 'done';
}

interface VerifyOutcome {
  errors: Diagnostic[];
  warnings: Diagnostic[];
  tick: string | null;
  cycleEstimate: number;
}

function verifyProgram(lowered: LoweredProgram, chassis: ChassisContext | null): VerifyOutcome {
  const errors: Diagnostic[] = [];
  const warnings: Diagnostic[] = [];
  const fns = new Map<string, FnInfo>();
  for (const irFn of lowered.fns) {
    fns.set(irFn.name, {
      fn: irFn,
      state: 'unchecked',
      bodyCost: 0,
      retType: 'void',
      paramTypes: [],
    });
  }
  const frame: VerifyFrame = { errors, warnings, fns, callStack: [], chassis };
  for (const info of fns.values()) {
    checkFn(info, frame);
  }

  let tick: string | null = null;
  let cycleEstimate = 0;
  if (lowered.entryName !== null) {
    const info = fns.get(lowered.entryName);
    if (info === undefined) {
      errors.push(
        diagnostic('E_ENTRY_UNKNOWN', lowered.entryAt, { name: lowered.entryName }),
      );
    } else if (info.fn.params.length !== 0) {
      errors.push(
        diagnostic('E_ENTRY_ARGS', lowered.entryAt, {
          name: lowered.entryName,
          count: info.fn.params.length,
        }),
      );
    } else {
      // The every-tick dispatch is a zero-argument user call (09 § 4).
      cycleEstimate = COST_USER_CALL + info.bodyCost;
      if (cycleEstimate > CYCLE_BUDGET) {
        errors.push(
          diagnostic('E_BUDGET', lowered.entryAt, {
            estimate: cycleEstimate,
            budget: CYCLE_BUDGET,
          }),
        );
      }
      tick = info.fn.name;
    }
  }
  return { errors, warnings, tick, cycleEstimate };
}

// ---------------------------------------------------------------------------
// compile — the single public entry point (09 § 3; 20-IMPLEMENTATION-PLAN
// T04.5; G8: the editor, the server and the tests all go through here)
// ---------------------------------------------------------------------------

export type CompileResult =
  | { ok: true; ir: IrProgram; warnings: Diagnostic[]; cycleEstimate: number }
  | { ok: false; errors: Diagnostic[]; warnings: Diagnostic[] };

export function compile(src: string, options: CompileOptions = {}): CompileResult {
  try {
    const parsed = parseProgram(tokenize(src));
    if (parsed.entries.length > 1) {
      const second = parsed.entries[1];
      return {
        ok: false,
        errors: [
          diagnostic('E_ENTRY_MULTIPLE', second?.at, { count: parsed.entries.length }),
        ],
        warnings: [],
      };
    }
    const lowered = lowerProgram(parsed);
    const outcome = verifyProgram(lowered, options.chassis ?? null);
    if (outcome.errors.length > 0) {
      return {
        ok: false,
        errors: sortDiagnostics(outcome.errors),
        warnings: sortDiagnostics(outcome.warnings),
      };
    }
    return {
      ok: true,
      ir: { fns: lowered.fns, tick: outcome.tick },
      warnings: sortDiagnostics(outcome.warnings),
      cycleEstimate: outcome.cycleEstimate,
    };
  } catch (error) {
    if (error instanceof CompileError) {
      return { ok: false, errors: [error.diagnostic], warnings: [] };
    }
    throw error;
  }
}
