// The match driver — Phase 5 task 8.1 (23-WEB-CLIENT-PLAN.md § 8.1), the
// phase that makes everything else possible. runMatch owns the tick loop
// and its EXPLICIT TOTAL ORDERING (G31: the order lives in one place —
// runTick below — and is asserted by the pipeline tests, not implied):
//
//     world (respawn, the D5 stream) → actuators (VM steps, intent
//     application) → physics (integration, arena clamps, construction) →
//     hitscan, damage and deaths (combat) → biomass (pickup, eat,
//     vitality) → events → win condition.
//
// Reconciliations with the spec, documented rather than silent:
// - 10-DETERMINISM.md § 2.1 advances matchRng "once per tick, before any
//   bot steps"; 23 § 8.1's one-line ordering ends with "biomass". These
//   are two halves of one story: the WORLD's biomass (respawn) runs
//   first as the D5 stream's consumer, so a cell that returns on tick T
//   can be walked over on tick T; the BOTS' biomass (contact pickup,
//   eat conversions, the vitality that consumes them) runs after combat,
//   where 23 § 8.1 puts it. A robot killed by a shot this tick neither
//   picks up nor eats — the mercy rule the Phase 4 integration test
//   already proved (combat first, vitality second).
// - Movement runs BEFORE hitscan (23 § 8.1's physics → hitscan), the one
//   place this loop deliberately differs from 20 Phase 12.3's older
//   prose: a robot is shot where this tick's move left it, not where the
//   tick found it. The Phase 4 combat wiring (cooldowns → resolveAttacks
//   → volley → noteShieldDamage) is unchanged.
// - Pickup is contact-based within the robot's collision radius, one
//   cell per robot per tick (nearest, lowest index on ties): the DSL has
//   no take actuator, D15 makes "depleted" and "picked up" one event,
//   and Mission 1's model is walking to the food.
// - Construction (04 § 3.2.1): a build request pays the child's mass in
//   carried biomass UP FRONT — the spec fixes cost (Σ part mass) and
//   rate (2 kg/s ⇒ cost × 30 ticks) but neither pausing nor refunds, so
//   the queue never needs them. The builder's death loses the queue;
//   caps (4 per design, 6 per side) count in-progress builds, so a
//   completed child is always legal to spawn.
// - The events stage hands typed records to a MatchSink seam; telemetry/
//   (23 § 8.2) owns the 17 wire kinds and the replay document, and
//   stamps kinds over these records next phase. The snapshot cadence
//   (tick 1, then every 30 — 11 § 4) is the loop's, because the loop is
//   where the tick boundary lives; the format is telemetry's. The result
//   also carries every tick's records: a match is at most 1500 ticks and
//   the caller stores them; the sink is the notification seam, not the
//   store.

import { DEFAULT_ARENA_CONFIG, buildArena, clampToArena, resolvePillarOverlap, type Arena } from '../arena';
import { BiomassField } from '../arena/biomass';
import { GrenadeVolley, resolveAttacks, tickWeaponCooldowns } from '../combat/weapons';
import { noteShieldDamage } from '../vitality/shields';
import { createMatchRng, type Rng } from '../math/rng';
import { toMm, type Fixed } from '../math/fixed';
import type { ActuatorIntent, VmYieldReason } from '../execution/vm';
import type { IrProgram } from '../program/compiler';
import { PARTS_BY_ID } from '../robot/parts';
import { CHASSIS_LIMITS, validateDesignList, type Design } from '../robot/design';
import { snapshotRobot, spawnRobot, type Robot, type RobotSnapshot } from '../robot/robot';
import { convertCarriedBiomass, drainEnergyForTick, regenerateShieldForTick } from '../vitality';
import { COAST_PLAN, integrateMovement, headingFromAim, planFromMove, planFromMoveAt, type ThrottlePlan } from './movement';
import { createVmDriver, type RobotDriver } from './driver';
import { evaluateTickOutcome, resolveAtTickCap, type MatchOutcome } from './winCondition';
import type { CombatDeathRecord } from '../combat/damage';

