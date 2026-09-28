import { describe, expect, it } from 'vitest';
import { EVENT_KINDS, type ReplayEvent } from './eventKinds';
import { EventLog } from './eventLog';
import type { MatchRecordView, MatchSinkView, SnapshotRobotView } from './views';

// EventLog — the MatchSink telemetry owes the tick loop (23 § 8.2). The
// six dimensions ride its three methods: recordTick (the 15 record
// mappings, D10's change-only rule), snapshot (the 30-tick correction),
// eventsUpTo (the streamable bucket array of 11 § 3/§ 5).

const DESIGN_NAMES: [readonly string[], readonly string[]] = [['scout'], ['tank']];

const logOf = (): EventLog => new EventLog({ designNames: DESIGN_NAMES });

const move = (robotId: string, vx: number, vy: number): MatchRecordView => ({ kind: 'move', robotId, vx, vy });
const aim = (robotId: string, angle: number): MatchRecordView => ({ kind: 'aim', robotId, angle });

const robotState = (id: string, xMm: number, yMm: number): SnapshotRobotView => ({
  id,
  xMm,
  yMm,
  hp: 15,
  shield: 0,
  energy: 500,
  biomass: 0,
  alive: true,
});

const kindsIn = (events: readonly ReplayEvent[]): string[] => events.map((event) => event.kind);

