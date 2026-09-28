// Robot state (06-ARCHITECTURE.md § 2: robot.ts holds the Robot state,
// spawnBot and snapshot). 23-WEB-CLIENT-PLAN.md § 7.2 scopes this phase
// to "state, Design, Chassis, parts catalog, aggregate" — the per-tick
// step (20 Phase 09's tickBot) needs perception/ and execution/ and
// lands with the match phase; nothing here advances a robot.
//
// Naming: "robot" is the spawned instance, never "bot" (a bot is a saved
// loadout, AGENTS.md N3 / D12). 20 Phase 09 says spawnBot and a Bot type;
// that spelling loses the vocabulary the rest of the spec is built on,
// so the factory is spawnRobot over a Robot (AGENTS.md: spec follows
// this file where they disagree on naming).
//
// Dynamic fields (position, velocity, heading, pools, cooldowns, alive) are
// plain mutable state: combat/, vitality/ and match/ mutate them through
// their own functions in their own phases. This module owns construction
// and the replay-facing scalar view, and nothing else.
//
// Internal scales are finer than their wire surfaces and the names say so
// (G26): the energy pool lives in energy MILLI-units (energyMilli, D6's
// milliwatt accumulator needs the headroom) and shield regen banks
// fractional HP. Both convert to the integer DSL/replay units at
// snapshotRobot, here at the boundary, once (G33).
//
// Wire units (D1): snapshots carry integer millimetres; the internal
// position is Q16.16. Conversions happen here, at the boundary, once.
//
// Context note: robot/ may import only math/ and itself (06 § 5.2), so the
// runtime fields below are declared here as STATE while combat/ and
// vitality/ own the POLICY that drives them (cooldown decrementing, drain,
// regen). The field name is the cross-context contract; match/ wires the
// two halves together in Phase 5.

import { ANGLE_ZERO, type Angle } from '../math/angle';
import { toMm } from '../math/fixed';
import { createBotRng, type Rng } from '../math/rng';
import { VEC2_ZERO, type Vec2 } from '../math/vec2';
import { aggregate, validateChassis } from './parts';
import type { ChassisStats, Design } from './design';

export interface Robot {
  readonly side: number;
  readonly designIndex: number;
  readonly robotIndex: number;
  readonly design: Design;
  readonly stats: ChassisStats;
  // Stable replay id (11 § 3: p1.<design>.<index>), built once at spawn so
  // combat records and snapshots never re-derive it.
  readonly id: string;
  position: Vec2;
  velocity: Vec2;
  heading: Angle;
  hullHp: number;
  shieldHp: number;
  // Energy pool in milli-units, clamped by vitality/ to [0, energyMaxMilli].
  energyMilli: number;
  // Spawn-derived caps the vitality context clamps against. The robot is
  // the runtime entity; stats keeps the design-level originals.
  readonly energyMaxMilli: number;
  readonly maxShieldHp: number;
  // Milliwatt-ticks carried between ticks by vitality/'s accumulator, so a
  // 5 W draw costs 83 milli-units/tick and never floor(5/60) = 0 (D6).
  energyRemainder: number;
  // Fractional shield regen, banked until it crosses one full HP (D7's
  // 0.5 HP/s must not floor to 0), plus the ticks left of the 1 s
  // no-damage suppression combat damage triggers.
  shieldRegenRemainder: number;
  shieldRegenSuppressTicks: number;
  // One countdown per fitted weapon, parallel to stats.weapons; 0 = ready
  // to fire. combat/ owns the decrement and the consume-on-fire rule.
  weaponCooldowns: number[];
  biomassCarried: number;
  alive: boolean;
  // The two seam fields combat/'s structural views read at the top level
  // (Combatant.weapons, Damageable.carryCapacity). They mirror stats so a
  // robot is ONE object across contexts — a copied adapter would fork the
  // mutable pools, so the fields live here at spawn (the header's contract:
  // robot/ owns state, combat/ and vitality/ own policy).
  readonly weapons: ChassisStats['weapons'];
  readonly carryCapacity: number;
  // This robot's own rng-int stream (D5): seeded from the match seed and
  // this robot's identity, advanced by nothing but its own rng-int reads.
  readonly rng: Rng;
}

