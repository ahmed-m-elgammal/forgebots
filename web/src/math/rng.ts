// Two named RNG streams (22-DECISIONS.md D5, 10-DETERMINISM.md § 2.3):
//
//   matchRng — seeded from matches.seed, advanced once per tick before any
//              bot steps, drives world events only, never DSL-visible.
//   botRng   — one per robot, seeded by deriveSeed(seed, side, designIndex,
//              robotIndex), advanced only by that robot's own rng-int.
//
// A bot's sequence is therefore independent of how many other robots exist
// or in what order they ran. The engine is Mulberry32 (10 § 2.3), integer
// only, seeded explicitly — there is no Math.random anywhere in this
// module and no default seed. Math.imul is the sanctioned integer
// 32-bit multiply inside the math module (10 § 3).

export interface Rng {
  nextUint32(): number;
  nextInt(boundExclusive: number): number;
}

const UINT32_LIMIT = 0x100000000;
const MULBERRY_GOLDEN = 0x6d2b79f5;
const MAX_UINT32 = 0xffffffff;
const UINT64_LIMIT = 1n << 64n;
const M64 = UINT64_LIMIT - 1n;
// splitmix64's golden gamma. deriveSeed advances by it before the first
// mix so a bot stream can never coincide with createMatchRng's reduction
// of the same match seed — stream separation holds for every seed (D5).
const SPLITMIX_GAMMA = 0x9e3779b97f4a7c15n;

// splitmix64 finalizer — the deterministic bigint → uint32 reduction for
// both stream kinds. matches.seed is a bigint; folding side, designIndex
// and robotIndex through the same mixer gives each robot its own stream
// without collisions between the trivially adjacent tuples.
function mix64(value: bigint): bigint {
  let z = value & M64;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & M64;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & M64;
  return (z ^ (z >> 31n)) & M64;
}

function assertMatchSeed(seed: bigint): void {
  if (seed < 0n || seed >= UINT64_LIMIT) {
    throw new RangeError(`match seed must be a uint64, got ${seed}`);
  }
}

function assertRobotIndex(value: number, label: string): void {
  if (!Number.isInteger(value)) {
    throw new TypeError(`${label} must be an integer, got ${value}`);
  }
  if (value < 0 || value > MAX_UINT32) {
    throw new RangeError(`${label} must be a uint32, got ${value}`);
  }
}

export function createRng(seed: number): Rng {
  if (!Number.isInteger(seed)) {
    throw new TypeError(`rng seed must be an integer, got ${seed}`);
  }
  if (seed < 0 || seed > MAX_UINT32) {
    throw new RangeError(`rng seed must be a uint32, got ${seed}`);
  }
  let state = seed | 0;
  const nextUint32 = (): number => {
    state = (state + MULBERRY_GOLDEN) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
  return {
    nextUint32,
    // Uniform in [0, bound) by rejection sampling — the same contract as
    // the DSL's (rng-int n), with no modulo bias and no float.
    nextInt(boundExclusive: number): number {
      if (!Number.isInteger(boundExclusive)) {
        throw new TypeError(`bound must be an integer, got ${boundExclusive}`);
      }
      if (boundExclusive < 1 || boundExclusive > UINT32_LIMIT) {
        throw new RangeError(`bound must be in [1, 2^32], got ${boundExclusive}`);
      }
      const limit = UINT32_LIMIT - (UINT32_LIMIT % boundExclusive);
      let draw = nextUint32();
      while (draw >= limit) {
        draw = nextUint32();
      }
      return draw % boundExclusive;
    },
  };
}

export function createMatchRng(seed: bigint): Rng {
  assertMatchSeed(seed);
  return createRng(Number(mix64(seed) & 0xffffffffn));
}

export function deriveSeed(
  matchSeed: bigint,
  side: number,
  designIndex: number,
  robotIndex: number,
): number {
  assertMatchSeed(matchSeed);
  if (side !== 0 && side !== 1) {
    throw new RangeError(`side must be 0 or 1, got ${side}`);
  }
  assertRobotIndex(designIndex, 'designIndex');
  assertRobotIndex(robotIndex, 'robotIndex');
  let z = mix64(matchSeed + SPLITMIX_GAMMA);
  z = mix64(z ^ BigInt(side));
  z = mix64(z ^ BigInt(designIndex));
  z = mix64(z ^ BigInt(robotIndex));
  return Number(z & 0xffffffffn);
}

export function createBotRng(
  matchSeed: bigint,
  side: number,
  designIndex: number,
  robotIndex: number,
): Rng {
  return createRng(deriveSeed(matchSeed, side, designIndex, robotIndex));
}