describe('EventLog — normal cases: every record maps to its wire kind', () => {
  it('[normal] maps the actuator records: move, aim, say, vm_yield, fire', () => {
    const log = logOf();
    log.recordTick(4, [
      move('p1.scout.0', 65536, 0),
      aim('p1.scout.0', 8192),
      { kind: 'say', robotId: 'p1.scout.0', channel: 2, payload: 42 },
      { kind: 'vm_yield', robotId: 'p1.scout.0', cyclesUsed: 1000, reason: 'budget' },
      { kind: 'fire', robotId: 'p1.scout.0', weaponPartId: 'blaster', success: false },
    ]);
    const [empty, , , , tick4] = log.eventsUpTo(4);
    expect(empty).toEqual([]);
    expect(kindsIn(tick4!)).toEqual(['move', 'aim', 'say', 'vm_yield', 'fire']);
    expect(tick4![0]).toEqual({ t: 4, kind: 'move', bot: 'p1.scout.0', vx: 65536, vy: 0 });
    expect(tick4![1]).toEqual({ t: 4, kind: 'aim', bot: 'p1.scout.0', angle: 8192 });
    expect(tick4![2]).toEqual({ t: 4, kind: 'say', bot: 'p1.scout.0', channel: 2, payload: 42 });
    expect(tick4![3]).toEqual({ t: 4, kind: 'vm_yield', bot: 'p1.scout.0', cycles_used: 1000, reason: 'budget' });
    expect(tick4![4]).toEqual({ t: 4, kind: 'fire', bot: 'p1.scout.0', weapon: 'blaster', success: false });
  });

  it('[normal] maps the combat records: shot, damage, death with and without a killer', () => {
    const log = logOf();
    log.recordTick(9, [
      { kind: 'shot', attackerId: 'p1.scout.0', weaponPartId: 'blaster', xMm: 1234, yMm: 5678, targetId: 'p2.tank.0', damage: 12, toShield: 12 },
      { kind: 'damage', throwerId: 'p1.scout.0', xMm: 1234, yMm: 5678, targetId: 'p2.tank.0', amount: 8, toShield: 0, toHull: 8, killed: false },
      { kind: 'death', botId: 'p2.tank.0', cause: 'combat', killerId: 'p1.scout.0', bounty: 0 },
      { kind: 'death', botId: 'p2.tank.1', cause: 'starvation', killerId: null, bounty: 0 },
    ]);
    const [tick9] = log.eventsUpTo(9).slice(-1);
    expect(tick9![0]).toEqual({ t: 9, kind: 'shot', bot: 'p1.scout.0', x: 1234, y: 5678, target: 'p2.tank.0', weapon: 'blaster', damage: 12, to_shield: 12 });
    expect(tick9![1]).toEqual({ t: 9, kind: 'damage', target: 'p2.tank.0', amount: 8, source: 'p1.scout.0', to_shield: 0, x: 1234, y: 5678 });
    expect(tick9![2]).toEqual({ t: 9, kind: 'death', bot: 'p2.tank.0', cause: 'combat', killer: 'p1.scout.0' });
    expect(tick9![3]).toEqual({ t: 9, kind: 'death', bot: 'p2.tank.1', cause: 'starvation' });
  });

  it('[normal] maps the biomass and construction records', () => {
    const log = logOf();
    log.recordTick(2, [
      { kind: 'biomass_spawn', cellIndex: 7, xMm: -2000, yMm: 3000 },
      { kind: 'biomass_taken', robotId: 'p1.scout.0', amount: 1, cellIndex: 7 },
      { kind: 'biomass_depleted', cellIndex: 7, xMm: -2000, yMm: 3000 },
      { kind: 'eat', botId: 'p1.scout.0', consumedBiomass: 10, gainedEnergy: 5, reason: 'player' },
      { kind: 'build_start', robotId: 'p1.scout.0', designIndex: 0, costKg: 5 },
      { kind: 'build_done', robotId: 'p1.scout.0', childId: 'p1.scout.1' },
      { kind: 'birth', robotId: 'p1.scout.1', parentRobotId: 'p1.scout.0', designIndex: 0 },
    ]);
    const [tick2] = log.eventsUpTo(2).slice(-1);
    expect(kindsIn(tick2!)).toEqual(['biomass_spawn', 'biomass_taken', 'biomass_depleted', 'eat', 'build_start', 'build_done', 'birth']);
    expect(tick2![0]).toEqual({ t: 2, kind: 'biomass_spawn', x: -2000, y: 3000 });
    expect(tick2![1]).toEqual({ t: 2, kind: 'biomass_taken', bot: 'p1.scout.0', amount: 1 });
    expect(tick2![2]).toEqual({ t: 2, kind: 'biomass_depleted', x: -2000, y: 3000 });
    expect(tick2![3]).toEqual({ t: 2, kind: 'eat', bot: 'p1.scout.0', amount: 10, reason: 'player' });
    expect(tick2![4]).toEqual({ t: 2, kind: 'build_start', bot: 'p1.scout.0', design: 'scout', cost_kg: 5 });
    expect(tick2![5]).toEqual({ t: 2, kind: 'build_done', bot: 'p1.scout.0', child: 'p1.scout.1' });
    expect(tick2![6]).toEqual({ t: 2, kind: 'birth', bot: 'p1.scout.1', parent: 'p1.scout.0', design: 'scout' });
  });

  it('[normal] resolves design names per side — p2 builds its own list', () => {
    const log = logOf();
    log.recordTick(1, [
      { kind: 'build_start', robotId: 'p2.tank.0', designIndex: 0, costKg: 9 },
      { kind: 'birth', robotId: 'p2.tank.1', parentRobotId: 'p2.tank.0', designIndex: 0 },
    ]);
    const [tick1] = log.eventsUpTo(1).slice(-1);
    expect(tick1![0]).toMatchObject({ design: 'tank' });
    expect(tick1![1]).toMatchObject({ design: 'tank' });
  });

  it('[normal] the snapshot event carries exactly the seven wire fields', () => {
    const log = logOf();
    log.snapshot(1, [robotState('p1.scout.0', 1234, 5678)]);
    const [tick1] = log.eventsUpTo(1).slice(-1);
    expect(tick1).toEqual([
      { t: 1, kind: 'snapshot', robots: [{ id: 'p1.scout.0', x: 1234, y: 5678, hp: 15, shield: 0, energy: 500, biomass: 0 }] },
    ]);
  });
});

