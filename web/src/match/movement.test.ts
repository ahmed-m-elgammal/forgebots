import { describe, expect, it } from 'vitest';
import { fromMm, fromRaw } from '../math/fixed';
import { vec2 } from '../math/vec2';
import {
  COAST_PLAN,
  MOVE_AT_FULL_MM,
  THROTTLE_LIMIT,
  headingFromAim,
  integrateMovement,
  planFromMove,
  planFromMoveAt,
} from './index';

// Movement (20 Phase 08 T08.3's throttle conversion, hosted in match/
// until actuation/ is scheduled). The DoD line — no actuator can push a
// robot past its chassis top speed (D8) — is the [boundary] anchor:
// top speed is reached and then held exactly, never exceeded.
//
// Pinned numbers, mk1 engine (2500 mm/s = 163840 raw, base accel):
// the per-tick velocity bound is 163840 × 10000 / 60000‰ = 2730 raw,
// so a standing start holds 2730 × t until tick 61 lands exactly on top
// speed, and one tick of travel at top speed is 2730 raw = 41.67 mm.

const MK1 = { topSpeedMmPerSec: 2500, accelPermyriad: 10000, ignoresFriction: false };
const HOVER = { topSpeedMmPerSec: 2500, accelPermyriad: 13000, ignoresFriction: true };
const ORIGIN = vec2(fromRaw(0), fromRaw(0));

const runTicks = (plan: ReturnType<typeof planFromMove>, stats: typeof MK1, ticks: number, velocity = vec2(fromRaw(0), fromRaw(0))) => {
  let position = ORIGIN;
  let current = velocity;
  for (let tick = 0; tick < ticks; tick++) {
    const next = integrateMovement(position, current, plan, stats);
    position = next.position;
    current = next.velocity;
  }
  return { position, velocity: current };
};

describe('planFromMove — the move intent (D8)', () => {
  it('[normal] a full-throttle command passes through unclamped', () => {
    expect(planFromMove(THROTTLE_LIMIT, -THROTTLE_LIMIT)).toEqual({ commanded: true, x: 65536, y: -65536 });
  });

  it('[boundary] each axis clamps to exactly ±65536, never beyond', () => {
    expect(planFromMove(999999, -999999).x).toBe(THROTTLE_LIMIT);
    expect(planFromMove(999999, -999999).y).toBe(-THROTTLE_LIMIT);
    expect(planFromMove(65536, -65536).x).toBe(THROTTLE_LIMIT);
  });

  it('[state] the plan reports commanded so the physics stage moves the robot', () => {
    expect(planFromMove(0, 0).commanded).toBe(true);
  });
});

describe('planFromMoveAt — the move-at intent (D8 taper)', () => {
  it('[normal] a point 1 m east commands full throttle east', () => {
    const plan = planFromMoveAt(ORIGIN, 1000, 0);
    expect(plan).toEqual({ commanded: true, x: 65536, y: 0 });
  });

  it('[boundary] full throttle begins exactly at MOVE_AT_FULL_MM (inclusive)', () => {
    expect(planFromMoveAt(ORIGIN, MOVE_AT_FULL_MM, 0).x).toBe(THROTTLE_LIMIT);
    expect(planFromMoveAt(ORIGIN, MOVE_AT_FULL_MM - 1, 0).x).toBe(Math.floor(((MOVE_AT_FULL_MM - 1) * THROTTLE_LIMIT) / MOVE_AT_FULL_MM));
  });

  it('[boundary] the taper reaches 0 exactly at the point, and the zero-distance guard coasts (no NaN)', () => {
    expect(planFromMoveAt(ORIGIN, 0, 0)).toEqual(COAST_PLAN);
    const far = planFromMoveAt(ORIGIN, 100000, 0);
    const almostThere = planFromMoveAt(vec2(fromMm(99999), fromRaw(0)), 100000, 0);
    expect(almostThere.x).toBeGreaterThan(0);
    void far;
  });

  it('[normal] the direction follows the target: west is negative, 45 degrees splits the axes', () => {
    expect(planFromMoveAt(vec2(fromMm(50000), fromRaw(0)), 49000, 0).x).toBeLessThan(0);
    const diagonal = planFromMoveAt(ORIGIN, 1000, 1000);
    expect(diagonal.x).toBe(46341);
    expect(diagonal.y).toBe(46341);
  });

  it('[state] a commanded move-at never asks for more than the top speed allows', () => {
    for (const mm of [0, 500, 999, 1000, 5000, 200000]) {
      const plan = planFromMoveAt(ORIGIN, mm, 0);
      expect(plan.x).toBeLessThanOrEqual(THROTTLE_LIMIT);
    }
  });
});

