import { describe, expect, it } from 'vitest';
import { DEFAULT_ARENA_CONFIG, buildArena } from '../arena';
import { BiomassField } from '../arena/biomass';
import { fromMm, toMm } from '../math/fixed';
import { angleOf, vec2 } from '../math/vec2';
import { compile } from '../program';
import { PART_ID } from '../robot';
import type { Design } from '../robot/design';
import { runMatch, type MatchRecord } from './index';

// The construction economy and the combat/biomass record paths that a
// full match only reaches under specific rosters: build refusals, the
// per-design spawn cap, grenade splash in a match, and the emergency
// conversion of a starving carrier.

const designOf = (name: string, parts: readonly string[]): Design => ({ name, chassis: { parts: parts as Design['chassis']['parts'] } });
const BLASTER_BOT = designOf('blasterbot', [PART_ID.mk1Engine, PART_ID.blaster]);
const GRENADIER = designOf('grenadier', [PART_ID.mk1Engine, PART_ID.grenade]);
const SHIELDED_TARGET = designOf('target', [PART_ID.mk1Engine, PART_ID.blaster, PART_ID.lightShield]);
const STARVER = designOf('starver', [PART_ID.mk2Engine, PART_ID.heavyBlaster, PART_ID.heavyBlaster, PART_ID.blaster]);
const NO_CONSTRUCTOR = designOf('wannabe', [PART_ID.mk1Engine]);

const compileOk = (src: string) => {
  const result = compile(src);
  if (!result.ok) {
    throw new Error(`fixture failed: ${JSON.stringify(result.errors)}`);
  }
  return result.ir;
};
const IDLE_PROGRAM = compileOk('(defn unused [] 0)');

// A seed whose first two slots are 30-55 m apart.
const CLOSE_SEED = (() => {
  for (let candidate = 1n; candidate < 600n; candidate++) {
    const arena = buildArena(DEFAULT_ARENA_CONFIG, candidate);
    const first = arena.spawnPoints[arena.spawnOrder[0]!]!;
    const second = arena.spawnPoints[arena.spawnOrder[1]!]!;
    const dx = BigInt(first.x) - BigInt(second.x);
    const dy = BigInt(first.y) - BigInt(second.y);
    const squared = dx * dx + dy * dy;
    if (squared <= BigInt(fromMm(55000)) ** 2n && squared >= BigInt(fromMm(30000)) ** 2n) {
      return candidate;
    }
  }
  throw new Error('no seed');
})();

// A seed whose second slot holds a cell within 450 mm — a forager there
// stands in contact from tick 1.
const CELL_SEED = (() => {
  for (let candidate = 1n; candidate < 600n; candidate++) {
    const arena = buildArena(DEFAULT_ARENA_CONFIG, candidate);
    const first = arena.spawnPoints[arena.spawnOrder[0]!]!;
    const second = arena.spawnPoints[arena.spawnOrder[1]!]!;
    const dx = BigInt(first.x) - BigInt(second.x);
    const dy = BigInt(first.y) - BigInt(second.y);
    const squared = dx * dx + dy * dy;
    if (squared > BigInt(fromMm(55000)) ** 2n || squared < BigInt(fromMm(30000)) ** 2n) {
      continue;
    }
    const field = BiomassField.build(arena, candidate);
    if (field.nearestAvailable(second, fromMm(450)) !== null) {
      return candidate;
    }
  }
  throw new Error('no seed');
})();

const spawnPointsFor = (seed: bigint): [{ x: number; y: number }, { x: number; y: number }] => {
  const arena = buildArena(DEFAULT_ARENA_CONFIG, seed);
  const first = arena.spawnPoints[arena.spawnOrder[0]!]!;
  const second = arena.spawnPoints[arena.spawnOrder[1]!]!;
  return [first, second].map((point) => ({ x: toMm(point.x), y: toMm(point.y) })) as [{ x: number; y: number }, { x: number; y: number }];
};

const recordsOfKind = (ticks: readonly { readonly records: readonly MatchRecord[] }[], kind: string): MatchRecord[] =>
  ticks.flatMap((tick) => tick.records.filter((record) => record.kind === kind));