describe('EventLog — D10 change-only move and aim', () => {
  it('[boundary] the first emission always passes, then identical values are suppressed', () => {
    const log = logOf();
    log.recordTick(1, [move('p1.scout.0', 65536, 0)]);
    log.recordTick(2, [move('p1.scout.0', 65536, 0)]);
    log.recordTick(3, [move('p1.scout.0', 65536, 0)]);
    log.recordTick(4, [aim('p1.scout.0', 8192)]);
    log.recordTick(5, [aim('p1.scout.0', 8192)]);
    const events = log.eventsUpTo(5);
    expect(kindsIn(events[1]!)).toEqual(['move']);
    expect(events[2]!).toEqual([]);
    expect(events[3]!).toEqual([]);
    expect(kindsIn(events[4]!)).toEqual(['aim']);
    expect(events[5]!).toEqual([]);
  });

  it('[boundary] a changed value re-emits and becomes the new suppression baseline', () => {
    const log = logOf();
    log.recordTick(1, [move('p1.scout.0', 65536, 0)]);
    log.recordTick(2, [move('p1.scout.0', 0, 65536)]);
    log.recordTick(3, [move('p1.scout.0', 0, 65536)]);
    log.recordTick(4, [move('p1.scout.0', 65536, 0)]);
    const events = log.eventsUpTo(4);
    expect(kindsIn(events[1]!)).toEqual(['move']);
    expect(kindsIn(events[2]!)).toEqual(['move']);
    expect(events[3]!).toEqual([]);
    expect(kindsIn(events[4]!)).toEqual(['move']);
  });

  it('[boundary] de-duplication is per robot: one robot’s repeat does not silence another', () => {
    const log = logOf();
    log.recordTick(1, [move('p1.scout.0', 65536, 0)]);
    log.recordTick(2, [move('p2.tank.0', 65536, 0)]);
    log.recordTick(3, [move('p1.scout.0', 65536, 0)]);
    const events = log.eventsUpTo(3);
    expect(kindsIn(events[1]!)).toEqual(['move']);
    expect(kindsIn(events[2]!)).toEqual(['move']);
    expect(events[3]!).toEqual([]);
  });

  it('[boundary] two intents in one tick: the changed value emits once, the repeat is suppressed', () => {
    const log = logOf();
    log.recordTick(1, [move('p1.scout.0', 65536, 0), move('p1.scout.0', 65536, 0)]);
    log.recordTick(2, [aim('p1.scout.0', 0), aim('p1.scout.0', 16384)]);
    const events = log.eventsUpTo(2);
    expect(kindsIn(events[1]!)).toEqual(['move']);
    expect(kindsIn(events[2]!)).toEqual(['aim', 'aim']);
  });
});

describe('EventLog — bucketing, gap-fill and the t field', () => {
  it('[boundary] unseen ticks become empty buckets and t always equals the bucket index', () => {
    const log = logOf();
    log.recordTick(1, [move('p1.scout.0', 65536, 0)]);
    log.recordTick(5, [move('p1.scout.0', 0, 65536)]);
    const events = log.eventsUpTo(7);
    expect(events).toHaveLength(8);
    expect(events[0]).toEqual([]);
    expect(events[2]).toEqual([]);
    expect(events[3]).toEqual([]);
    expect(events[4]).toEqual([]);
    expect(kindsIn(events[5]!)).toEqual(['move']);
    expect(events[6]).toEqual([]);
    for (const [index, bucket] of events.entries()) {
      for (const event of bucket) {
        expect(event.t).toBe(index);
      }
    }
  });

  it('[boundary] a snapshot can arrive for a tick the loop never recorded', () => {
    const log = logOf();
    log.recordTick(1, [move('p1.scout.0', 65536, 0)]);
    log.snapshot(30, [robotState('p1.scout.0', 100, 200)]);
    const events = log.eventsUpTo(30);
    expect(kindsIn(events[30]!)).toEqual(['snapshot']);
  });

  it('[boundary] recordTick and snapshot may share a tick — both land in one bucket', () => {
    const log = logOf();
    log.recordTick(30, [move('p1.scout.0', 65536, 0)]);
    log.snapshot(30, [robotState('p1.scout.0', 100, 200)]);
    const [bucket] = log.eventsUpTo(30).slice(-1);
    expect(kindsIn(bucket!)).toEqual(['move', 'snapshot']);
  });
});

