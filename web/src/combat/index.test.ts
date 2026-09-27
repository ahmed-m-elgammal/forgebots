import { describe, expect, it } from 'vitest';
import { fromMm } from '../math/fixed';
import { vec2 } from '../math/vec2';
import {
  GRENADE_FUSE_TICKS,
  GRENADE_THROW_RANGE_MM,
  GrenadeVolley,
  KILL_BOUNTY_MAX,
  ROBOT_HIT_RADIUS_MM,
  applyDamage,
  resolveAttacks,
  tickWeaponCooldowns,
  type Combatant,
} from './index';

// The barrel is the surface match/ will import (AGENTS.md G8). A smoke
// pass through it fails if an export drifts from damage.ts / weapons.ts
// without a rename rippling here.

const BLASTER = { partId: 'blaster', damagePerHit: 12, cooldownTicks: 60, rangeMm: 30000, splashRadiusMm: null };

const makeCombatant = (id: string, side: number, xMm: number): Combatant => ({
  id,
  side,
  position: vec2(fromMm(xMm), fromMm(0)),
  heading: 0 as Combatant['heading'],
  hullHp: 30,
  shieldHp: 0,
  biomassCarried: 0,
  alive: true,
  carryCapacity: 25,
  weapons: [BLASTER],
  weaponCooldowns: [0],
});

describe('combat barrel', () => {
  it('[normal] resolves a fire tick end to end through the public surface', () => {
    const attacker = makeCombatant('p1.a.0', 0, 0);
    const victim = makeCombatant('p2.b.0', 1, 10000);
    const resolution = resolveAttacks([attacker, victim], [attacker], new GrenadeVolley());
    expect(resolution.shots).toHaveLength(1);
    expect(resolution.shots[0]!.toShield).toBe(0);
    expect(victim.hullHp).toBe(18);
    tickWeaponCooldowns(attacker);
    expect(attacker.weaponCooldowns).toEqual([59]);
    applyDamage(victim, 18, attacker);
    expect(victim.alive).toBe(false);
  });

  it('[determinism] the constants are the pinned catalog decisions', () => {
    expect(ROBOT_HIT_RADIUS_MM).toBe(500);
    expect(GRENADE_THROW_RANGE_MM).toBe(24000);
    expect(GRENADE_FUSE_TICKS).toBe(60);
    expect(KILL_BOUNTY_MAX).toBe(10);
  });
});
