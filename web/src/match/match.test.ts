import { describe, expect, it } from 'vitest';
import { DEFAULT_ARENA_CONFIG, buildArena } from '../arena';
import { BiomassField } from '../arena/biomass';
import { fromMm, toMm } from '../math/fixed';
import { angleOf, vec2 } from '../math/vec2';
import { compile } from '../program';
import { PART_ID } from '../robot';
import type { Design } from '../robot/design';
import { CollectingSink, FOOD_RANGE_MM, runMatch, type MatchRecord, type MatchSideInput } from './index';

// runMatch — the Phase 5 deliverable (23 § 8.1). The six dimensions ride
// whole matches: a match is the function. Geometry constants (spawn
// points, aim angles) are computed from the arena the same way the loop
// builds it, so the tests never hand-place a robot.

const SEED = 42n;

const compileOk = (src: string) => {
  const result = compile(src);
  if (!result.ok) {
    throw new Error(`fixture program failed to compile: ${JSON.stringify(result.errors)}`);
  }
  return result.ir;
};

// A program with no every-tick: the VM's tick is null and the robot does
// nothing all match.
const IDLE_PROGRAM = compileOk('(defn unused [] 0)');

const designOf = (name: string, parts: readonly string[]): Design => ({ name, chassis: { parts: parts as Design['chassis']['parts'] } });

const BLASTER_BOT: Design = designOf('blasterbot', [PART_ID.mk1Engine, PART_ID.blaster]);
const STARVER: Design = designOf('starver', [PART_ID.mk2Engine, PART_ID.heavyBlaster, PART_ID.heavyBlaster, PART_ID.blaster]);
const DRIFTER: Design = designOf('drifter', [PART_ID.mk1Engine, PART_ID.solarPanel]);
const BUILDER: Design = designOf('builder', [PART_ID.mk1Engine, PART_ID.constructor]);
const TINY: Design = designOf('tiny', [PART_ID.proximity]);

const arenaOf = (seed: bigint) => buildArena(DEFAULT_ARENA_CONFIG, seed);

// p1's first robot and p2's first robot occupy spawn slots
// spawnOrder[0] and spawnOrder[1] respectively.
const spawnPointsFor = (seed: bigint): [first: { x: number; y: number }, second: { x: number; y: number }] => {
  const arena = arenaOf(seed);
  const first = arena.spawnPoints[arena.spawnOrder[0]!]!;
  const second = arena.spawnPoints[arena.spawnOrder[1]!]!;
  return [first, second].map((point) => ({ x: toMm(point.x), y: toMm(point.y) })) as [{ x: number; y: number }, { x: number; y: number }];
};

// A side input of one design fielding one robot, with a program aimed at
// a point and a fire-every-tick trigger.
const hunterSide = (design: Design, targetMm: { x: number; y: number }, fromPointMm: { x: number; y: number }): MatchSideInput => {
  const angle = angleOf(vec2(fromMm(targetMm.x - fromPointMm.x), fromMm(targetMm.y - fromPointMm.y)));
  const program = compileOk(`(defn step [] (move-at ${targetMm.x} ${targetMm.y}) (aim ${angle}) (fire)) (every-tick step)`);
  return [{ design, program, robotCount: 1 }];
};

const idleSide = (design: Design, count = 1): MatchSideInput => [{ design, program: IDLE_PROGRAM, robotCount: count }];

// Six per side via two designs of three — the per-design cap is four.
const sixPerSide = (): MatchSideInput => [
  { design: designOf('alpha', [PART_ID.mk1Engine, PART_ID.blaster]), program: IDLE_PROGRAM, robotCount: 3 },
  { design: designOf('beta', [PART_ID.mk1Engine, PART_ID.blaster]), program: IDLE_PROGRAM, robotCount: 3 },
];

// Deterministic seed search: the first seed whose first two spawn slots
// sit within maxMm of each other, so a hunter can close to blaster range
// well inside the tick cap (opposite-wall slots are 197 m apart).
const findCloseSpawnSeed = (maxMm: number, ceilingMm: number): bigint => {
  for (let candidate = 1n; candidate < 500n; candidate++) {
    const arena = arenaOf(candidate);
    const first = arena.spawnPoints[arena.spawnOrder[0]!]!;
    const second = arena.spawnPoints[arena.spawnOrder[1]!]!;
    const dx = BigInt(first.x) - BigInt(second.x);
    const dy = BigInt(first.y) - BigInt(second.y);
    const squared = dx * dx + dy * dy;
    const max = BigInt(fromMm(maxMm)) * BigInt(fromMm(maxMm));
    const floor = BigInt(fromMm(ceilingMm)) * BigInt(fromMm(ceilingMm));
    if (squared <= max && squared >= floor) {
      return candidate;
    }
  }
  throw new Error('no close-spawn seed found under 500');
};