describe('EventLog — invalid input', () => {
  it('[invalid] refuses ticks that are not positive integers', () => {
    const log = logOf();
    expect(() => log.recordTick(0, [])).toThrow(RangeError);
    expect(() => log.recordTick(-3, [])).toThrow(RangeError);
    expect(() => log.recordTick(1.5, [])).toThrow(RangeError);
    expect(() => log.snapshot(0, [])).toThrow(RangeError);
  });

  it('[invalid] refuses out-of-order ticks — the loop calls in order, and the log holds it to that', () => {
    const log = logOf();
    log.recordTick(5, []);
    expect(() => log.recordTick(4, [])).toThrow(RangeError);
    expect(() => log.snapshot(2, [])).toThrow(RangeError);
  });

  it('[invalid] eventsUpTo refuses ticks below what the log saw', () => {
    const log = logOf();
    log.recordTick(10, []);
    expect(() => log.eventsUpTo(9)).toThrow(RangeError);
    expect(() => log.eventsUpTo(0)).toThrow(RangeError);
    expect(() => log.eventsUpTo(2.5)).toThrow(RangeError);
  });

  it('[invalid] a record kind with no wire mapping stops the line', () => {
    const log = logOf();
    const unknown = { kind: 'teleport', robotId: 'p1.scout.0' } as unknown as MatchRecordView;
    expect(() => log.recordTick(1, [unknown])).toThrow(TypeError);
  });

  it('[invalid] a robot id outside the p1/p2 wire format stops the line', () => {
    const log = logOf();
    expect(() => log.recordTick(1, [{ kind: 'build_start', robotId: 'sideA.scout.0', designIndex: 0, costKg: 1 }])).toThrow(TypeError);
  });

  it('[invalid] a designIndex beyond the side’s list stops the line', () => {
    const log = logOf();
    expect(() => log.recordTick(1, [{ kind: 'build_start', robotId: 'p1.scout.0', designIndex: 5, costKg: 1 }])).toThrow(RangeError);
  });
});

describe('EventLog — state changes and repeated calls', () => {
  it('[state] eventsUpTo is a read: the log keeps recording after it', () => {
    const log = logOf();
    log.recordTick(1, [move('p1.scout.0', 65536, 0)]);
    expect(log.eventsUpTo(1)).toHaveLength(2);
    log.recordTick(2, [move('p1.scout.0', 0, 65536)]);
    const events = log.eventsUpTo(2);
    expect(kindsIn(events[1]!)).toEqual(['move']);
    expect(kindsIn(events[2]!)).toEqual(['move']);
  });

  it('[state] mutating the returned buckets cannot corrupt the log', () => {
    const log = logOf();
    log.recordTick(1, [move('p1.scout.0', 65536, 0)]);
    const first = log.eventsUpTo(1);
    first[1]!.push({ t: 1, kind: 'move', bot: 'forged', vx: 1, vy: 1 });
    const second = log.eventsUpTo(1);
    expect(second[1]).toHaveLength(1);
  });

  it('[repeated] the suppression baseline survives across eventsUpTo calls', () => {
    const log = logOf();
    log.recordTick(1, [move('p1.scout.0', 65536, 0)]);
    log.eventsUpTo(1);
    log.recordTick(2, [move('p1.scout.0', 65536, 0)]);
    log.eventsUpTo(2);
    const events = log.eventsUpTo(2);
    let moveEvents = 0;
    for (const bucket of events) {
      moveEvents += bucket.filter((event) => event.kind === 'move').length;
    }
    expect(moveEvents).toBe(1);
  });

  it('[repeated] eventsUpTo called repeatedly is deep-stable', () => {
    const log = logOf();
    log.recordTick(3, [move('p1.scout.0', 1, 2)]);
    log.snapshot(3, [robotState('p1.scout.0', 5, 5)]);
    expect(log.eventsUpTo(4)).toEqual(log.eventsUpTo(4));
    expect(log.eventsUpTo(4)).toEqual(log.eventsUpTo(4));
  });
});