// 04 § 2: 1500 ticks = 25 s of simulated time; D9's worst-case budgets
// are computed from it. The simulate endpoint's 300 (D9) is the caller's
// tickLimit, not a second constant here.
export const DEFAULT_TICK_LIMIT = 1500;

// 11 § 4: a snapshot every 30 ticks, plus tick 1.
const SNAPSHOT_PERIOD_TICKS = 30;

// 04 § 3.2.1: a Constructor consumes 2 kg of biomass per second of build
// time, and a child costs the summed mass of its design's parts.
const BUILD_TICKS_PER_KG = 30;

const EAT_REASON = {
  player: 'player',
  starvation: 'starvation',
} as const;

type EatReason = (typeof EAT_REASON)[keyof typeof EAT_REASON];

// The typed record vocabulary of one tick (11-REPLAY-FORMAT.md § 4's
// event shapes, robot-attributed). Owned here as one discriminated
// union — telemetry/ maps these to the wire kinds in its own phase, and
// its completeness test fails if a record shape gains no mapping. move
// records carry the EFFECTIVE throttle axes (clamped for move, derived
// from distance for move-at): the value the engine actually acts on,
// which is also the value D10's change-only rule compares.
export type MatchRecord =
  | { readonly kind: 'move'; readonly robotId: string; readonly vx: number; readonly vy: number }
  | { readonly kind: 'aim'; readonly robotId: string; readonly angle: number }
  | { readonly kind: 'say'; readonly robotId: string; readonly channel: number; readonly payload: number }
  | { readonly kind: 'vm_yield'; readonly robotId: string; readonly cyclesUsed: number; readonly reason: VmYieldReason }
  | { readonly kind: 'fire'; readonly robotId: string; readonly weaponPartId: string; readonly success: boolean }
  | { readonly kind: 'shot'; readonly attackerId: string; readonly weaponPartId: string; readonly xMm: number; readonly yMm: number; readonly targetId: string; readonly damage: number; readonly toShield: number }
  | { readonly kind: 'damage'; readonly throwerId: string; readonly xMm: number; readonly yMm: number; readonly targetId: string; readonly amount: number; readonly toShield: number; readonly toHull: number; readonly killed: boolean }
  | { readonly kind: 'death'; readonly botId: string; readonly cause: string; readonly killerId: string | null; readonly bounty: number }
  | { readonly kind: 'eat'; readonly botId: string; readonly consumedBiomass: number; readonly gainedEnergy: number; readonly reason: EatReason }
  | { readonly kind: 'biomass_taken'; readonly robotId: string; readonly amount: number; readonly cellIndex: number }
  | { readonly kind: 'biomass_depleted'; readonly cellIndex: number; readonly xMm: number; readonly yMm: number }
  | { readonly kind: 'biomass_spawn'; readonly cellIndex: number; readonly xMm: number; readonly yMm: number }
  | { readonly kind: 'build_start'; readonly robotId: string; readonly designIndex: number; readonly costKg: number }
  | { readonly kind: 'build_done'; readonly robotId: string; readonly childId: string }
  | { readonly kind: 'birth'; readonly robotId: string; readonly parentRobotId: string; readonly designIndex: number };

// The seam telemetry/ implements in 23 § 8.2. The loop knows only that a
// tick's records are complete when recordTick is called; the sink decides
// bucketing, change-only de-duplication and serialisation. Stateless
// implementations are safe to share.
export interface MatchSink {
  recordTick(tick: number, records: readonly MatchRecord[]): void;
  snapshot(tick: number, robots: readonly RobotSnapshot[]): void;
}

// Accumulating sink for callers that want the stream as data. The match
// result already carries everything; this is for spy assertions and for
// a streaming consumer to model against.
export class CollectingSink implements MatchSink {
  readonly ticks: { tick: number; records: MatchRecord[] }[] = [];
  readonly snapshots: { tick: number; robots: RobotSnapshot[] }[] = [];