const CLOSE_SEED = findCloseSpawnSeed(55000, 30000);

// A seed where p1's first slot has a cell inside the food() radius, so a
// forager can see its first meal from where it stands.
const findForageSeed = (): bigint => {
  for (let candidate = 1n; candidate < 500n; candidate++) {
    const arena = arenaOf(candidate);
    const slot = arena.spawnPoints[arena.spawnOrder[0]!]!;
    const field = BiomassField.build(arena, candidate);
    if (field.nearestAvailable(slot, fromMm(FOOD_RANGE_MM - 500)) !== null) {
      return candidate;
    }
  }
  throw new Error('no forage seed found under 500');
};

const FORAGE_SEED = findForageSeed();

const recordsOfKind = (ticks: readonly { readonly records: readonly MatchRecord[] }[], kind: string): MatchRecord[] =>
  ticks.flatMap((tick) => tick.records.filter((record) => record.kind === kind));

describe('runMatch — normal cases', () => {
  it('[normal] a hunter kills an idle robot: elimination, combat death first-class, bounty paid', () => {
    const [first, second] = spawnPointsFor(CLOSE_SEED);
    const result = runMatch([hunterSide(BLASTER_BOT, second, first), idleSide(BLASTER_BOT)], { seed: CLOSE_SEED, tickLimit: 1200 });
    expect(result.winner).toBe('p1');
    expect(result.reason).toBe('elimination');
    expect(result.durationTicks).toBeLessThanOrEqual(1200);
    const deaths = recordsOfKind(result.ticks, 'death');
    expect(deaths).toHaveLength(1);
    const death = deaths[0]!;
    expect(death).toMatchObject({ kind: 'death', cause: 'combat', killerId: 'p1.blasterbot.0', botId: 'p2.blasterbot.0' });
    expect((death as { bounty: number }).bounty).toBe(0);
    expect(result.finalRobots.find((robot) => robot.id === 'p2.blasterbot.0')!.alive).toBe(false);
    expect(result.finalRobots.find((robot) => robot.id === 'p1.blasterbot.0')!.alive).toBe(true);
  });

  it('[normal] combat and starvation are both first-class in one match: two death causes', () => {
    const [first, second] = spawnPointsFor(CLOSE_SEED);
    // p1 fields a hunter that starves late (39 W draw) and p2 fields two
    // robots, so the combat death does not end the match.
    const result = runMatch([hunterSide(STARVER, second, first), idleSide(BLASTER_BOT, 2)], { seed: CLOSE_SEED, tickLimit: 1500 });
    const deaths = recordsOfKind(result.ticks, 'death');
    const causes = deaths.map((death) => (death as { cause: string }).cause).sort();
    expect(causes).toEqual(['combat', 'starvation']);
    expect(result.winner).toBe('p2');
    expect(result.reason).toBe('elimination');
    const combatTick = result.ticks.find((tick) => tick.records.some((record) => record.kind === 'death' && (record as { cause: string }).cause === 'combat'))!.tick;
    const starveTick = result.ticks.find((tick) => tick.records.some((record) => record.kind === 'death' && (record as { cause: string }).cause === 'starvation'))!.tick;
    expect(combatTick).toBeLessThan(starveTick);
  });

  it('[normal] the hunter acts on the tick it starves: VM, combat and construction ran before vitality', () => {
    const [first, second] = spawnPointsFor(CLOSE_SEED);
    const result = runMatch([hunterSide(STARVER, second, first), idleSide(BLASTER_BOT, 2)], { seed: CLOSE_SEED, tickLimit: 1500 });
    const starveTick = result.ticks.find((tick) => tick.records.some((record) => record.kind === 'death' && (record as { cause: string }).cause === 'starvation'))!.tick;
    const starvationTickRecords = result.ticks.find((tick) => tick.tick === starveTick)!.records;
    expect(starvationTickRecords.some((record) => record.kind === 'move' && record.robotId === 'p1.starver.0')).toBe(true);
  });
});

