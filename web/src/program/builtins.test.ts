import { describe, expect, it } from 'vitest';
import { evalPureBuiltin } from './builtins';
import { INT_LITERAL_LIMIT } from './compiler';
import { fcos, fatan2, fsin } from '../math/angle';

// The DSL's pure builtin vocabulary (program/ owns it per AGENTS.md § 6;
// the VM dispatches here). The spec leaves the int semantics open; the
// documented choices — saturating int32, truncating division, dividend-sign
// mod, mod-0 = 0, eager boolean folds — are pinned at their exact edges.

const MAX = INT_LITERAL_LIMIT;
const MIN = -INT_LITERAL_LIMIT;

const evalInt = (name: string, args: number[]): number =>
  evalPureBuiltin(name, args) as number;
const evalBool = (name: string, args: (number | boolean)[]): boolean =>
  evalPureBuiltin(name, args) as boolean;

describe('arithmetic — + - *', () => {
  it('[normal] folds variadic chains left to right', () => {
    expect(evalInt('+', [1, 2, 3])).toBe(6);
    expect(evalInt('-', [10, 3, 2])).toBe(5);
    expect(evalInt('*', [2, 3, 4])).toBe(24);
  });

  it('[boundary] saturates at the int32 edges instead of wrapping', () => {
    expect(evalInt('+', [MAX, 1])).toBe(MAX);
    expect(evalInt('+', [MIN, -1])).toBe(MIN);
    expect(evalInt('-', [MAX, -1])).toBe(MAX);
    expect(evalInt('*', [46341, 46341])).toBe(MAX);
    expect(evalInt('*', [-46341, 46341])).toBe(MIN);
    // Per-step saturation: ((MAX + MAX) + −MAX) clamps the inner sum first.
    expect(evalInt('+', [MAX, MAX])).toBe(MAX);
    expect(evalInt('+', [MAX, MAX, -MAX])).toBe(0);
  });

  it('[boundary] unary minus negates; the symmetric range cannot overflow', () => {
    expect(evalInt('-', [5])).toBe(-5);
    expect(evalInt('-', [MIN])).toBe(MAX);
    expect(evalInt('-', [0])).toBe(-0);
  });

  it('[invalid] rejects non-integer and boolean operands, and empty folds', () => {
    expect(() => evalInt('+', [1.5])).toThrow(TypeError);
    expect(() => evalPureBuiltin('+', [true])).toThrow(TypeError);
    expect(() => evalInt('+', [])).toThrow(TypeError);
    expect(() => evalInt('-', [])).toThrow(TypeError);
    expect(() => evalInt('*', [])).toThrow(TypeError);
    expect(() => evalInt('/', [1])).toThrow(TypeError);
  });

  it('[determinism] repeated evaluation is stable', () => {
    expect(evalInt('*', [12345, 678])).toBe(evalInt('*', [12345, 678]));
  });
});

describe('division and modulus', () => {
  it('[normal] truncates toward zero like C integer division', () => {
    expect(evalInt('/', [7, 2])).toBe(3);
    expect(evalInt('/', [-7, 2])).toBe(-3);
    expect(evalInt('/', [7, -2])).toBe(-3);
    expect(evalInt('/', [-7, -2])).toBe(3);
    expect(evalInt('mod', [7, 3])).toBe(1);
    expect(evalInt('mod', [-7, 3])).toBe(-1);
    expect(evalInt('mod', [7, -3])).toBe(1);
  });

  it('[boundary] division by zero saturates toward the numerator sign (legacy/01 § 2)', () => {
    expect(evalInt('/', [5, 0])).toBe(MAX);
    expect(evalInt('/', [-5, 0])).toBe(MIN);
    expect(evalInt('/', [0, 0])).toBe(MAX);
    expect(evalInt('/', [MAX, 0])).toBe(MAX);
  });

  it('[boundary] mod by zero is 0 — a NaN must never enter integer state', () => {
    expect(evalInt('mod', [5, 0])).toBe(0);
    expect(evalInt('mod', [0, 0])).toBe(0);
    expect(evalInt('mod', [-5, 0])).toBe(0);
  });

  it('[invalid] needs exactly two operands for mod', () => {
    expect(() => evalInt('mod', [5])).toThrow(TypeError);
    expect(() => evalPureBuiltin('mod', [5, true])).toThrow(TypeError);
  });

  it('[determinism] chains of division stay exact', () => {
    expect(evalInt('/', [1000, 5, 2])).toBe(100);
    expect(evalInt('/', [1000, 3, 2])).toBe(evalInt('/', [1000, 3, 2]));
  });
});

describe('abs, min, max', () => {
  it('[normal] folds comparisons over variadic operands', () => {
    expect(evalInt('abs', [-9])).toBe(9);
    expect(evalInt('min', [3, 1, 2])).toBe(1);
    expect(evalInt('max', [3, 1, 2])).toBe(3);
    expect(evalInt('min', [5])).toBe(5);
  });

  it('[boundary] the int32 extremes are stable under abs/min/max', () => {
    expect(evalInt('abs', [MIN])).toBe(MAX);
    expect(evalInt('min', [MAX, MIN])).toBe(MIN);
    expect(evalInt('max', [MAX, MIN])).toBe(MAX);
    expect(evalInt('abs', [0])).toBe(0);
  });

  it('[invalid] rejects empty operand lists', () => {
    expect(() => evalInt('min', [])).toThrow(TypeError);
    expect(() => evalInt('abs', [])).toThrow(TypeError);
  });
});

