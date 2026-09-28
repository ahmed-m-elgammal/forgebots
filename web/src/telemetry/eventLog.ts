// The EventLog — telemetry/'s MatchSink (23-WEB-CLIENT-PLAN.md § 8.2).
// The tick loop hands it raw records; it produces the replay's `events`
// array: one bucket per tick, every event stamped with its `"t"`
// (11-REPLAY-FORMAT.md § 3), wire kinds from the one enum, and — the
// rule that makes the 150 KB budget reachable (D10) — `move` and `aim`
// emitted ONLY when the value differs from the last value emitted for
// that robot. The viewer holds the last value forward; the 30-tick
// snapshot is the periodic correction.
//
// Bucketing details the loop's call pattern implies and this class
// makes explicit (G31):
// - recordTick/snapshot arrive in tick order and may share a tick (the
//   loop records a tick's events before its snapshot). Ticks the loop
//   never mentions — idle ticks — are empty buckets, gap-filled on
//   demand. Tick 0 is empty by construction: matches are 1-based.
// - eventsUpTo(finalTick) is a pure read: it pads to finalTick, hands
//   out fresh arrays, and leaves the log free to keep recording.
// - The sink interface is satisfied structurally (views.ts); match/ is
//   never imported (06 § 5.2).

import { EVENT_KINDS, type ReplayEvent, type ReplayRobotState } from './eventKinds';
import type { MatchRecordView, SnapshotRobotView } from './views';

export interface EventLogConfig {
  // Design names per side, side-indexed (0 = p1). build_start and birth
  // records carry a designIndex; the wire event carries the design NAME
  // (11 § 4), which only the caller's side lists can supply.
  readonly designNames: readonly [readonly string[], readonly string[]];
}

// Robot ids are spec-frozen (11 § 3: p1.<design>.<index>); only the side
// prefix is parsed here — design names come from the config, never from
// splitting the id (a design name may itself contain dots).
const SIDE_PREFIX_PATTERN = /^p([12])\./;
const FIRST_TICK = 1;

export class EventLog {
  private readonly buckets = new Map<number, ReplayEvent[]>();
  private lastSeenTick = 0;
  private readonly lastMoveEmitted = new Map<string, { readonly vx: number; readonly vy: number }>();
  private readonly lastAimEmitted = new Map<string, number>();

  constructor(private readonly config: EventLogConfig) {}

  recordTick(tick: number, records: readonly MatchRecordView[]): void {
    this.assertTickArrivedInOrder(tick);
    const bucket = this.bucketFor(tick);
    for (const record of records) {
      for (const event of this.mapRecord(record, tick)) {
        bucket.push(event);
      }
    }
  }

  snapshot(tick: number, robots: readonly SnapshotRobotView[]): void {
    this.assertTickArrivedInOrder(tick);
    const bucket = this.bucketFor(tick);
    bucket.push({ t: tick, kind: EVENT_KINDS.snapshot, robots: robots.map(toWireRobot) });
  }

  // Buckets 0..finalTick, gap-filled, fresh arrays. finalTick below a
  // tick the log actually saw is a caller bug: the document would claim
  // fewer ticks than the engine ran.
  eventsUpTo(finalTick: number): ReplayEvent[][] {
    if (!Number.isInteger(finalTick) || finalTick < FIRST_TICK) {
      throw new RangeError(`finalTick must be a positive integer, got ${finalTick}`);
    }
    if (finalTick < this.lastSeenTick) {
      throw new RangeError(`finalTick ${finalTick} is below the last recorded tick ${this.lastSeenTick}`);
    }
    const events: ReplayEvent[][] = [];
    for (let tick = 0; tick <= finalTick; tick++) {
      const bucket = this.buckets.get(tick);
      events.push(bucket ? [...bucket] : []);
    }
    return events;
  }

  private assertTickArrivedInOrder(tick: number): void {
    if (!Number.isInteger(tick) || tick < FIRST_TICK) {
      throw new RangeError(`tick must be a positive integer, got ${tick}`);
    }
    if (tick < this.lastSeenTick) {
      throw new RangeError(`ticks must arrive in order, got ${tick} after ${this.lastSeenTick}`);
    }
    this.lastSeenTick = tick;
  }

  private bucketFor(tick: number): ReplayEvent[] {
    const existing = this.buckets.get(tick);
    if (existing !== undefined) {
      return existing;
    }
    const created: ReplayEvent[] = [];
    this.buckets.set(tick, created);
    return created;
  }

