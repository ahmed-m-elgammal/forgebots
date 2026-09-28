import { describe, expect, it } from 'vitest';
import { runMatch, type MatchSideInput } from '../match';
import { compile } from '../program';
import { PART_ID } from '../robot';
import type { Design } from '../robot/design';
import { canonicalJson, type JsonValue } from './canonical';
import { EVENT_KINDS } from './eventKinds';
import { FX_TABLE } from './fxTable';
import { EventLog } from './eventLog';
import { outputSha256 } from './outputSha256';
import { buildReplayDocument, type ReplayDocument } from './replay';

// The whole pipeline through public surfaces: runMatch's sink seam takes
// an EventLog (structurally — neither context imports the other, 06 §
// 5.2), and the document that comes out the far side is the 11 § 2
// contract. These matches are the integration tier (AGENTS.md § 4).

const SEED = 42n;

const compileOk = (src: string) => {
  const result = compile(src);
  if (!result.ok) {
    throw new Error(`fixture program failed to compile: ${JSON.stringify(result.errors)}`);
  }
  return result.ir;
};

const designOf = (name: string, parts: readonly string[]): Design => ({ name, chassis: { parts: parts as Design['chassis']['parts'] } });

const MOVER: Design = designOf('mover', [PART_ID.mk1Engine, PART_ID.solarPanel]);
const DRIFTER: Design = designOf('drifter', [PART_ID.mk1Engine, PART_ID.solarPanel]);

// Re-issues the same throttle every tick — the exact bot D10 says must
// emit almost nothing.
const SPAM_SIDE: MatchSideInput = [
  { design: MOVER, program: compileOk('(defn step [] (move 65536 0)) (every-tick step)'), robotCount: 1 },
];
const IDLE_SIDE: MatchSideInput = [
  { design: DRIFTER, program: compileOk('(defn unused [] 0)'), robotCount: 1 },
];

const designNamesOf = (sides: readonly [MatchSideInput, MatchSideInput]): [readonly string[], readonly string[]] => [
  sides[0].map((entry) => entry.design.name),
  sides[1].map((entry) => entry.design.name),
];

// The wire's design payload is JSON; the IR is JSON-safe but not typed
// as JsonValue (interface fields have no implicit index signature), so
// the test crosses the wire exactly as the server would: through JSON.
const asJson = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue;

const playerMeta = (handle: string, designs: readonly Design[]) => ({
  userId: '11111111-1111-1111-1111-111111111111',
  handle,
  botId: '22222222-2222-2222-2222-222222222222',
  botSnapshot: {
    name: handle,
    designs: designs.map((design) => ({ name: design.name, parts: [...design.chassis.parts], code: asJson(compileOk('(defn unused [] 0)')) })),
  },
  eloBefore: 1000,
  eloAfter: 1000,
  isGhost: false,
});

const replayOf = (sides: readonly [MatchSideInput, MatchSideInput], seed: bigint): { document: ReplayDocument; matchTicks: number } => {
  const log = new EventLog({ designNames: designNamesOf(sides) });
  const result = runMatch(sides, { seed }, log);
  const document = buildReplayDocument({
    matchId: '44444444-4444-4444-4444-444444444444',
    seed,
    balanceVersionId: 1,
    balanceSha256: 'cd'.repeat(32),
    durationMs: 0,
    players: [playerMeta('forgewright', sides[0].map((entry) => entry.design)), playerMeta('gearsmith', sides[1].map((entry) => entry.design))],
    eventLog: log,
    result,
  });
  return { document, matchTicks: result.durationTicks };
};

