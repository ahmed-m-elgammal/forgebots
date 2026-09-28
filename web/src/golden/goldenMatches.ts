// The golden gate — Phase 5 task 8.3 (23-WEB-CLIENT-PLAN.md § 8.3): fixed
// seed → fixed output_sha256 over golden-seeds.json's matchups. This is
// the test that proves integer maths is portable instead of assuming it
// (10-DETERMINISM.md § 5-6): CI re-runs these matchups on every PR and a
// hash that moves without a deliberate bump fails the build.
//
// This module is the golden tier's composition root — the one place a
// golden matchup legitimately crosses contexts: program/ compiles the
// .fb sources, match/ runs the match, telemetry/ documents and hashes
// it. No context may import match/ (06-ARCHITECTURE.md § 5.2), so the
// composition lives outside every context, the same role the server's
// main.ts plays. Nothing here belongs in a context: it reads fixtures,
// it runs nothing on its own.
//
// Reconciliations with the spec, documented rather than silent:
// - balance_json (07-DATA-MODEL.md § 2.3) is "full hardware catalog +
//   arena layout": realized as the parsed catalog PARTS and the default
//   arena config — the two balance inputs the simulator actually
//   consumes. A balance patch, or a drift between the catalog JSON and
//   its parser, changes every golden hash and forces a deliberate
//   re-record. That is the gate working, not a bug.
// - golden-seeds.json names the balance "season-1-v1" but the replay
//   wire carries balance_version_id as 07 § 2.3's monotonic integer
//   within a season: the golden tier pins season 1's first version as 1.
// - The seeds file's own hash fields stay null: spec-kit is upstream of
//   code, and filling them is a spec edit for the owner to approve. The
//   web tier records its hashes in golden-fixtures.json next to this
//   module, reviewed like source (AGENTS.md § 4).
// - Starter bots field one design each (19 § 2), so each side spawns one
//   robot and the design takes the bot file's name: robot ids read
//   p1.pebble.0. Ghost matches are ghost vs ghost (19 § 1.1), and
//   elo_after equals elo_before — the simulator computes no Elo; the
//   ladder is the server's job.
// - The .fb hardware comments name catalog ids except "solar", short for
//   solar_panel. The alias lives in KNOWN_PART_IDS; an unknown token is
//   a broken fixture, not a part, and throws.

import { readFileSync } from 'node:fs';
import { DEFAULT_ARENA_CONFIG } from '../arena';
import { runMatch, type MatchSideInput } from '../match';
import { compile, type IrProgram } from '../program';
import { PART_ID, PARTS, type Design, type PartId } from '../robot';
import {
  buildReplayDocument,
  canonicalJson,
  EventLog,
  sha256Hex,
  type JsonValue,
  type ReplayDocument,
  type ReplayPlayerPayload,
} from '../telemetry';
import fixturesJson from './golden-fixtures.json';

// 07 § 2.3's version int, season 1's first — see the reconciliation above.
export const GOLDEN_BALANCE_VERSION_ID = 1;

// Starter bots field exactly one robot (19 § 2's single-design loadouts).
const ROBOTS_PER_STARTER_DESIGN = 1;

const EXAMPLES_DIR = new URL('../../../spec-kit/examples/', import.meta.url);
const REPO_ROOT = new URL('../../../', import.meta.url);
const SEEDS_FILE_URL = new URL('golden-seeds.json', EXAMPLES_DIR);

// The seeds file's canonical spelling: lowercase 0x-hex, at most 16
// digits — the uint64 bound matches.balance and the replay's seed share.
const GOLDEN_SEED_PATTERN = /^0x[0-9a-f]{1,16}$/;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

// The catalog's own ids, plus the one short name the .fb comments use.
const KNOWN_PART_IDS: ReadonlyMap<string, PartId> = new Map([
  ...Object.values(PART_ID).map((id): [string, PartId] => [id, id]),
  ['solar', PART_ID.solarPanel],
]);

export interface GoldenSide {
  readonly bot: string;
  readonly source: string;
  readonly parts: readonly PartId[];
  readonly design: Design;
  readonly program: IrProgram;
  readonly ghostElo: number;
}

export interface GoldenMatchup {
  readonly id: string;
  readonly covers: string;
  readonly seed: bigint;
  readonly tickLimit: number;
  readonly sides: readonly [GoldenSide, GoldenSide];
}

export interface GoldenFixtures {
  readonly simVersion: string;
  readonly balanceVersionId: number;
  readonly balanceSha256: string;
  readonly hashes: Readonly<Record<string, string>>;
}

export function parseGoldenSeed(value: unknown): bigint {
  if (typeof value !== 'string' || !GOLDEN_SEED_PATTERN.test(value)) {
    throw new TypeError(
      `golden seed must be 0x-prefixed lowercase hex of 1-16 digits (uint64), got ${JSON.stringify(value)}`,
    );
  }
  return BigInt(value);
}