describe('comparisons and booleans', () => {
  it('[normal] the six comparators on plain integers', () => {
    expect(evalBool('<', [1, 2])).toBe(true);
    expect(evalBool('<=', [2, 2])).toBe(true);
    expect(evalBool('>', [1, 2])).toBe(false);
    expect(evalBool('>=', [2, 1])).toBe(true);
    expect(evalBool('==', [2, 2])).toBe(true);
    expect(evalBool('!=', [2, 2])).toBe(false);
  });

  it('[boundary] comparisons at the extremes', () => {
    expect(evalBool('<=', [MIN, MAX])).toBe(true);
    expect(evalBool('>=', [MIN, MAX])).toBe(false);
    expect(evalBool('==', [MAX, MAX])).toBe(true);
  });

  it('[state] and / or fold every argument — eagerness is the IR contract', () => {
    expect(evalBool('and', [true, true, true])).toBe(true);
    expect(evalBool('and', [true, false, true])).toBe(false);
    expect(evalBool('or', [false, false])).toBe(false);
    expect(evalBool('or', [false, true, false])).toBe(true);
    // All arguments are validated even when the first decides the result:
    // the verifier's type check ran on all of them at compile time.
    expect(() => evalPureBuiltin('and', [false, 1])).toThrow(TypeError);
    expect(() => evalPureBuiltin('or', [true, 1])).toThrow(TypeError);
  });

  it('[invalid] comparators reject booleans and not rejects integers', () => {
    expect(() => evalPureBuiltin('<', [true, 2])).toThrow(TypeError);
    expect(() => evalPureBuiltin('not', [1])).toThrow(TypeError);
    expect(evalBool('not', [false])).toBe(true);
  });
});

describe('dist', () => {
  it('[normal] measures two-point distance in millimetres', () => {
    expect(evalInt('dist', [0, 0, 3, 4])).toBe(5);
    expect(evalInt('dist', [1000, 2000, 1000, 2000])).toBe(0);
    expect(evalInt('dist', [0, 0, 30000, 40000])).toBe(50000);
  });

  it('[boundary] the T6 regression: the first point is part of the answer', () => {
    // The shipped bug measured from the origin when x1 y1 were non-zero.
    expect(evalInt('dist', [100000, 100000, 101000, 100000])).toBe(1000);
    expect(evalInt('dist', [0, 0, 0, 0])).toBe(0);
  });

  it('[boundary] hypotenuses beyond int32 saturate instead of wrapping', () => {
    // sqrt(2) × (2^31 − 1) ≈ 3.04e9 — over the int32 ceiling.
    expect(evalInt('dist', [-MAX, -MAX, MAX, MAX])).toBe(MAX);
    expect(evalInt('dist', [0, 0, MAX, MAX])).toBe(MAX);
    expect(evalInt('dist', [0, 0, MAX, 0])).toBe(MAX);
  });

  it('[invalid] needs four integer coordinates', () => {
    expect(() => evalInt('dist', [0, 0, 3])).toThrow(TypeError);
    expect(() => evalPureBuiltin('dist', [0, 0, 3, true])).toThrow(TypeError);
  });

  it('[determinism] floor behaviour is stable at non-square hypotenuses', () => {
    // sqrt(2) ≈ 1.414 → 1; the integer sqrt floors, always.
    expect(evalInt('dist', [0, 0, 1, 1])).toBe(1);
    expect(evalInt('dist', [0, 0, 2, 2])).toBe(2);
    expect(evalInt('dist', [0, 0, 1, 2])).toBe(2);
  });
});

describe('trig dispatch', () => {
  it('[normal] sin / cos / atan2 agree with the math module exactly', () => {
    for (const angle of [0, 1, 8192, 16384, 24576, 32768, -49152, 65535, 65536]) {
      expect(evalInt('sin', [angle])).toBe(fsin(angle));
      expect(evalInt('cos', [angle])).toBe(fcos(angle));
    }
    expect(evalInt('atan2', [1, 2])).toBe(fatan2(1, 2));
    expect(evalInt('atan2', [0, -1])).toBe(32768);
  });

  it('[invalid] propagates the math module\'s integer validation', () => {
    expect(() => evalInt('sin', [0.5])).toThrow(TypeError);
    expect(() => evalInt('atan2', [0.5, 1])).toThrow(TypeError);
  });

  it('[determinism] table lookups never drift between calls', () => {
    expect(evalInt('sin', [12345])).toBe(evalInt('sin', [12345]));
    expect(evalInt('cos', [54321])).toBe(evalInt('cos', [54321]));
  });
});

describe('unknown names', () => {
  it('[invalid] a non-pure builtin name is a caller contract violation', () => {
    // The VM routes sensors, actuators, time and rng-int elsewhere; this
    // module throws loudly rather than guessing.
    expect(() => evalPureBuiltin('radar', [])).toThrow(TypeError);
    expect(() => evalPureBuiltin('move', [1, 2])).toThrow(TypeError);
    expect(() => evalPureBuiltin('nope', [])).toThrow(TypeError);
  });
});
