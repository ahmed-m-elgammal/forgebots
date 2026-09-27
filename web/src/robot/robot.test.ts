import { describe, expect, it } from 'vitest';
import {
  CHASSIS_ERROR_CODES,
  PART_ID,
  robotId,
  snapshotRobot,
  spawnRobot,
} from './index';
import { FIXED_MAX, fromMm, fromRaw } from '../math/fixed';
import type { Design } from './design';

// Robot state per 23 § 7.2: construction (spawnRobot) and the replay's
// scalar view (snapshotRobot). 20 Phase 09's spawn-state rules are
// pinned here: full hull, full shield, energy at energyMax, empty carry,
// alive, and one rng-int stream per robot identity (D5).

const SCOUT: Design = {
  name: 'scout',
  chassis: { parts: [PART_ID.mk1Engine, PART_ID.shortRadar, PART_ID.blaster, PART_ID.solarPanel] },
};

const spawn = (overrides?: Partial<Parameters<typeof spawnRobot>[0]>) =>
  spawnRobot({
    seed: 42n,
    side: 0,
    designIndex: 0,
    robotIndex: 0,
    design: SCOUT,
    spawnPosition: { x: fromMm(50000), y: fromMm(60000) },
    ...overrides,
  });

describe('spawnRobot (20 Phase 09 spawn state)', () => {
  it('[normal] aggregates the chassis into the robot stats', () => {
    const robot = spawn();
    expect(robot.stats.massKg).toBe(11);
    expect(robot.stats.topSpeedMmPerSec).toBe(2500);
    expect(robot.stats.weapons).toHaveLength(1);
  });

  it('[state] spawns at full hull, full shield, full energy, empty carry, alive', () => {
    const robot = spawn();
    expect(robot.hullHp).toBe(robot.stats.maxHullHp);
    expect(robot.shieldHp).toBe(robot.stats.maxShieldHp);
    expect(robot.energyMilli).toBe(500000);
    expect(robot.biomassCarried).toBe(0);
    expect(robot.alive).toBe(true);
    expect(robot.velocity).toEqual({ x: 0, y: 0 });
    expect(robot.heading).toBe(0);
  });

  it('[state] combat and vitality runtime state starts neutral (tasks 3-4 contract)', () => {
    const robot = spawn();
    expect(robot.id).toBe('p1.scout.0');
    expect(robot.weaponCooldowns).toEqual([0]);
    expect(robot.energyRemainder).toBe(0);
    expect(robot.shieldRegenRemainder).toBe(0);
    expect(robot.shieldRegenSuppressTicks).toBe(0);
  });

  it('[state] one cooldown slot per fitted weapon, in design order', () => {
    const gunner: Design = {
      name: 'gunner',
      chassis: { parts: [PART_ID.blaster, PART_ID.grenade, PART_ID.heavyBlaster] },
    };
    const robot = spawn({ design: gunner });
    expect(robot.weaponCooldowns).toEqual([0, 0, 0]);
    expect(robot.stats.weapons.map((weapon) => weapon.partId)).toEqual([
      PART_ID.blaster,
      PART_ID.grenade,
      PART_ID.heavyBlaster,
    ]);
  });

  it('[state] carries the identity that the replay and match loop use', () => {
    const robot = spawn({ side: 1, designIndex: 2, robotIndex: 3 });
    expect(robot.side).toBe(1);
    expect(robot.designIndex).toBe(2);
    expect(robot.robotIndex).toBe(3);
    expect(robot.design.name).toBe('scout');
    expect(robot.position).toEqual({ x: fromMm(50000), y: fromMm(60000) });
  });

  it('[determinism] the same identity derives the same rng-int stream', () => {
    const first = spawn({ robotIndex: 0 });
    const second = spawn({ robotIndex: 0 });
    const draws = (robot: ReturnType<typeof spawn>): number[] => [robot.rng.nextUint32(), robot.rng.nextInt(1000)];
    expect(draws(second)).toEqual(draws(first));
  });

  it('[state] two robots of one design with different indices get different streams (D5)', () => {
    const first = spawn({ robotIndex: 0 });
    const second = spawn({ robotIndex: 1 });
    expect(first.rng.nextUint32()).not.toBe(second.rng.nextUint32());
  });

  it('[invalid] a chassis that fails validateChassis never becomes a robot', () => {
    const broken: Design = { name: 'too-heavy', chassis: { parts: [PART_ID.constructor, PART_ID.constructor] } };
    expect(() =>
      spawnRobot({ seed: 42n, side: 0, designIndex: 0, robotIndex: 0, design: broken, spawnPosition: { x: fromRaw(0), y: fromRaw(0) } }),
    ).toThrow(new RegExp(CHASSIS_ERROR_CODES.stack));
  });

  it('[invalid] identity parts must be non-negative integers', () => {
    expect(() => spawn({ robotIndex: 1.5 })).toThrow(TypeError);
    expect(() => spawn({ robotIndex: -1 })).toThrow(RangeError);
    expect(() => spawn({ side: 2 })).toThrow(RangeError);
  });

  it('[invalid] an empty design name is rejected at the boundary', () => {
    expect(() => spawn({ design: { ...SCOUT, name: '' } })).toThrow(TypeError);
  });

  it('[invalid] the seed is validated by the stream owner (D5 uint64)', () => {
    expect(() => spawn({ seed: -1n })).toThrow(RangeError);
  });
});

