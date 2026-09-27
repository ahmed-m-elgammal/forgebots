import { describe, expect, it } from 'vitest';
import { BiomassField, buildArena, regionOf } from './index';
import { DEFAULT_ARENA_CONFIG } from './index';
import { fromRaw } from '../math/fixed';

// The barrel is the surface the match loop and perception/ will import
// (AGENTS.md G8). A smoke pass through it fails if an export drifts from
// geometry.ts / biomass.ts without a rename rippling here.

describe('arena barrel', () => {
  it('[normal] builds an arena and a field through the public surface', () => {
    const arena = buildArena(DEFAULT_ARENA_CONFIG, 42n);
    expect(arena.pillars).toHaveLength(8);
    const field = BiomassField.build(arena, 42n);
    expect(field.availableCount()).toBe(400);
    expect(regionOf(arena, { x: fromRaw(0), y: fromRaw(0) })).toBe(0);
  });

  it('[determinism] the default config is the frozen D15 layout', () => {
    expect(DEFAULT_ARENA_CONFIG).toEqual({
      sizeMm: 200000,
      wallThicknessMm: 500,
      pillarRadiusMm: 2000,
      robotRadiusMm: 500,
      spawnInsetMm: 1500,
    });
  });
});
