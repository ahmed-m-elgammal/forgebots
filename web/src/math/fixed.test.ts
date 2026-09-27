import { describe, expect, it } from 'vitest';
import {
  FIXED_MAX,
  FIXED_MIN,
  FIXED_ONE,
  FIXED_ZERO,
  add,
  ceiling,
  clamp,
  cmp,
  div,
  floor,
  fromMm,
  fromRaw,
  isqrt,
  max,
  min,
  mul,
  neg,
  rawValue,
  round,
  sqrt,
  sub,
  toMm,
  type Fixed,
} from './fixed';

const u = (raw: number): Fixed => fromRaw(raw);

// Unit: one module, no I/O, no tick loop (AGENTS.md § 4). Tags follow the
// six required categories: normal, boundary, invalid, state, repeat,
// determinism.

describe('fromRaw', () => {
  it('[normal] builds a Fixed from an integer raw', () => {
    expect(u(65536)).toBe(FIXED_ONE);
    expect(u(0)).toBe(FIXED_ZERO);
  });

  it('[boundary] accepts both exact range edges', () => {
    expect(u(2147483647)).toBe(FIXED_MAX);
    expect(u(-2147483647)).toBe(FIXED_MIN);
  });

  it('[invalid] rejects fractions, NaN, Infinity and null-ish input', () => {
    expect(() => fromRaw(65536.5)).toThrow(TypeError);
    expect(() => fromRaw(Number.NaN)).toThrow(TypeError);
    expect(() => fromRaw(Number.POSITIVE_INFINITY)).toThrow(TypeError);
    expect(() => fromRaw(null as unknown as number)).toThrow(TypeError);
  });

  it('[invalid] rejects raw values beyond the symmetric Q16.16 range', () => {
    expect(() => fromRaw(2147483648)).toThrow(RangeError);
    expect(() => fromRaw(-2147483648)).toThrow(RangeError);
  });

  it('[repeat] consecutive calls with the same raw give the same value', () => {
    expect(fromRaw(12345)).toBe(fromRaw(12345));
  });
});

describe('rawValue', () => {
  it('[normal] reads back the exact raw integer', () => {
    expect(rawValue(fromMm(30000))).toBe(1966080);
  });
});

describe('fromMm / toMm', () => {
  it('[normal] converts the wire unit exactly at whole metres', () => {
    expect(fromMm(30000)).toBe(u(1966080));
    expect(toMm(u(1966080))).toBe(30000);
    expect(toMm(FIXED_ONE)).toBe(1000);
  });

  it('[normal] rounds sub-raw-precision millimetres half away from zero', () => {
    expect(fromMm(1)).toBe(u(66));
    expect(fromMm(-1)).toBe(u(-66));
  });

  it('[boundary] spans the full ±32767999 mm world', () => {
    expect(fromMm(32767999)).toBe(u(2147483582));
    expect(fromMm(-32767999)).toBe(u(-2147483582));
    expect(fromMm(0)).toBe(FIXED_ZERO);
    expect(toMm(FIXED_MAX)).toBe(32768000);
    expect(toMm(FIXED_MIN)).toBe(-32768000);
  });

  it('[invalid] rejects fractional millimetres and out-of-world lengths', () => {
    expect(() => fromMm(1.5)).toThrow(TypeError);
    expect(() => fromMm(Number.NaN)).toThrow(TypeError);
    expect(() => fromMm(32768000)).toThrow(RangeError);
    expect(() => fromMm(-32768000)).toThrow(RangeError);
  });

  it('[determinism] round-trips deterministically across the range', () => {
    for (const mm of [0, 1, 5, 12345, 30000, 32767999, -1, -12345, -32767999]) {
      expect(toMm(fromMm(mm))).toBe(mm);
    }
  });
});

describe('add / sub', () => {
  it('[normal] adds and subtracts exactly', () => {
    expect(add(FIXED_ONE, FIXED_ONE)).toBe(u(131072));
    expect(sub(u(131072), FIXED_ONE)).toBe(FIXED_ONE);
  });

  it('[boundary] saturates on both overflow directions instead of wrapping', () => {
    expect(add(FIXED_MAX, FIXED_ONE)).toBe(FIXED_MAX);
    expect(add(FIXED_MIN, u(-1))).toBe(FIXED_MIN);
    expect(sub(FIXED_MIN, FIXED_ONE)).toBe(FIXED_MIN);
    expect(sub(FIXED_MAX, u(-1))).toBe(FIXED_MAX);
  });

  it('[boundary] treats zero as the exact identity', () => {
    expect(add(FIXED_ZERO, u(987))).toBe(u(987));
    expect(sub(u(987), FIXED_ZERO)).toBe(u(987));
  });

  it('[state] leaves both operands untouched', () => {
    const a = FIXED_MAX;
    const b = FIXED_MAX;
    add(a, b);
    expect(a).toBe(FIXED_MAX);
    expect(b).toBe(FIXED_MAX);
  });

  it('[repeat] is idempotent across repeated identical calls', () => {
    const once = add(u(5000), u(7));
    expect(add(u(5000), u(7))).toBe(once);
  });
});

