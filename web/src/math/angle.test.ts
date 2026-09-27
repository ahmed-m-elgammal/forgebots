import { describe, expect, it } from 'vitest';
import {
  ANGLE_PI,
  BRADS_PER_TURN,
  angleBetween,
  angleDiff,
  wrapToPi,
  type Angle,
} from './angle';

const deg = (degrees: number): Angle =>
  wrapToPi(Math.round((degrees * BRADS_PER_TURN) / 360));

// Angles are 16-bit circular (65536 = 2π, π = 32768, D1). The three Phase 1
// functions are tested at ±π and 0 exactly as 23-WEB-CLIENT-PLAN.md § 4
// requires, plus the six categories: normal, boundary, invalid, state,
// repeat, determinism.

describe('wrapToPi', () => {
  it('[normal] leaves already-normalised headings alone', () => {
    expect(wrapToPi(0)).toBe(0);
    expect(wrapToPi(16384)).toBe(16384);
    expect(wrapToPi(-16384)).toBe(-16384);
  });

  it('[boundary] maps ±π and 0 canonically into (−π, π]', () => {
    expect(wrapToPi(ANGLE_PI)).toBe(ANGLE_PI);
    expect(wrapToPi(-ANGLE_PI)).toBe(ANGLE_PI);
    expect(wrapToPi(0)).toBe(0);
    expect(wrapToPi(ANGLE_PI + 1)).toBe(-ANGLE_PI + 1);
    expect(wrapToPi(BRADS_PER_TURN - 1)).toBe(-1);
    expect(wrapToPi(BRADS_PER_TURN)).toBe(0);
    expect(wrapToPi(3 * BRADS_PER_TURN + ANGLE_PI)).toBe(ANGLE_PI);
    expect(wrapToPi(-3 * BRADS_PER_TURN - ANGLE_PI - 1)).toBe(ANGLE_PI - 1);
  });

  it('[invalid] rejects non-integer, NaN and Infinity headings', () => {
    expect(() => wrapToPi(0.5)).toThrow(TypeError);
    expect(() => wrapToPi(Number.NaN)).toThrow(TypeError);
    expect(() => wrapToPi(Number.POSITIVE_INFINITY)).toThrow(TypeError);
    expect(() => wrapToPi(null as unknown as number)).toThrow(TypeError);
  });

  it('[state] any unbounded heading accumulator normalises to range', () => {
    expect(wrapToPi(1000000000)).toBe(-13824);
    expect(wrapToPi(-1000000000)).toBe(13824);
  });

  it('[repeat] is idempotent: wrapping a wrapped angle changes nothing', () => {
    for (const raw of [0, 1, -1, ANGLE_PI, -ANGLE_PI, 98304, -98305, 123456789]) {
      expect(wrapToPi(wrapToPi(raw))).toBe(wrapToPi(raw));
    }
  });

  it('[determinism] same raw, same result, every time', () => {
    expect(wrapToPi(98304)).toBe(ANGLE_PI);
    expect(wrapToPi(98304)).toBe(wrapToPi(98304));
  });
});

describe('angleDiff', () => {
  it('[normal] gives the plain difference for small turns', () => {
    expect(angleDiff(wrapToPi(0), wrapToPi(16384))).toBe(16384);
    expect(angleDiff(wrapToPi(16384), wrapToPi(0))).toBe(-16384);
  });

  it('[boundary] turns 179° → −179° by +2°, not −358°', () => {
    const facing = deg(179);
    const target = deg(-179);
    expect(angleDiff(facing, target)).toBe(364);
    expect(angleDiff(target, facing)).toBe(-364);
  });

  it('[boundary] resolves exact antipodes to the canonical +π', () => {
    expect(angleDiff(wrapToPi(0), ANGLE_PI)).toBe(ANGLE_PI);
    expect(angleDiff(ANGLE_PI, wrapToPi(0))).toBe(ANGLE_PI);
  });

  it('[invalid] rejects non-integer inputs before wrapping', () => {
    expect(() => angleDiff(0.5 as Angle, wrapToPi(0))).toThrow(TypeError);
    expect(() => angleDiff(wrapToPi(0), Number.NaN as Angle)).toThrow(TypeError);
  });

  it('[state] the result always lands inside (−π, π]', () => {
    for (let raw = -BRADS_PER_TURN; raw <= BRADS_PER_TURN; raw += 1024) {
      const diff = angleDiff(wrapToPi(raw), wrapToPi(-raw));
      expect(diff).toBeGreaterThan(-ANGLE_PI);
      expect(diff).toBeLessThanOrEqual(ANGLE_PI);
    }
  });

  it('[repeat] repeated identical calls are stable', () => {
    const from = deg(179);
    const to = deg(-179);
    expect(angleDiff(from, to)).toBe(angleDiff(from, to));
  });
});

describe('angleBetween', () => {
  it('[normal] measures the unsigned separation of two headings', () => {
    expect(angleBetween(wrapToPi(0), wrapToPi(16384))).toBe(16384);
    expect(angleBetween(wrapToPi(0), wrapToPi(-8192))).toBe(8192);
  });

  it('[boundary] antipodes are π apart; identical headings are 0 apart', () => {
    expect(angleBetween(wrapToPi(0), ANGLE_PI)).toBe(ANGLE_PI);
    expect(angleBetween(wrapToPi(8192), wrapToPi(-8192))).toBe(16384);
    expect(angleBetween(wrapToPi(1234), wrapToPi(1234))).toBe(0);
  });

  it('[state] is symmetric — direction of comparison cannot change it', () => {
    for (let raw = -BRADS_PER_TURN; raw <= BRADS_PER_TURN; raw += 4096) {
      const a = wrapToPi(raw);
      const b = wrapToPi(raw + 12345);
      expect(angleBetween(a, b)).toBe(angleBetween(b, a));
    }
  });

  it('[determinism] repeated calls return identical values', () => {
    expect(angleBetween(wrapToPi(1), ANGLE_PI)).toBe(
      angleBetween(wrapToPi(1), ANGLE_PI),
    );
  });
});
