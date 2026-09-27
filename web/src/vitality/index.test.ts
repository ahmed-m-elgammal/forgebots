import { describe, expect, it } from 'vitest';
import {
  EMERGENCY_CONVERSION_BIOMASS,
  EMERGENCY_CONVERSION_ENERGY,
  SHIELD_REGEN_MILLI_TICKS_PER_HP,
  SHIELD_REGEN_SUPPRESSION_TICKS,
  TICKS_PER_SECOND,
  drainEnergyForTick,
  noteShieldDamage,
  regenerateShieldForTick,
  type EnergizedRobot,
  type ShieldedRobot,
} from './index';

// The barrel is the surface match/ will import (AGENTS.md G8). A smoke
// pass through it fails if an export drifts from energy.ts / shields.ts
// without a rename rippling here.

const makeEnergyRobot = (): EnergizedRobot => ({
  id: 'p1.e.0',
  energyMaxMilli: 500000,
  energyMilli: 500000,
  energyRemainder: 0,
  biomassCarried: 0,
  alive: true,
});

const makeShieldRobot = (): ShieldedRobot => ({
  id: 'p1.e.0',
  maxShieldHp: 50,
  shieldHp: 30,
  shieldRegenRemainder: 0,
  shieldRegenSuppressTicks: 0,
  alive: true,
});

describe('vitality barrel', () => {
  it('[normal] drains and regenerates through the public surface', () => {
    const energyRobot = makeEnergyRobot();
    const result = drainEnergyForTick(energyRobot, 5000);
    expect(result.poolDeltaMilli).toBe(-83);

    const shieldRobot = makeShieldRobot();
    noteShieldDamage(shieldRobot);
    expect(regenerateShieldForTick(shieldRobot, 1000)).toBe(false);
  });

  it('[determinism] the constants are the pinned spec numbers', () => {
    expect(TICKS_PER_SECOND).toBe(60);
    expect(EMERGENCY_CONVERSION_BIOMASS).toBe(10);
    expect(EMERGENCY_CONVERSION_ENERGY).toBe(5);
    expect(SHIELD_REGEN_SUPPRESSION_TICKS).toBe(60);
    expect(SHIELD_REGEN_MILLI_TICKS_PER_HP).toBe(60000);
  });
});