export interface RobotSnapshot {
  readonly id: string;
  readonly side: number;
  readonly designIndex: number;
  readonly robotIndex: number;
  readonly xMm: number;
  readonly yMm: number;
  readonly headingBrads: number;
  readonly hp: number;
  readonly shield: number;
  readonly energy: number;
  readonly biomass: number;
  readonly alive: boolean;
}

export interface SpawnRobotArgs {
  readonly seed: bigint;
  readonly side: number;
  readonly designIndex: number;
  readonly robotIndex: number;
  readonly design: Design;
  readonly spawnPosition: Vec2;
}

const INDEX_LIMIT = 0xffffffff;
// Spawn pool scale: the energy surface (04 § 4.1 self.energy) is integer
// units; the internal pool is milli-units (D6). vitality/ pins the same
// scale — one definition per context is the price of the import rule.
const MILLI_PER_ENERGY = 1000;

function assertIdentityPart(value: number, label: string): void {
  if (!Number.isInteger(value)) {
    throw new TypeError(`robot ${label} must be an integer, got ${value}`);
  }
  if (value < 0 || value > INDEX_LIMIT) {
    throw new RangeError(`robot ${label} must be a uint32, got ${value}`);
  }
}

// Stable robot id for the life of a match (11-REPLAY-FORMAT.md § 3:
// p1.<design>.<index>; sides are one-based on the wire).
export function robotId(side: number, designName: string, robotIndex: number): string {
  return `p${side + 1}.${designName}.${robotIndex}`;
}

// Aggregates the design's chassis and builds the spawn state of 20 Phase
// 09: full hull, full shield, energy at energyMax, empty carry. The
// chassis is validated here because spawn is the boundary between data
// and simulation (G33) — an invalid design never becomes a robot.
export function spawnRobot(args: SpawnRobotArgs): Robot {
  assertIdentityPart(args.side, 'side');
  assertIdentityPart(args.designIndex, 'designIndex');
  assertIdentityPart(args.robotIndex, 'robotIndex');
  if (args.design.name.length === 0) {
    throw new TypeError('robot design name must not be empty');
  }
  const verdict = validateChassis(args.design.chassis);
  if (!verdict.ok) {
    const codes = verdict.issues.map((issue) => issue.code).join(', ');
    throw new TypeError(`design ${args.design.name} has an invalid chassis: ${codes}`);
  }
  const stats = aggregate(args.design.chassis);
  return {
    side: args.side,
    designIndex: args.designIndex,
    robotIndex: args.robotIndex,
    design: args.design,
    stats,
    id: robotId(args.side, args.design.name, args.robotIndex),
    position: args.spawnPosition,
    velocity: VEC2_ZERO,
    heading: ANGLE_ZERO,
    hullHp: stats.maxHullHp,
    shieldHp: stats.maxShieldHp,
    energyMilli: stats.energyMax * MILLI_PER_ENERGY,
    energyMaxMilli: stats.energyMax * MILLI_PER_ENERGY,
    maxShieldHp: stats.maxShieldHp,
    energyRemainder: 0,
    shieldRegenRemainder: 0,
    shieldRegenSuppressTicks: 0,
    weaponCooldowns: stats.weapons.map(() => 0),
    biomassCarried: 0,
    alive: true,
    weapons: stats.weapons,
    carryCapacity: stats.carryCapacity,
    rng: createBotRng(args.seed, args.side, args.designIndex, args.robotIndex),
  };
}

// The scalar state the replay's snapshot event carries (11 § 4: id, x, y,
// hp, shield, energy, biomass). hp follows the DSL's own definition —
// hull plus shield (04 § 4.1) — with shield alongside so a viewer derives
// hull as hp − shield. Energy floors back to wire units here: the milli
// pool is the ground truth, the wire shows whole units. Pure: the robot is
// not touched.
export function snapshotRobot(robot: Robot): RobotSnapshot {
  return {
    id: robot.id,
    side: robot.side,
    designIndex: robot.designIndex,
    robotIndex: robot.robotIndex,
    xMm: toMm(robot.position.x),
    yMm: toMm(robot.position.y),
    headingBrads: robot.heading,
    hp: robot.hullHp + robot.shieldHp,
    shield: robot.shieldHp,
    energy: (robot.energyMilli / MILLI_PER_ENERGY) | 0,
    biomass: robot.biomassCarried,
    alive: robot.alive,
  };
}
