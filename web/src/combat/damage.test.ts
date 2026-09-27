import { describe, expect, it } from 'vitest';
import {
  DEATH_CAUSE_COMBAT,
  KILL_BOUNTY_MAX,
  applyDamage,
  killRobot,
  type Damageable,
  type DamageOutcome,
} from './index';

// Shield-first damage, death and bounty per D7 and 04 § 6. Every pool
// edge gets its exact-boundary test (T5): damage equal to the shield
// pool, hull dying at exactly 0, the bounty at exactly 10.

let nextRobotNumber = 0;

interface FixtureOverrides {
  readonly id?: string;
  readonly hullHp?: number;
  readonly shieldHp?: number;
  readonly biomassCarried?: number;
  readonly alive?: boolean;
  readonly carryCapacity?: number;
}

const makeRobot = (overrides: FixtureOverrides = {}): Damageable => ({
  id: overrides.id ?? `r${nextRobotNumber++}`,
  hullHp: overrides.hullHp ?? 30,
  shieldHp: overrides.shieldHp ?? 20,
  biomassCarried: overrides.biomassCarried ?? 0,
  alive: overrides.alive ?? true,
  carryCapacity: overrides.carryCapacity ?? 25,
});

const cloneOutcome = (outcome: DamageOutcome): string => JSON.stringify(outcome);

describe('applyDamage (D7 shield-first)', () => {
  it('[normal] drains the shield first and leaves hull untouched while it lasts', () => {
    const target = makeRobot({ hullHp: 30, shieldHp: 20 });
    const outcome = applyDamage(target, 12, null);
    expect(target.shieldHp).toBe(8);
    expect(target.hullHp).toBe(30);
    expect(target.alive).toBe(true);
    expect(outcome).toEqual({ toShield: 12, toHull: 0, killed: false, death: null });
  });

  it('[normal] overflow reaches hull once the shield is gone', () => {
    const target = makeRobot({ hullHp: 30, shieldHp: 8 });
    const outcome = applyDamage(target, 12, null);
    expect(target.shieldHp).toBe(0);
    expect(target.hullHp).toBe(26);
    expect(outcome).toEqual({ toShield: 8, toHull: 4, killed: false, death: null });
  });

  it('[normal] a target with no shield takes the hit on hull alone', () => {
    const target = makeRobot({ hullHp: 30, shieldHp: 0 });
    const outcome = applyDamage(target, 12, null);
    expect(target.hullHp).toBe(18);
    expect(outcome).toEqual({ toShield: 0, toHull: 12, killed: false, death: null });
  });

  it('[boundary] damage exactly equal to the shield pool stops at the hull', () => {
    const target = makeRobot({ hullHp: 30, shieldHp: 12 });
    const outcome = applyDamage(target, 12, null);
    expect(target.shieldHp).toBe(0);
    expect(target.hullHp).toBe(30);
    expect(outcome.toHull).toBe(0);
  });

  it('[boundary] one shield point left soaks 1 and passes the rest through', () => {
    const target = makeRobot({ hullHp: 30, shieldHp: 1 });
    const outcome = applyDamage(target, 12, null);
    expect(target.shieldHp).toBe(0);
    expect(target.hullHp).toBe(19);
    expect(outcome).toEqual({ toShield: 1, toHull: 11, killed: false, death: null });
  });

  it('[boundary] hull dying at exactly 0 is death, one point above survives', () => {
    const dying = makeRobot({ hullHp: 5, shieldHp: 0 });
    const dyingOutcome = applyDamage(dying, 5, null);
    expect(dyingOutcome.killed).toBe(true);
    expect(dying.alive).toBe(false);

    const surviving = makeRobot({ hullHp: 6, shieldHp: 0 });
    const survivingOutcome = applyDamage(surviving, 5, null);
    expect(survivingOutcome.killed).toBe(false);
    expect(surviving.hullHp).toBe(1);
    expect(surviving.alive).toBe(true);
  });

  it('[boundary] overkill clamps hull to 0 but reports the full overflow', () => {
    const target = makeRobot({ hullHp: 3, shieldHp: 0 });
    const outcome = applyDamage(target, 50, null);
    expect(target.hullHp).toBe(0);
    expect(outcome.toHull).toBe(50);
    expect(outcome.killed).toBe(true);
  });

  it('[invalid] zero, negative and fractional damage are caller bugs', () => {
    const target = makeRobot();
    expect(() => applyDamage(target, 0, null)).toThrow(RangeError);
    expect(() => applyDamage(target, -12, null)).toThrow(RangeError);
    expect(() => applyDamage(target, 1.5, null)).toThrow(TypeError);
    expect(() => applyDamage(target, Number.NaN, null)).toThrow(TypeError);
  });

  it('[invalid] a dead robot cannot take damage', () => {
    const target = makeRobot({ alive: false });
    expect(() => applyDamage(target, 12, null)).toThrow(/dead/);
  });

  it('[state] mutates only the target and reports the split', () => {
    const target = makeRobot({ id: 'target', shieldHp: 5, biomassCarried: 4 });
    const source = makeRobot({ id: 'source', biomassCarried: 2 });
    applyDamage(target, 60, source);
    expect(target.alive).toBe(false);
    expect(target.shieldHp).toBe(0);
    expect(target.hullHp).toBe(0);
    expect(source.shieldHp).toBe(20);
    expect(source.hullHp).toBe(30);
    expect(source.alive).toBe(true);
  });

  it('[repeat] successive hits deplete the pools in order until death', () => {
    const target = makeRobot({ hullHp: 14, shieldHp: 20 });
    const blaster = (robot: Damageable): DamageOutcome => applyDamage(robot, 12, null);
    expect(blaster(target).toShield).toBe(12);
    expect(blaster(target).toHull).toBe(4);
    expect(target.hullHp).toBe(10);
    expect(blaster(target).killed).toBe(true);
    expect(target.alive).toBe(false);
  });

  it('[determinism] the same starting state always yields the same ledger', () => {
    const run = (): string => {
      const target = makeRobot({ id: 'ledger', hullHp: 21, shieldHp: 15 });
      return [applyDamage(target, 12, null), applyDamage(target, 12, null), applyDamage(target, 12, null)]
        .map(cloneOutcome)
        .join('|');
    };
    expect(run()).toBe(run());
  });
});