describe('neg', () => {
  it('[boundary] is closed on the symmetric range edges', () => {
    expect(neg(FIXED_MAX)).toBe(FIXED_MIN);
    expect(neg(FIXED_MIN)).toBe(FIXED_MAX);
    expect(neg(FIXED_ZERO)).toBe(FIXED_ZERO);
  });
});

describe('mul', () => {
  it('[normal] multiplies exactly at representable products', () => {
    expect(mul(u(32768), u(32768))).toBe(u(16384));
    expect(mul(FIXED_ONE, u(9182))).toBe(u(9182));
  });

  it('[boundary] saturates past ±MAX in either sign direction', () => {
    expect(mul(FIXED_MAX, u(131072))).toBe(FIXED_MAX);
    expect(mul(FIXED_MAX, u(-131072))).toBe(FIXED_MIN);
    expect(mul(FIXED_MAX, FIXED_ZERO)).toBe(FIXED_ZERO);
  });

  it('[normal] truncates the exact product toward zero', () => {
    // 196609² / 65536 = 589830.0000152 — the fraction drops, toward zero.
    expect(mul(u(196609), u(196609))).toBe(u(589830));
    expect(mul(u(-196609), u(196609))).toBe(u(-589830));
  });

  it('[invalid] multiplying by one raw unit never wraps to zero silently', () => {
    expect(mul(FIXED_ONE, u(1))).toBe(u(1));
  });

  it('[determinism] is a pure function of its operands', () => {
    expect(mul(u(65537), u(2))).toBe(mul(u(65537), u(2)));
  });
});

describe('div', () => {
  it('[normal] divides exactly at representable quotients', () => {
    expect(div(u(393216), u(196608))).toBe(u(131072));
    expect(div(FIXED_ONE, u(131072))).toBe(u(32768));
  });

  it('[boundary] division by zero saturates toward the numerator sign', () => {
    expect(div(FIXED_ONE, FIXED_ZERO)).toBe(FIXED_MAX);
    expect(div(u(-1), FIXED_ZERO)).toBe(FIXED_MIN);
    expect(div(FIXED_ZERO, FIXED_ZERO)).toBe(FIXED_MAX);
  });

  it('[boundary] survives the most extreme finite operands', () => {
    expect(div(FIXED_MAX, FIXED_MIN)).toBe(u(-65536));
    expect(div(FIXED_MAX, FIXED_ONE)).toBe(FIXED_MAX);
  });

  it('[normal] truncates the exact quotient toward zero, not toward −∞', () => {
    expect(div(u(-65536), u(196608))).toBe(u(-21845));
    expect(div(u(65536), u(196608))).toBe(u(21845));
  });

  it('[repeat] repeated identical divisions stay identical', () => {
    expect(div(FIXED_ONE, u(3))).toBe(div(FIXED_ONE, u(3)));
  });
});

describe('cmp / min / max', () => {
  it('[normal] orders, and returns operand identities for min/max', () => {
    expect(cmp(FIXED_MIN, FIXED_MAX)).toBe(-1);
    expect(cmp(FIXED_MAX, FIXED_MIN)).toBe(1);
    expect(cmp(u(7), u(7))).toBe(0);
    expect(min(u(7), u(9))).toBe(u(7));
    expect(max(u(7), u(9))).toBe(u(9));
    expect(min(u(9), u(7))).toBe(u(7));
    expect(max(u(9), u(7))).toBe(u(9));
    expect(min(u(7), u(7))).toBe(u(7));
  });

  it('[boundary] compares the exact edges correctly', () => {
    expect(cmp(FIXED_ZERO, FIXED_MIN)).toBe(1);
    expect(cmp(FIXED_ZERO, FIXED_MAX)).toBe(-1);
  });
});

describe('clamp', () => {
  it('[normal] passes interior values through unchanged', () => {
    expect(clamp(u(5), u(1), u(10))).toBe(u(5));
  });

  it('[boundary] pins to lo and hi exactly at and beyond the edges', () => {
    expect(clamp(u(1), u(1), u(10))).toBe(u(1));
    expect(clamp(u(10), u(1), u(10))).toBe(u(10));
    expect(clamp(u(0), u(1), u(10))).toBe(u(1));
    expect(clamp(u(11), u(1), u(10))).toBe(u(10));
  });

  it('[invalid] rejects inverted bounds — an impossible state', () => {
    expect(() => clamp(u(5), u(10), u(1))).toThrow(RangeError);
  });
});

