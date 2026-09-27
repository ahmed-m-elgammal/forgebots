import { describe, expect, it } from 'vitest';
import {
  createBotRng,
  createMatchRng,
  createRng,
  deriveSeed,
  type Rng,
} from './rng';

const UINT32_LIMIT = 4294967296;
const UINT64_LIMIT = 1n << 64n;

const draw = (rng: Rng, count: number): number[] =>
  Array.from({ length: count }, () => rng.nextUint32());

// D5 names two streams: matchRng (world events, never DSL-visible) and one
// botRng per robot (advanced only by that robot's rng-int). Mulberry32 with
// an explicit seed, no Math.random, no ambient state. The golden sequences
// below pin the exact algorithm — replay determinism depends on it never
// drifting. Categories: normal, boundary, invalid, state, repeat,
// determinism.

describe('createRng', () => {
  it('[determinism] same seed produces the same uint32 sequence', () => {
    expect(draw(createRng(7), 5)).toEqual([
      50271532, 266108690, 4195786334, 3002305430, 2239590375,
    ]);
    expect(draw(createRng(7), 5)).toEqual(draw(createRng(7), 5));
  });

  it('[determinism] same seed produces the same unbiased int sequence', () => {
    const seq = (): number[] => {
      const rng = createRng(12345);
      return Array.from({ length: 5 }, () => rng.nextInt(100));
    };
    expect(seq()).toEqual([69, 44, 50, 52, 86]);
    expect(seq()).toEqual(seq());
  });

  it('[boundary] accepts the full uint32 seed range including both edges', () => {
    expect(() => createRng(0)).not.toThrow();
    expect(() => createRng(UINT32_LIMIT - 1)).not.toThrow();
  });

  it('[invalid] rejects negative, overflowing, fractional and NaN seeds', () => {
    expect(() => createRng(-1)).toThrow(RangeError);
    expect(() => createRng(UINT32_LIMIT)).toThrow(RangeError);
    expect(() => createRng(1.5)).toThrow(TypeError);
    expect(() => createRng(Number.NaN)).toThrow(TypeError);
  });

  it('[state] the stream advances: consecutive draws move forward', () => {
    const rng = createRng(7);
    const seen = draw(rng, 3);
    expect(new Set(seen).size).toBe(3);
  });

  it('[state] every draw lands inside the uint32 range', () => {
    const rng = createRng(99);
    for (const value of draw(rng, 500)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(UINT32_LIMIT);
    }
  });
});

describe('nextInt', () => {
  it('[normal] produces values in [0, bound) across many draws', () => {
    const rng = createRng(4242);
    for (let i = 0; i < 500; i++) {
      const value = rng.nextInt(65536);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(65536);
    }
  });

  it('[boundary] a bound of 1 always yields 0; the 2^32 bound is accepted', () => {
    const rng = createRng(8);
    for (let i = 0; i < 50; i++) {
      expect(rng.nextInt(1)).toBe(0);
    }
    expect(rng.nextInt(UINT32_LIMIT)).toBeLessThan(UINT32_LIMIT);
  });

  it('[invalid] rejects zero, negative, fractional and oversized bounds', () => {
    const rng = createRng(1);
    expect(() => rng.nextInt(0)).toThrow(RangeError);
    expect(() => rng.nextInt(-5)).toThrow(RangeError);
    expect(() => rng.nextInt(2.5)).toThrow(TypeError);
    expect(() => rng.nextInt(UINT32_LIMIT + 1)).toThrow(RangeError);
  });

  it('[state] covers small ranges without systematic bias', () => {
    const rng = createRng(777);
    const buckets = new Set<number>();
    for (let i = 0; i < 200; i++) {
      buckets.add(rng.nextInt(3));
    }
    expect(buckets.size).toBe(3);
  });

  it('[repeat] repeated identical draws over a fixed sequence are stable', () => {
    const seq = (): number[] => {
      const rng = createRng(7);
      return Array.from({ length: 10 }, () => rng.nextInt(2));
    };
    expect(seq()).toEqual(seq());
  });
});