describe('EventLog — determinism and the sink seam', () => {
  it('[determinism] the same record stream produces byte-identical event arrays', () => {
    const feed = (log: EventLog): void => {
      log.snapshot(1, [robotState('p1.scout.0', 0, 0), robotState('p2.tank.0', 1000, 2000)]);
      log.recordTick(2, [move('p1.scout.0', 65536, 0), aim('p1.scout.0', 4096)]);
      log.recordTick(3, [move('p1.scout.0', 65536, 0)]);
      log.recordTick(4, [{ kind: 'fire', robotId: 'p1.scout.0', weaponPartId: 'blaster', success: true }]);
      log.recordTick(4, [aim('p1.scout.0', 4096)]);
      log.snapshot(30, [robotState('p1.scout.0', 9, 9)]);
    };
    const left = logOf();
    const right = logOf();
    feed(left);
    feed(right);
    expect(left.eventsUpTo(30)).toEqual(right.eventsUpTo(30));
    expect(JSON.stringify(left.eventsUpTo(30))).toBe(JSON.stringify(right.eventsUpTo(30)));
  });

  it('[determinism] the log satisfies the structural sink seam the match loop calls', () => {
    const log = logOf();
    const sink: MatchSinkView = log;
    sink.recordTick(1, [move('p1.scout.0', 65536, 0)]);
    sink.snapshot(1, [robotState('p1.scout.0', 0, 0)]);
    expect(kindsIn(log.eventsUpTo(1)[1]!)).toEqual(['move', 'snapshot']);
  });

  it('[state] every wire kind the log emits belongs to the one enum', () => {
    const log = new EventLog({ designNames: [['scout'], ['tank']] });
    log.recordTick(1, [
      move('p1.scout.0', 65536, 0),
      aim('p1.scout.0', 1),
      { kind: 'say', robotId: 'p1.scout.0', channel: 1, payload: 2 },
      { kind: 'vm_yield', robotId: 'p1.scout.0', cyclesUsed: 1, reason: 'trap' },
      { kind: 'fire', robotId: 'p1.scout.0', weaponPartId: 'blaster', success: true },
      { kind: 'shot', attackerId: 'p1.scout.0', weaponPartId: 'blaster', xMm: 1, yMm: 2, targetId: 'p2.tank.0', damage: 3, toShield: 3 },
      { kind: 'damage', throwerId: 'p1.scout.0', xMm: 1, yMm: 2, targetId: 'p2.tank.0', amount: 4, toShield: 0, toHull: 4, killed: true },
      { kind: 'death', botId: 'p2.tank.0', cause: 'combat', killerId: 'p1.scout.0', bounty: 0 },
      { kind: 'eat', botId: 'p1.scout.0', consumedBiomass: 5, gainedEnergy: 2, reason: 'player' },
      { kind: 'biomass_spawn', cellIndex: 0, xMm: 0, yMm: 0 },
      { kind: 'biomass_taken', robotId: 'p1.scout.0', amount: 1, cellIndex: 0 },
      { kind: 'biomass_depleted', cellIndex: 0, xMm: 0, yMm: 0 },
      { kind: 'build_start', robotId: 'p1.scout.0', designIndex: 0, costKg: 1 },
      { kind: 'build_done', robotId: 'p1.scout.0', childId: 'p1.scout.1' },
      { kind: 'birth', robotId: 'p1.scout.1', parentRobotId: 'p1.scout.0', designIndex: 0 },
    ]);
    log.snapshot(1, [robotState('p1.scout.0', 0, 0)]);
    const kinds = new Set(kindsIn(log.eventsUpTo(1).flat()));
    const wireKinds = new Set<string>(Object.values(EVENT_KINDS));
    for (const kind of kinds) {
      expect(wireKinds.has(kind)).toBe(true);
    }
    expect(kinds.size).toBe(16);
  });
});
