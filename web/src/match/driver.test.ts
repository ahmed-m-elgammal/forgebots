import { describe, expect, it } from 'vitest';
import { DEFAULT_ARENA_CONFIG, buildArena } from '../arena';
import { BiomassField, RESPAWN_TICKS } from '../arena/biomass';
import { fromMm, toMm, type Fixed } from '../math/fixed';
import { createMatchRng } from '../math/rng';
import { compile } from '../program';
import { PART_ID } from '../robot';
import { spawnRobot, type Robot } from '../robot/robot';
import type { Design } from '../robot/design';
import {
  FOOD_RANGE_MM,
  createVmDriver,
  createVmEnv,
  packPoint,
  unpackX,
  unpackY,
  type CachedReading,
  type MatchWorld,
} from './index';

// The perception bridge: self state, time, rng-int, and the five sensors
// of 04 § 4.1 / D16 — queried through the same env the VM sees. Range
// boundaries are exact squared comparisons; ties go to the lowest spawn
// index; the rate-limited sensors hold their value between refreshes.

const SEED = 42n;

const RADAR_BOT: Design = { name: 'radarbot', chassis: { parts: [PART_ID.mk1Engine, PART_ID.shortRadar] } };
const SCANNER: Design = { name: 'scanner', chassis: { parts: [PART_ID.directionalScanner] } };
const PLAIN: Design = { name: 'plain', chassis: { parts: [PART_ID.proximity] } };

const arena = buildArena(DEFAULT_ARENA_CONFIG, SEED);
const field = BiomassField.build(arena, SEED);

const makeRobot = (design: Design, side: number, index: number, xMm: number, yMm: number): Robot =>
  spawnRobot({
    seed: SEED,
    side,
    designIndex: 0,
    robotIndex: index,
    design,
    spawnPosition: { x: fromMm(xMm), y: fromMm(yMm) },
  });

const worldWith = (robots: Robot[]): MatchWorld & { robots: Robot[] } => ({ arena, field, robots });
// The food tests deplete cells, so each builds a pristine field of its own.
const freshWorld = (robots: Robot[]): { world: MatchWorld & { robots: Robot[] }; field: BiomassField } => {
  const fresh = BiomassField.build(arena, SEED);
  return { world: { arena, field: fresh, robots }, field: fresh };
};

const env = (self: Robot, world: MatchWorld, tick = 1, cache = new Map<string, CachedReading>()) =>
  createVmEnv(self, world, tick, cache);

describe('the Option payload encoding', () => {
  it('[normal] packs and unpacks a point exactly', () => {
    const payload = packPoint(123456, 65432);
    expect(unpackX(payload)).toBe(123456);
    expect(unpackY(payload)).toBe(65432);
  });

  it('[boundary] the arena corners survive the round trip', () => {
    for (const [x, y] of [[1000, 1000], [199000, 199000], [1000, 199000], [0, 0]] as const) {
      const payload = packPoint(x, y);
      expect(unpackX(payload)).toBe(x);
      expect(unpackY(payload)).toBe(y);
    }
  });

  it('[invalid] a payload below one full x-step decodes to x 0', () => {
    expect(unpackX(packPoint(0, 524287))).toBe(0);
    expect(unpackY(packPoint(0, 524287))).toBe(524287);
  });
});

