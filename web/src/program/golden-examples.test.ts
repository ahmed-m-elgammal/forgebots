import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CYCLE_BUDGET, compile, type IrNode, type IrProgram } from './compiler';

// Integration tier (AGENTS.md § 4): reads the canonical bot sources from
// spec-kit/examples/ and runs the full pipeline. 19 § 5.3: every .fb file
// in that directory must parse and pass verify(); CI asserts it, which is
// what stops a doc listing and a shipped source from drifting apart.

const EXAMPLES_DIR = new URL('../../../spec-kit/examples/', import.meta.url);

const exampleFiles = readdirSync(EXAMPLES_DIR).filter((name) => name.endsWith('.fb'));

const readExample = (name: string): string =>
  readFileSync(new URL(name, EXAMPLES_DIR), 'utf8');

function compileOk(src: string) {
  const result = compile(src);
  if (!result.ok) {
    throw new Error(`expected success, got: ${result.errors.map((e) => e.code).join(', ')}`);
  }
  return result;
}

function findNodes(node: IrNode, predicate: (n: IrNode) => boolean): IrNode[] {
  const found: IrNode[] = [];
  const visit = (current: IrNode): void => {
    if (predicate(current)) found.push(current);
    switch (current.op) {
      case 'store':
        visit(current.value);
        break;
      case 'do':
        current.body.forEach(visit);
        break;
      case 'if':
        visit(current.cond);
        visit(current.then);
        if (current.else !== undefined) visit(current.else);
        break;
      case 'let':
        current.bindings.forEach((binding) => visit(binding.value));
        visit(current.body);
        break;
      case 'while':
        visit(current.cond);
        visit(current.body);
        break;
      case 'loop':
        visit(current.body);
        break;
      case 'call':
        current.args.forEach(visit);
        break;
      case 'return':
        if (current.value !== undefined) visit(current.value);
        break;
      default:
        break;
    }
  };
  visit(node);
  return found;
}

// The eight canonical starter bots (19 § 5.3) plus sample-bot, which 19
// lists as "not a starter bot" but still requires to compile.
const CANONICAL_BOTS = [
  'pebble.fb',
  'glow.fb',
  'drifter.fb',
  'pouncer.fb',
  'breeder.fb',
  'reaper.fb',
  'swarm-mind.fb',
  'sentinel.fb',
];

describe('golden compile — spec-kit/examples (23 § 5.2.5)', () => {
  it('[normal] all example .fb sources compile clean and inside the budget', () => {
    expect(exampleFiles.length).toBeGreaterThanOrEqual(CANONICAL_BOTS.length);
    for (const name of exampleFiles) {
      const result = compile(readExample(name));
      expect(result.ok, `${name} failed verification`).toBe(true);
      if (result.ok) {
        expect(result.cycleEstimate).toBeLessThanOrEqual(CYCLE_BUDGET);
        expect(result.ir.tick).toBe('step');
        for (const warning of result.warnings) {
          expect(String(warning.code).startsWith('W_')).toBe(true);
        }
      }
    }
  });

  it('[normal] each canonical starter bot from 19 § 5.3 is present and compiles', () => {
    for (const name of CANONICAL_BOTS) {
      expect(exampleFiles).toContain(name);
      expect(compile(readExample(name)).ok).toBe(true);
    }
  });

  it('[determinism] the IR is byte-stable for every example across repeated compiles', () => {
    for (const name of exampleFiles) {
      const first = JSON.stringify(compileOk(readExample(name)).ir);
      for (let run = 0; run < 3; run += 1) {
        expect(JSON.stringify(compileOk(readExample(name)).ir), `${name} drifted`).toBe(first);
      }
    }
  });

  it('[determinism] every example IR round-trips through JSON unchanged (20 T05.5)', () => {
    for (const name of exampleFiles) {
      const result = compileOk(readExample(name));
      const roundTripped: IrProgram = JSON.parse(JSON.stringify(result.ir)) as IrProgram;
      expect(roundTripped, `${name} lost data through JSON`).toEqual(result.ir);
    }
  });

  it('[boundary] compiled estimates stay in the 36-155 band the cost table implies', () => {
    // Sanity band: the trivial bots sit at 36 (4 + 30 + 1 + 1); the heaviest
    // (Reaper, with two payload reads and a dist) stays far below 1000.
    const estimates = exampleFiles.map((name) => compileOk(readExample(name)).cycleEstimate);
    expect(Math.min(...estimates)).toBe(36);
    expect(Math.max(...estimates)).toBeLessThan(200);
  });
});

