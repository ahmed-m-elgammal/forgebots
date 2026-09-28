import { describe, expect, it } from 'vitest';
import { DEFAULT_ARENA_CONFIG, buildArena } from '../arena';
import { BiomassField, regionOf } from '../arena/biomass';
import { fromMm, toMm } from '../math/fixed';
import { angleOf, vec2 } from '../math/vec2';
import { compile } from '../program';
import { PART_ID } from '../robot';
import type { Design } from '../robot/design';
import { runMatch, type MatchRecord } from './index';

// The G31 assertion suite: the total ordering of 23 § 8.1 — world →
// actuators → physics → combat → biomass — is asserted through public
// behaviour, not implied. Four witnesses:
//
// 1. The per-tick record stream itself: records are appended in
//    execution order, so every tick's records must read as stage blocks
//    in pipeline order (the stage validator below runs over whole
//    matches).
// 2. The world's respawn lands on schedule (deplete + 300) and its
//    biomass_spawn record is the FIRST record of that tick — the D5
//    stream ran before any bot stepped.
// 3. A killing shot's recorded position reflects THIS tick's movement
//    (physics before hitscan): it sits one tick's travel past the last
//    snapshot's position, never equal to it.
// 4. A robot that starves on tick T still acted on tick T — VM,
//    actuators and combat all ran before vitality (asserted in
//    match.test.ts; the stage validator re-asserts the biomass stage's
//    position).

const designOf = (name: string, parts: readonly string[]): Design => ({ name, chassis: { parts: parts as Design['chassis']['parts'] } });
const BLASTER_BOT = designOf('blasterbot', [PART_ID.mk1Engine, PART_ID.blaster]);
const SOLAR_FORAGER = designOf('forager', [PART_ID.mk1Engine, PART_ID.solarPanel]);

const compileOk = (src: string) => {
  const result = compile(src);
  if (!result.ok) {
    throw new Error(`fixture failed: ${JSON.stringify(result.errors)}`);
  }
  return result.ir;
};

const IDLE_PROGRAM = compileOk('(defn unused [] 0)');

const spawnPointsFor = (seed: bigint): [{ x: number; y: number }, { x: number; y: number }] => {
  const arena = buildArena(DEFAULT_ARENA_CONFIG, seed);
  const first = arena.spawnPoints[arena.spawnOrder[0]!]!;
  const second = arena.spawnPoints[arena.spawnOrder[1]!]!;
  return [first, second].map((point) => ({ x: toMm(point.x), y: toMm(point.y) })) as [{ x: number; y: number }, { x: number; y: number }];
};

// CLOSE_SEED: first two spawn slots 30-55 m apart, so the hunter closes
// to blaster range inside the tick cap. VICTIM_SEED: additionally a cell
// within 450 mm of the second slot, so a forager spawned there stands in
// contact from tick 1.
const findSeed = (wantCellOnSecondSlot: boolean): bigint => {
  for (let candidate = 1n; candidate < 600n; candidate++) {
    const arena = buildArena(DEFAULT_ARENA_CONFIG, candidate);
    const first = arena.spawnPoints[arena.spawnOrder[0]!]!;
    const second = arena.spawnPoints[arena.spawnOrder[1]!]!;
    const dx = BigInt(first.x) - BigInt(second.x);
    const dy = BigInt(first.y) - BigInt(second.y);
    const squared = dx * dx + dy * dy;
    const max = BigInt(fromMm(55000)) * BigInt(fromMm(55000));
    const min = BigInt(fromMm(30000)) * BigInt(fromMm(30000));
    if (squared > max || squared < min) {
      continue;
    }
    if (!wantCellOnSecondSlot) {
      return candidate;
    }
    const field = BiomassField.build(arena, candidate);
    if (field.nearestAvailable(second, fromMm(450)) !== null) {
      return candidate;
    }
  }
  throw new Error('no seed found under 600');
};

const CLOSE_SEED = findSeed(false);
const VICTIM_SEED = findSeed(true);