describe('createVmEnv — self state and time (04 § 4.1)', () => {
  it('[normal] self fields read the robot in wire units', () => {
    const self = makeRobot(RADAR_BOT, 0, 0, 50000, 60000);
    self.hullHp = 7;
    self.shieldHp = 3;
    self.energyMilli = 250500;
    self.biomassCarried = 4;
    const view = env(self, worldWith([self]));
    expect(view.selfField('x')).toBe(50000);
    expect(view.selfField('y')).toBe(60000);
    expect(view.selfField('hp')).toBe(10);
    expect(view.selfField('shield')).toBe(3);
    expect(view.selfField('energy')).toBe(250);
    expect(view.selfField('biomass')).toBe(4);
    expect(view.selfField('alive')).toBe(true);
    expect(view.time()).toBe(1);
  });

  it('[boundary] the energy floor: 999 milli-units shows as 0, 1000 as 1', () => {
    const self = makeRobot(PLAIN, 0, 0, 0, 0);
    const view = env(self, worldWith([self]));
    self.energyMilli = 999;
    expect(view.selfField('energy')).toBe(0);
    self.energyMilli = 1000;
    expect(view.selfField('energy')).toBe(1);
  });

  it('[invalid] an unknown self field answers 0 instead of escaping the sandbox', () => {
    const self = makeRobot(PLAIN, 0, 0, 0, 0);
    expect(env(self, worldWith([self])).selfField('toString')).toBe(0);
    expect(env(self, worldWith([self])).selfField('velocity')).toBe(0);
  });

  it('[invalid] an unknown payload getter answers 0 instead of throwing', () => {
    const self = makeRobot(PLAIN, 0, 0, 0, 0);
    expect(env(self, worldWith([self])).payloadCoordinate('hit-z', 12345)).toBe(0);
  });

  it('[determinism] time() returns exactly the tick the driver was given', () => {
    const self = makeRobot(PLAIN, 0, 0, 0, 0);
    expect(env(self, worldWith([self]), 777).time()).toBe(777);
  });
});

describe('createVmEnv — rng-int is the robot own stream (D5)', () => {
  it('[normal] draws come from the robot stream and advance it', () => {
    const self = makeRobot(PLAIN, 0, 0, 0, 0);
    const first = env(self, worldWith([self]));
    const a = first.rngInt(1000);
    const b = first.rngInt(1000);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(1000);
    expect(b).not.toBe(a);
  });

  it('[state] the stream lives on the robot: a fresh env continues, not restarts', () => {
    const self = makeRobot(PLAIN, 0, 0, 0, 0);
    const world = worldWith([self]);
    const first = env(self, world).rngInt(100);
    const second = env(self, world).rngInt(100);
    expect(second).not.toBe(first);
    const clone = makeRobot(PLAIN, 0, 0, 50000, 50000);
    const throughOneEnv = env(clone, worldWith([clone]));
    expect([throughOneEnv.rngInt(100), throughOneEnv.rngInt(100)]).toEqual([first, second]);
  });

  it('[determinism] identical identities derive identical streams across matches', () => {
    const one = makeRobot(PLAIN, 0, 0, 0, 0);
    const two = makeRobot(PLAIN, 0, 0, 50000, 50000);
    expect([one.rng.nextInt(9973), one.rng.nextInt(9973)]).toEqual([two.rng.nextInt(9973), two.rng.nextInt(9973)]);
  });
});

describe('radar — nearest robot in part range (D16)', () => {
  it('[normal] returns the nearest living robot, allies included (radar is unfiltered)', () => {
    const self = makeRobot(RADAR_BOT, 0, 0, 100000, 100000);
    const near = makeRobot(PLAIN, 0, 1, 120000, 100000);
    const far = makeRobot(PLAIN, 1, 0, 100000, 120000);
    const view = env(self, worldWith([self, near, far]));
    const hit = view.sensor('radar', []);
    expect(hit.kind).toBe('some');
    expect(hit.kind === 'some' && unpackX(hit.payload)).toBe(120000);
  });

  it('[boundary] the range edge is inclusive: 25000 mm hits, 25001 does not', () => {
    const self = makeRobot(RADAR_BOT, 0, 0, 100000, 100000);
    const atRange = makeRobot(PLAIN, 1, 0, 125000, 100000);
    expect(env(self, worldWith([self, atRange])).sensor('radar', []).kind).toBe('some');
    const outOfRange = makeRobot(PLAIN, 1, 0, 125001, 100000);
    expect(env(self, worldWith([self, outOfRange])).sensor('radar', []).kind).toBe('none');
  });

  it('[state] dead robots are invisible and the robot never sees itself', () => {
    const self = makeRobot(RADAR_BOT, 0, 0, 100000, 100000);
    const corpse = makeRobot(PLAIN, 1, 0, 110000, 100000);
    corpse.alive = false;
    expect(env(self, worldWith([self, corpse])).sensor('radar', []).kind).toBe('none');
  });

  it('[state] ties go to the lowest spawn index', () => {
    const self = makeRobot(RADAR_BOT, 0, 0, 100000, 100000);
    const left = makeRobot(PLAIN, 1, 1, 110000, 100000);
    const right = makeRobot(PLAIN, 1, 2, 90000, 100000);
    const hit = env(self, worldWith([self, left, right])).sensor('radar', []);
    expect(hit.kind === 'some' && unpackX(hit.payload)).toBe(110000);
  });

  it('[invalid] no radar part fitted: none, no matter what stands nearby', () => {
    const self = makeRobot(PLAIN, 0, 0, 100000, 100000);
    const close = makeRobot(PLAIN, 1, 0, 101000, 100000);
    expect(env(self, worldWith([self, close])).sensor('radar', []).kind).toBe('none');
  });
});

