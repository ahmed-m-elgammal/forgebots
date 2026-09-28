// The perception bridge — match/'s answer to the VM's VmEnv (23 § 8.1;
// 06-ARCHITECTURE.md § 5.2 makes match/ the one context that may import
// every other, and running the bots' programs is the tick loop's job:
// 10-DETERMINISM.md § 2.1 steps each alive bot inside the loop).
//
// The file owns the sensor vocabulary the DSL surface promises (04 § 4.1,
// 22-DECISIONS.md D16): radar, scan, food, ally, enemy, self.*, time,
// rng-int. When perception/ is scheduled as its own context this logic
// moves there whole — nothing else in match/ touches it.
//
// Sensor determinism (D5, 10-DETERMINISM.md § 4): queries are pure reads
// of the world — nearest-by-exact-squared-distance over robots in spawn
// order, lowest spawn index on ties, inclusive range boundaries decided
// on BigInt squares, never isqrt. No sensor draws from any rng: a bot's
// only randomness is its own rng-int (robot.rng), advanced by nothing
// else (D5's stream separation is also asserted by a match test).
//
// Rate limiting (D16, 20 Phase 07 sub-task 5): radar is 1 Hz, scan and
// food 4 Hz, ally and enemy every tick. A rate-limited sensor recomputes
// when queried on a tick its rate allows and holds its value otherwise,
// so the staleness window is bounded — a 1 Hz radar is up to 59 ticks
// stale, the balance lever the spec names. The cache is per robot and
// per sensor, held by the driver instance.
//
// Option payloads (09 § 2.3): a sensor result is ONE payload number the
// payload-coordinate getters decode. The encoding is match/'s to define:
// x_mm * PAYLOAD_PACK + y_mm. Arena positions are non-negative (clamped
// inside the walls) and fit 19 bits, so the product stays exact in a JS
// number and decode is exact integer division — determinism holds on
// every platform.
//
// Sandbox safety: the VM is trusted to hand verified builtin names, but
// the env never throws — an unknown sensor name, self field or getter
// answers with a valid value (none / 0), because runVmAndCollectActuators
// only catches its own yield signals and match/ relies on that contract.

import { angleDiff, wrapToPi } from '../math/angle';
import { angleOf, distanceSquared, sub, type Vec2 } from '../math/vec2';
import { fromMm, toMm } from '../math/fixed';
import type { BiomassField } from '../arena/biomass';
import type { Arena } from '../arena/geometry';
import type { ActuatorIntent, OptionValue, VmEnv, VmEvent } from '../execution/vm';
import { runVmAndCollectActuators } from '../execution/vm';
import type { IrProgram } from '../program/compiler';
import type { Robot } from '../robot/robot';

// D16's sensor rates in ticks: radar 1 Hz, the 4 Hz sensors 15.
const RADAR_PERIOD_TICKS = 60;
const FAST_SENSOR_PERIOD_TICKS = 15;

// D16's food() radius — no part, always present.
export const FOOD_RANGE_MM = 5000;

// 2^19 > the 200 000 mm arena span, so both coordinates fit and the
// packed payload stays exact (see header).
const PAYLOAD_PACK = 524288;

export function packPoint(xMm: number, yMm: number): number {
  return xMm * PAYLOAD_PACK + yMm;
}

export function unpackX(payload: number): number {
  return (payload / PAYLOAD_PACK) | 0;
}

export function unpackY(payload: number): number {
  return payload % PAYLOAD_PACK;
}

// The world the sensors read. Live references on purpose: positions and
// pools mutate as the tick pipeline runs, and a sensor called during the
// actuators stage must see the world as the VM's tick sees it.
export interface MatchWorld {
  readonly arena: Arena;
  readonly field: BiomassField;
  readonly robots: readonly Robot[];
}

export interface DriveOutcome {
  readonly intents: ActuatorIntent[];
  readonly yieldEvents: readonly VmEvent[];
}

// One robot's brain for one tick. Implementations must be pure reads of
// the world: the tick loop applies what they return, they never apply it
// themselves (the VM's intent-not-motion contract, 23 § 6.3).
export interface RobotDriver {
  drive(robot: Robot, tick: number): DriveOutcome;
}

export interface CachedReading {
  readonly payload: OptionValue;
  readonly refreshedAt: number;
}

const SENSOR_RADAR = 'radar';
const SENSOR_SCAN = 'scan';
const SENSOR_FOOD = 'food';
const SENSOR_ALLY = 'ally';
const SENSOR_ENEMY = 'enemy';

function sensorPeriod(name: string): number | null {
  if (name === SENSOR_RADAR) return RADAR_PERIOD_TICKS;
  if (name === SENSOR_SCAN || name === SENSOR_FOOD) return FAST_SENSOR_PERIOD_TICKS;
  return null;
}

// Nearest living robot matching the side filter, within an exact squared
// range (null range = map-wide). Spawn order + strict less-than make ties
// deterministic: the lowest spawn index wins.
function nearestRobot(
  self: Robot,
  world: MatchWorld,
  sideFilter: (candidate: Robot) => boolean,
  rangeSquared: bigint | null,
): Robot | null {
  let best: Robot | null = null;
  let bestSquared = 0n;
  for (const candidate of world.robots) {
    if (!candidate.alive || candidate.id === self.id || !sideFilter(candidate)) {
      continue;
    }
    const squared = distanceSquared(self.position, candidate.position);
    if (rangeSquared !== null && squared > rangeSquared) {
      continue;
    }
    if (best === null || squared < bestSquared) {
      best = candidate;
      bestSquared = squared;
    }
  }
  return best;
}