  recordTick(tick: number, records: readonly MatchRecord[]): void {
    this.ticks.push({ tick, records: [...records] });
  }

  snapshot(tick: number, robots: readonly RobotSnapshot[]): void {
    this.snapshots.push({ tick, robots: [...robots] });
  }
}

const SILENT_SINK: MatchSink = {
  recordTick: () => undefined,
  snapshot: () => undefined,
};

// One side's bot as the match consumes it: designs with their compiled
// programs. A design whose program has no every-tick simply does nothing.
export interface MatchDesignInput {
  readonly design: Design;
  readonly program: IrProgram;
  readonly robotCount: number;
}

export type MatchSideInput = readonly MatchDesignInput[];

export interface MatchConfig {
  readonly seed: bigint;
  readonly tickLimit?: number;
}

export interface TickRecords {
  readonly tick: number;
  readonly records: readonly MatchRecord[];
}

export interface MatchResult extends MatchOutcome {
  readonly durationTicks: number;
  readonly ticks: readonly TickRecords[];
  readonly snapshots: readonly { readonly tick: number; readonly robots: readonly RobotSnapshot[] }[];
  readonly finalRobots: readonly RobotSnapshot[];
  // Indices of the cells standing at the end — the biomass half of the
  // canonical final state telemetry/ will hash.
  readonly availableCellIndices: readonly number[];
}

interface PendingBuild {
  readonly builder: Robot;
  readonly designIndex: number;
  readonly costKg: number;
  remainingTicks: number;
}