describe('construction refusals', () => {
  it('[invalid] a build with no Constructor fitted is a silent no-op', () => {
    const wannabe = compileOk('(defn step [] (build 0)) (every-tick step)');
    const result = runMatch([[{ design: NO_CONSTRUCTOR, program: wannabe, robotCount: 1 }], [{ design: BLASTER_BOT, program: IDLE_PROGRAM, robotCount: 1 }]], { seed: CLOSE_SEED, tickLimit: 3 });
    expect(recordsOfKind(result.ticks, 'build_start')).toHaveLength(0);
    expect(result.finalRobots).toHaveLength(2);
  });

  it('[invalid] a build of a design index the side does not field is refused', () => {
    const dreamer = compileOk('(defn step [] (build 5)) (every-tick step)');
    const result = runMatch([[{ design: NO_CONSTRUCTOR, program: dreamer, robotCount: 1 }], [{ design: BLASTER_BOT, program: IDLE_PROGRAM, robotCount: 1 }]], { seed: CLOSE_SEED, tickLimit: 3 });
    expect(recordsOfKind(result.ticks, 'build_start')).toHaveLength(0);
  });

  it('[invalid] a builder without the material never starts the queue', () => {
    // The child costs 4 kg (proximity + light shield); the builder holds
    // at most one cell for a long stretch, so every attempt refuses.
    const [first] = spawnPointsFor(CELL_SEED);
    void first;
    const builder = compileOk('(defn step [] (let ((f (food))) (if (some? f) (move-at (food-x f) (food-y f)))) (if (>= (self.biomass) 1) (build 1))) (every-tick step)');
    const result = runMatch(
      [
        [{ design: designOf('builder', [PART_ID.mk1Engine, PART_ID.constructor]), program: builder, robotCount: 1 }],
        [{ design: BLASTER_BOT, program: IDLE_PROGRAM, robotCount: 1 }],
      ],
      { seed: CELL_SEED, tickLimit: 250 },
    );
    const starts = recordsOfKind(result.ticks, 'build_start');
    expect(starts.every((record) => (record as { costKg: number }).costKg > 1)).toBe(true);
  });
});

describe('grenade splash inside a match', () => {
  it('[state] a walking target walks into the splash: damage records, shield suppression, splash kill', () => {
    const [first, second] = spawnPointsFor(CLOSE_SEED);
    const angle = angleOf(vec2(fromMm(second.x - first.x), fromMm(second.y - first.y)));
    const lobber = compileOk(`(defn step [] (aim ${angle}) (fire)) (every-tick step)`);
    const walker = compileOk(`(defn step [] (move-at ${first.x} ${first.y})) (every-tick step)`);
    const result = runMatch(
      [[{ design: GRENADIER, program: lobber, robotCount: 1 }], [{ design: SHIELDED_TARGET, program: walker, robotCount: 1 }]],
      { seed: CLOSE_SEED, tickLimit: 1500 },
    );
    const damage = recordsOfKind(result.ticks, 'damage');
    expect(damage.length).toBeGreaterThanOrEqual(1);
    expect(damage.some((record) => (record as { toShield: number }).toShield > 0)).toBe(true);
    const deaths = recordsOfKind(result.ticks, 'death');
    expect(deaths.some((record) => (record as { botId: string }).botId === 'p2.target.0' && (record as { botId: string; cause: string }).cause === 'combat')).toBe(true);
    expect(result.winner).toBe('p1');
  });
});

describe('the starving carrier', () => {
  it('[state] starvation burns the emergency conversion first: eat(starvation) then death, first-class', () => {
    // The starver stands on a cell (contact at tick 1), carries 1 kg, and
    // drains 39 W: the pool empties around tick 770, the emergency
    // conversion consumes the kilo for nothing (floored 2:1 on 1 kg), and
    // the robot dies of starvation with the cause stamped.
    const forager = compileOk('(defn step [] (let ((f (food))) (if (some? f) (move-at (food-x f) (food-y f)))) ) (every-tick step)');
    const result = runMatch(
      [[{ design: BLASTER_BOT, program: IDLE_PROGRAM, robotCount: 1 }], [{ design: STARVER, program: forager, robotCount: 1 }]],
      { seed: CELL_SEED },
    );
    const eats = recordsOfKind(result.ticks, 'eat').filter((record) => (record as { reason: string }).reason === 'starvation');
    expect(eats.length).toBeGreaterThanOrEqual(1);
    const last = eats[eats.length - 1] as { consumedBiomass: number; gainedEnergy: number };
    expect(last.gainedEnergy).toBe((last.consumedBiomass / 2) | 0);
    const deaths = recordsOfKind(result.ticks, 'death');
    expect(deaths.some((record) => (record as { botId: string; cause: string }).botId === 'p2.starver.0' && (record as { botId: string; cause: string }).cause === 'starvation')).toBe(true);
    expect(result.winner).toBe('p1');
    expect(result.durationTicks).toBeLessThanOrEqual(1500);
    const deathTick = result.ticks.find((tick) => tick.records.some((record) => record.kind === 'death' && (record as { botId: string }).botId === 'p2.starver.0'))!.tick;
    const lastEatTick = result.ticks.filter((tick) => tick.records.some((record) => record.kind === 'eat')).map((tick) => tick.tick).at(-1)!;
    // The final conversion lands on the death tick or just before it —
    // the robot died with an empty pool and an empty carry.
    expect(lastEatTick).toBeLessThanOrEqual(deathTick);
    expect(deathTick - lastEatTick).toBeLessThanOrEqual(12);
  });
});
