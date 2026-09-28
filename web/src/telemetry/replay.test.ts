import { describe, expect, it } from 'vitest';
import { canonicalJson } from './canonical';
import { EVENT_KINDS } from './eventKinds';
import { EventLog } from './eventLog';
import { outputSha256 } from './outputSha256';
import {
  buildReplayDocument,
  REPLAY_FORMAT_VERSION,
  SIM_VERSION,
  type ReplayDesignPayload,
  type ReplayDocument,
  type ReplayPlayerPayload,
} from './replay';
import type { MatchResultView, SnapshotRobotView } from './views';

// buildReplayDocument — the 11 § 2 top-level shape plus the hash rule of
// § 2.1: output_sha256 over seed ‖ balance ‖ canonical(final_state) ‖
// canonical(events), with the embedded copy excluded from its own input
// because the builder hashes the parts before the document exists.

const BALANCE_SHA = 'ab'.repeat(32);

const designOf = (name: string): ReplayDesignPayload => ({ name, parts: ['mk1-engine', 'blaster'], code: { fns: [], tick: null } });

const playerOf = (overrides: Partial<ReplayPlayerPayload> = {}): ReplayPlayerPayload => ({
  userId: '11111111-1111-1111-1111-111111111111',
  handle: 'forgewright',
  botId: '22222222-2222-2222-2222-222222222222',
  botSnapshot: { name: 'Slasher', designs: [designOf('scout')] },
  eloBefore: 1000,
  eloAfter: 1012,
  isGhost: false,
  ...overrides,
});

const finalRobot = (id: string, xMm: number, alive: boolean): SnapshotRobotView => ({
  id,
  xMm,
  yMm: 42,
  hp: alive ? 15 : 0,
  shield: 0,
  energy: 500,
  biomass: 3,
  alive,
});

const resultOf = (overrides: Partial<MatchResultView> = {}): MatchResultView => ({
  winner: 'p1',
  reason: 'elimination',
  durationTicks: 45,
  finalRobots: [finalRobot('p1.scout.0', 1234, true), finalRobot('p2.tank.0', 9876, false)],
  availableCellIndices: [2, 5, 9],
  ...overrides,
});

const documentOf = (overrides: Partial<Parameters<typeof buildReplayDocument>[0]> = {}) => {
  const log = new EventLog({ designNames: [['scout'], ['tank']] });
  log.recordTick(1, [{ kind: 'move', robotId: 'p1.scout.0', vx: 65536, vy: 0 }]);
  log.snapshot(1, [finalRobot('p1.scout.0', 1000, true)]);
  log.recordTick(45, [{ kind: 'death', botId: 'p2.tank.0', cause: 'combat', killerId: 'p1.scout.0', bounty: 0 }]);
  return buildReplayDocument({
    matchId: '33333333-3333-3333-3333-333333333333',
    seed: 42n,
    balanceVersionId: 7,
    balanceSha256: BALANCE_SHA,
    durationMs: 18750,
    players: [playerOf(), playerOf({ handle: 'gearsmith', botSnapshot: { name: 'Wall', designs: [designOf('tank')] } })],
    eventLog: log,
    result: resultOf(),
    ...overrides,
  });
};

describe('buildReplayDocument — normal cases', () => {
  it('[normal] assembles the full 11 § 2 top-level shape', () => {
    const document = documentOf();
    expect(document.version).toBe(REPLAY_FORMAT_VERSION);
    expect(REPLAY_FORMAT_VERSION).toBe(1);
    expect(document.sim_version).toBe(SIM_VERSION);
    expect(document.match_id).toBe('33333333-3333-3333-3333-333333333333');
    expect(document.seed).toBe('0x2a');
    expect(document.balance_version_id).toBe(7);
    expect(document.balance_sha256).toBe(BALANCE_SHA);
    expect(document.tick_count).toBe(45);
    expect(document.duration_ms).toBe(18750);
    expect(document.winner).toBe('p1');
    expect(document.reason).toBe('elimination');
    expect(document.players).toHaveLength(2);
  });

  it('[normal] players map to the wire with their exact designs', () => {
    const document = documentOf();
    expect(document.players[0]).toEqual({
      user_id: '11111111-1111-1111-1111-111111111111',
      handle: 'forgewright',
      bot_id: '22222222-2222-2222-2222-222222222222',
      bot_snapshot: { name: 'Slasher', designs: [designOf('scout')] },
      elo_before: 1000,
      elo_after: 1012,
      is_ghost: false,
    });
  });

  it('[normal] match_end is stamped once, at the last tick, with the result', () => {
    const document = documentOf();
    const endEvents = document.events[45]!.filter((event) => event.kind === EVENT_KINDS.matchEnd);
    expect(endEvents).toEqual([{ t: 45, kind: 'match_end', winner: 'p1', reason: 'elimination' }]);
    const everywhereElse = document.events.flatMap((bucket, index) => (index === 45 ? [] : bucket));
    expect(everywhereElse.filter((event) => event.kind === EVENT_KINDS.matchEnd)).toEqual([]);
  });

  it('[normal] the final state is canonical: robots with alive plus the standing cells', () => {
    const document = documentOf();
    expect(document.final_state.robots).toEqual([
      { id: 'p1.scout.0', x: 1234, y: 42, hp: 15, shield: 0, energy: 500, biomass: 3, alive: true },
      { id: 'p2.tank.0', x: 9876, y: 42, hp: 0, shield: 0, energy: 500, biomass: 3, alive: false },
    ]);
    expect(document.final_state.available_cell_indices).toEqual([2, 5, 9]);
  });

  it('[normal] the embedded hash is exactly the parts-hash — the self-exclusion rule of 11 § 2.1', () => {
    const document = documentOf();
    const { output_sha256, ...documentWithoutHash } = document;
    const recomputed = outputSha256({
      seed: 42n,
      balanceSha256: BALANCE_SHA,
      finalState: documentWithoutHash.final_state,
      events: documentWithoutHash.events,
    });
    expect(output_sha256).toBe(recomputed);
    // And the embedded copy is the only field the hash skips.
    expect(canonicalJson({ ...documentWithoutHash, output_sha256: 'tampered' })).not.toBe(canonicalJson(documentWithoutHash));
  });
});

