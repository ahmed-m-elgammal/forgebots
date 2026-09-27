import { describe, expect, it } from 'vitest';
import {
  FIXED_MAX,
  FIXED_MIN,
  FIXED_ONE,
  FIXED_ZERO,
  fromRaw,
  type Fixed,
} from './fixed';
import {
  VEC2_ZERO,
  add,
  angleOf,
  cross,
  distance,
  dot,
  inRange,
  length,
  normalize,
  scale,
  sub,
  vec2,
  type Vec2,
} from './vec2';

const u = (raw: number): Fixed => fromRaw(raw);
const p = (xRaw: number, yRaw: number): Vec2 => vec2(u(xRaw), u(yRaw));

// Vectors over Q16.16 metres. The distance tests carry the T6 regression
// for the (dist 0 0 dx dy) origin bug that shipped in two starter bots
// (AGENTS.md § 3). Categories: normal, boundary, invalid, state, repeat,
// determinism.

describe('vec2 / add / sub', () => {
  it('[normal] composes and decomposes positions component-wise', () => {
    expect(add(p(65536, 131072), p(196608, 262144))).toEqual(p(262144, 393216));
    expect(sub(p(262144, 393216), p(196608, 262144))).toEqual(p(65536, 131072));
  });

  it('[boundary] saturates component-wise instead of wrapping', () => {
    expect(add(vec2(FIXED_MAX, FIXED_ZERO), p(65536, 0)).x).toBe(FIXED_MAX);
    expect(sub(vec2(FIXED_MIN, FIXED_ZERO), p(65536, 0)).x).toBe(FIXED_MIN);
  });

  it('[state] never mutates its operands', () => {
    const a = vec2(FIXED_MAX, FIXED_ONE);
    const b = p(65536, 65536);
    add(a, b);
    sub(a, b);
    expect(a).toEqual(vec2(FIXED_MAX, FIXED_ONE));
    expect(b).toEqual(p(65536, 65536));
  });

  it('[repeat] repeated identical calls return identical results', () => {
    expect(add(p(1, 2), p(3, 4))).toEqual(add(p(1, 2), p(3, 4)));
  });
});

describe('scale', () => {
  it('[normal] scales both components', () => {
    expect(scale(p(196608, 262144), u(32768))).toEqual(p(98304, 131072));
  });

  it('[boundary] scaling by zero and by one is exact', () => {
    expect(scale(p(9182, -7), FIXED_ZERO)).toEqual(VEC2_ZERO);
    expect(scale(p(9182, -7), FIXED_ONE)).toEqual(p(9182, -7));
    expect(scale(vec2(FIXED_MAX, FIXED_MAX), FIXED_MAX).x).toBe(FIXED_MAX);
  });

  it('[determinism] pure function of its inputs', () => {
    expect(scale(p(3, 4), u(2))).toEqual(scale(p(3, 4), u(2)));
  });
});

describe('dot / cross', () => {
  it('[normal] dot products in metre units', () => {
    expect(dot(p(196608, 262144), p(262144, 196608))).toBe(u(1572864));
    expect(dot(p(65536, 0), p(0, 65536))).toBe(FIXED_ZERO);
    expect(dot(p(-65536, 0), p(65536, 0))).toBe(u(-65536));
  });

  it('[normal] 2D cross gives the signed parallelogram area', () => {
    expect(cross(p(65536, 0), p(0, 65536))).toBe(u(65536));
    expect(cross(p(0, 65536), p(65536, 0))).toBe(u(-65536));
    expect(cross(p(131072, 196608), p(262144, 393216))).toBe(FIXED_ZERO);
  });

  it('[boundary] saturates instead of overflowing on extreme operands', () => {
    expect(dot(vec2(FIXED_MAX, FIXED_MAX), vec2(FIXED_MAX, FIXED_MAX))).toBe(
      FIXED_MAX,
    );
    expect(cross(vec2(FIXED_MAX, FIXED_ZERO), vec2(FIXED_ZERO, FIXED_MIN))).toBe(
      FIXED_MIN,
    );
  });
});

describe('length', () => {
  it('[normal] measures the 3-4-5 triangle exactly', () => {
    expect(length(p(196608, 262144))).toBe(u(327680));
  });

  it('[boundary] zero stays zero and axis vectors stay exact', () => {
    expect(length(VEC2_ZERO)).toBe(FIXED_ZERO);
    expect(length(p(65536, 0))).toBe(FIXED_ONE);
    expect(length(vec2(FIXED_MAX, FIXED_MAX))).toBe(FIXED_MAX);
  });

  it('[repeat] repeated measurement is stable', () => {
    expect(length(p(196608, 262144))).toBe(length(p(196608, 262144)));
  });
});