describe('integrateMovement — the acceleration model (the physics-phase decisions)', () => {
  it('[normal] a standing start accelerates by exactly the per-tick bound', () => {
    const first = integrateMovement(ORIGIN, vec2(fromRaw(0), fromRaw(0)), planFromMove(65536, 0), MK1);
    expect(first.velocity.x).toBe(2730);
    expect(first.position.x).toBe(45);
  });

  it('[boundary] top speed is reached and then held exactly — never exceeded (the DoD)', () => {
    const { velocity } = runTicks(planFromMove(65536, 0), MK1, 200);
    expect(velocity.x).toBe(163840);
    const { velocity: atSixty } = runTicks(planFromMove(65536, 0), MK1, 60);
    expect(atSixty.x).toBe(2730 * 60);
    const { velocity: atSixtyOne } = runTicks(planFromMove(65536, 0), MK1, 61);
    expect(atSixtyOne.x).toBe(163840);
  });

  it('[boundary] one tick of travel at top speed is exactly the per-tick raw step (dt = 1/60 s)', () => {
    const { position } = runTicks(planFromMove(65536, 0), MK1, 61);
    const before = position.x;
    const last = integrateMovement(position, vec2(fromRaw(163840), fromRaw(0)), planFromMove(65536, 0), MK1);
    expect(last.position.x - before).toBe(2730);
  });

  it('[normal] coasting decays velocity by the same bound until it stops exactly at 0', () => {
    const { velocity } = runTicks(COAST_PLAN, MK1, 61, vec2(fromRaw(163840), fromRaw(0)));
    expect(velocity.x).toBe(0);
  });

  it('[state] a hover unit keeps its momentum when idle — ignoresFriction is the coast perk', () => {
    const { velocity } = runTicks(COAST_PLAN, HOVER, 30, vec2(fromRaw(163840), fromRaw(0)));
    expect(velocity.x).toBe(163840);
  });

  it('[normal] the hover unit accelerates 30 % faster per tick', () => {
    const first = integrateMovement(ORIGIN, vec2(fromRaw(0), fromRaw(0)), planFromMove(65536, 0), HOVER);
    expect(first.velocity.x).toBe(3549);
  });

  it('[state] a chassis with no engine cannot be pushed into motion by any intent', () => {
    const stationary = { topSpeedMmPerSec: 0, accelPermyriad: 10000, ignoresFriction: false };
    const { position } = runTicks(planFromMove(65536, 65536), stationary, 100);
    expect(position.x).toBe(0);
    expect(position.y).toBe(0);
  });

  it('[state] integrateMovement is pure — the caller writes the results back', () => {
    const position = vec2(fromMm(1000), fromMm(2000));
    const velocity = vec2(fromRaw(2730), fromRaw(0));
    integrateMovement(position, velocity, planFromMove(65536, 0), MK1);
    expect(position.x).toBe(fromMm(1000));
    expect(velocity.x).toBe(2730);
  });

  it('[repeat] every tick under full throttle steps by the same bound — no drift over 1500 ticks', () => {
    const { velocity, position } = runTicks(planFromMove(65536, 0), MK1, 1500);
    expect(velocity.x).toBe(163840);
    // 1500 ticks of a 2.5 m/s chassis: pinned distance including the
    // acceleration ramp's per-tick floors.
    expect(position.x).toBe(4014450);
  });

  it('[determinism] the same start, plan and stats trace the same path twice', () => {
    const run = (): string => {
      const { position, velocity } = runTicks(planFromMove(12345, -65536), MK1, 90);
      return JSON.stringify([position.x, position.y, velocity.x, velocity.y]);
    };
    expect(run()).toBe(run());
  });
});

describe('headingFromAim — the aim intent (D8 angle unit)', () => {
  it('[normal] an absolute angle normalises into (−π, π]', () => {
    expect(headingFromAim(16384)).toBe(16384);
    expect(headingFromAim(65536)).toBe(0);
    expect(headingFromAim(98304)).toBe(32768);
  });

  it('[boundary] the wrap edges: π stays π, one step past −π wraps to +π−ε', () => {
    expect(headingFromAim(32768)).toBe(32768);
    expect(headingFromAim(-32769)).toBe(32767);
    expect(headingFromAim(-32768)).toBe(32768);
  });

  it('[determinism] repeated wraps of the same angle agree', () => {
    expect(headingFromAim(123456)).toBe(headingFromAim(123456));
  });
});
