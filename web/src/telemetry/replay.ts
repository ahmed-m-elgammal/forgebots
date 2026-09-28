// The replay document (11-REPLAY-FORMAT.md § 2) — the self-contained,
// lossless bundle a viewer re-simulates from: match meta, balance
// reference, both sides' exact designs, the tick-grouped events, the
// canonical final state, and output_sha256 over the parts that decide
// the match.
//
// Ordering inside the builder is the hash's correctness argument (G31):
// the events are finalised first (match_end stamped at the last tick),
// then the final state is built, then the hash is taken over the parts —
// so the document's embedded output_sha256 is structurally excluded from
// its own input (11 § 2.1): it is computed before the field exists.
//
// What the caller supplies and why: the simulator keeps no clock and no
// identity registry (G22, G35), so duration_ms (wall-clock metadata,
// excluded from the hash), match_id, the balance reference and the
// players' account details arrive as parameters. The result's
// durationTicks is the match's own time: tick_count.

import type { JsonValue } from './canonical';
import { EVENT_KINDS, type ReplayEvent, type ReplayFinalState } from './eventKinds';
import { EventLog } from './eventLog';
import { outputSha256 } from './outputSha256';
import type { MatchResultView, SnapshotRobotView } from './views';

// 11 § 9: the document shape's version and the simulator's semver are
// independent. The format is committed to version 1 for at least 18
// months (18 § 1.3); sim_version tracks the simulator itself.
export const REPLAY_FORMAT_VERSION = 1;
export const SIM_VERSION = '0.1.0';

// One design as the wire carries it (07 § 2.3's chassis_json entry):
// name, part ids, and the program in its byte-stable compiled form —
// enough to re-simulate without the bots table (11 § 2).
export interface ReplayDesignPayload {
  readonly name: string;
  readonly parts: readonly string[];
  readonly code: JsonValue;
}

export interface ReplayBotSnapshotPayload {
  readonly name: string;
  readonly designs: readonly ReplayDesignPayload[];
}

export interface ReplayPlayerPayload {
  readonly userId: string;
  readonly handle: string;
  readonly botId: string;
  readonly botSnapshot: ReplayBotSnapshotPayload;
  readonly eloBefore: number;
  readonly eloAfter: number;
  readonly isGhost: boolean;
}

export interface ReplayDocumentInput {
  readonly matchId: string;
  readonly seed: bigint;
  readonly balanceVersionId: number;
  readonly balanceSha256: string;
  // Wall-clock metadata the caller measures; the simulator has no clock.
  readonly durationMs: number;
  readonly players: readonly [ReplayPlayerPayload, ReplayPlayerPayload];
  readonly eventLog: EventLog;
  readonly result: MatchResultView;
}

export interface ReplayPlayerDocument {
  readonly user_id: string;
  readonly handle: string;
  readonly bot_id: string;
  readonly bot_snapshot: { readonly name: string; readonly designs: readonly ReplayDesignPayload[] };
  readonly elo_before: number;
  readonly elo_after: number;
  readonly is_ghost: boolean;
}

export interface ReplayDocument {
  readonly version: typeof REPLAY_FORMAT_VERSION;
  readonly match_id: string;
  readonly sim_version: string;
  readonly seed: string;
  readonly balance_version_id: number;
  readonly balance_sha256: string;
  readonly tick_count: number;
  readonly duration_ms: number;
  readonly winner: 'p1' | 'p2' | 'draw';
  readonly reason: 'elimination' | 'tick_cap_biomass' | 'draw_tick' | 'draw_tie';
  readonly players: readonly [ReplayPlayerDocument, ReplayPlayerDocument];
  readonly events: readonly (readonly ReplayEvent[])[];
  readonly final_state: ReplayFinalState;
  readonly output_sha256: string;
}

export function buildReplayDocument(input: ReplayDocumentInput): ReplayDocument {
  assertText(input.matchId, 'matchId');
  assertNonNegativeInteger(input.balanceVersionId, 'balanceVersionId');
  assertNonNegativeInteger(input.durationMs, 'durationMs');
  assertPlayers(input.players);
  if (input.result.durationTicks < 1) {
    throw new RangeError(`durationTicks must be at least 1, got ${input.result.durationTicks}`);
  }

  const tickCount = input.result.durationTicks;
  const events = input.eventLog.eventsUpTo(tickCount);
  events[tickCount]!.push({
    t: tickCount,
    kind: EVENT_KINDS.matchEnd,
    winner: input.result.winner,
    reason: input.result.reason,
  });
  const finalState = buildFinalState(input.result);
  const outputSha = outputSha256({
    seed: input.seed,
    balanceSha256: input.balanceSha256,
    finalState,
    events,
  });
  return {
    version: REPLAY_FORMAT_VERSION,
    match_id: input.matchId,
    sim_version: SIM_VERSION,
    seed: toWireSeed(input.seed),
    balance_version_id: input.balanceVersionId,
    balance_sha256: input.balanceSha256,
    tick_count: tickCount,
    duration_ms: input.durationMs,
    winner: input.result.winner,
    reason: input.result.reason,
    players: [toWirePlayer(input.players[0]!), toWirePlayer(input.players[1]!)],
    events,
    final_state: finalState,
    output_sha256: outputSha,
  };
}

function buildFinalState(result: MatchResultView): ReplayFinalState {
  return {
    robots: result.finalRobots.map(toFinalRobot),
    available_cell_indices: [...result.availableCellIndices],
  };
}

// The final state carries alive — the hash must distinguish a survivor
// from a corpse that died with the same scalars — and converts to the
// wire's millimetre keys here, at the edge, once (G33).
function toFinalRobot(robot: SnapshotRobotView): ReplayFinalState['robots'][number] {
  return {
    id: robot.id,
    x: robot.xMm,
    y: robot.yMm,
    hp: robot.hp,
    shield: robot.shield,
    energy: robot.energy,
    biomass: robot.biomass,
    alive: robot.alive,
  };
}

function toWirePlayer(player: ReplayPlayerPayload): ReplayPlayerDocument {
  assertText(player.userId, 'userId');
  assertText(player.handle, 'handle');
  assertText(player.botId, 'botId');
  assertText(player.botSnapshot.name, 'botSnapshot.name');
  assertNonNegativeInteger(player.eloBefore, 'eloBefore');
  assertNonNegativeInteger(player.eloAfter, 'eloAfter');
  if (player.botSnapshot.designs.length === 0) {
    throw new TypeError('bot_snapshot must carry at least one design (a bot is 1-3 designs, D12)');
  }
  for (const design of player.botSnapshot.designs) {
    assertText(design.name, 'design.name');
    if (!Array.isArray(design.parts)) {
      throw new TypeError(`design ${design.name} must list its part ids`);
    }
  }
  return {
    user_id: player.userId,
    handle: player.handle,
    bot_id: player.botId,
    bot_snapshot: { name: player.botSnapshot.name, designs: [...player.botSnapshot.designs] },
    elo_before: player.eloBefore,
    elo_after: player.eloAfter,
    is_ghost: player.isGhost,
  };
}

// Lowercase hex with the 0x prefix; zero is "0x0". The seed arrived
// uint64-validated — the hash step runs first in buildReplayDocument.
function toWireSeed(seed: bigint): string {
  return `0x${seed.toString(16)}`;
}

function assertText(value: string, label: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer, got ${value}`);
  }
}

function assertPlayers(players: readonly [ReplayPlayerPayload, ReplayPlayerPayload]): void {
  if (players.length !== 2) {
    throw new TypeError(`a replay carries exactly two players, got ${players.length}`);
  }
}