// Stage map: the pipeline position each record kind is emitted at. death
// splits by cause — combat deaths are combat-stage, starvation deaths
// are biomass-stage.
const STAGE_OF: Record<string, number> = {
  biomass_spawn: 0,
  move: 1,
  aim: 1,
  say: 1,
  vm_yield: 1,
  build_start: 1,
  build_done: 2,
  birth: 2,
  fire: 3,
  shot: 3,
  damage: 3,
  biomass_taken: 4,
  biomass_depleted: 4,
  eat: 4,
};

function stageOf(record: MatchRecord): number {
  if (record.kind === 'death') {
    return record.cause === 'combat' ? 3 : 4;
  }
  return STAGE_OF[record.kind]!;
}

function assertPipelineOrder(records: readonly MatchRecord[], tick: number): void {
  let previous = -1;
  for (const record of records) {
    const stage = stageOf(record);
    expect(stage, `stage regression at tick ${tick}: ${record.kind} after stage ${previous}`).toBeGreaterThanOrEqual(previous);
    previous = stage;
  }
}

describe('the G31 total ordering, asserted', () => {
  it('[normal] every tick of a combat match reads as stage blocks in pipeline order', () => {
    const [first, second] = spawnPointsFor(CLOSE_SEED);
    const angle = angleOf(vec2(fromMm(second.x - first.x), fromMm(second.y - first.y)));
    const hunter = compileOk(`(defn step [] (move-at ${second.x} ${second.y}) (aim ${angle}) (fire)) (every-tick step)`);
    const result = runMatch([[{ design: BLASTER_BOT, program: hunter, robotCount: 1 }], [{ design: BLASTER_BOT, program: IDLE_PROGRAM, robotCount: 1 }]], { seed: CLOSE_SEED, tickLimit: 1200 });
    expect(result.reason).toBe('elimination');
    for (const tick of result.ticks) {
      assertPipelineOrder(tick.records, tick.tick);
    }
  });

  it('[normal] every tick of a foraging match reads as stage blocks in pipeline order', () => {
    const forager = compileOk('(defn step [] (let ((f (food))) (if (some? f) (move-at (food-x f) (food-y f)))) (if (>= (self.biomass) 1) (eat))) (every-tick step)');
    const result = runMatch([[{ design: BLASTER_BOT, program: IDLE_PROGRAM, robotCount: 1 }], [{ design: SOLAR_FORAGER, program: forager, robotCount: 1 }]], { seed: VICTIM_SEED, tickLimit: 900 });
    expect(result.ticks.some((tick) => tick.records.some((record) => record.kind === 'biomass_taken'))).toBe(true);
    for (const tick of result.ticks) {
      assertPipelineOrder(tick.records, tick.tick);
    }
  });

  it('[state] the world respawns on schedule: deplete + 300, as the FIRST record of the tick', () => {
    const forager = compileOk('(defn step [] (let ((f (food))) (if (some? f) (move-at (food-x f) (food-y f)))) (if (>= (self.biomass) 1) (eat))) (every-tick step)');
    const result = runMatch([[{ design: BLASTER_BOT, program: IDLE_PROGRAM, robotCount: 1 }], [{ design: SOLAR_FORAGER, program: forager, robotCount: 1 }]], { seed: VICTIM_SEED, tickLimit: 900 });
    const firstTaken = result.ticks.find((tick) => tick.records.some((record) => record.kind === 'biomass_taken'))!;
    const firstSpawn = result.ticks.find((tick) => tick.records.some((record) => record.kind === 'biomass_spawn'))!;
    expect(firstTaken.tick).toBe(1);
    expect(firstSpawn.tick).toBe(firstTaken.tick + 300);
    expect(firstSpawn.records[0]!.kind).toBe('biomass_spawn');
    const spawnedCell = firstSpawn.records[0] as { cellIndex: number; xMm: number; yMm: number };
    // The paired depleted record carries the taken cell's position.
    const takenCell = firstTaken.records.find((record) => record.kind === 'biomass_depleted') as { cellIndex: number; xMm: number; yMm: number };
    // The unit may land on any free slot of its region (the matchRng's
    // pick) — the region-scoped cluster rule is what must hold.
    const arena = buildArena(DEFAULT_ARENA_CONFIG, VICTIM_SEED);
    const regionOfMm = (xMm: number, yMm: number): number =>
      regionOf(arena, { x: fromMm(xMm), y: fromMm(yMm) });
    expect(regionOfMm(spawnedCell.xMm, spawnedCell.yMm)).toBe(regionOfMm(takenCell.xMm, takenCell.yMm));
  });

  it('[state] the killing shot fires from where this tick\'s move left the shooter (physics before hitscan)', () => {
    const [first, second] = spawnPointsFor(CLOSE_SEED);
    const angle = angleOf(vec2(fromMm(second.x - first.x), fromMm(second.y - first.y)));
    const hunter = compileOk(`(defn step [] (move-at ${second.x} ${second.y}) (aim ${angle}) (fire)) (every-tick step)`);
    const result = runMatch([[{ design: BLASTER_BOT, program: hunter, robotCount: 1 }], [{ design: BLASTER_BOT, program: IDLE_PROGRAM, robotCount: 1 }]], { seed: CLOSE_SEED, tickLimit: 1200 });
    const killTick = result.durationTicks;
    const killRecords = result.ticks.find((tick) => tick.tick === killTick)!.records;
    const shot = killRecords.find((record) => record.kind === 'shot') as { xMm: number; yMm: number };
    expect(shot).toBeDefined();
    const lastSnapshot = result.snapshots[result.snapshots.length - 1]!;
    expect(lastSnapshot.tick).toBe(killTick - 1);
    const shooter = lastSnapshot.robots.find((robot) => robot.id === 'p1.blasterbot.0')!;
    const movedX = shot.xMm - shooter.xMm;
    const movedY = shot.yMm - shooter.yMm;
    const stepMm = Math.sqrt(movedX * movedX + movedY * movedY);
    // One tick of full-throttle mk1 travel is 2730 raw = 41.66 mm; the
    // mm-rounded shot position sits 40-43 mm past the snapshot. Had
    // hitscan resolved before physics, the shot would record the
    // snapshot position exactly — 0 mm.
    expect(stepMm).toBeGreaterThan(35);
    expect(stepMm).toBeLessThan(48);
  });

  it('[determinism] a bot rng-int sequence is independent of the other side (D5)', () => {
    const roller = compileOk('(defn step [] (say 7 (rng-int 1000))) (every-tick step)');
    const ROLLER = designOf('roller', [PART_ID.proximity]);
    const small = runMatch([[{ design: ROLLER, program: roller, robotCount: 1 }], [{ design: BLASTER_BOT, program: IDLE_PROGRAM, robotCount: 1 }]], { seed: 77n, tickLimit: 120 });
    const large = runMatch([[{ design: ROLLER, program: roller, robotCount: 1 }], [{ design: BLASTER_BOT, program: IDLE_PROGRAM, robotCount: 3 }]], { seed: 77n, tickLimit: 120 });
    const saysOf = (result: typeof small): number[] =>
      result.ticks.flatMap((tick) => tick.records.filter((record) => record.kind === 'say' && record.robotId === 'p1.roller.0')).map((record) => (record as { payload: number }).payload);
    expect(saysOf(small)).toEqual(saysOf(large));
    expect(saysOf(small)).toHaveLength(120);
  });

  it('[determinism] the field layout is seed-deterministic and bot-independent', () => {
    const roller = compileOk('(defn step [] (say 7 (rng-int 1000))) (every-tick step)');
    const ROLLER = designOf('roller', [PART_ID.proximity]);
    const one = runMatch([[{ design: ROLLER, program: roller, robotCount: 1 }], [{ design: BLASTER_BOT, program: IDLE_PROGRAM, robotCount: 1 }]], { seed: 77n, tickLimit: 31 });
    const two = runMatch([[{ design: ROLLER, program: roller, robotCount: 1 }], [{ design: BLASTER_BOT, program: IDLE_PROGRAM, robotCount: 3 }]], { seed: 77n, tickLimit: 31 });
    expect(one.availableCellIndices).toEqual(two.availableCellIndices);
  });
});