function robotPayload(target: Robot): OptionValue {
  return { kind: 'some', payload: packPoint(toMm(target.position.x), toMm(target.position.y)) };
}

function cellPayload(world: MatchWorld, position: Vec2): OptionValue {
  const cell = world.field.nearestAvailable(position, fromMm(FOOD_RANGE_MM));
  if (cell === null) {
    return { kind: 'none' };
  }
  return { kind: 'some', payload: packPoint(toMm(cell.position.x), toMm(cell.position.y)) };
}

// The scan cone: the target's bearing from self, within half the cone of
// the requested scan angle. Both the cone half-width and the shortest
// angular path are inclusive boundaries (T5).
function inScanCone(self: Robot, target: Robot, scanAngle: number, coneBrads: number): boolean {
  const bearing = angleOf(sub(target.position, self.position));
  const halfCone = (coneBrads / 2) | 0;
  const off = angleDiff(wrapToPi(scanAngle), bearing);
  const magnitude = off < 0 ? -off : off;
  return magnitude <= halfCone;
}

// The bot-side env for one drive: self state (04 § 4.1's table, wire
// units at the boundary), time, and the five sensors with rate limiting.
// Exported so the env contract is testable directly — the driver is its
// only production caller.
export function createVmEnv(self: Robot, world: MatchWorld, tick: number, cache: Map<string, CachedReading>): VmEnv {
  const query = (name: string, args: readonly number[]): OptionValue => {
    const period = sensorPeriod(name);
    if (period !== null) {
      const cached = cache.get(name);
      if (cached !== undefined && tick - cached.refreshedAt < period) {
        return cached.payload;
      }
    }
    const payload = computeSensor(self, world, name, args);
    if (period !== null) {
      cache.set(name, { payload, refreshedAt: tick });
    }
    return payload;
  };
  return {
    selfField: (field: string) => {
      switch (field) {
        case 'x':
          return toMm(self.position.x);
        case 'y':
          return toMm(self.position.y);
        case 'hp':
          return self.hullHp + self.shieldHp;
        case 'shield':
          return self.shieldHp;
        case 'energy':
          return (self.energyMilli / 1000) | 0;
        case 'biomass':
          return self.biomassCarried;
        case 'alive':
          return self.alive;
        default:
          // The verifier rejects unknown fields; a hand-built IR gets a
          // harmless answer instead of an escape from the sandbox.
          return 0;
      }
    },
    time: () => tick,
    rngInt: (bound: number) => self.rng.nextInt(bound),
    sensor: query,
    payloadCoordinate: (getter: string, payload: number) => {
      if (getter === 'hit-x' || getter === 'food-x') {
        return unpackX(payload);
      }
      if (getter === 'hit-y' || getter === 'food-y') {
        return unpackY(payload);
      }
      return 0;
    },
  };
}

function computeSensor(self: Robot, world: MatchWorld, name: string, args: readonly number[]): OptionValue {
  switch (name) {
    case SENSOR_RADAR: {
      const rangeMm = self.stats.radarRangeMm;
      if (rangeMm === 0) {
        return { kind: 'none' };
      }
      const range = BigInt(fromMm(rangeMm));
      const target = nearestRobot(self, world, () => true, range * range);
      return target === null ? { kind: 'none' } : robotPayload(target);
    }
    case SENSOR_SCAN: {
      const rangeMm = self.stats.scanRangeMm;
      if (rangeMm === 0) {
        return { kind: 'none' };
      }
      const range = BigInt(fromMm(rangeMm));
      const scanAngle = args[0] ?? 0;
      const target = nearestRobot(self, world, (candidate) => inScanCone(self, candidate, scanAngle, self.stats.scanConeBrads), range * range);
      return target === null ? { kind: 'none' } : robotPayload(target);
    }
    case SENSOR_FOOD:
      return cellPayload(world, self.position);
    case SENSOR_ALLY: {
      const target = nearestRobot(self, world, (candidate) => candidate.side === self.side, null);
      return target === null ? { kind: 'none' } : robotPayload(target);
    }
    case SENSOR_ENEMY: {
      const target = nearestRobot(self, world, (candidate) => candidate.side !== self.side, null);
      return target === null ? { kind: 'none' } : robotPayload(target);
    }
    default:
      // Sandbox answer for a hand-built IR calling an unknown sensor.
      return { kind: 'none' };
  }
}

// The VM-backed driver: steps the robot's compiled program through
// runVmAndCollectActuators with a fresh env per tick and a persistent
// sensor cache. The ir is the design's program; a design whose compiled
// tick is null (no every-tick) yields a robot that does nothing.
export function createVmDriver(ir: IrProgram, world: MatchWorld): RobotDriver {
  const cache = new Map<string, CachedReading>();
  return {
    drive(robot: Robot, tick: number): DriveOutcome {
      const step = runVmAndCollectActuators(createVmEnv(robot, world, tick, cache), ir);
      return { intents: step.actuators, yieldEvents: step.events };
    },
  };
}
