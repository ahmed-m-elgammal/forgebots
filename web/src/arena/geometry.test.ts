import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ARENA_CONFIG,
  buildArena,
  clampToArena,
  isInsidePillar,
  isInWall,
  pillarExclusionRadius,
  resolvePillarOverlap,
} from './index';
import { fromMm, fromRaw } from '../math/fixed';
import { vec2 } from '../math/vec2';

// Phase 4 task 1 geometry (23 § 7.1, D15, 20 Phase 12): 200 m x 200 m in
// Q16.16, 0.5 m walls, 8 pillars on the 3 x 3 lattice with the centre
// cell empty, 12 perimeter spawn points with a seed-derived order.

const arena = () => buildArena(DEFAULT_ARENA_CONFIG, 42n);

describe('buildArena (20 T14.1)', () => {
  it('[boundary] the 200 m extent is representable in Q16.16 without overflow', () => {
    // The 20 Phase 12 regression: 200 m must survive D1's fixed point.
    expect(arena().size).toBe(13107200);
    expect(13107200).toBeLessThan(0x7fffffff);
  });

  it('[normal] places 8 pillars on the 3 x 3 lattice, centre cell empty', () => {
    const pillars = arena().pillars;
    expect(pillars).toHaveLength(8);
    // Cell centres: ((2c+1) x 13107200 / 6) truncated — the edges floor
    // sub-raw, which is deterministic on every platform.
    expect(pillars.map((p) => [p.x, p.y])).toEqual([
      [2184533, 2184533],
      [6553600, 2184533],
      [10922666, 2184533],
      [2184533, 6553600],
      [10922666, 6553600],
      [2184533, 10922666],
      [6553600, 10922666],
      [10922666, 10922666],
    ]);
    // The centre cell (100 m, 100 m) is empty — that is the 9th pocket.
    expect(pillars.some((p) => p.x === 6553600 && p.y === 6553600)).toBe(false);
  });

  it('[normal] spaces 12 spawn points around the perimeter, three per side', () => {
    const points = arena().spawnPoints;
    expect(points).toHaveLength(12);
    expect(points.map((p) => [p.x, p.y])).toEqual([
      [3276800, 98304],
      [6553600, 98304],
      [9830400, 98304],
      [13008896, 3276800],
      [13008896, 6553600],
      [13008896, 9830400],
      [9830400, 13008896],
      [6553600, 13008896],
      [3276800, 13008896],
      [98304, 9830400],
      [98304, 6553600],
      [98304, 3276800],
    ]);
  });

  it('[determinism] the same seed yields the same spawn order; a different seed does not', () => {
    const first = buildArena(DEFAULT_ARENA_CONFIG, 42n);
    const second = buildArena(DEFAULT_ARENA_CONFIG, 42n);
    expect(second.spawnOrder).toEqual(first.spawnOrder);
    expect(first.spawnOrder).toEqual([3, 11, 2, 7, 6, 9, 4, 5, 0, 1, 8, 10]);
    // The permutation covers every slot exactly once — no robot shares a
    // spawn point by accident.
    expect([...first.spawnOrder].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    const other = buildArena(DEFAULT_ARENA_CONFIG, 7n);
    expect(other.spawnOrder).not.toEqual(first.spawnOrder);
    // Geometry is seed-independent: only the order derives from the seed.
    expect(other.pillars).toEqual(first.pillars);
    expect(other.spawnPoints).toEqual(first.spawnPoints);
  });

  it('[invalid] rejects non-integer, non-positive and out-of-range config', () => {
    expect(() => buildArena({ ...DEFAULT_ARENA_CONFIG, sizeMm: 200000.5 }, 1n)).toThrow(TypeError);
    expect(() => buildArena({ ...DEFAULT_ARENA_CONFIG, sizeMm: 0 }, 1n)).toThrow(RangeError);
    expect(() => buildArena({ ...DEFAULT_ARENA_CONFIG, sizeMm: 32768000 }, 1n)).toThrow(RangeError);
    expect(() => buildArena({ ...DEFAULT_ARENA_CONFIG, wallThicknessMm: 100000 }, 1n)).toThrow(RangeError);
    expect(() => buildArena({ ...DEFAULT_ARENA_CONFIG, spawnInsetMm: 500 }, 1n)).toThrow(RangeError);
    expect(() => buildArena({ ...DEFAULT_ARENA_CONFIG, pillarRadiusMm: -1 }, 1n)).toThrow(RangeError);
  });
});

describe('isInWall / clampToArena (20 T14.2, T14.4)', () => {
  it('[normal] flags the wall band, inside and at corners', () => {
    const field = arena();
    expect(isInWall(field, vec2(fromMm(100), fromMm(100000)))).toBe(true);
    expect(isInWall(field, vec2(fromMm(100), fromMm(100)))).toBe(true);
    expect(isInWall(field, vec2(fromMm(199900), fromMm(100000)))).toBe(true);
    expect(isInWall(field, vec2(fromMm(100000), fromMm(199900)))).toBe(true);
  });

  it('[boundary] the inner wall face itself is interior', () => {
    const field = arena();
    expect(isInWall(field, vec2(fromMm(500), fromMm(100000)))).toBe(false);
    expect(isInWall(field, vec2(fromMm(100000), fromMm(500)))).toBe(false);
    expect(isInWall(field, vec2(fromMm(100000), fromMm(100000)))).toBe(false);
  });

  it('[state] clamps a centre so the robot disc stays inside the walls', () => {
    const field = arena();
    const low = fromMm(1000);
    const high = fromRaw(13041664);
    expect(clampToArena(field, vec2(fromRaw(0), fromRaw(0)))).toEqual(vec2(low, low));
    expect(clampToArena(field, vec2(fromRaw(0x7fffffff), high))).toEqual(vec2(high, high));
  });

  it('[boundary] a centre exactly on the clamp bound is unchanged, and clamping is idempotent', () => {
    const field = arena();
    const onBound = vec2(fromMm(1000), fromRaw(13041664));
    expect(clampToArena(field, onBound)).toEqual(onBound);
    const once = clampToArena(field, vec2(fromMm(300), fromMm(199800)));
    expect(clampToArena(field, once)).toEqual(once);
  });
});

describe('isInsidePillar / resolvePillarOverlap (20 T14.2)', () => {
  it('[normal] flags the exclusion disc around each pillar', () => {
    const field = arena();
    expect(isInsidePillar(field, vec2(fromRaw(6553600), fromRaw(2184533)))).toBe(true);
    expect(isInsidePillar(field, vec2(fromRaw(6553600), fromRaw(6553600)))).toBe(false);
  });

  it('[boundary] touching the stone is allowed; one raw inside is not', () => {
    const field = arena();
    const exclusion = pillarExclusionRadius(field);
    expect(exclusion).toBe(fromMm(2500));
    expect(isInsidePillar(field, vec2(fromRaw(6553600), fromRaw(2184533 + exclusion)))).toBe(false);
    expect(isInsidePillar(field, vec2(fromRaw(6553600), fromRaw(2184533 + exclusion - 1)))).toBe(true);
  });

  it('[state] a non-overlapping position passes through untouched', () => {
    const field = arena();
    const clear = vec2(fromMm(10000), fromMm(10000));
    expect(resolvePillarOverlap(field, clear)).toEqual(clear);
  });

  it('[determinism] the exact-centre tie-break pushes east, deterministically', () => {
    const field = arena();
    const centre = vec2(fromRaw(6553600), fromRaw(2184533));
    const resolved = resolvePillarOverlap(field, centre);
    expect(resolved).toEqual(vec2(fromRaw(6553600 + fromMm(2500)), fromRaw(2184533)));
    expect(resolvePillarOverlap(field, centre)).toEqual(resolved);
  });

  it('[normal] pushes an overlapping disc radially out to the boundary', () => {
    const field = arena();
    const pillar = vec2(fromRaw(6553600), fromRaw(2184533));
    const inside = vec2(fromRaw(6553600 + 1000), fromRaw(2184533 + 1000));
    const resolved = resolvePillarOverlap(field, inside);
    const exclusionSq = BigInt(pillarExclusionRadius(field)) * BigInt(pillarExclusionRadius(field));
    // Out of the exclusion, on the first push: pillars are ~66 m apart,
    // so one radial pass can never land in another pillar.
    expect(isInsidePillar(field, resolved)).toBe(false);
    const dx = BigInt(resolved.x) - BigInt(pillar.x);
    const dy = BigInt(resolved.y) - BigInt(pillar.y);
    expect(dx * dx + dy * dy).toBeGreaterThanOrEqual(exclusionSq);
  });
});