describe('killRobot and the biomass bounty (04 § 6)', () => {
  it('[normal] the killer gains min(10, victim carry)', () => {
    const victim = makeRobot({ biomassCarried: 25, carryCapacity: 25 });
    const killer = makeRobot({ biomassCarried: 0, carryCapacity: 25 });
    const record = killRobot(victim, killer);
    expect(record).toEqual({ botId: victim.id, cause: DEATH_CAUSE_COMBAT, killerId: killer.id, bounty: KILL_BOUNTY_MAX });
    expect(killer.biomassCarried).toBe(10);
  });

  it('[boundary] carry at exactly the cap pays 10; below it pays everything', () => {
    const atCap = makeRobot({ biomassCarried: 10 });
    const atCapKiller = makeRobot();
    expect(killRobot(atCap, atCapKiller).bounty).toBe(10);

    const underCap = makeRobot({ biomassCarried: 9 });
    const underCapKiller = makeRobot();
    expect(killRobot(underCap, underCapKiller).bounty).toBe(9);

    const empty = makeRobot({ biomassCarried: 0 });
    expect(killRobot(empty, makeRobot()).bounty).toBe(0);
  });

  it('[boundary] the killer capacity clamps the bounty: full means nothing moves', () => {
    const victim = makeRobot({ biomassCarried: 25 });
    const killer = makeRobot({ biomassCarried: 25, carryCapacity: 25 });
    const record = killRobot(victim, killer);
    expect(record.bounty).toBe(0);
    expect(killer.biomassCarried).toBe(25);
    expect(victim.alive).toBe(false);
  });

  it('[boundary] partial killer room pays only what fits', () => {
    const victim = makeRobot({ biomassCarried: 25 });
    const killer = makeRobot({ biomassCarried: 21, carryCapacity: 25 });
    const record = killRobot(victim, killer);
    expect(record.bounty).toBe(4);
    expect(killer.biomassCarried).toBe(25);
  });

  it('[invalid] killing a corpse twice throws', () => {
    const victim = makeRobot();
    killRobot(victim, null);
    expect(() => killRobot(victim, null)).toThrow(/already dead/);
  });

  it('[state] death zeroes the victim carry and leaves the rest of the state alone', () => {
    const victim = makeRobot({ hullHp: 7, shieldHp: 5, biomassCarried: 12 });
    const killer = makeRobot({ biomassCarried: 3 });
    killRobot(victim, killer);
    expect(victim.biomassCarried).toBe(0);
    expect(victim.hullHp).toBe(7);
    expect(victim.shieldHp).toBe(5);
    expect(killer.biomassCarried).toBe(13);
  });

  it('[state] a dead killer earns nothing and self-splash cannot farm itself', () => {
    const deadKiller = makeRobot({ alive: false });
    const victimOfCorpse = makeRobot({ biomassCarried: 20 });
    const corpseRecord = killRobot(victimOfCorpse, deadKiller);
    expect(corpseRecord.bounty).toBe(0);
    expect(corpseRecord.killerId).toBe(null);
    expect(deadKiller.biomassCarried).toBe(0);

    const selfSplash = makeRobot({ biomassCarried: 20 });
    const selfRecord = killRobot(selfSplash, selfSplash);
    expect(selfRecord.bounty).toBe(0);
    expect(selfRecord.killerId).toBe(null);
    expect(selfSplash.biomassCarried).toBe(0);
  });

  it('[repeat] one killer farms several victims up to its capacity', () => {
    const killer = makeRobot({ biomassCarried: 0, carryCapacity: 25 });
    killRobot(makeRobot({ biomassCarried: 10 }), killer);
    killRobot(makeRobot({ biomassCarried: 10 }), killer);
    expect(killer.biomassCarried).toBe(20);
    killRobot(makeRobot({ biomassCarried: 10 }), killer);
    expect(killer.biomassCarried).toBe(25);
    const overflowVictim = makeRobot({ biomassCarried: 10 });
    const record = killRobot(overflowVictim, killer);
    expect(record.bounty).toBe(0);
  });

  it('[determinism] the same kill scenario produces the same record twice', () => {
    const run = (): string => {
      const victim = makeRobot({ id: 'victim', biomassCarried: 7 });
      const killer = makeRobot({ id: 'killer', biomassCarried: 1 });
      return JSON.stringify(killRobot(victim, killer));
    };
    expect(run()).toBe(run());
  });
});