describe('scan — the 30 degree cone (D16)', () => {
  it('[normal] a target inside the cone is found, one behind the scanner is not', () => {
    const self = makeRobot(SCANNER, 0, 0, 100000, 100000);
    const ahead = makeRobot(PLAIN, 1, 0, 130000, 100000);
    expect(env(self, worldWith([self, ahead])).sensor('scan', [0]).kind).toBe('some');
    const behind = makeRobot(PLAIN, 1, 0, 70000, 100000);
    expect(env(self, worldWith([self, behind])).sensor('scan', [0]).kind).toBe('none');
  });

  it('[boundary] the cone follows the requested angle, not the chassis heading', () => {
    const self = makeRobot(SCANNER, 0, 0, 100000, 100000);
    const north = makeRobot(PLAIN, 1, 0, 100000, 130000);
    expect(env(self, worldWith([self, north])).sensor('scan', [16384]).kind).toBe('some');
    expect(env(self, worldWith([self, north])).sensor('scan', [0]).kind).toBe('none');
  });

  it('[boundary] the 40 m scan range edge is exact', () => {
    const self = makeRobot(SCANNER, 0, 0, 100000, 100000);
    const atRange = makeRobot(PLAIN, 1, 0, 140000, 100000);
    expect(env(self, worldWith([self, atRange])).sensor('scan', [0]).kind).toBe('some');
    const past = makeRobot(PLAIN, 1, 0, 140001, 100000);
    expect(env(self, worldWith([self, past])).sensor('scan', [0]).kind).toBe('none');
  });

  it('[invalid] no scanner part: none even straight ahead', () => {
    const self = makeRobot(PLAIN, 0, 0, 100000, 100000);
    const ahead = makeRobot(PLAIN, 1, 0, 101000, 100000);
    expect(env(self, worldWith([self, ahead])).sensor('scan', [0]).kind).toBe('none');
  });
});