describe('match → telemetry pipeline', () => {
  it('[normal] every emitted event carries a wire kind from the one enum, and t equals its bucket', () => {
    const { document } = replayOf([SPAM_SIDE, IDLE_SIDE], SEED);
    expect(document.events).toHaveLength(document.tick_count + 1);
    document.events.forEach((bucket, index) => {
      for (const event of bucket) {
        expect(Object.values(EVENT_KINDS)).toContain(event.kind);
        expect(event.t).toBe(index);
      }
    });
  });

  it('[normal] the snapshot cadence survives the sink: tick 1, then every 30th tick', () => {
    const { document } = replayOf([SPAM_SIDE, IDLE_SIDE], SEED);
    const snapshotTicks = document.events
      .map((bucket, index) => (bucket.some((event) => event.kind === EVENT_KINDS.snapshot) ? index : -1))
      .filter((tick) => tick >= 0);
    expect(snapshotTicks[0]).toBe(1);
    for (const tick of snapshotTicks) {
      expect(tick === 1 || tick % 30 === 0).toBe(true);
    }
    expect(snapshotTicks).toContain(30);
  });

  it('[boundary] D10: a bot re-issuing (move 65536 0) every tick emits exactly one move event', () => {
    const sides: [MatchSideInput, MatchSideInput] = [SPAM_SIDE, IDLE_SIDE];
    const log = new EventLog({ designNames: designNamesOf(sides) });
    const result = runMatch(sides, { seed: SEED, tickLimit: 300 }, log);
    const document = buildReplayDocument({
      matchId: 'm',
      seed: SEED,
      balanceVersionId: 1,
      balanceSha256: 'cd'.repeat(32),
      durationMs: 0,
      players: [playerMeta('forgewright', [MOVER]), playerMeta('gearsmith', [DRIFTER])],
      eventLog: log,
      result,
    });
    const moveRecords = result.ticks.flatMap((tick) => tick.records).filter((record) => record.kind === 'move' && record.robotId === 'p1.mover.0');
    expect(moveRecords.length).toBe(300);
    const moveEvents = document.events.flat().filter((event) => event.kind === EVENT_KINDS.move && event.bot === 'p1.mover.0');
    expect(moveEvents).toEqual([{ t: 1, kind: 'move', bot: 'p1.mover.0', vx: 65536, vy: 0 }]);
  });

  it('[boundary] an idle match runs to the cap: draw_tie, gap-filled final bucket, no unintentional yields', () => {
    const { document } = replayOf([IDLE_SIDE, IDLE_SIDE], SEED);
    expect(document.winner).toBe('draw');
    expect(document.reason).toBe('draw_tie');
    expect(document.tick_count).toBe(1500);
    // 1500 is a snapshot tick, so the closing bucket is snapshot then match_end.
    expect(document.events[1500]!.at(-1)).toEqual({ t: 1500, kind: 'match_end', winner: 'draw', reason: 'draw_tie' });
    expect(document.events[900]!.some((event) => event.kind === EVENT_KINDS.snapshot)).toBe(true);
    const yields = document.events.flat().filter((event) => event.kind === EVENT_KINDS.vmYield);
    expect(yields).toEqual([]);
  });

  it('[state] building the document left the log pure, and the hash recomputes from the document itself', () => {
    const sides: [MatchSideInput, MatchSideInput] = [SPAM_SIDE, IDLE_SIDE];
    const log = new EventLog({ designNames: designNamesOf(sides) });
    const result = runMatch(sides, { seed: SEED }, log);
    const document = buildReplayDocument({
      matchId: 'm',
      seed: SEED,
      balanceVersionId: 1,
      balanceSha256: 'cd'.repeat(32),
      durationMs: 0,
      players: [playerMeta('forgewright', [MOVER]), playerMeta('gearsmith', [DRIFTER])],
      eventLog: log,
      result,
    });
    const logView = JSON.stringify(log.eventsUpTo(result.durationTicks));
    const rebuilt = buildReplayDocument({
      matchId: 'm',
      seed: SEED,
      balanceVersionId: 1,
      balanceSha256: 'cd'.repeat(32),
      durationMs: 0,
      players: [playerMeta('forgewright', [MOVER]), playerMeta('gearsmith', [DRIFTER])] as never,
      eventLog: log,
      result,
    });
    expect(JSON.stringify(rebuilt)).toBe(JSON.stringify(document));
    const { output_sha256 } = document;
    const recomputed = outputSha256({
      seed: SEED,
      balanceSha256: 'cd'.repeat(32),
      finalState: JSON.parse(canonicalJson(document.final_state)),
      events: JSON.parse(canonicalJson(document.events)),
    });
    expect(output_sha256).toBe(recomputed);
    expect(logView).toBe(JSON.stringify(log.eventsUpTo(result.durationTicks)));
  });

  it('[repeated][determinism] two runs of the same seed produce byte-identical replays', () => {
    const left = replayOf([SPAM_SIDE, IDLE_SIDE], SEED).document;
    const right = replayOf([SPAM_SIDE, IDLE_SIDE], SEED).document;
    expect(JSON.stringify(left)).toBe(JSON.stringify(right));
    expect(left.output_sha256).toBe(right.output_sha256);
  });

  it('[determinism] a different seed produces a different hash over the same-shaped document', () => {
    const left = replayOf([SPAM_SIDE, IDLE_SIDE], 1n).document;
    const right = replayOf([SPAM_SIDE, IDLE_SIDE], 2n).document;
    expect(left.output_sha256).not.toBe(right.output_sha256);
  });

  it('[normal] every kind the document uses has an fx entry — the 11 § 4 contract on live data', () => {
    const { document } = replayOf([SPAM_SIDE, IDLE_SIDE], SEED);
    const kinds = new Set(document.events.flat().map((event) => event.kind));
    for (const kind of kinds) {
      expect(FX_TABLE[kind as keyof typeof FX_TABLE]).toBeDefined();
    }
  });
});