describe('snapshotRobot (11 § 4 scalar state)', () => {
  it('[normal] carries the snapshot scalars in wire units', () => {
    const robot = spawn();
    const snapshot = snapshotRobot(robot);
    expect(snapshot).toEqual({
      id: 'p1.scout.0',
      side: 0,
      designIndex: 0,
      robotIndex: 0,
      xMm: 50000,
      yMm: 60000,
      headingBrads: 0,
      hp: robot.hullHp + robot.shieldHp,
      shield: robot.stats.maxShieldHp,
      energy: 500,
      biomass: 0,
      alive: true,
    });
  });

  it('[normal] robot ids follow the replay format p1.<design>.<index>', () => {
    expect(robotId(0, 'scout', 0)).toBe('p1.scout.0');
    expect(robotId(1, 'tank', 3)).toBe('p2.tank.3');
  });

  it('[boundary] a robot at the Q16.16 extreme snapshots to the mm bound', () => {
    const robot = spawn({ spawnPosition: { x: FIXED_MAX, y: fromRaw(0) } });
    // toMm rounds half away from zero, so the raw maximum lands one
    // millimetre above fromMm's 32767999 input bound — the conversion
    // asymmetry of D1's symmetric raw range.
    expect(snapshotRobot(robot).xMm).toBe(32768000);
    expect(snapshotRobot(robot).yMm).toBe(0);
  });

  it('[state] reflects damage state without mutating it', () => {
    const robot = spawn();
    robot.hullHp = 3;
    robot.shieldHp = 0;
    robot.biomassCarried = 7;
    robot.alive = false;
    const snapshot = snapshotRobot(robot);
    expect(snapshot.hp).toBe(3);
    expect(snapshot.shield).toBe(0);
    expect(snapshot.biomass).toBe(7);
    expect(snapshot.alive).toBe(false);
    expect(robot.biomassCarried).toBe(7);
  });

  it('[boundary] energy floors to wire units: a partial milli remainder stays hidden', () => {
    const robot = spawn();
    robot.energyMilli = 499917;
    expect(snapshotRobot(robot).energy).toBe(499);
    robot.energyMilli = 0;
    expect(snapshotRobot(robot).energy).toBe(0);
  });

  it('[repeat] repeated snapshots are byte-identical', () => {
    const robot = spawn();
    expect(JSON.stringify(snapshotRobot(robot))).toBe(JSON.stringify(snapshotRobot(robot)));
  });
});
