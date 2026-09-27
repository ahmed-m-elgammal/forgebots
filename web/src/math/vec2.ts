// Vectors over Q16.16 metres (22-DECISIONS.md D1). Immutable value
// operations: every function returns a new Vec2 and never mutates its
// arguments, so callers can hold positions without defensive copies.
//
// distance() takes two points. The predecessor's DSL shipped
// `(dist 0 0 dx dy)` — distance-from-origin — in two starter bots
// (AGENTS.md § 3, T6); a two-point signature makes that mistake hard to
// write and the tests pin it. inRange is a named predicate (G28) that
// compares squared lengths as BigInt, so the exact boundary is decided
// without sqrt rounding.

import {
  FIXED_ZERO,
  RAW_PER_UNIT,
  type Fixed,
  isqrt,
  saturate,
  add as fixedAdd,
  sub as fixedSub,
} from './fixed';
import { type Angle, wrapToPi } from './angle';

export interface Vec2 {
  readonly x: Fixed;
  readonly y: Fixed;
}

const UNIT_WIDE = BigInt(RAW_PER_UNIT);
const PRESCALE_CEILING = 536870912;
const PRESCALE_FLOOR = 134217728;

// atan(2^-i) in brads, round(atan(2^-i) · 65536 / 2π). Fixed lookup table,
// identical bit-for-bit at module load (10-DETERMINISM.md § 2.2).
const ATAN_BRADS = [
  8192, 4836, 2555, 1297, 651, 326, 163, 81, 41, 20, 10, 5, 3, 1, 1,
] as const;

export function vec2(x: Fixed, y: Fixed): Vec2 {
  return { x, y };
}

export const VEC2_ZERO: Vec2 = vec2(FIXED_ZERO, FIXED_ZERO);

export function add(a: Vec2, b: Vec2): Vec2 {
  return vec2(fixedAdd(a.x, b.x), fixedAdd(a.y, b.y));
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return vec2(fixedSub(a.x, b.x), fixedSub(a.y, b.y));
}

export function scale(v: Vec2, s: Fixed): Vec2 {
  return vec2(
    saturate((BigInt(v.x) * BigInt(s)) / UNIT_WIDE),
    saturate((BigInt(v.y) * BigInt(s)) / UNIT_WIDE),
  );
}

export function dot(a: Vec2, b: Vec2): Fixed {
  return saturate(
    (BigInt(a.x) * BigInt(b.x) + BigInt(a.y) * BigInt(b.y)) / UNIT_WIDE,
  );
}

export function cross(a: Vec2, b: Vec2): Fixed {
  return saturate(
    (BigInt(a.x) * BigInt(b.y) - BigInt(a.y) * BigInt(b.x)) / UNIT_WIDE,
  );
}

function sumOfSquares(dx: number, dy: number): bigint {
  return BigInt(dx) * BigInt(dx) + BigInt(dy) * BigInt(dy);
}

function absMax(a: number, b: number): number {
  const absA = a < 0 ? -a : a;
  const absB = b < 0 ? -b : b;
  return absA >= absB ? absA : absB;
}

// atan2 in brads by integer CORDIC, 15 iterations, worst-case error under
// 4 brads across a full-turn sweep. The ratio is what matters, so the
// vector is pre-scaled into a working band first: shifted down far enough
// that the CORDIC gain (×1.6478) cannot overflow int32, and shifted up far
// enough that shift quantisation cannot eat small directions.
function atan2Brad(y: number, x: number): number {
  if (x === 0 && y === 0) return 0;
  let px = x;
  let py = y;
  while (absMax(px, py) > PRESCALE_CEILING) {
    px >>= 1;
    py >>= 1;
  }
  while (absMax(px, py) < PRESCALE_FLOOR) {
    px <<= 1;
    py <<= 1;
  }
  let z = 0;
  if (px < 0) {
    z = py >= 0 ? 32768 : -32768;
    px = -px;
    py = -py;
  }
  for (let i = 0; i < ATAN_BRADS.length; i++) {
    const step = ATAN_BRADS[i]!;
    if (py > 0) {
      const nextX = px + (py >> i);
      const nextY = py - (px >> i);
      px = nextX;
      py = nextY;
      z += step;
    } else if (py < 0) {
      const nextX = px - (py >> i);
      const nextY = py + (px >> i);
      px = nextX;
      py = nextY;
      z -= step;
    }
  }
  return z;
}

// Heading of a vector, normalised into (−π, π].
export function angleOf(v: Vec2): Angle {
  return wrapToPi(atan2Brad(v.y, v.x));
}

export function length(v: Vec2): Fixed {
  return saturate(BigInt(isqrt(sumOfSquares(v.x, v.y))));
}

// Normalises to a unit heading. The zero vector normalises to the zero
// vector — there is no NaN in an integer world to fall back on.
// Near-zero inputs lose precision the way any fixed-point divide does;
// callers that care use inRange/length checks first.
export function normalize(v: Vec2): Vec2 {
  const magnitude = sumOfSquares(v.x, v.y);
  if (magnitude === 0n) {
    return VEC2_ZERO;
  }
  const unitScale = BigInt(isqrt(magnitude));
  return vec2(
    saturate((BigInt(v.x) * UNIT_WIDE) / unitScale),
    saturate((BigInt(v.y) * UNIT_WIDE) / unitScale),
  );
}

// Euclidean distance between two points, in metres.
export function distance(a: Vec2, b: Vec2): Fixed {
  return saturate(BigInt(isqrt(sumOfSquares(a.x - b.x, a.y - b.y))));
}

// Inclusive: exactly-at-range counts as in range, decided on squared
// integers so the boundary carries no sqrt rounding.
export function inRange(a: Vec2, b: Vec2, range: Fixed): boolean {
  if (range < FIXED_ZERO) {
    throw new RangeError(`range must not be negative, got ${range}`);
  }
  return sumOfSquares(a.x - b.x, a.y - b.y) <= BigInt(range) * BigInt(range);
}