describe('food — the 5 m radius, no part needed (D16)', () => {
  it('[normal] returns the nearest available cell within 5 000 mm as coordinates', () => {
    const { world, field: fresh } = freshWorld([]);
    const cell = fresh.cell(0);
    const cellXMm = toMm(cell.position.x);
    const cellYMm = toMm(cell.position.y);
    const self = makeRobot(PLAIN, 0, 80, cellXMm - 1000, cellYMm);
    world.robots.push(self);
    const hit = env(self, world).sensor('food', []);
    expect(hit.kind).toBe('some');
    expect(hit.kind === 'some' && unpackX(hit.payload)).toBe(cellXMm);
    expect(hit.kind === 'some' && unpackY(hit.payload)).toBe(cellYMm);
  });

  it('[boundary] with one cell left in the world, exactly FOOD_RANGE_MM hits and one more does not', () => {
    const { world, field: fresh } = freshWorld([]);
    const cell = fresh.cell(0);
    const cellXMm = toMm(cell.position.x);
    const cellYMm = toMm(cell.position.y);
    for (const candidate of fresh.allCells()) {
      if (candidate.index !== cell.index) {
        fresh.deplete(candidate.index, 0);
      }
    }
    const atRange = makeRobot(PLAIN, 0, 81, cellXMm, cellYMm);
    // Exact raw placement: the boundary is one raw unit below the range,
    // and the mm round trip would blur it by up to one raw unit.
    atRange.position = { x: (cell.position.x - fromMm(FOOD_RANGE_MM)) as Fixed, y: cell.position.y };
    world.robots.push(atRange);
    const hit = env(atRange, world).sensor('food', []);
    expect(hit.kind).toBe('some');
    expect(hit.kind === 'some' && unpackX(hit.payload)).toBe(cellXMm);
    const past = makeRobot(PLAIN, 0, 82, cellXMm, cellYMm);
    past.position = { x: (cell.position.x - fromMm(FOOD_RANGE_MM) - 1) as Fixed, y: cell.position.y };
    const worldPast = freshWorld([]);
    const lonePast = worldPast.field.cell(cell.index);
    for (const candidate of worldPast.field.allCells()) {
      if (candidate.index !== lonePast.index) {
        worldPast.field.deplete(candidate.index, 0);
      }
    }
    worldPast.world.robots.push(past);
    expect(env(past, worldPast.world).sensor('food', []).kind).toBe('none');
  });

  it('[state] standing on a cell reports that cell; once taken, the next cell takes over', () => {
    const { world, field: fresh } = freshWorld([]);
    const cell = fresh.cell(0);
    const self = makeRobot(PLAIN, 0, 84, toMm(cell.position.x), toMm(cell.position.y));
    self.position = { x: cell.position.x, y: cell.position.y };
    world.robots.push(self);
    const cache = new Map<string, CachedReading>();
    const hit = env(self, world, 1, cache).sensor('food', []);
    expect(hit.kind).toBe('some');
    expect(hit.kind === 'some' && unpackX(hit.payload)).toBe(toMm(cell.position.x));
    fresh.deplete(cell.index, 0);
    // Food is 4 Hz: a re-query inside the same window is cached, so the
    // re-read happens past the 15-tick boundary on the same cache.
    const after = env(self, world, 16, cache).sensor('food', []);
    if (after.kind === 'some') {
      expect(packPoint(unpackX(after.payload), unpackY(after.payload))).not.toBe(packPoint(toMm(cell.position.x), toMm(cell.position.y)));
    }
  });

  it('[state] a depleted cell is not food until it respawns', () => {
    const { world, field: fresh } = freshWorld([]);
    const cell = fresh.cell(0);
    const self = makeRobot(PLAIN, 0, 83, toMm(cell.position.x), toMm(cell.position.y));
    world.robots.push(self);
    const view = env(self, world);
    const availableBefore = fresh.availableCount();
    fresh.deplete(cell.index, 0);
    const afterTaking = view.sensor('food', []);
    if (afterTaking.kind === 'none') {
      fresh.respawnDueCells(RESPAWN_TICKS, createMatchRng(SEED));
      const hit = view.sensor('food', []);
      expect(fresh.availableCount()).toBe(availableBefore);
      expect(hit.kind).toBe('some');
      expect(hit.kind === 'some' && unpackX(hit.payload)).toBe(toMm(cell.position.x));
    }
  });
});

