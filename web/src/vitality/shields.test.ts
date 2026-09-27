import { describe, expect, it } from 'vitest';
import {
  SHIELD_REGEN_MILLI_TICKS_PER_HP,
  SHIELD_REGEN_SUPPRESSION_TICKS,
  noteShieldDamage,
  regenerateShieldForTick,
  type ShieldedRobot,
} from './index';

// Shield regen per D7 and 20 Phase 13: carried-remainder accumulation
// (0.5 HP/s must not floor to 0) and the 1 s no-damage suppression. The
// damage side lives in combat/; the match loop (Phase 5) will call
// noteShieldDamage whenever a damage outcome reports to_shield > 0.

interface RobotOverrides {
  readonly id?: string;
  readonly maxShieldHp?: number;
  readonly shieldHp?: number;
  readonly shieldRegenRemainder?: number;
  readonly shieldRegenSuppressTicks?: number;
  readonly alive?: boolean;
}

const makeRobot = (overrides: RobotOverrides = {}): ShieldedRobot => ({
  id: overrides.id ?? 'robot',
  maxShieldHp: overrides.maxShieldHp ?? 50,
  shieldHp: overrides.shieldHp ?? 30,
  shieldRegenRemainder: overrides.shieldRegenRemainder ?? 0,
  shieldRegenSuppressTicks: overrides.shieldRegenSuppressTicks ?? 0,
  alive: overrides.alive ?? true,
});

const LIGHT = 1000;
const HEAVY = 500;

const runTicks = (robot: ShieldedRobot, rate: number, ticks: number): boolean[] => {
  const gains: boolean[] = [];
  for (let tick = 0; tick < ticks; tick++) {
    gains.push(regenerateShieldForTick(robot, rate));
  }
  return gains;
};

describe('regenerateShieldForTick — the carried remainder', () => {
  it('[normal] 1 HP/s crystallises exactly one HP every 60 ticks', () => {
    const robot = makeRobot();
    const gains = runTicks(robot, LIGHT, 60);
    expect(gains.filter((gained) => gained)).toHaveLength(1);
    expect(robot.shieldHp).toBe(31);
    expect(robot.shieldRegenRemainder).toBe(0);
  });

  it('[normal] 0.5 HP/s is measurably non-zero: one HP every 120 ticks (the regression guard)', () => {
    const robot = makeRobot();
    expect(runTicks(robot, HEAVY, 60).some((gained) => gained)).toBe(false);
    expect(robot.shieldHp).toBe(30);
    runTicks(robot, HEAVY, 60);
    expect(robot.shieldHp).toBe(31);
  });

  it('[boundary] a stack of both rates (2.5 HP/s) crystallises one HP every 40 ticks', () => {
    const robot = makeRobot();
    const gains = runTicks(robot, LIGHT + 2 * HEAVY, 40);
    expect(gains.filter((gained) => gained)).toHaveLength(1);
    expect(robot.shieldHp).toBe(31);
  });

  it('[boundary] 59 ticks bank 59 000 and grant nothing; the threshold is exact', () => {
    const robot = makeRobot();
    runTicks(robot, LIGHT, 59);
    expect(robot.shieldHp).toBe(30);
    expect(robot.shieldRegenRemainder).toBe(59000);
    expect(SHIELD_REGEN_MILLI_TICKS_PER_HP).toBe(60000);
  });

  it('[boundary] a full pool regenerates nothing and clears the bank', () => {
    const robot = makeRobot({ shieldHp: 50, shieldRegenRemainder: 45000 });
    expect(regenerateShieldForTick(robot, LIGHT)).toBe(false);
    expect(robot.shieldHp).toBe(50);
    expect(robot.shieldRegenRemainder).toBe(0);
  });

  it('[boundary] the final point clamps at the cap and discards the unused bank', () => {
    const robot = makeRobot({ shieldHp: 49, shieldRegenRemainder: 59000 });
    expect(regenerateShieldForTick(robot, 2 * LIGHT)).toBe(true);
    expect(robot.shieldHp).toBe(50);
    expect(robot.shieldRegenRemainder).toBe(0);
  });

  it('[invalid] a negative or fractional rate is a catalog bug', () => {
    const robot = makeRobot();
    expect(() => regenerateShieldForTick(robot, -1)).toThrow(RangeError);
    expect(() => regenerateShieldForTick(robot, 0.5)).toThrow(TypeError);
  });

  it('[invalid] corpses do not regenerate', () => {
    const robot = makeRobot({ alive: false, shieldHp: 10 });
    expect(regenerateShieldForTick(robot, LIGHT)).toBe(false);
    expect(robot.shieldHp).toBe(10);
  });

  it('[state] a chassis with no shield parts never regenerates', () => {
    const robot = makeRobot({ maxShieldHp: 0, shieldHp: 0 });
    expect(runTicks(robot, LIGHT, 100).some((gained) => gained)).toBe(false);
    expect(robot.shieldHp).toBe(0);
  });

  it('[repeat] regen fills the pool to the cap and then holds', () => {
    const robot = makeRobot({ shieldHp: 30 });
    runTicks(robot, 2 * LIGHT, 2000);
    expect(robot.shieldHp).toBe(50);
  });

  it('[determinism] the same start and rate always walk the same 100-tick path', () => {
    const run = (): string => {
      const robot = makeRobot({ id: 'regen', shieldHp: 30 });
      const states: number[] = [];
      for (let tick = 0; tick < 100; tick++) {
        regenerateShieldForTick(robot, LIGHT);
        states.push(robot.shieldHp);
      }
      return JSON.stringify(states);
    };
    expect(run()).toBe(run());
  });
});

