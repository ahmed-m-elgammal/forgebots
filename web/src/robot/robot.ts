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
// Dynamic fields (position, velocity, heading, pools, alive) are plain
// mutable state: combat/, vitality/ and match/ mutate them through their
// own functions in their own phases. This module owns construction and
// the replay-facing scalar view, and nothing else.
//
// Wire units (D1): snapshots carry integer millimetres; the internal
// position is Q16.16. Conversions happen here, at the boundary, once.

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
  position: Vec2;
  velocity: Vec2;
  heading: Angle;
  hullHp: number;
  shieldHp: number;
  energy: number;
  biomassCarried: number;
  alive: boolean;
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
    position: args.spawnPosition,
    velocity: VEC2_ZERO,
    heading: ANGLE_ZERO,
    hullHp: stats.maxHullHp,
    shieldHp: stats.maxShieldHp,
    energy: stats.energyMax,
    biomassCarried: 0,
    alive: true,
    rng: createBotRng(args.seed, args.side, args.designIndex, args.robotIndex),
  };
}

// The scalar state the replay's snapshot event carries (11 § 4: id, x, y,
// hp, shield, energy, biomass). hp follows the DSL's own definition —
// hull plus shield (04 § 4.1) — with shield alongside so a viewer derives
// hull as hp − shield. Pure: the robot is not touched.
export function snapshotRobot(robot: Robot): RobotSnapshot {
  return {
    id: robotId(robot.side, robot.design.name, robot.robotIndex),
    side: robot.side,
    designIndex: robot.designIndex,
    robotIndex: robot.robotIndex,
    xMm: toMm(robot.position.x),
    yMm: toMm(robot.position.y),
    headingBrads: robot.heading,
    hp: robot.hullHp + robot.shieldHp,
    shield: robot.shieldHp,
    energy: robot.energy,
    biomass: robot.biomassCarried,
    alive: robot.alive,
  };
}