describe('buildReplayDocument — boundary cases', () => {
  it('[boundary] a match that ends on tick 1: two buckets, match_end in the last', () => {
    const log = new EventLog({ designNames: [['scout'], ['tank']] });
    log.recordTick(1, [{ kind: 'move', robotId: 'p1.scout.0', vx: 65536, vy: 0 }]);
    log.snapshot(1, [finalRobot('p1.scout.0', 1000, true)]);
    const document = buildReplayDocument({
      matchId: 'm',
      seed: 1n,
      balanceVersionId: 0,
      balanceSha256: BALANCE_SHA,
      durationMs: 0,
      players: [playerOf(), playerOf()],
      eventLog: log,
      result: resultOf({ durationTicks: 1 }),
    });
    expect(document.events).toHaveLength(2);
    expect(document.tick_count).toBe(1);
    expect(document.events[1]!.some((event) => event.kind === EVENT_KINDS.matchEnd)).toBe(true);
  });

  it('[boundary] a match capped with an empty final tick still gets its match_end bucket', () => {
    const log = new EventLog({ designNames: [['scout'], ['tank']] });
    log.recordTick(1, [{ kind: 'move', robotId: 'p1.scout.0', vx: 65536, vy: 0 }]);
    log.snapshot(60, [finalRobot('p1.scout.0', 0, true)]);
    const document = buildReplayDocument({
      matchId: 'm',
      seed: 1n,
      balanceVersionId: 0,
      balanceSha256: BALANCE_SHA,
      durationMs: 0,
      players: [playerOf(), playerOf()],
      eventLog: log,
      result: resultOf({ winner: 'draw', reason: 'draw_tie', durationTicks: 90, finalRobots: [finalRobot('p1.scout.0', 0, true)] }),
    });
    expect(document.tick_count).toBe(90);
    // Ticks 61..89 were idle; 90 closes the match with match_end alone.
    expect(document.events[75]).toEqual([]);
    expect(document.events[90]).toEqual([{ t: 90, kind: 'match_end', winner: 'draw', reason: 'draw_tie' }]);
    expect(document.seed).toBe('0x1');
  });

  it('[boundary] a zero seed and the uint64-maximum seed render as wire hex', () => {
    expect(documentOf({ seed: 0n }).seed).toBe('0x0');
    expect(documentOf({ seed: (1n << 64n) - 1n }).seed).toBe('0x' + 'f'.repeat(16));
  });
});