describe('deriveSeed', () => {
  it('[determinism] pins the exact uint32 reduction for known tuples', () => {
    expect(deriveSeed(0n, 0, 0, 0)).toBe(1310806392);
    expect(deriveSeed(123456789n, 1, 2, 3)).toBe(1801331857);
    expect(deriveSeed(123456789n, 1, 2, 3)).toBe(deriveSeed(123456789n, 1, 2, 3));
  });

  it('[normal] returns values inside the uint32 range', () => {
    for (const seed of [0n, 1n, 123456789n, UINT64_LIMIT - 1n]) {
      for (const side of [0, 1]) {
        const seedValue = deriveSeed(seed, side, 0, 0);
        expect(seedValue).toBeGreaterThanOrEqual(0);
        expect(seedValue).toBeLessThan(UINT32_LIMIT);
      }
    }
  });

  it('[boundary] accepts the extreme match seeds and indices', () => {
    expect(() => deriveSeed(0n, 0, 0, 0)).not.toThrow();
    expect(() => deriveSeed(UINT64_LIMIT - 1n, 1, UINT32_LIMIT - 1, UINT32_LIMIT - 1)).not.toThrow();
  });

  it('[invalid] rejects out-of-range seeds, sides and indices', () => {
    expect(() => deriveSeed(-1n, 0, 0, 0)).toThrow(RangeError);
    expect(() => deriveSeed(UINT64_LIMIT, 0, 0, 0)).toThrow(RangeError);
    expect(() => deriveSeed(1n, 2, 0, 0)).toThrow(RangeError);
    expect(() => deriveSeed(1n, -1, 0, 0)).toThrow(RangeError);
    expect(() => deriveSeed(1n, 0, -1, 0)).toThrow(RangeError);
    expect(() => deriveSeed(1n, 0, 0, 1.5)).toThrow(TypeError);
  });

  it('[state] distinct robot identities derive distinct streams', () => {
    const seeds = new Set<number>();
    for (const side of [0, 1]) {
      for (let design = 0; design < 10; design++) {
        for (let robot = 0; robot < 10; robot++) {
          seeds.add(deriveSeed(0n, side, design, robot));
        }
      }
    }
    expect(seeds.size).toBe(200);
  });
});

describe('matchRng / botRng stream separation (D5)', () => {
  it('[determinism] createMatchRng reproduces its sequence exactly', () => {
    expect(draw(createMatchRng(42n), 3)).toEqual([
      1383243166, 3169003791, 2309565951,
    ]);
    expect(draw(createMatchRng(42n), 3)).toEqual(draw(createMatchRng(42n), 3));
  });

  it('[determinism] createBotRng reproduces its sequence exactly', () => {
    expect(draw(createBotRng(0n, 0, 0, 0), 3)).toEqual([
      1412366480, 4132951876, 2192620832,
    ]);
  });

  it('[state] a bot stream is never the match stream for the same seed', () => {
    expect(draw(createMatchRng(0n), 3)).not.toEqual(draw(createBotRng(0n, 0, 0, 0), 3));
  });

  it('[state] two bots never perturb each other, whatever the run order', () => {
    const sideA = createBotRng(123n, 0, 0, 0);
    const sideB = createBotRng(123n, 1, 0, 0);
    const referenceB = draw(createBotRng(123n, 1, 0, 0), 10);
    const interleaved: number[] = [];
    for (let i = 0; i < 10; i++) {
      sideA.nextUint32();
      interleaved.push(sideB.nextUint32());
    }
    expect(interleaved).toEqual(referenceB);
  });

  it('[state] match-world draws leave every bot sequence untouched', () => {
    const match = createMatchRng(7n);
    const bot = createBotRng(7n, 0, 0, 0);
    const botAlone = draw(createBotRng(7n, 0, 0, 0), 10);
    const interleaved: number[] = [];
    for (let i = 0; i < 10; i++) {
      match.nextUint32();
      match.nextInt(1000);
      interleaved.push(bot.nextUint32());
    }
    expect(interleaved).toEqual(botAlone);
  });

  it('[invalid] rejects seeds outside uint64 for both stream kinds', () => {
    expect(() => createMatchRng(-1n)).toThrow(RangeError);
    expect(() => createMatchRng(UINT64_LIMIT)).toThrow(RangeError);
    expect(() => createBotRng(UINT64_LIMIT, 0, 0, 0)).toThrow(RangeError);
  });
});