  private mapRecord(record: MatchRecordView, tick: number): ReplayEvent[] {
    switch (record.kind) {
      case 'move':
        return this.mapMove(record.robotId, record.vx, record.vy, tick);
      case 'aim':
        return this.mapAim(record.robotId, record.angle, tick);
      case 'say':
        return [{ t: tick, kind: EVENT_KINDS.say, bot: record.robotId, channel: record.channel, payload: record.payload }];
      case 'vm_yield':
        return [{ t: tick, kind: EVENT_KINDS.vmYield, bot: record.robotId, cycles_used: record.cyclesUsed, reason: record.reason }];
      case 'fire':
        return [{ t: tick, kind: EVENT_KINDS.fire, bot: record.robotId, weapon: record.weaponPartId, success: record.success }];
      case 'shot':
        return [{
          t: tick,
          kind: EVENT_KINDS.shot,
          bot: record.attackerId,
          x: record.xMm,
          y: record.yMm,
          target: record.targetId,
          weapon: record.weaponPartId,
          damage: record.damage,
          to_shield: record.toShield,
        }];
      case 'damage':
        return [{
          t: tick,
          kind: EVENT_KINDS.damage,
          target: record.targetId,
          amount: record.amount,
          source: record.throwerId,
          to_shield: record.toShield,
          x: record.xMm,
          y: record.yMm,
        }];
      case 'death':
        return mapDeath(record.botId, record.cause, record.killerId, tick);
      case 'eat':
        return [{ t: tick, kind: EVENT_KINDS.eat, bot: record.botId, amount: record.consumedBiomass, reason: record.reason }];
      case 'biomass_taken':
        return [{ t: tick, kind: EVENT_KINDS.biomassTaken, bot: record.robotId, amount: record.amount }];
      case 'biomass_depleted':
        return [{ t: tick, kind: EVENT_KINDS.biomassDepleted, x: record.xMm, y: record.yMm }];
      case 'biomass_spawn':
        return [{ t: tick, kind: EVENT_KINDS.biomassSpawn, x: record.xMm, y: record.yMm }];
      case 'build_start':
        return [{ t: tick, kind: EVENT_KINDS.buildStart, bot: record.robotId, design: this.designName(record.robotId, record.designIndex), cost_kg: record.costKg }];
      case 'build_done':
        return [{ t: tick, kind: EVENT_KINDS.buildDone, bot: record.robotId, child: record.childId }];
      case 'birth':
        return [{ t: tick, kind: EVENT_KINDS.birth, bot: record.robotId, parent: record.parentRobotId, design: this.designName(record.parentRobotId, record.designIndex) }];
      default: {
        const unmapped: never = record;
        throw new TypeError(`no wire mapping for record kind ${(unmapped as { kind: string }).kind}`);
      }
    }
  }

  // D10: suppress a repeat of the robot's last emitted throttle. The
  // first value a robot emits always passes — the viewer has nothing to
  // hold forward before it.
  private mapMove(robotId: string, vx: number, vy: number, tick: number): ReplayEvent[] {
    const previous = this.lastMoveEmitted.get(robotId);
    if (previous !== undefined && previous.vx === vx && previous.vy === vy) {
      return [];
    }
    this.lastMoveEmitted.set(robotId, { vx, vy });
    return [{ t: tick, kind: EVENT_KINDS.move, bot: robotId, vx, vy }];
  }

  private mapAim(robotId: string, angle: number, tick: number): ReplayEvent[] {
    const previous = this.lastAimEmitted.get(robotId);
    if (previous !== undefined && previous === angle) {
      return [];
    }
    this.lastAimEmitted.set(robotId, angle);
    return [{ t: tick, kind: EVENT_KINDS.aim, bot: robotId, angle }];
  }

  // The side prefix tells the mapping which side's design list to read;
  // the design NAME comes from the config. A designIndex beyond the
  // side's list is a producer bug and stops the line here.
  private designName(robotId: string, designIndex: number): string {
    const side = sideIndexOf(robotId);
    const name = this.config.designNames[side]?.[designIndex];
    if (name === undefined) {
      throw new RangeError(`side ${side} has no design at index ${designIndex} (robot ${robotId})`);
    }
    return name;
  }
}

function mapDeath(botId: string, cause: string, killerId: string | null, tick: number): ReplayEvent[] {
  if (killerId === null) {
    return [{ t: tick, kind: EVENT_KINDS.death, bot: botId, cause }];
  }
  return [{ t: tick, kind: EVENT_KINDS.death, bot: botId, cause, killer: killerId }];
}

function sideIndexOf(robotId: string): number {
  const match = SIDE_PREFIX_PATTERN.exec(robotId);
  if (match === null) {
    throw new TypeError(`robot id is not a wire id (p1.<design>.<index>): ${robotId}`);
  }
  return Number(match[1]) - 1;
}

// 11 § 4's snapshot entry list — exactly these seven fields, positions
// in millimetres.
function toWireRobot(robot: SnapshotRobotView): ReplayRobotState {
  return {
    id: robot.id,
    x: robot.xMm,
    y: robot.yMm,
    hp: robot.hp,
    shield: robot.shield,
    energy: robot.energy,
    biomass: robot.biomass,
  };
}