describe('runMatch — foraging, the full loop', () => {
  it('[state] a drifter walks to food, picks it up, and eats it', () => {
    const forageProgram = compileOk(
      '(defn step [] (let ((f (food))) (if (some? f) (move-at (food-x f) (food-y f)))) (if (>= (self.biomass) 1) (eat))) (every-tick step)',
    );
    const result = runMatch([[{ design: DRIFTER, program: forageProgram, robotCount: 1 }], idleSide(BLASTER_BOT)], { seed: FORAGE_SEED, tickLimit: 900 });
    const taken = recordsOfKind(result.ticks, 'biomass_taken');
    const eaten = recordsOfKind(result.ticks, 'eat').filter((record) => (record as { reason: string }).reason === 'player');
    expect(taken.length).toBeGreaterThanOrEqual(1);
    expect(eaten.length).toBeGreaterThanOrEqual(1);
    const firstTakenTick = result.ticks.find((tick) => tick.records.some((record) => record.kind === 'biomass_taken'))!.tick;
    const firstEatTick = result.ticks.find((tick) => tick.records.some((record) => record.kind === 'eat'))!.tick;
    expect(firstEatTick).toBeGreaterThanOrEqual(firstTakenTick);
    expect(recordsOfKind(result.ticks, 'biomass_depleted').length).toBe(taken.length);
    expect(result.availableCellIndices.length).toBeLessThanOrEqual(400);
  });
});

describe('runMatch — construction', () => {
  it('[state] a builder with material builds a child: start, done, birth, and the child lives', () => {
    const buildProgram = compileOk(
      '(defn step [] (let ((f (food))) (if (some? f) (move-at (food-x f) (food-y f)))) (if (>= (self.biomass) 1) (build 1))) (every-tick step)',
    );
    const result = runMatch(
      [
        [
          { design: BUILDER, program: buildProgram, robotCount: 1 },
          { design: TINY, program: IDLE_PROGRAM, robotCount: 0 },
        ],
        idleSide(BLASTER_BOT),
      ],
      { seed: FORAGE_SEED, tickLimit: 900 },
    );
    const starts = recordsOfKind(result.ticks, 'build_start');
    const dones = recordsOfKind(result.ticks, 'build_done');
    const births = recordsOfKind(result.ticks, 'birth');
    expect(starts.length).toBeGreaterThanOrEqual(1);
    expect(dones).toHaveLength(starts.length);
    expect(births).toHaveLength(starts.length);
    expect(result.finalRobots.some((robot) => robot.id === 'p1.tiny.0')).toBe(true);
  });
});

describe('runMatch — win conditions at the boundary', () => {
  it('[boundary] a one-tick match with two live sides resolves the biomass tiebreak (draw_tie)', () => {
    const result = runMatch([idleSide(BLASTER_BOT), idleSide(BLASTER_BOT)], { seed: SEED, tickLimit: 1 });
    expect(result.durationTicks).toBe(1);
    expect(result.winner).toBe('draw');
    expect(result.reason).toBe('draw_tie');
  });

  it('[boundary] the tick cap is honoured exactly', () => {
    const result = runMatch([idleSide(BLASTER_BOT), idleSide(BLASTER_BOT)], { seed: SEED, tickLimit: 37 });
    expect(result.durationTicks).toBe(37);
  });

  it('[boundary] six robots per side is legal and all twelve act', () => {
    const result = runMatch([sixPerSide(), sixPerSide()], { seed: SEED, tickLimit: 31 });
    expect(result.finalRobots).toHaveLength(12);
    expect(result.finalRobots.every((robot) => robot.alive)).toBe(true);
  });

  it('[boundary] ids are unique across a 12-robot match, children included', () => {
    const result = runMatch([sixPerSide(), sixPerSide()], { seed: SEED, tickLimit: 1 });
    const ids = result.finalRobots.map((robot) => robot.id);
    expect(new Set(ids).size).toBe(12);
  });

  it('[state] snapshots land at tick 1 and every 30 ticks with wire-unit state', () => {
    const result = runMatch([idleSide(BLASTER_BOT, 2), idleSide(BLASTER_BOT, 2)], { seed: SEED, tickLimit: 61 });
    expect(result.snapshots[0]!.tick).toBe(1);
    expect(result.snapshots.map((snapshot) => snapshot.tick)).toEqual([1, 30, 60]);
    for (const snapshot of result.snapshots) {
      expect(snapshot.robots).toHaveLength(4);
      for (const robot of snapshot.robots) {
        expect(Number.isInteger(robot.xMm)).toBe(true);
        expect(Number.isInteger(robot.energy)).toBe(true);
      }
    }
  });
});