describe('normalize', () => {
  it('[normal] reduces the 3-4-5 triangle to its unit direction', () => {
    expect(normalize(p(196608, 262144))).toEqual(p(39321, 52428));
  });

  it('[normal] unit vectors pass through exactly', () => {
    expect(normalize(p(65536, 0))).toEqual(p(65536, 0));
    expect(normalize(p(0, -65536))).toEqual(p(0, -65536));
  });

  it('[boundary] the zero vector normalizes to the zero vector, not NaN', () => {
    expect(normalize(VEC2_ZERO)).toEqual(VEC2_ZERO);
  });

  it('[boundary] the smallest non-zero vector is documented, not wrapped', () => {
    expect(normalize(p(1, 1))).toEqual(p(65536, 65536));
  });

  it('[state] leaves the input untouched', () => {
    const v = p(196608, 262144);
    normalize(v);
    expect(v).toEqual(p(196608, 262144));
  });

  it('[determinism] same input, same unit vector, every call', () => {
    expect(normalize(p(196608, 262144))).toEqual(normalize(p(196608, 262144)));
  });
});

describe('distance', () => {
  it('[normal] measures between two points, neither at the origin', () => {
    expect(distance(p(65536, 65536), p(262144, 327680))).toBe(u(327680));
  });

  it('[normal] is symmetric and zero for identical points', () => {
    const a = p(9182, -7);
    const b = p(-44, 65536);
    expect(distance(a, b)).toBe(distance(b, a));
    expect(distance(a, a)).toBe(FIXED_ZERO);
  });

  it('[T6] distance from a non-origin point is measured from that point', () => {
    const far = p(98304000, 98304000);
    const nearby = p(98304000 + 196608, 98304000 + 262144);
    expect(distance(far, nearby)).toBe(u(327680));
    expect(distance(far, VEC2_ZERO)).toBe(
      u(Math.floor(1500 * Math.SQRT2 * 65536)),
    );
  });

  it('[boundary] saturates beyond the representable world edge', () => {
    expect(distance(vec2(FIXED_MAX, FIXED_ZERO), vec2(FIXED_MIN, FIXED_ZERO))).toBe(
      FIXED_MAX,
    );
  });

  it('[repeat] repeated calls are stable', () => {
    expect(distance(p(1, 2), p(3, 4))).toBe(distance(p(1, 2), p(3, 4)));
  });
});

describe('inRange', () => {
  it('[normal] accepts inside and rejects outside', () => {
    const a = VEC2_ZERO;
    const b = p(196608, 262144);
    expect(inRange(a, b, u(400000))).toBe(true);
    expect(inRange(a, b, u(300000))).toBe(false);
  });

  it('[boundary] exactly-at-range counts, one raw unit short does not', () => {
    const a = VEC2_ZERO;
    const b = p(196608, 262144);
    expect(inRange(a, b, u(327680))).toBe(true);
    expect(inRange(a, b, u(327679))).toBe(false);
  });

  it('[boundary] zero range matches only identical points', () => {
    expect(inRange(p(7, 7), p(7, 7), FIXED_ZERO)).toBe(true);
    expect(inRange(p(7, 7), p(7, 8), FIXED_ZERO)).toBe(false);
  });

  it('[invalid] rejects negative ranges — an impossible state', () => {
    expect(() => inRange(VEC2_ZERO, VEC2_ZERO, u(-1))).toThrow(RangeError);
  });

  it('[state] is symmetric, so sensor order cannot change the answer', () => {
    const a = p(123, 456);
    const b = p(-789, 42);
    expect(inRange(a, b, u(1000))).toBe(inRange(b, a, u(1000)));
  });
});

describe('angleOf', () => {
  it('[normal] heads the cardinal directions exactly', () => {
    expect(angleOf(p(65536, 0))).toBe(0);
    expect(angleOf(p(0, 65536))).toBe(16384);
    expect(angleOf(p(-65536, 0))).toBe(32768);
    expect(angleOf(p(0, -65536))).toBe(-16384);
  });

  it('[normal] matches atan2 on representative interior directions', () => {
    expect(angleOf(p(65536, 65536))).toBe(8192);
    expect(angleOf(p(196608, 65536))).toBe(3356);
    expect(angleOf(p(-65536, -65536))).toBe(-24576);
  });

  it('[boundary] pre-scales extreme magnitudes without overflow', () => {
    expect(angleOf(vec2(FIXED_MAX, FIXED_MAX))).toBe(8192);
    expect(angleOf(vec2(FIXED_MAX, FIXED_ZERO))).toBe(0);
    expect(angleOf(vec2(FIXED_MIN, FIXED_ZERO))).toBe(32768);
    expect(angleOf(p(1, 1))).toBe(8192);
  });

  it('[invalid] the zero vector has no heading and yields 0', () => {
    expect(angleOf(VEC2_ZERO)).toBe(0);
  });

  it('[determinism] agrees with the float reference within 4 brads off the ±π seam', () => {
    for (let degrees = 0; degrees < 360; degrees++) {
      for (const radius of [65536, 655, 66, 6, 1]) {
        const radians = (degrees * Math.PI) / 180;
        const x = Math.round(radius * Math.cos(radians));
        const y = Math.round(radius * Math.sin(radians));
        if (x === 0 && y === 0) continue;
        const reference = (Math.atan2(y, x) * 32768) / Math.PI;
        if (Math.abs(reference) > 32600) continue;
        const ours = angleOf(p(x, y));
        expect(Math.abs(ours - reference)).toBeLessThanOrEqual(4);
      }
    }
  });

  it('[repeat] repeated measurement of the same vector is identical', () => {
    expect(angleOf(p(196608, 65536))).toBe(angleOf(p(196608, 65536)));
  });
});