describe('buildReplayDocument — invalid input', () => {
  it('[invalid] refuses an empty match id', () => {
    expect(() => documentOf({ matchId: '' })).toThrow(TypeError);
  });

  it('[invalid] refuses negative or fractional metadata', () => {
    expect(() => documentOf({ balanceVersionId: -1 })).toThrow(RangeError);
    expect(() => documentOf({ durationMs: -1 })).toThrow(RangeError);
    expect(() => documentOf({ durationMs: 12.5 })).toThrow(RangeError);
  });

  it('[invalid] refuses a malformed balance hash and a short match', () => {
    expect(() => documentOf({ balanceSha256: 'zz'.repeat(32) })).toThrow(TypeError);
    expect(() => documentOf({ result: resultOf({ durationTicks: 0 }) })).toThrow(RangeError);
  });

  it('[invalid] refuses a player with an empty handle, a nameless bot or no designs', () => {
    expect(() => documentOf({ players: [playerOf({ handle: '' }), playerOf()] })).toThrow(TypeError);
    expect(() => documentOf({ players: [playerOf({ botSnapshot: { name: '', designs: [designOf('scout')] } }), playerOf()] })).toThrow(TypeError);
    expect(() => documentOf({ players: [playerOf({ botSnapshot: { name: 'X', designs: [] } }), playerOf()] })).toThrow(TypeError);
  });

  it('[invalid] refuses a player list that is not exactly two sides', () => {
    const onePlayer = [playerOf()] as unknown as [ReplayPlayerPayload, ReplayPlayerPayload];
    expect(() => documentOf({ players: onePlayer })).toThrow(TypeError);
  });

  it('[invalid] refuses a design whose parts field is not a list at runtime', () => {
    const forged = playerOf({
      botSnapshot: { name: 'Slasher', designs: [{ name: 'scout', parts: 'mk1-engine' as unknown as readonly string[], code: null }] },
    });
    expect(() => documentOf({ players: [forged, playerOf()] })).toThrow(TypeError);
  });

  it('[invalid] refuses a negative seed', () => {
    expect(() => documentOf({ seed: -1n })).toThrow(RangeError);
  });

  it('[invalid] refuses an event log that saw more ticks than the result claims', () => {
    const longLog = new EventLog({ designNames: [['scout'], ['tank']] });
    longLog.recordTick(50, []);
    expect(() => buildReplayDocument({
      matchId: 'm',
      seed: 1n,
      balanceVersionId: 0,
      balanceSha256: BALANCE_SHA,
      durationMs: 0,
      players: [playerOf(), playerOf()],
      eventLog: longLog,
      result: resultOf({ durationTicks: 45 }),
    })).toThrow(RangeError);
  });
});

describe('buildReplayDocument — state changes and repeated calls', () => {
  it('[state] building does not consume the log — a second build is identical', () => {
    const log = new EventLog({ designNames: [['scout'], ['tank']] });
    log.recordTick(1, [{ kind: 'move', robotId: 'p1.scout.0', vx: 65536, vy: 0 }]);
    log.snapshot(1, [finalRobot('p1.scout.0', 0, true)]);
    log.recordTick(45, [{ kind: 'death', botId: 'p2.tank.0', cause: 'combat', killerId: 'p1.scout.0', bounty: 0 }]);
    const input = {
      matchId: 'm',
      seed: 42n,
      balanceVersionId: 7,
      balanceSha256: BALANCE_SHA,
      durationMs: 100,
      players: [playerOf(), playerOf()] as [ReplayPlayerPayload, ReplayPlayerPayload],
      eventLog: log,
      result: resultOf(),
    };
    const first = buildReplayDocument(input);
    const second = buildReplayDocument(input);
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    // The log's own view stays clean: match_end was stamped into a copy.
    expect(log.eventsUpTo(45)[45]!.some((event) => event.kind === EVENT_KINDS.matchEnd)).toBe(false);
  });
});

describe('buildReplayDocument — determinism', () => {
  it('[determinism] two identical matches produce byte-identical documents, hash included', () => {
    const run = (): ReplayDocument => {
      const log = new EventLog({ designNames: [['scout'], ['tank']] });
      log.recordTick(1, [{ kind: 'move', robotId: 'p1.scout.0', vx: 65536, vy: 0 }]);
      log.recordTick(2, [{ kind: 'fire', robotId: 'p1.scout.0', weaponPartId: 'blaster', success: true }]);
      log.recordTick(2, [{ kind: 'shot', attackerId: 'p1.scout.0', weaponPartId: 'blaster', xMm: 1, yMm: 2, targetId: 'p2.tank.0', damage: 12, toShield: 12 }]);
      log.snapshot(30, [finalRobot('p1.scout.0', 5000, true)]);
      log.recordTick(31, [{ kind: 'death', botId: 'p2.tank.0', cause: 'combat', killerId: 'p1.scout.0', bounty: 0 }]);
      return buildReplayDocument({
        matchId: 'same-id',
        seed: 4242n,
        balanceVersionId: 3,
        balanceSha256: BALANCE_SHA,
        durationMs: 750,
        players: [playerOf(), playerOf()],
        eventLog: log,
        result: resultOf({ durationTicks: 31 }),
      });
    };
    const left = run();
    const right = run();
    expect(JSON.stringify(left)).toBe(JSON.stringify(right));
    expect(left.output_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('[determinism] a different seed changes the hash but the shape stands', () => {
    const left = documentOf({ seed: 1n });
    const right = documentOf({ seed: 2n });
    expect(left.output_sha256).not.toBe(right.output_sha256);
    expect(left.seed).toBe('0x1');
  });
});