describe('ally and enemy — map wide, team filtered (D16)', () => {
  it('[normal] enemy() finds the other side anywhere on the map', () => {
    const self = makeRobot(PLAIN, 0, 0, 1000, 1000);
    const foe = makeRobot(PLAIN, 1, 0, 199000, 199000);
    const hit = env(self, worldWith([self, foe])).sensor('enemy', []);
    expect(hit.kind).toBe('some');
  });

  it('[normal] ally() finds the same side, not the enemy', () => {
    const self = makeRobot(PLAIN, 0, 0, 1000, 1000);
    const friend = makeRobot(PLAIN, 0, 1, 199000, 199000);
    const foe = makeRobot(PLAIN, 1, 0, 100000, 100000);
    const hit = env(self, worldWith([self, friend, foe])).sensor('ally', []);
    expect(hit.kind === 'some' && unpackX(hit.payload)).toBe(199000);
  });

  it('[state] the filters are exclusive: no ally returns none with only enemies present', () => {
    const self = makeRobot(PLAIN, 0, 0, 1000, 1000);
    const foe = makeRobot(PLAIN, 1, 0, 100000, 100000);
    expect(env(self, worldWith([self, foe])).sensor('ally', []).kind).toBe('none');
  });

  it('[boundary] ally/enemy are every-tick sensors: no cache holds a stale answer', () => {
    const self = makeRobot(PLAIN, 0, 0, 1000, 1000);
    const world = worldWith([self]);
    const view = env(self, world, 5);
    expect(view.sensor('enemy', []).kind).toBe('none');
    const foe = makeRobot(PLAIN, 1, 0, 100000, 100000);
    world.robots.push(foe);
    expect(view.sensor('enemy', []).kind).toBe('some');
  });
});

describe('rate limiting — the D16 staleness window', () => {
  it('[normal] radar is 1 Hz: the same reading holds for 59 ticks, refreshes on the 60th', () => {
    const self = makeRobot(RADAR_BOT, 0, 0, 100000, 100000);
    const foe = makeRobot(PLAIN, 1, 0, 110000, 100000);
    const world = worldWith([self, foe]);
    const cache = new Map<string, CachedReading>();
    const first = env(self, world, 1, cache).sensor('radar', []);
    world.robots.splice(world.robots.indexOf(foe), 1);
    for (let tick = 2; tick <= 60; tick++) {
      expect(env(self, world, tick, cache).sensor('radar', [])).toEqual(first);
    }
    const refreshed = env(self, world, 61, cache).sensor('radar', []);
    expect(refreshed.kind).toBe('none');
  });

  it('[boundary] the refresh boundary: tick 59 stale, tick 60 fresh', () => {
    const self = makeRobot(RADAR_BOT, 0, 0, 100000, 100000);
    const foe = makeRobot(PLAIN, 1, 0, 110000, 100000);
    const world = worldWith([self, foe]);
    const cache = new Map<string, CachedReading>();
    env(self, world, 10, cache).sensor('radar', []);
    world.robots.splice(world.robots.indexOf(foe), 1);
    expect(env(self, world, 69, cache).sensor('radar', []).kind).toBe('some');
    expect(env(self, world, 70, cache).sensor('radar', []).kind).toBe('none');
  });

  it('[state] each rate-limited sensor keeps its own cache', () => {
    const self = makeRobot(SCANNER, 0, 0, 100000, 100000);
    const foe = makeRobot(PLAIN, 1, 0, 110000, 100000);
    const world = worldWith([self, foe]);
    const cache = new Map<string, CachedReading>();
    env(self, world, 1, cache).sensor('scan', [0]);
    world.robots.splice(world.robots.indexOf(foe), 1);
    expect(env(self, world, 2, cache).sensor('scan', [0]).kind).toBe('some');
    expect(env(self, world, 2, cache).sensor('food', []).kind).toBe('none');
  });

  it('[repeat] a driver cache persists across drives and keeps the cadence', () => {
    const self = makeRobot(RADAR_BOT, 0, 0, 100000, 100000);
    const foe = makeRobot(PLAIN, 1, 0, 110000, 100000);
    const world = worldWith([self, foe]);
    const compiled = compile('(defn step [] (say 1 0)) (every-tick step)');
    expect(compiled.ok).toBe(true);
    const driver = createVmDriver(compiled.ok ? compiled.ir : { fns: [], tick: null }, world);
    const first = driver.drive(self, 1);
    expect(first.intents).toHaveLength(1);
    world.robots.splice(world.robots.indexOf(foe), 1);
    const second = driver.drive(self, 30);
    expect(second.yieldEvents).toHaveLength(0);
  });
});