// The chassis lives in the source's ";; Hardware" comment: part tokens
// after the colon on that line, continuing on following comment lines
// that list nothing but part tokens (drifter.fb wraps onto a second
// line). Declaration order is kept — reaper stacks two blasters, and
// parts order is the replay's chassis contract.
export function hardwarePartIds(source: string, botName: string): readonly PartId[] {
  const lines = source.split('\n');
  const header = lines.findIndex((line) => line.startsWith(';; Hardware'));
  if (header < 0) {
    throw new TypeError(`${botName}.fb declares no ";; Hardware" chassis`);
  }
  const tokenLines = [lines[header]!.slice(lines[header]!.indexOf(':') + 1)];
  for (let i = header + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (!/^;;\s+[a-z0-9_]/.test(line) || line.includes(':')) break;
    tokenLines.push(line.replace(/^;;\s+/, ''));
  }
  const tokens = tokenLines
    .join(',')
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  const parts: PartId[] = [];
  for (const token of tokens) {
    const partId = KNOWN_PART_IDS.get(token);
    if (partId === undefined) {
      throw new TypeError(`${botName}.fb hardware names no catalog part ${JSON.stringify(token)}`);
    }
    parts.push(partId);
  }
  if (parts.length === 0) {
    throw new TypeError(`${botName}.fb's ";; Hardware" comment lists no parts`);
  }
  return parts;
}

export function loadGoldenMatchups(): readonly GoldenMatchup[] {
  return goldenMatchupsFromSeeds(JSON.parse(readFileSync(SEEDS_FILE_URL, 'utf8')));
}

// Validates the parsed golden-seeds.json and materializes its matchups:
// sources are read, hardware parsed and programs compiled eagerly, so a
// broken fixture fails at load instead of mid-match.
export function goldenMatchupsFromSeeds(raw: unknown): readonly GoldenMatchup[] {
  if (typeof raw !== 'object' || raw === null) {
    throw new TypeError('golden-seeds.json must be a JSON object');
  }
  const seeds = raw as Record<string, unknown>;
  const balanceVersion = seeds['balance_version'];
  if (typeof balanceVersion !== 'string' || balanceVersion.length === 0) {
    throw new TypeError('golden balance_version must be a non-empty string');
  }
  const tickLimit = seeds['tick_limit'];
  if (typeof tickLimit !== 'number' || !Number.isInteger(tickLimit) || tickLimit < 1) {
    throw new TypeError(`golden tick_limit must be a positive integer, got ${JSON.stringify(tickLimit)}`);
  }
  const ghostElo = seeds['ghost_seed_elo'];
  if (typeof ghostElo !== 'object' || ghostElo === null || Array.isArray(ghostElo)) {
    throw new TypeError('golden ghost_seed_elo must be an object of bot → elo');
  }
  const rawMatchups = seeds['matchups'];
  if (!Array.isArray(rawMatchups) || rawMatchups.length === 0) {
    throw new TypeError('golden matchups must be a non-empty array');
  }
  const eloByBot = ghostElo as Record<string, unknown>;
  return rawMatchups.map((entry) => goldenMatchupOf(entry, tickLimit, eloByBot));
}

function goldenMatchupOf(raw: unknown, tickLimit: number, eloByBot: Record<string, unknown>): GoldenMatchup {
  if (typeof raw !== 'object' || raw === null) {
    throw new TypeError('a golden matchup must be an object');
  }
  const matchup = raw as Record<string, unknown>;
  const id = matchup['id'];
  if (typeof id !== 'string' || id.length === 0) {
    throw new TypeError('a golden matchup needs a non-empty id');
  }
  const covers = matchup['covers'];
  if (typeof covers !== 'string') {
    throw new TypeError(`golden matchup ${id} needs a covers string`);
  }
  return {
    id,
    covers,
    seed: parseGoldenSeed(matchup['seed']),
    tickLimit,
    sides: [goldenSideOf(matchup['p1'], id, eloByBot), goldenSideOf(matchup['p2'], id, eloByBot)],
  };
}

function goldenSideOf(raw: unknown, matchupId: string, eloByBot: Record<string, unknown>): GoldenSide {
  if (typeof raw !== 'object' || raw === null) {
    throw new TypeError(`golden matchup ${matchupId} needs a p1 and a p2 object`);
  }
  const side = raw as Record<string, unknown>;
  const bot = side['bot'];
  if (typeof bot !== 'string' || bot.length === 0) {
    throw new TypeError(`golden matchup ${matchupId} needs a non-empty bot name`);
  }
  const source = side['source'];
  if (typeof source !== 'string' || source.length === 0) {
    throw new TypeError(`golden matchup ${matchupId} bot ${bot} needs a non-empty source path`);
  }
  const elo = eloByBot[bot];
  if (typeof elo !== 'number' || !Number.isInteger(elo) || elo < 0) {
    throw new TypeError(`golden ghost_seed_elo[${bot}] must be a non-negative integer, got ${JSON.stringify(elo)}`);
  }
  const sourceText = readSourceText(bot, source);
  const compiled = compile(sourceText);
  if (!compiled.ok) {
    throw new TypeError(
      `golden bot ${bot} (${source}) does not compile: ${compiled.errors.map((error) => error.code).join(', ')}`,
    );
  }
  const parts = hardwarePartIds(sourceText, bot);
  return {
    bot,
    source,
    parts,
    design: { name: bot, chassis: { parts } },
    program: compiled.ir,
    ghostElo: elo,
  };
}

