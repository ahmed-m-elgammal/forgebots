import { describe, expect, it } from 'vitest';
import { fromMm } from '../math/fixed';
import { vec2 } from '../math/vec2';
import {
  GrenadeVolley,
  resolveAttacks,
  tickWeaponCooldowns,
  type Combatant,
  type CombatWeapon,
} from './index';
import { drainEnergyForTick, noteShieldDamage, regenerateShieldForTick } from '../vitality';

// The Phase 5 wiring contract, proven before match/ exists: the tick
// order of 20 Phase 12.3 (combat, then vitality) and the two seams
// between them — a shot's to_shield > 0 triggers noteShieldDamage, and
// a robot killed mid-tick stops metabolising. The contexts themselves
// cannot import each other (06 § 5.2); this file is the composition
// root standing in for match/match.ts.

const BLASTER: CombatWeapon = {
  partId: 'blaster',
  damagePerHit: 12,
  cooldownTicks: 60,
  rangeMm: 30000,
  splashRadiusMm: null,
};

interface FixtureRobot {
  readonly id: string;
  readonly combatant: Combatant;
  alive: boolean;
  // Shield pool — the same state as combatant.shieldHp, synced at the
  // vitality boundary each tick (the real Robot is ONE object satisfying
  // both structural views; the fixture mirrors that here).
  shieldHp: number;
  readonly maxShieldHp: number;
  energyMilli: number;
  readonly energyMaxMilli: number;
  energyRemainder: number;
  biomassCarried: number;
  shieldRegenRemainder: number;
  shieldRegenSuppressTicks: number;
  readonly regenRate: number;
}

const makeRobot = (id: string, side: number, xMm: number, regenRate: number): FixtureRobot => {
  const combatant: Combatant = {
    id,
    side,
    position: vec2(fromMm(xMm), fromMm(0)),
    heading: 0 as Combatant['heading'],
    hullHp: 30,
    shieldHp: 20,
    biomassCarried: 0,
    alive: true,
    carryCapacity: 25,
    weapons: [BLASTER],
    weaponCooldowns: [0],
  };
  return {
    id,
    combatant,
    alive: true,
    shieldHp: combatant.shieldHp,
    maxShieldHp: 50,
    energyMilli: 500000,
    energyMaxMilli: 500000,
    energyRemainder: 0,
    biomassCarried: 0,
    shieldRegenRemainder: 0,
    shieldRegenSuppressTicks: 0,
    regenRate,
  };
};

// One tick exactly as match/ will run it: cooldowns, attacks, volley,
// then vitality over everyone still standing.
function tick(combatants: readonly Combatant[], fixtures: readonly FixtureRobot[], attackers: readonly Combatant[]) {
  for (const combatant of combatants) {
    tickWeaponCooldowns(combatant);
  }
  const volley = new GrenadeVolley();
  const resolution = resolveAttacks(combatants, attackers, volley);
  const splash = volley.stepAll(combatants);
  for (const shot of resolution.shots) {
    if (shot.toShield > 0) {
      const victim = fixtures.find((fixture) => fixture.combatant.id === shot.targetId);
      if (victim !== undefined) {
        noteShieldDamage(victim);
      }
    }
  }
  const regenGains: string[] = [];
  const starvationDeaths: string[] = [];
  for (const fixture of fixtures) {
    // The combatant is the shared state object; vitality sees its pools
    // through the fixture, so death and damage must propagate in before
    // the sweep and healed shields propagate back out.
    fixture.alive = fixture.combatant.alive;
    fixture.shieldHp = fixture.combatant.shieldHp;
    const regenerated = regenerateShieldForTick(fixture, fixture.regenRate);
    fixture.combatant.shieldHp = fixture.shieldHp;
    if (regenerated) {
      regenGains.push(fixture.combatant.id);
    }
    const energy = drainEnergyForTick(fixture, 5000);
    if (energy.starvationDeath !== null) {
      starvationDeaths.push(energy.starvationDeath.botId);
    }
  }
  return { resolution, splash, regenGains, starvationDeaths };
}

describe('the combat-to-vitality wiring contract (for match/, Phase 5)', () => {
  it('[normal] shields soak first, regen resumes exactly 60 ticks after the last shield hit', () => {
    const shooter = makeRobot('p1.a.0', 0, 0, 1000);
    const target = makeRobot('p2.b.0', 1, 10000, 1000);
    const combatants = [shooter.combatant, target.combatant];

    // One blaster hit: 12 of the 20 shield points gone, regen suppressed.
    const first = tick(combatants, [shooter, target], [shooter.combatant]);
    expect(first.resolution.shots[0]!.toShield).toBe(12);
    expect(target.combatant.shieldHp).toBe(8);

    // Suppressed ticks bank nothing (the damage tick's own regen call
    // already spent one suppression tick); the window releases after 60.
    for (let tickIndex = 0; tickIndex < 59; tickIndex++) {
      tick(combatants, [shooter, target], []);
    }
    expect(target.combatant.shieldHp).toBe(8);
    expect(target.shieldRegenSuppressTicks).toBe(0);
    for (let tickIndex = 0; tickIndex < 60; tickIndex++) {
      tick(combatants, [shooter, target], []);
    }
    expect(target.combatant.shieldHp).toBe(9);
  });

  it('[state] a killed robot stops metabolising the same tick it dies', () => {
    const shooter = makeRobot('p1.a.0', 0, 0, 1000);
    const victim = makeRobot('p2.b.0', 1, 10000, 1000);
    victim.combatant.shieldHp = 0;
    victim.combatant.hullHp = 12;
    victim.energyMilli = 499917;
    const combatants = [shooter.combatant, victim.combatant];

    const lethal = tick(combatants, [shooter, victim], [shooter.combatant]);
    expect(lethal.resolution.deaths).toHaveLength(1);
    expect(victim.combatant.alive).toBe(false);
    const poolAfterDeath = victim.energyMilli;
    for (let tickIndex = 0; tickIndex < 10; tickIndex++) {
      tick(combatants, [shooter, victim], []);
    }
    expect(victim.energyMilli).toBe(poolAfterDeath);
    expect(shooter.combatant.shieldHp).toBe(20);
    // The survivor keeps paying its 5 W draw: 11 ticks telescope to 916
    // milli-units (11 x 83 1/3), the accumulator holding 40 at the end.
    expect(shooter.energyMilli).toBe(499084);
  });

  it('[state] the intended order is combat first, vitality second — same tick, deterministic', () => {
    const run = (): string => {
      const localShooter = makeRobot('p1.a.0', 0, 0, 1000);
      const localTarget = makeRobot('p2.b.0', 1, 10000, 1000);
      const localCombatants = [localShooter.combatant, localTarget.combatant];
      const states: string[] = [];
      for (let tickIndex = 0; tickIndex < 150; tickIndex++) {
        const result = tick(localCombatants, [localShooter, localTarget], tickIndex % 61 === 0 ? [localShooter.combatant] : []);
        states.push(
          JSON.stringify([
            localShooter.combatant.shieldHp,
            localShooter.combatant.hullHp,
            localTarget.combatant.shieldHp,
            localTarget.combatant.hullHp,
            localTarget.energyMilli,
            result.resolution.shots.length,
          ]),
        );
      }
      return states.join('|');
    };
    expect(run()).toBe(run());
  });
});
