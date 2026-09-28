// Movement — the physics half of the match pipeline's actuator
// application (23 § 8.1's "actuators → physics" pair; 20 Phase 08
// T08.3's throttle conversion, which lands here until actuation/ is
// scheduled as its own context).
//
// The model, decided here because the spec defers it to "the physics
// phase" (robot/parts.ts stores the hover ratio "relative to a base the
// physics phase defines") and because the catalog's mobility perks must
// be observable (G2 — a part whose effects do nothing is a spec
// violation):
//
// - A move/move-at intent sets a TARGET velocity per world axis:
//   (throttle / 65536) × top speed, clamped to ±top speed — no actuator
//   can exceed the chassis top speed (D8, 04 § 4.2), the invariant the
//   hardware budget exists for.
// - Velocity approaches its target by at most one tick's acceleration
//   bound: topSpeed × accelPermyriad / 10000 / 60. At the base ratio a
//   chassis reaches top speed in exactly one second; the hover unit's
//   +30 % spools in about 46 ticks.
// - A tick with no throttle command is a coasting tick: the target is
//   zero and velocity decays under the same bound. That decay IS
//   friction, so the hover unit's ignoresFriction perk is the right to
//   keep its momentum when idle — a strafing run keeps its speed.
//
// Position advances by velocity/60 per tick (dt = 1/60 s, 10 § 2.1);
// the division truncates toward zero, losing under one raw unit —
// deterministic on every platform. All integer otherwise: products on
// BigInt through saturate, no float anywhere (10-DETERMINISM.md § 2.2).

import { wrapToPi, type Angle } from '../math/angle';
import { RAW_PER_UNIT, fromMm, isqrt, saturate, toMm, type Fixed } from '../math/fixed';
import { add as vecAdd, vec2, type Vec2 } from '../math/vec2';

// D8: move throttle is Q16.16, 65536 = 100 % of top speed, clamped to
// ±65536 per axis.
export const THROTTLE_LIMIT = RAW_PER_UNIT;

// D8: move-at is full throttle at ≥ 1 000 mm and tapers to 0 at the point.
export const MOVE_AT_FULL_MM = 1000;

const PERMYRIAD_BASE = 10000n;
const TICKS_PER_SECOND = 60n;

interface MovementStats {
  readonly topSpeedMmPerSec: number;
  readonly accelPermyriad: number;
  readonly ignoresFriction: boolean;
}

// The throttle axes a robot commanded this tick, in raw Q16.16 units
// (65536 = full). `commanded` is false on a coasting tick — no move or
// move-at intent reached the physics stage.
export interface ThrottlePlan {
  readonly commanded: boolean;
  readonly x: Fixed;
  readonly y: Fixed;
}

export const COAST_PLAN: ThrottlePlan = { commanded: false, x: 0 as Fixed, y: 0 as Fixed };

function clampThrottleAxis(value: number): number {
  if (value > THROTTLE_LIMIT) {
    return THROTTLE_LIMIT;
  }
  if (value < -THROTTLE_LIMIT) {
    return -THROTTLE_LIMIT;
  }
  return value;
}

// move(vx, vy): world-axis throttle, each axis clamped to ±65536 (D8).
// The clamp is the whole validation — a bot cannot even ask for more
// than its engine can deliver, and the verifier guarantees integers.
export function planFromMove(vx: number, vy: number): ThrottlePlan {
  return { commanded: true, x: clampThrottleAxis(vx) as Fixed, y: clampThrottleAxis(vy) as Fixed };
}

// move-at(tx, ty): full throttle toward a point ≥ 1 000 mm away,
// tapering linearly to 0 at the point, coordinates in millimetres (D8).
// The zero-distance guard is 20 T08.3's: throttle 0, never NaN — an
// integer world has no NaN to fall back on, so the plan is a coast.
export function planFromMoveAt(self: Vec2, txMm: number, tyMm: number): ThrottlePlan {
  const dx = BigInt(fromMm(txMm)) - BigInt(self.x);
  const dy = BigInt(fromMm(tyMm)) - BigInt(self.y);
  if (dx === 0n && dy === 0n) {
    return COAST_PLAN;
  }
  const lengthRaw = BigInt(isqrt(dx * dx + dy * dy));
  const distanceMm = toMm(saturate(lengthRaw));
  // Integer taper: distanceMm × 65536 overflows int32 near the arena
  // diagonal, so the division runs on BigInt and lands back in a number.
  const magnitude =
    distanceMm >= MOVE_AT_FULL_MM
      ? THROTTLE_LIMIT
      : Number((BigInt(distanceMm) * BigInt(THROTTLE_LIMIT)) / BigInt(MOVE_AT_FULL_MM));
  const unitX = saturate((dx * BigInt(RAW_PER_UNIT)) / lengthRaw);
  const unitY = saturate((dy * BigInt(RAW_PER_UNIT)) / lengthRaw);
  return {
    commanded: true,
    x: saturate((BigInt(magnitude) * BigInt(unitX)) / BigInt(RAW_PER_UNIT)),
    y: saturate((BigInt(magnitude) * BigInt(unitY)) / BigInt(RAW_PER_UNIT)),
  };
}

// The target velocity of one axis in raw units: throttle fraction of the
// top speed. A chassis with no mobility part has top speed 0 — a
// stationary turret cannot be pushed into motion by any intent.
function targetVelocity(throttle: Fixed, topSpeedRaw: bigint): Fixed {
  return saturate((BigInt(clampThrottleAxis(throttle)) * topSpeedRaw) / BigInt(RAW_PER_UNIT));
}

function stepToward(current: Fixed, target: Fixed, bound: bigint): Fixed {
  const delta = BigInt(target) - BigInt(current);
  if (delta > bound) {
    return saturate(BigInt(current) + bound);
  }
  if (delta < -bound) {
    return saturate(BigInt(current) - bound);
  }
  return target;
}

// One tick of integration: velocity steps toward the plan's target under
// the acceleration bound, then position advances by velocity/60. aim is
// not movement — heading is set directly by the actuators stage; the
// plan knows nothing about it. Pure with respect to its inputs: the
// caller writes the returned vectors back.
export function integrateMovement(
  position: Vec2,
  velocity: Vec2,
  plan: ThrottlePlan,
  stats: MovementStats,
): { position: Vec2; velocity: Vec2 } {
  const topSpeedRaw = BigInt(fromMm(stats.topSpeedMmPerSec));
  const accelBound = (topSpeedRaw * BigInt(stats.accelPermyriad)) / (PERMYRIAD_BASE * TICKS_PER_SECOND);
  const coasting = !plan.commanded;
  const targetX = coasting && stats.ignoresFriction ? velocity.x : targetVelocity(coasting ? 0 as Fixed : plan.x, topSpeedRaw);
  const targetY = coasting && stats.ignoresFriction ? velocity.y : targetVelocity(coasting ? 0 as Fixed : plan.y, topSpeedRaw);
  const nextVelocity = vec2(stepToward(velocity.x, targetX, accelBound), stepToward(velocity.y, targetY, accelBound));
  const positionStep = vec2(
    saturate(BigInt(nextVelocity.x) / TICKS_PER_SECOND),
    saturate(BigInt(nextVelocity.y) / TICKS_PER_SECOND),
  );
  return { position: vecAdd(position, positionStep), velocity: nextVelocity };
}

// aim(angle): the absolute chassis heading, normalised into (−π, π]
// (the wrapToPi contract; angles are the 16-bit circular unit, D8).
export function headingFromAim(angle: number): Angle {
  return wrapToPi(angle);
}