// The mutable world one match runs over. robots is append-only: children
// materialise at the end, so array order is spawn order with births
// appended — the deterministic order every stage iterates in.
interface MatchState {
  readonly seed: bigint;
  readonly arena: Arena;
  readonly field: BiomassField;
  readonly robots: Robot[];
  readonly robotsById: Map<string, Robot>;
  readonly drivers: Map<string, RobotDriver>;
  readonly designs: readonly [MatchSideInput, MatchSideInput];
  readonly nextRobotIndex: Map<string, number>;
  pendingBuilds: PendingBuild[];
  readonly volley: GrenadeVolley;
  readonly sink: MatchSink;
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a positive integer, got ${value}`);
  }
}

function validateSide(side: MatchSideInput, label: string): void {
  const verdict = validateDesignList(side.map((entry) => entry.design));
  if (!verdict.ok) {
    const codes = verdict.issues.map((issue) => issue.code).join(', ');
    throw new TypeError(`${label} has an invalid design list: ${codes}`);
  }
  const names = new Set<string>();
  let total = 0;
  for (const entry of side) {
    // A design with zero starting robots is the constructor's blueprint:
    // 04 § 6's "1–4 robots per design" governs fielded robots, and the
    // build economy needs a design to build from (Mission 3). A side
    // must still field at least one robot in total.
    if (!Number.isInteger(entry.robotCount) || entry.robotCount < 0) {
      throw new RangeError(`${label} robotCount must be a non-negative integer, got ${entry.robotCount}`);
    }
    if (entry.robotCount > CHASSIS_LIMITS.robotsPerDesignMax) {
      throw new RangeError(`${label} robots per design must be at most ${CHASSIS_LIMITS.robotsPerDesignMax}, got ${entry.robotCount}`);
    }
    if (names.has(entry.design.name)) {
      throw new TypeError(`${label} has duplicate design name ${entry.design.name} — robot ids would collide`);
    }
    names.add(entry.design.name);
    total += entry.robotCount;
  }
  if (total === 0) {
    throw new RangeError(`${label} must field at least one robot`);
  }
  if (total > CHASSIS_LIMITS.robotsPerSideMax) {
    throw new RangeError(`${label} robots must be at most ${CHASSIS_LIMITS.robotsPerSideMax}, got ${total}`);
  }
}

function aliveCount(state: MatchState, sideIndex: number): number {
  let count = 0;
  for (const robot of state.robots) {
    if (robot.side === sideIndex && robot.alive) {
      count += 1;
    }
  }
  return count;
}

function pendingCount(state: MatchState, sideIndex: number, designIndex: number | null): number {
  let count = 0;
  for (const build of state.pendingBuilds) {
    if (build.builder.side === sideIndex && (designIndex === null || build.designIndex === designIndex)) {
      count += 1;
    }
  }
  return count;
}

function sideStanding(state: MatchState, sideIndex: number): { aliveRobots: number; totalCarriedBiomass: number } {
  let aliveRobots = 0;
  let totalCarriedBiomass = 0;
  for (const robot of state.robots) {
    if (robot.side === sideIndex && robot.alive) {
      aliveRobots += 1;
      totalCarriedBiomass += robot.biomassCarried;
    }
  }
  return { aliveRobots, totalCarriedBiomass };
}

function spawnInitialRobots(state: MatchState): void {
  let spawnSlot = 0;
  state.designs.forEach((side, sideIndex) => {
    side.forEach((entry, designIndex) => {
      state.nextRobotIndex.set(`${sideIndex}:${designIndex}`, 0);
      for (let robotIndex = 0; robotIndex < entry.robotCount; robotIndex++) {
        const position = state.arena.spawnPoints[state.arena.spawnOrder[spawnSlot]!]!;
        spawnSlot += 1;
        addRobot(state, sideIndex, designIndex, robotIndex, entry, position);
      }
    });
  });
}

function addRobot(state: MatchState, sideIndex: number, designIndex: number, robotIndex: number, entry: MatchDesignInput, position: { x: Fixed; y: Fixed }): Robot {
  const robot = spawnRobot({ seed: state.seed, side: sideIndex, designIndex, robotIndex, design: entry.design, spawnPosition: position });
  state.robots.push(robot);
  state.robotsById.set(robot.id, robot);
  state.drivers.set(robot.id, createVmDriver(entry.program, { arena: state.arena, field: state.field, robots: state.robots }));
  state.nextRobotIndex.set(`${sideIndex}:${designIndex}`, robotIndex + 1);
  return robot;
}

// A build request: constructor fitted, design known, constructor free,
// material on hand, and both spawn caps (counting in-progress builds)
// still open. A refused request is a no-op that cost its cycles — fire
// with no weapon, per 04 § 4.2; the replay has no build_fail kind.
function attemptBuildStart(state: MatchState, builder: Robot, designIndex: number, records: MatchRecord[]): void {
  if (builder.stats.buildRateMilliKgPerSecond <= 0) {
    return;
  }
  const entry = state.designs[builder.side]![designIndex];
  if (entry === undefined) {
    return;
  }
  if (state.pendingBuilds.some((build) => build.builder === builder)) {
    return;
  }
  if (aliveCount(state, builder.side) + pendingCount(state, builder.side, null) >= CHASSIS_LIMITS.robotsPerSideMax) {
    return;
  }
  if (aliveOfDesign(state, builder.side, designIndex) + pendingCount(state, builder.side, designIndex) >= CHASSIS_LIMITS.robotsPerDesignMax) {
    return;
  }
  const costKg = entry.design.chassis.parts.reduce<number>((total, partId) => total + PARTS_BY_ID[partId]!.massKg, 0);
  if (builder.biomassCarried < costKg) {
    return;
  }
  builder.biomassCarried -= costKg;
  state.pendingBuilds.push({
    builder,
    designIndex,
    costKg,
    remainingTicks: costKg * BUILD_TICKS_PER_KG,
  });
  records.push({ kind: 'build_start', robotId: builder.id, designIndex, costKg });
}

function aliveOfDesign(state: MatchState, sideIndex: number, designIndex: number): number {
  let count = 0;
  for (const robot of state.robots) {
    if (robot.side === sideIndex && robot.designIndex === designIndex && robot.alive) {
      count += 1;
    }
  }
  return count;
}

// Construction runs in the physics stage: the world's continuous
// processes tick before any resolution. A queue whose builder died is
// dropped — the biomass was paid up front and is gone with it.
function advanceBuilds(state: MatchState, records: MatchRecord[]): void {
  const surviving: PendingBuild[] = [];
  for (const build of state.pendingBuilds) {
    if (!build.builder.alive) {
      continue;
    }
    build.remainingTicks -= 1;
    if (build.remainingTicks > 0) {
      surviving.push(build);
      continue;
    }
    const key = `${build.builder.side}:${build.designIndex}`;
    const robotIndex = state.nextRobotIndex.get(key) ?? 0;
    const entry = state.designs[build.builder.side]![build.designIndex]!;
    const child = addRobot(state, build.builder.side, build.designIndex, robotIndex, entry, build.builder.position);
    records.push({ kind: 'build_done', robotId: build.builder.id, childId: child.id });
    records.push({ kind: 'birth', robotId: child.id, parentRobotId: build.builder.id, designIndex: build.designIndex });
  }
  state.pendingBuilds = surviving;
}

// The actuators stage: step each alive robot's brain in spawn order and
// apply what it asked for, in intent order. move/move-at set the throttle
// plan (applied by the physics stage); aim turns the chassis now; fire
// and eat are flags their resolution stages consume; build and say act
// immediately. The last move/move-at intent wins — a throttle is a set,
// not an accumulate.
function applyIntents(state: MatchState, robot: Robot, intents: readonly ActuatorIntent[], records: MatchRecord[]): { plan: ThrottlePlan; fire: boolean; eatBatches: number } {
  let plan: ThrottlePlan = COAST_PLAN;
  let fire = false;
  let eatBatches = 0;
  for (const intent of intents) {
    switch (intent.kind) {
      case 'move':
        plan = planFromMove(intent.vx, intent.vy);
        records.push({ kind: 'move', robotId: robot.id, vx: plan.x, vy: plan.y });
        break;
      case 'move-at':
        plan = planFromMoveAt(robot.position, intent.tx, intent.ty);
        records.push({ kind: 'move', robotId: robot.id, vx: plan.x, vy: plan.y });
        break;
      case 'aim':
        robot.heading = headingFromAim(intent.angle);
        records.push({ kind: 'aim', robotId: robot.id, angle: robot.heading });
        break;
      case 'fire':
        fire = true;
        break;
      case 'eat':
        eatBatches += 1;
        break;
      case 'build':
        attemptBuildStart(state, robot, intent.design, records);
        break;
      case 'say':
        records.push({ kind: 'say', robotId: robot.id, channel: intent.channel, payload: intent.value });
        break;
    }
  }
  return { plan, fire, eatBatches };
}

function deathRecord(death: CombatDeathRecord): MatchRecord {
  return { kind: 'death', botId: death.botId, cause: death.cause, killerId: death.killerId, bounty: death.bounty };
}

function suppressShieldRegen(state: MatchState, robotId: string): void {
  const robot = state.robotsById.get(robotId);
  if (robot !== undefined && robot.alive) {
    noteShieldDamage(robot);
  }
}

// The combat stage — hitscan, damage, deaths, in the Phase 4 wiring's
// proven order: cooldowns tick for every living robot, attackers fire in
// spawn order, the volley flies and detonates, and every shield damage
// sets the D7 suppression window. Deaths are immediate inside combat's
// pass; a robot killed by an earlier shot neither fires nor is hit by
// splash this tick.
function runCombatStage(state: MatchState, fireFlags: ReadonlySet<string>, records: MatchRecord[]): void {
  for (const robot of state.robots) {
    if (robot.alive) {
      tickWeaponCooldowns(robot);
    }
  }
  const attackers = state.robots.filter((robot) => robot.alive && fireFlags.has(robot.id));
  const resolution = resolveAttacks(state.robots, attackers, state.volley);
  for (const attempt of resolution.attempts) {
    records.push({ kind: 'fire', robotId: attempt.attackerId, weaponPartId: attempt.weaponPartId, success: attempt.success });
  }
  for (const shot of resolution.shots) {
    records.push({ kind: 'shot', attackerId: shot.attackerId, weaponPartId: shot.weaponPartId, xMm: shot.xMm, yMm: shot.yMm, targetId: shot.targetId, damage: shot.damage, toShield: shot.toShield });
    if (shot.toShield > 0) {
      suppressShieldRegen(state, shot.targetId);
    }
  }
  for (const death of resolution.deaths) {
    records.push(deathRecord(death));
  }
  const splash = state.volley.stepAll(state.robots);
  for (const detonation of splash.detonations) {
    for (const application of detonation.applications) {
      records.push({ kind: 'damage', throwerId: detonation.throwerId, xMm: detonation.xMm, yMm: detonation.yMm, targetId: application.targetId, amount: application.amount, toShield: application.toShield, toHull: application.toHull, killed: application.killed });
      if (application.toShield > 0) {
        suppressShieldRegen(state, application.targetId);
      }
    }
  }
  for (const death of splash.deaths) {
    records.push(deathRecord(death));
  }
}

// The biomass stage: the bots' half of the biomass story. Contact pickup
// first (world → carry), then player-issued eat batches (carry → energy),
// then vitality — shield regen, the milliwatt drain, the emergency
// conversion and starvation. All of it skips fresh corpses: combat ran
// first, and the dead do not metabolise.
function runBiomassStage(state: MatchState, tick: number, eatBatches: ReadonlyMap<string, number>, records: MatchRecord[]): void {
  for (const robot of state.robots) {
    if (!robot.alive || robot.biomassCarried >= robot.carryCapacity) {
      continue;
    }
    const cell = state.field.nearestAvailable(robot.position, state.arena.robotRadius);
    if (cell === null) {
      continue;
    }
    state.field.deplete(cell.index, tick);
    robot.biomassCarried += cell.kg;
    records.push({ kind: 'biomass_taken', robotId: robot.id, amount: cell.kg, cellIndex: cell.index });
    records.push({ kind: 'biomass_depleted', cellIndex: cell.index, xMm: toMm(cell.position.x), yMm: toMm(cell.position.y) });
  }
  for (const robot of state.robots) {
    const batches = eatBatches.get(robot.id) ?? 0;
    for (let batch = 0; batch < batches && robot.alive; batch++) {
      const conversion = convertCarriedBiomass(robot);
      if (conversion !== null) {
        records.push({ kind: 'eat', botId: conversion.botId, consumedBiomass: conversion.consumedBiomass, gainedEnergy: conversion.gainedEnergy, reason: EAT_REASON.player });
      }
    }
  }
  for (const robot of state.robots) {
    if (!robot.alive) {
      continue;
    }
    regenerateShieldForTick(robot, robot.stats.shieldRegenMilliHpPerSecond);
    const energy = drainEnergyForTick(robot, robot.stats.netPowerMilliwatts);
    if (energy.conversion !== null) {
      records.push({ kind: 'eat', botId: energy.conversion.botId, consumedBiomass: energy.conversion.consumedBiomass, gainedEnergy: energy.conversion.gainedEnergy, reason: EAT_REASON.starvation });
    }
    if (energy.starvationDeath !== null) {
      records.push({ kind: 'death', botId: energy.starvationDeath.botId, cause: energy.starvationDeath.cause, killerId: null, bounty: 0 });
    }
  }
}

// THE ORDER. One function, because G31: the total ordering of
// 23 § 8.1 lives here and nowhere else, and the pipeline tests assert
// it through observable outcomes. Stages in spillover detail live above;
// this is the skeleton.
function runTick(state: MatchState, tick: number, matchRng: Rng): MatchRecord[] {
  const records: MatchRecord[] = [];

  // world — the D5 stream consumes its once-per-tick draws before any
  // bot steps; a cell returning now can be walked over now.
  for (const cell of state.field.respawnDueCells(tick, matchRng)) {
    records.push({ kind: 'biomass_spawn', cellIndex: cell.index, xMm: toMm(cell.position.x), yMm: toMm(cell.position.y) });
  }

  // actuators — brains step in spawn order, intents apply in order.
  const plans = new Map<string, ThrottlePlan>();
  const fireFlags = new Set<string>();
  const eatBatches = new Map<string, number>();
  for (const robot of state.robots) {
    if (!robot.alive) {
      continue;
    }
    const driver = state.drivers.get(robot.id)!;
    const outcome = driver.drive(robot, tick);
    for (const event of outcome.yieldEvents) {
      records.push({ kind: 'vm_yield', robotId: robot.id, cyclesUsed: event.cyclesUsed, reason: event.reason });
    }
    const applied = applyIntents(state, robot, outcome.intents, records);
    plans.set(robot.id, applied.plan);
    if (applied.fire) {
      fireFlags.add(robot.id);
    }
    if (applied.eatBatches > 0) {
      eatBatches.set(robot.id, applied.eatBatches);
    }
  }

  // physics — velocity integrates, walls and pillars correct, and
  // construction advances. Movement lands before any shot is resolved.
  for (const robot of state.robots) {
    if (!robot.alive) {
      continue;
    }
    const moved = integrateMovement(robot.position, robot.velocity, plans.get(robot.id) ?? COAST_PLAN, robot.stats);
    robot.velocity = moved.velocity;
    robot.position = clampToArena(state.arena, moved.position);
    robot.position = resolvePillarOverlap(state.arena, robot.position);
  }
  advanceBuilds(state, records);

  // combat — hitscan, damage, deaths.
  runCombatStage(state, fireFlags, records);

  // biomass — pickup, eat, vitality.
  runBiomassStage(state, tick, eatBatches, records);

  return records;
}

function runTicks(state: MatchState, tickLimit: number): MatchResult {
  const matchRng = createMatchRng(state.seed);
  const allTicks: TickRecords[] = [];
  const allSnapshots: { tick: number; robots: RobotSnapshot[] }[] = [];
  let outcome: MatchOutcome | null = null;
  let durationTicks = tickLimit;
  for (let tick = 1; tick <= tickLimit; tick++) {
    const records = runTick(state, tick, matchRng);
    if (records.length > 0) {
      allTicks.push({ tick, records });
      state.sink.recordTick(tick, records);
    }
    if (tick === 1 || tick % SNAPSHOT_PERIOD_TICKS === 0) {
      const robots = state.robots.map(snapshotRobot);
      allSnapshots.push({ tick, robots });
      state.sink.snapshot(tick, robots);
    }
    outcome = evaluateTickOutcome(sideStanding(state, 0), sideStanding(state, 1));
    if (outcome !== null) {
      durationTicks = tick;
      break;
    }
  }
  const final = outcome ?? resolveAtTickCap(sideStanding(state, 0), sideStanding(state, 1));
  return {
    winner: final.winner,
    reason: final.reason,
    durationTicks,
    ticks: allTicks,
    snapshots: allSnapshots,
    finalRobots: state.robots.map(snapshotRobot),
    availableCellIndices: state.field.allCells().filter((cell) => cell.available).map((cell) => cell.index),
  };
}

export function runMatch(sides: readonly [MatchSideInput, MatchSideInput], config: MatchConfig, sink: MatchSink = SILENT_SINK): MatchResult {
  if (sides.length !== 2) {
    throw new TypeError(`exactly two sides field a match (04 § 6: 1 vs 1), got ${sides.length}`);
  }
  const tickLimit = config.tickLimit ?? DEFAULT_TICK_LIMIT;
  assertPositiveInteger(tickLimit, 'tickLimit');
  validateSide(sides[0], 'p1');
  validateSide(sides[1], 'p2');
  const arena = buildArena(DEFAULT_ARENA_CONFIG, config.seed);
  const state: MatchState = {
    seed: config.seed,
    arena,
    field: BiomassField.build(arena, config.seed),
    robots: [],
    robotsById: new Map(),
    drivers: new Map(),
    designs: [sides[0], sides[1]],
    nextRobotIndex: new Map(),
    pendingBuilds: [],
    volley: new GrenadeVolley(),
    sink,
  };
  spawnInitialRobots(state);
  return runTicks(state, tickLimit);
}

