import { describe, expect, it } from 'vitest';
import {
  ANGLE_PI,
  BRADS_PER_TURN,
  angleBetween,
  angleDiff,
  fatan2,
  fcos,
  fsin,
  wrapToPi,
  type Angle,
} from './angle';

const QUARTER_TURN = 16384;

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

// ---------------------------------------------------------------------------
// fsin / fcos / fatan2 — the DSL's fixed trig tables (10-DETERMINISM § 2.2).
// The float references here are test-only: source stays integer-only.
// ---------------------------------------------------------------------------

const realSin = (brad: number): number =>
  Math.round(65536 * Math.sin((brad * 2 * Math.PI) / BRADS_PER_TURN));

const circularDistance = (a: number, b: number): number =>
  Math.abs((((a - b + ANGLE_PI) % BRADS_PER_TURN) - ANGLE_PI) % BRADS_PER_TURN);

describe('fsin', () => {
  it('[normal] tracks the real sine across all four quadrants', () => {
    for (let brad = 0; brad < BRADS_PER_TURN; brad += 512) {
      expect(Math.abs(fsin(brad) - realSin(brad))).toBeLessThanOrEqual(30);
    }
    expect(fsin(8192)).toBeGreaterThan(40000);
    expect(fsin(24576)).toBeGreaterThan(40000);
    expect(fsin(40960)).toBeLessThan(-40000);
    expect(fsin(57344)).toBeLessThan(-40000);
  });

  it('[boundary] is exact at every quadrant boundary', () => {
    expect(fsin(0)).toBe(0);
    expect(fsin(QUARTER_TURN)).toBe(BRADS_PER_TURN);
    expect(fsin(ANGLE_PI)).toBe(0);
    expect(fsin(3 * QUARTER_TURN)).toBe(-BRADS_PER_TURN);
    expect(fsin(BRADS_PER_TURN)).toBe(0);
    expect(fsin(-QUARTER_TURN)).toBe(-BRADS_PER_TURN);
    expect(fsin(-ANGLE_PI)).toBe(0);
  });

  it('[invalid] rejects non-integer, NaN and Infinity angles', () => {
    expect(() => fsin(0.5)).toThrow(TypeError);
    expect(() => fsin(Number.NaN)).toThrow(TypeError);
    expect(() => fsin(Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });

  it('[repeat] unbounded accumulators and repeated calls agree', () => {
    for (let brad = -3 * BRADS_PER_TURN; brad <= 3 * BRADS_PER_TURN; brad += 997) {
      expect(fsin(brad)).toBe(fsin(brad + BRADS_PER_TURN));
      expect(fsin(brad)).toBe(fsin(wrapToPi(brad)));
    }
  });

  it('[determinism] every one of the 65536 headings stays within 30 units', () => {
    let worst = 0;
    for (let brad = 0; brad < BRADS_PER_TURN; brad++) {
      const error = Math.abs(fsin(brad) - realSin(brad));
      if (error > worst) worst = error;
    }
    expect(worst).toBeLessThanOrEqual(30);
  });
});

describe('fcos', () => {
  it('[normal] tracks the real cosine through a full turn', () => {
    for (let brad = 0; brad < BRADS_PER_TURN; brad += 512) {
      const real = Math.round(65536 * Math.cos((brad * 2 * Math.PI) / BRADS_PER_TURN));
      expect(Math.abs(fcos(brad) - real)).toBeLessThanOrEqual(30);
    }
  });

  it('[boundary] is exact at every quadrant boundary', () => {
    expect(fcos(0)).toBe(BRADS_PER_TURN);
    expect(fcos(QUARTER_TURN)).toBe(0);
    expect(fcos(ANGLE_PI)).toBe(-BRADS_PER_TURN);
    expect(fcos(3 * QUARTER_TURN)).toBe(0);
    expect(fcos(-QUARTER_TURN)).toBe(0);
  });

  it('[invalid] rejects non-integer angles', () => {
    expect(() => fcos(1.5)).toThrow(TypeError);
  });

  it('[state] is the π/2 phase shift of the same table', () => {
    for (let brad = 0; brad < BRADS_PER_TURN; brad += 255) {
      expect(fcos(brad)).toBe(fsin(brad + QUARTER_TURN));
    }
  });

  it('[determinism] repeated calls are identical', () => {
    expect(fcos(12345)).toBe(fcos(12345));
  });
});

describe('fatan2', () => {
  it('[normal] angles of representative vectors land on their octants', () => {
    expect(fatan2(1000, 3000)).toBeGreaterThan(0);
    expect(fatan2(1000, 3000)).toBeLessThan(8192);
    expect(fatan2(3000, 1000)).toBeGreaterThan(8192);
    expect(fatan2(3000, 1000)).toBeLessThan(QUARTER_TURN);
  });

  it('[boundary] is exact at both axes and all four diagonals', () => {
    expect(fatan2(0, 1)).toBe(0);
    expect(fatan2(1, 0)).toBe(QUARTER_TURN);
    expect(fatan2(0, -1)).toBe(ANGLE_PI);
    expect(fatan2(-1, 0)).toBe(-QUARTER_TURN);
    expect(fatan2(1, 1)).toBe(8192);
    expect(fatan2(1, -1)).toBe(24576);
    expect(fatan2(-1, 1)).toBe(-8192);
    expect(fatan2(-1, -1)).toBe(-24576);
    expect(fatan2(0, 0)).toBe(0);
  });

  it('[invalid] rejects non-integer coordinates', () => {
    expect(() => fatan2(0.5, 1)).toThrow(TypeError);
    expect(() => fatan2(1, Number.NaN)).toThrow(TypeError);
  });

  it('[state] stays inside wrapToPi\'s canonical (−π, π] range', () => {
    const coords = [1, 2, 3, 5, 7, 13, 100, 255, 1000, 12345, 65536, 200000, 2147483647];
    for (const dx of coords.concat(coords.map((v) => -v))) {
      for (const dy of coords.concat(coords.map((v) => -v))) {
        const angle = fatan2(dy, dx);
        expect(angle).toBeGreaterThan(-ANGLE_PI);
        expect(angle).toBeLessThanOrEqual(ANGLE_PI);
      }
    }
  });

  it('[determinism] a dense coordinate grid stays within 6 brads', () => {
    let worst = 0;
    const coords = [1, 2, 3, 5, 7, 11, 99, 255, 1000, 4095, 12345, 65536, 200000, 2000000];
    for (const dx of coords.concat(coords.map((v) => -v))) {
      for (const dy of coords.concat(coords.map((v) => -v))) {
        if (dx === 0 && dy === 0) continue;
        const want = Math.round((65536 * Math.atan2(dy, dx)) / (2 * Math.PI));
        worst = Math.max(worst, circularDistance(fatan2(dy, dx), want));
      }
    }
    expect(worst).toBeLessThanOrEqual(6);
  });
});