function readSourceText(bot: string, source: string): string {
  try {
    return readFileSync(new URL(source, REPO_ROOT), 'utf8');
  } catch {
    throw new TypeError(`golden bot ${bot} source ${source} is missing`);
  }
}

export function loadGoldenFixtures(): GoldenFixtures {
  return goldenFixturesFrom(fixturesJson);
}

// Binds the recorded fixtures to this tier's pinned versions: a fixture
// written for another balance version or simulator is a lie, and the
// loader refuses it before any comparison can mislead.
export function goldenFixturesFrom(raw: unknown): GoldenFixtures {
  if (typeof raw !== 'object' || raw === null) {
    throw new TypeError('golden fixtures must be a JSON object');
  }
  const fixture = raw as Record<string, unknown>;
  const simVersion = fixture['sim_version'];
  if (typeof simVersion !== 'string' || simVersion.length === 0) {
    throw new TypeError('golden fixtures sim_version must be a non-empty string');
  }
  const balanceVersionId = fixture['balance_version_id'];
  if (balanceVersionId !== GOLDEN_BALANCE_VERSION_ID) {
    throw new TypeError(
      `golden fixtures balance_version_id must be ${GOLDEN_BALANCE_VERSION_ID}, got ${JSON.stringify(balanceVersionId)}`,
    );
  }
  const balanceSha256 = fixture['balance_sha256'];
  if (typeof balanceSha256 !== 'string' || !SHA256_HEX_PATTERN.test(balanceSha256)) {
    throw new TypeError('golden fixtures balance_sha256 must be 64 hex characters');
  }
  const hashes = fixture['hashes'];
  if (typeof hashes !== 'object' || hashes === null || Array.isArray(hashes)) {
    throw new TypeError('golden fixtures hashes must be an object of matchup id → sha256');
  }
  const recorded: Record<string, string> = {};
  for (const [id, hash] of Object.entries(hashes)) {
    if (typeof hash !== 'string' || !SHA256_HEX_PATTERN.test(hash)) {
      throw new TypeError(`golden fixture for ${id} must be a 64-hex sha256, got ${JSON.stringify(hash)}`);
    }
    recorded[id] = hash;
  }
  return { simVersion, balanceVersionId, balanceSha256, hashes: recorded };
}

// sha256 over the canonical balance document — the catalog the parser
// validates plus the arena layout the match builds on. Called per
// document build rather than cached: it is three small hashes per suite,
// and a constant would be one more piece of mutable module state.
export function goldenBalanceSha256(): string {
  return sha256Hex(utf8Bytes(canonicalJson({ catalog: PARTS, arena: DEFAULT_ARENA_CONFIG })));
}

export function runGoldenMatchup(matchup: GoldenMatchup): ReplayDocument {
  const log = new EventLog({
    designNames: [
      [matchup.sides[0]!.design.name],
      [matchup.sides[1]!.design.name],
    ],
  });
  const result = runMatch(
    [sideInputOf(matchup.sides[0]!), sideInputOf(matchup.sides[1]!)],
    { seed: matchup.seed, tickLimit: matchup.tickLimit },
    log,
  );
  return buildReplayDocument({
    matchId: matchup.id,
    seed: matchup.seed,
    balanceVersionId: GOLDEN_BALANCE_VERSION_ID,
    balanceSha256: goldenBalanceSha256(),
    durationMs: 0,
    players: [ghostPlayerOf(matchup.sides[0]!), ghostPlayerOf(matchup.sides[1]!)],
    eventLog: log,
    result,
  });
}

function sideInputOf(side: GoldenSide): MatchSideInput {
  return [{ design: side.design, program: side.program, robotCount: ROBOTS_PER_STARTER_DESIGN }];
}

function ghostPlayerOf(side: GoldenSide): ReplayPlayerPayload {
  return {
    userId: `ghost-${side.bot}`,
    handle: side.bot,
    botId: `ghost-bot-${side.bot}`,
    botSnapshot: {
      name: side.bot,
      designs: [{ name: side.design.name, parts: [...side.parts], code: asJsonValue(side.program) }],
    },
    eloBefore: side.ghostElo,
    eloAfter: side.ghostElo,
    isGhost: true,
  };
}

// The IR is JSON-safe but not typed as JsonValue (interface fields carry
// no implicit index signature); the wire crossing goes through JSON, the
// same way the server will cross it.
function asJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function utf8Bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}