describe('the 1 s suppression window (D7)', () => {
  it('[normal] a shield hit pauses regen for exactly 60 ticks', () => {
    const robot = makeRobot({ shieldHp: 30 });
    noteShieldDamage(robot);
    expect(robot.shieldRegenSuppressTicks).toBe(SHIELD_REGEN_SUPPRESSION_TICKS);
    const gains = runTicks(robot, LIGHT, 59);
    expect(gains.some((gained) => gained)).toBe(false);
    // Still one suppressed tick left — the 60th call releases the window.
    expect(robot.shieldRegenSuppressTicks).toBe(1);
  });

  it('[boundary] the countdown decrements on every suppressed tick and lands on 0', () => {
    const robot = makeRobot();
    noteShieldDamage(robot);
    for (let tick = 1; tick <= 59; tick++) {
      regenerateShieldForTick(robot, LIGHT);
      expect(robot.shieldRegenSuppressTicks).toBe(SHIELD_REGEN_SUPPRESSION_TICKS - tick);
    }
    regenerateShieldForTick(robot, LIGHT);
    expect(robot.shieldRegenSuppressTicks).toBe(0);
  });

  it('[state] the bank survives suppression: pause production, not storage', () => {
    const robot = makeRobot({ shieldRegenRemainder: 59000 });
    noteShieldDamage(robot);
    runTicks(robot, LIGHT, 60);
    expect(robot.shieldRegenRemainder).toBe(59000);
    expect(regenerateShieldForTick(robot, LIGHT)).toBe(true);
    expect(robot.shieldHp).toBe(31);
  });

  it('[state] a second hit inside the window restarts it rather than stacking', () => {
    const robot = makeRobot();
    noteShieldDamage(robot);
    runTicks(robot, LIGHT, 30);
    expect(robot.shieldRegenSuppressTicks).toBe(30);
    noteShieldDamage(robot);
    expect(robot.shieldRegenSuppressTicks).toBe(SHIELD_REGEN_SUPPRESSION_TICKS);
    runTicks(robot, LIGHT, 59);
    expect(robot.shieldRegenSuppressTicks).toBe(1);
  });

  it('[determinism] the same damage-and-regen sequence always walks the same path', () => {
    const run = (): string => {
      const robot = makeRobot({ id: 'suppressed', shieldHp: 30 });
      const states: string[] = [];
      for (let round = 0; round < 3; round++) {
        noteShieldDamage(robot);
        for (let tick = 0; tick < 80; tick++) {
          regenerateShieldForTick(robot, LIGHT);
          states.push(`${robot.shieldHp}:${robot.shieldRegenSuppressTicks}:${robot.shieldRegenRemainder}`);
        }
      }
      return JSON.stringify(states);
    };
    expect(run()).toBe(run());
  });
});