describe('floor / ceiling / round', () => {
  it('[normal] floors toward −∞', () => {
    expect(floor(u(163840))).toBe(u(131072));
    expect(floor(u(-163840))).toBe(u(-196608));
    expect(floor(FIXED_ONE)).toBe(FIXED_ONE);
  });

  it('[normal] ceils toward +∞', () => {
    expect(ceiling(u(163840))).toBe(u(196608));
    expect(ceiling(u(-163840))).toBe(u(-131072));
  });

  it('[normal] rounds half away from zero at the exact halfway raw', () => {
    expect(round(u(163840))).toBe(u(196608));
    expect(round(u(229376))).toBe(u(262144));
    expect(round(u(-163840))).toBe(u(-196608));
    expect(round(u(32768))).toBe(FIXED_ONE);
    expect(round(u(-32768))).toBe(u(-65536));
  });

  it('[boundary] one raw unit below halfway stays down, one above goes up', () => {
    expect(round(u(163839))).toBe(u(131072));
    expect(round(u(163841))).toBe(u(196608));
    expect(round(u(32767))).toBe(FIXED_ZERO);
    expect(round(u(32769))).toBe(FIXED_ONE);
  });

  it('[boundary] saturates instead of wrapping at the range edges', () => {
    expect(floor(FIXED_MAX)).toBe(u(2147418112));
    expect(floor(FIXED_MIN)).toBe(FIXED_MIN);
    expect(ceiling(FIXED_MIN)).toBe(u(-2147418112));
    expect(ceiling(FIXED_MAX)).toBe(FIXED_MAX);
    expect(round(FIXED_MAX)).toBe(FIXED_MAX);
    expect(round(FIXED_MIN)).toBe(FIXED_MIN);
  });

  it('[determinism] gives identical results on every repeated call', () => {
    expect(round(u(-163840))).toBe(round(u(-163840)));
    expect(floor(u(-163840))).toBe(floor(u(-163840)));
    expect(ceiling(u(163840))).toBe(ceiling(u(163840)));
  });
});

describe('T6 regression — the floor(power / 60) bug', () => {
  // floor(5 / 60) is 0, which made every sub-60 W part free (AGENTS.md § 1,
  // D6). The division must preserve the value; only an explicit floor may
  // reduce it to zero, and the energy accumulator never calls floor.
  it('[determinism] div keeps a 5/60 draw alive; floor alone zeroes it', () => {
    const fiveOverSixty = div(u(327680), u(3932160));
    expect(fiveOverSixty).toBe(u(5461));
    expect(floor(fiveOverSixty)).toBe(FIXED_ZERO);
  });
});

describe('sqrt / isqrt', () => {
  it('[normal] takes exact integer square roots in metres', () => {
    expect(sqrt(FIXED_ONE)).toBe(FIXED_ONE);
    expect(sqrt(u(262144))).toBe(u(131072));
  });

  it('[boundary] sqrt(0) = 0 and the smallest non-zero raw is exact', () => {
    expect(sqrt(FIXED_ZERO)).toBe(FIXED_ZERO);
    expect(sqrt(u(1))).toBe(u(256));
  });

  it('[invalid] rejects negative operands — impossible lengths', () => {
    expect(() => sqrt(u(-1))).toThrow(RangeError);
    expect(() => isqrt(-1n)).toThrow(RangeError);
  });

  it('[determinism] isqrt floors exactly around perfect squares', () => {
    expect(isqrt(0n)).toBe(0);
    expect(isqrt(1n)).toBe(1);
    expect(isqrt(8n)).toBe(2);
    expect(isqrt(9n)).toBe(3);
    expect(isqrt(15n)).toBe(3);
    expect(isqrt(16n)).toBe(4);
    expect(isqrt(16n)).toBe(isqrt(16n));
  });

  it('[boundary] the widest distances a match can ask for stay exact', () => {
    // 2 × (2^31-1)^2 is the largest sum of squares two Q16.16 axes can
    // produce; the seeded Newton guess must land the exact floor (T6),
    // verified by the defining property instead of a hand-computed value.
    const widestSum = (2n ** 31n - 1n) ** 2n * 2n;
    const root = BigInt(isqrt(widestSum));
    expect(root * root).toBeLessThanOrEqual(widestSum);
    expect((root + 1n) * (root + 1n)).toBeGreaterThan(widestSum);
    expect(isqrt(widestSum)).toBe(isqrt(widestSum));
    expect(isqrt(1n << 62n)).toBe(2147483648);
    expect(isqrt(2n)).toBe(1);
    expect(isqrt(3n)).toBe(1);
    expect(isqrt(4n)).toBe(2);
  });
});