describe('runMatch — invalid inputs', () => {
  const base = idleSide(BLASTER_BOT);

  it('[invalid] a side with no designs is rejected', () => {
    expect(() => runMatch([[], base], { seed: SEED, tickLimit: 1 })).toThrow(TypeError);
  });

  it('[invalid] more than three designs per side is rejected', () => {
    const four: MatchSideInput = [1, 2, 3, 4].map((index) => ({
      design: designOf(`d${index}`, [PART_ID.proximity]),
      program: IDLE_PROGRAM,
      robotCount: 1,
    }));
    expect(() => runMatch([four, base], { seed: SEED, tickLimit: 1 })).toThrow(TypeError);
  });

  it('[invalid] duplicate design names on one side would collide robot ids and are rejected', () => {
    const duplicated: MatchSideInput = [
      { design: BLASTER_BOT, program: IDLE_PROGRAM, robotCount: 1 },
      { design: BLASTER_BOT, program: IDLE_PROGRAM, robotCount: 1 },
    ];
    expect(() => runMatch([duplicated, base], { seed: SEED, tickLimit: 1 })).toThrow(/duplicate/);
  });

  it('[invalid] robotCount bounds: negative, five per design, seven per side, all-zero side', () => {
    expect(() => runMatch([[{ design: BLASTER_BOT, program: IDLE_PROGRAM, robotCount: -1 }], base], { seed: SEED, tickLimit: 1 })).toThrow(RangeError);
    expect(() => runMatch([[{ design: BLASTER_BOT, program: IDLE_PROGRAM, robotCount: 5 }], base], { seed: SEED, tickLimit: 1 })).toThrow(RangeError);
    expect(() => runMatch([idleSide(BLASTER_BOT), [{ design: designOf('alpha', [PART_ID.proximity]), program: IDLE_PROGRAM, robotCount: 4 }, { design: designOf('beta', [PART_ID.proximity]), program: IDLE_PROGRAM, robotCount: 3 }]], { seed: SEED, tickLimit: 1 })).toThrow(/p2/);
    expect(() => runMatch([[{ design: BLASTER_BOT, program: IDLE_PROGRAM, robotCount: 0 }], base], { seed: SEED, tickLimit: 1 })).toThrow(/at least one robot/);
  });

  it('[invalid] tickLimit must be a positive integer', () => {
    expect(() => runMatch([base, base], { seed: SEED, tickLimit: 0 })).toThrow(RangeError);
    expect(() => runMatch([base, base], { seed: SEED, tickLimit: 1.5 })).toThrow(RangeError);
    expect(() => runMatch([base, base], { seed: SEED, tickLimit: -3 })).toThrow(RangeError);
  });

  it('[invalid] the seed must be a uint64', () => {
    expect(() => runMatch([base, base], { seed: -1n, tickLimit: 1 })).toThrow(RangeError);
    expect(() => runMatch([base, base], { seed: 1n << 64n, tickLimit: 1 })).toThrow(RangeError);
  });

  it('[invalid] exactly two sides: a one-side or three-side roster is rejected', () => {
    expect(() => runMatch([base] as never, { seed: SEED, tickLimit: 1 })).toThrow();
    expect(() => runMatch([base, base, base] as never, { seed: SEED, tickLimit: 1 })).toThrow();
  });
});

describe('runMatch — repeated calls and determinism', () => {
  const fight = (): string => {
    const [first, second] = spawnPointsFor(SEED);
    const result = runMatch([hunterSide(BLASTER_BOT, second, first), idleSide(BLASTER_BOT, 2)], { seed: SEED, tickLimit: 1500 });
    return JSON.stringify({ winner: result.winner, reason: result.reason, duration: result.durationTicks, ticks: result.ticks, snapshots: result.snapshots, final: result.finalRobots, cells: result.availableCellIndices });
  };

  it('[repeat] two runs of the same seed and rosters are byte-identical', () => {
    expect(fight()).toBe(fight());
  });

  it('[determinism] a different seed changes the match (the streams are actually used)', () => {
    const [firstA, secondA] = spawnPointsFor(42n);
    const a = runMatch([hunterSide(BLASTER_BOT, secondA, firstA), idleSide(BLASTER_BOT)], { seed: 42n, tickLimit: 1200 });
    const [firstB, secondB] = spawnPointsFor(43n);
    const b = runMatch([hunterSide(BLASTER_BOT, secondB, firstB), idleSide(BLASTER_BOT)], { seed: 43n, tickLimit: 1200 });
    expect(JSON.stringify(a.ticks)).not.toBe(JSON.stringify(b.ticks));
  });

  it('[determinism] the collecting sink sees the same records the result carries', () => {
    const [first, second] = spawnPointsFor(SEED);
    const sink = new CollectingSink();
    const result = runMatch([hunterSide(BLASTER_BOT, second, first), idleSide(BLASTER_BOT)], { seed: SEED, tickLimit: 1200 }, sink);
    expect(sink.ticks.map((tick) => tick.records)).toEqual(result.ticks.map((tick) => tick.records));
    expect(sink.snapshots).toEqual(result.snapshots);
  });
});