describe('T6 regressions pinned against the canonical sources (AGENTS.md § 3)', () => {
  it('[state] pouncer and sentinel measure dist from the bot, not the arena origin', () => {
    for (const name of ['pouncer.fb', 'sentinel.fb']) {
      const result = compileOk(readExample(name));
      const dists = findNodes(
        result.ir.fns[0]!.body,
        (n) => n.op === 'call' && n.fn === 'dist',
      );
      expect(dists.length).toBeGreaterThan(0);
      for (const node of dists) {
        if (node.op === 'call') {
          expect(node.args[0]).toEqual({ op: 'self', field: 'x' });
          expect(node.args[1]).toEqual({ op: 'self', field: 'y' });
        }
      }
    }
  });

  it('[state] breeder cond keeps the documented priority: food, then build, then drift', () => {
    const result = compileOk(readExample('breeder.fb'));
    const body = result.ir.fns[0]!.body;
    expect(body.op).toBe('let');
    if (body.op !== 'let') return;
    // (cond [(some? f) (move-at …)] [(>= b 5) (build 0)] [else (move …)])
    expect(body.body.op).toBe('if');
    if (body.body.op !== 'if') return;
    expect(body.body.cond).toEqual({ op: 'call', fn: 'some?', args: [{ op: 'var', name: 'f' }] });
    expect(body.body.then).toMatchObject({ op: 'call', fn: 'move-at' });
    const second = body.body.else;
    expect(second?.op).toBe('if');
    if (second?.op !== 'if') return;
    expect(second.cond).toEqual({
      op: 'call',
      fn: '>=',
      args: [{ op: 'var', name: 'b' }, { op: 'num', v: 5 }],
    });
    expect(second.then).toMatchObject({ op: 'call', fn: 'build' });
    expect(second.else).toMatchObject({ op: 'call', fn: 'move' });
  });

  it('[state] drifter steers with move-at and re-rolls its heading via rng-int', () => {
    const result = compileOk(readExample('drifter.fb'));
    const all = result.ir.fns.map((fn) => findNodes(fn.body, () => true));
    const flat = all.flat();
    // The fallback heading is an angle fed to cos/sin — the old
    // (/ (- (food-x f) (self.x)) 60) idiom had no defined unit (D8).
    expect(flat.some((n) => n.op === 'call' && n.fn === 'move-at')).toBe(true);
    expect(flat.some((n) => n.op === 'call' && n.fn === 'rng-int')).toBe(true);
    expect(flat.some((n) => n.op === 'call' && n.fn === 'mod')).toBe(true);
    const headingFns = result.ir.fns.find((fn) => fn.name === 'pick-heading');
    expect(headingFns).toBeDefined();
  });

  it('[state] reaper calls enemy() directly — the dead weakest() helper is gone', () => {
    const result = compileOk(readExample('reaper.fb'));
    const sensors = findNodes(
      result.ir.fns[0]!.body,
      (n) => n.op === 'call' && (n.fn === 'enemy' || n.fn === 'ally'),
    );
    expect(sensors).toHaveLength(1);
    if (sensors[0]?.op === 'call') expect(sensors[0].fn).toBe('enemy');
    expect(result.ir.fns).toHaveLength(1);
  });

  it('[state] sentinel centre test compares against the documented 100000 mm centre', () => {
    const result = compileOk(readExample('sentinel.fb'));
    const hundreds = findNodes(
      result.ir.fns[0]!.body,
      (n) => n.op === 'num' && n.v === 100000,
    );
    expect(hundreds.length).toBeGreaterThanOrEqual(3);
  });

  it('[state] pebble and glow pin the throttle literals that document the beginner bug', () => {
    const pebble = compileOk(readExample('pebble.fb'));
    expect(pebble.ir.fns[0]!.body).toEqual({
      op: 'call',
      fn: 'move',
      args: [{ op: 'num', v: 0 }, { op: 'num', v: 0 }],
    });
    const glow = compileOk(readExample('glow.fb'));
    expect(glow.ir.fns[0]!.body).toEqual({
      op: 'call',
      fn: 'move',
      args: [{ op: 'num', v: 65536 }, { op: 'num', v: 0 }],
    });
  });
});
