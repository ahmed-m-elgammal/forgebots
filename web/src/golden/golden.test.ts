import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ARENA_CONFIG } from '../arena';
import { PART_ID, PARTS } from '../robot';
import { canonicalJson, EVENT_KINDS, sha256Hex, SIM_VERSION, outputSha256, type ReplayDocument } from '../telemetry';
import {
  GOLDEN_BALANCE_VERSION_ID,
  goldenBalanceSha256,
  goldenFixturesFrom,
  goldenMatchupsFromSeeds,
  hardwarePartIds,
  loadGoldenFixtures,
  loadGoldenMatchups,
  parseGoldenSeed,
  runGoldenMatchup,
} from './goldenMatches';

// The golden tier (AGENTS.md § 4): fixed seed → fixed output_sha256 over
// the full 1500-tick run, one document per golden-seeds.json matchup.
// The matches at module scope run once and every assertion reads them;
// the repeated-run tests are the ones that pay for extra matches.

const matchups = loadGoldenMatchups();
const fixtures = loadGoldenFixtures();

const documents = new Map<string, ReplayDocument>(matchups.map((matchup) => [matchup.id, runGoldenMatchup(matchup)] as const));
const documentFor = (id: string): ReplayDocument => documents.get(id)!;

// A valid seeds-file shape the invalid-input tests patch one field at a
// time. Real bot entries: the loader compiles for real, so the only
// difference from loadGoldenMatchups is what the patch breaks.
const seedsFileWith = (patch: Record<string, unknown>) => ({
  balance_version: 'season-1-v1',
  tick_limit: 1500,
  matchups: [
    {
      id: 'synthetic',
      covers: 'loader test',
      p1: { bot: 'pebble', source: 'spec-kit/examples/pebble.fb' },
      p2: { bot: 'drifter', source: 'spec-kit/examples/drifter.fb' },
      seed: '0x1',
    },
  ],
  ghost_seed_elo: { pebble: 800, drifter: 950 },
  ...patch,
});

const fixturesFileWith = (patch: Record<string, unknown>) => ({
  sim_version: SIM_VERSION,
  balance_version_id: GOLDEN_BALANCE_VERSION_ID,
  balance_sha256: goldenBalanceSha256(),
  hashes: { 'some-matchup': 'ab'.repeat(32) },
  ...patch,
});

// Portability by construction (10 § 6): if any number in a replay
// document were a float, another platform could hash it differently.
// Every numeric leaf must be an integer.
function assertAllIntegers(value: unknown, path: string): void {
  if (typeof value === 'number') {
    expect(Number.isInteger(value), `${path} must be an integer, got ${value}`).toBe(true);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertAllIntegers(entry, `${path}[${index}]`));
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, entry] of Object.entries(value)) assertAllIntegers(entry, `${path}.${key}`);
  }
}

describe('golden gate — fixed seed → fixed output_sha256 (23 § 8.3, 10 § 5)', () => {
  it.each(matchups)('$id: output_sha256 equals the recorded golden fixture', (matchup) => {
    const document = documentFor(matchup.id);
    const recorded = fixtures.hashes[matchup.id];
    if (recorded === undefined) {
      throw new Error(
        `no golden fixture recorded for ${matchup.id}; this run produced "${document.output_sha256}" — record it in golden-fixtures.json`,
      );
    }
    expect(
      document.output_sha256,
      `${matchup.id} drifted; if this re-record is deliberate (sim_version or balance bump), write "${document.output_sha256}"`,
    ).toBe(recorded);
  });

  it('[normal] the fixtures bind this tier to the pinned sim and balance identity', () => {
    expect(fixtures.simVersion).toBe(SIM_VERSION);
    expect(fixtures.balanceVersionId).toBe(GOLDEN_BALANCE_VERSION_ID);
    const fresh = goldenBalanceSha256();
    expect(
      fixtures.balanceSha256,
      `the balance fingerprint moved to "${fresh}" — a catalog or arena change invalidates every recorded hash`,
    ).toBe(fresh);
  });
});

describe('golden document integrity (11-REPLAY-FORMAT.md § 2)', () => {
  it('[normal] every document carries the meta on the wire forms the format pins', () => {
    for (const matchup of matchups) {
      const document = documentFor(matchup.id);
      expect(document.version).toBe(1);
      expect(document.sim_version).toBe(SIM_VERSION);
      expect(document.match_id).toBe(matchup.id);
      expect(document.seed).toBe(`0x${matchup.seed.toString(16)}`);
      expect(document.balance_version_id).toBe(GOLDEN_BALANCE_VERSION_ID);
      expect(document.balance_sha256).toBe(goldenBalanceSha256());
      expect(document.tick_count).toBeLessThanOrEqual(matchup.tickLimit);
      expect(document.duration_ms).toBe(0);
      for (const player of document.players) {
        expect(player.is_ghost).toBe(true);
        expect(player.elo_before).toBe(player.elo_after);
        expect(player.elo_before).toBe(matchups.flatMap((m) => m.sides).find((side) => side.bot === player.handle)?.ghostElo);
      }
    }
  });

  it('[normal] robot ids and design payloads use the bot file names the seeds file declares', () => {
    for (const matchup of matchups) {
      const document = documentFor(matchup.id);
      document.players.forEach((player) => {
        expect(player.bot_snapshot.name).toBe(player.handle);
        for (const design of player.bot_snapshot.designs) {
          expect(design.name).toBe(player.handle);
          expect(design.parts.length).toBeGreaterThan(0);
        }
      });
      const sidePrefix = matchup.sides.map((side) => side.bot);
      for (const robot of document.final_state.robots) {
        expect(robot.id).toMatch(/^p[12]\./);
        const side = robot.id.startsWith('p1.') ? sidePrefix[0]! : sidePrefix[1]!;
        expect(robot.id).toContain(`.${side}.`);
      }
    }
  });

  it('[boundary] tick_count lands in [1, tick_limit] and the closing bucket carries match_end last', () => {
    for (const matchup of matchups) {
      const document = documentFor(matchup.id);
      expect(document.tick_count).toBeGreaterThanOrEqual(1);
      expect(document.tick_count).toBeLessThanOrEqual(matchup.tickLimit);
      expect(document.events).toHaveLength(document.tick_count + 1);
      const closing = document.events[document.tick_count]!;
      expect(closing.at(-1)).toEqual({
        t: document.tick_count,
        kind: EVENT_KINDS.matchEnd,
        winner: document.winner,
        reason: document.reason,
      });
      expect(closing.filter((event) => event.kind === EVENT_KINDS.matchEnd)).toHaveLength(1);
    }
  });

  it('[boundary] snapshot ticks keep the cadence on real bots: tick 1, then every 30th up to the end', () => {
    for (const matchup of matchups) {
      const document = documentFor(matchup.id);
      const snapshotTicks = document.events
        .map((bucket, tick) => (bucket.some((event) => event.kind === EVENT_KINDS.snapshot) ? tick : -1))
        .filter((tick) => tick >= 0);
      const expected = [1];
      for (let tick = 30; tick <= document.tick_count; tick += 30) expected.push(tick);
      expect(snapshotTicks, `${matchup.id} ended at tick ${document.tick_count}`).toEqual(expected);
    }
  });

  it('[state] the embedded hash recomputes from the document parts it covers', () => {
    for (const matchup of matchups) {
      const document = documentFor(matchup.id);
      const recomputed = outputSha256({
        seed: matchup.seed,
        balanceSha256: goldenBalanceSha256(),
        finalState: document.final_state,
        events: document.events,
      });
      expect(document.output_sha256).toBe(recomputed);
    }
  });

  it('[state] the outcome vocabulary agrees with the final state it summarizes', () => {
    for (const matchup of matchups) {
      const document = documentFor(matchup.id);
      const biomassOf = (side: string) =>
        document.final_state.robots
          .filter((robot) => robot.id.startsWith(`${side}.`))
          .reduce((total, robot) => total + robot.biomass, 0);
      if (document.reason === 'elimination') {
        expect(document.winner === 'p1' || document.winner === 'p2').toBe(true);
        const loser = document.winner === 'p1' ? 'p2' : 'p1';
        for (const robot of document.final_state.robots.filter((r) => r.id.startsWith(`${loser}.`))) {
          expect(robot.alive, `${loser} must be extinct in ${matchup.id}`).toBe(false);
        }
      }
      if (document.reason === 'tick_cap_biomass') {
        expect(document.tick_count).toBe(matchup.tickLimit);
        expect(document.winner === 'p1' || document.winner === 'p2').toBe(true);
        const rival = document.winner === 'p1' ? 'p2' : 'p1';
        expect(biomassOf(document.winner)).toBeGreaterThan(biomassOf(rival));
      }
      if (document.reason === 'draw_tie' || document.reason === 'draw_tick') {
        expect(document.winner).toBe('draw');
      }
    }
  });

  it('[normal] the heaviest path finishes without an unintended vm_yield (20 Phase 20.1)', () => {
    for (const matchup of matchups) {
      const document = documentFor(matchup.id);
      const yields = document.events.flat().filter((event) => event.kind === EVENT_KINDS.vmYield);
      expect(yields, `${matchup.id} yielded`).toEqual([]);
    }
  });
});

describe('determinism and portability (10-DETERMINISM.md § 6)', () => {
  it('[determinism] every numeric leaf in every document is an integer — portability by construction', () => {
    for (const matchup of matchups) {
      assertAllIntegers(documentFor(matchup.id), matchup.id);
    }
  });

  it('[determinism] a different seed changes the hash over the same matchup', () => {
    const matchup = matchups[0]!;
    const other = runGoldenMatchup({ ...matchup, seed: matchup.seed + 1n });
    expect(other.output_sha256).not.toBe(documentFor(matchup.id).output_sha256);
    expect(other.seed).toBe(`0x${(matchup.seed + 1n).toString(16)}`);
  });
});

describe('repeated runs reproduce the golden documents byte for byte', () => {
  it.each(matchups)('$id: a second full run is byte-identical, hash included', (matchup) => {
    const second = runGoldenMatchup(matchup);
    expect(JSON.stringify(second)).toBe(JSON.stringify(documentFor(matchup.id)));
    expect(second.output_sha256).toBe(documentFor(matchup.id).output_sha256);
  });

  it('[repeated] a third run of the heaviest path still reproduces byte for byte', () => {
    const heaviest = matchups[2]!;
    expect(JSON.stringify(runGoldenMatchup(heaviest))).toBe(JSON.stringify(documentFor(heaviest.id)));
  });
});

describe('parseGoldenSeed', () => {
  it('[normal] the seeds file canonical form parses', () => {
    expect(parseGoldenSeed('0x0000000000000001')).toBe(1n);
  });

  it('[boundary] zero is the minimal form and 16 digits the uint64 ceiling', () => {
    expect(parseGoldenSeed('0x0')).toBe(0n);
    expect(parseGoldenSeed('0xffffffffffffffff')).toBe((1n << 64n) - 1n);
  });

  it('[invalid] non-strings, decimals, uppercase, junk and overflow all throw', () => {
    expect(() => parseGoldenSeed(1n)).toThrow(TypeError);
    expect(() => parseGoldenSeed('1234')).toThrow(TypeError);
    expect(() => parseGoldenSeed('0xABCDEF')).toThrow(TypeError);
    expect(() => parseGoldenSeed('0xdeadbeefg')).toThrow(TypeError);
    expect(() => parseGoldenSeed('0x10000000000000000')).toThrow(TypeError);
    expect(() => parseGoldenSeed('')).toThrow(TypeError);
    expect(() => parseGoldenSeed(null)).toThrow(TypeError);
  });
});

describe('hardwarePartIds — the .fb chassis comments', () => {
  it('[normal] the single-line form resolves catalog ids and the solar alias', () => {
    expect(hardwarePartIds(';; Hardware: mk1_engine, short_radar, solar\n(defn step [] 0)', 'pebble')).toEqual([
      PART_ID.mk1Engine,
      PART_ID.shortRadar,
      PART_ID.solarPanel,
    ]);
  });

  it('[normal] the wrapped continuation form collects the next comment line', () => {
    const drifter = ';; Hardware (chassis.json next to this bot):\n;;   mk1_engine, long_radar, solar\n\n(defn step [] 0)';
    expect(hardwarePartIds(drifter, 'drifter')).toEqual([PART_ID.mk1Engine, PART_ID.longRadar, PART_ID.solarPanel]);
  });

  it('[boundary] duplicate tokens keep their order — reaper stacks two blasters', () => {
    expect(hardwarePartIds(';; Hardware: blaster, blaster\n', 'reaper')).toEqual([PART_ID.blaster, PART_ID.blaster]);
  });

  it('[boundary] a prose line with a colon ends the token block', () => {
    const source = ';; Hardware: blaster\n;; Spec: spec-kit/19-STARTER-BOTS-AND-LIBRARY.md\n(defn step [] 0)';
    expect(hardwarePartIds(source, 'bot')).toEqual([PART_ID.blaster]);
  });

  it('[invalid] a missing header, an empty list and an unknown token all throw', () => {
    expect(() => hardwarePartIds('(defn step [] 0)', 'bot')).toThrow(TypeError);
    expect(() => hardwarePartIds(';; Hardware:\n(defn step [] 0)', 'bot')).toThrow(TypeError);
    expect(() => hardwarePartIds(';; Hardware: blaster, phaser\n', 'bot')).toThrow(TypeError);
  });
});

describe('goldenMatchupsFromSeeds — the seeds file at the edge', () => {
  it('[normal] the real file flows through validation unfiltered', () => {
    const raw = JSON.parse(
      readFileSync(new URL('../../../spec-kit/examples/golden-seeds.json', import.meta.url), 'utf8'),
    );
    expect(loadGoldenMatchups()).toEqual(goldenMatchupsFromSeeds(raw));
    expect(matchups.map((matchup) => matchup.id)).toEqual([
      'golden-1-pebble-vs-drifter',
      'golden-2-drifter-vs-breeder',
      'golden-3-swarm-mind-vs-reaper',
    ]);
    expect(matchups.map((matchup) => matchup.seed)).toEqual([1n, 2n, 3n]);
    expect(matchups.every((matchup) => matchup.tickLimit === 1500)).toBe(true);
  });

  it('[normal] sides materialize compiled programs, hardware and ghost elo', () => {
    const [pebble, drifter] = matchups[0]!.sides;
    expect(pebble!.bot).toBe('pebble');
    expect(pebble!.parts).toEqual([PART_ID.mk1Engine, PART_ID.shortRadar, PART_ID.solarPanel]);
    expect(pebble!.ghostElo).toBe(800);
    expect(pebble!.design).toEqual({ name: 'pebble', chassis: { parts: pebble!.parts } });
    expect(pebble!.program.fns.length).toBeGreaterThan(0);
    expect(drifter!.ghostElo).toBe(950);
    expect(drifter!.parts).toEqual([PART_ID.mk1Engine, PART_ID.longRadar, PART_ID.solarPanel]);
  });

  it('[boundary] a one-tick tick_limit is accepted', () => {
    const loaded = goldenMatchupsFromSeeds(seedsFileWith({ tick_limit: 1 }));
    expect(loaded[0]!.tickLimit).toBe(1);
  });

  it('[invalid] every malformed seeds file throws at load', () => {
    expect(() => goldenMatchupsFromSeeds(null)).toThrow(TypeError);
    expect(() => goldenMatchupsFromSeeds(seedsFileWith({ matchups: [] }))).toThrow(TypeError);
    expect(() => goldenMatchupsFromSeeds(seedsFileWith({ matchups: 'three' }))).toThrow(TypeError);
    expect(() => goldenMatchupsFromSeeds(seedsFileWith({ tick_limit: 0 }))).toThrow(TypeError);
    expect(() => goldenMatchupsFromSeeds(seedsFileWith({ tick_limit: 1.5 }))).toThrow(TypeError);
    expect(() => goldenMatchupsFromSeeds(seedsFileWith({ balance_version: '' }))).toThrow(TypeError);
    expect(() => goldenMatchupsFromSeeds(seedsFileWith({ ghost_seed_elo: null }))).toThrow(TypeError);
    expect(() => goldenMatchupsFromSeeds(seedsFileWith({ matchups: [null] }))).toThrow(TypeError);
    expect(() => goldenMatchupsFromSeeds(seedsFileWith({ matchups: [{ covers: 'c' }] }))).toThrow(TypeError);
    expect(() => goldenMatchupsFromSeeds(seedsFileWith({ matchups: [{ id: 'x' }] }))).toThrow(TypeError);
    expect(() =>
      goldenMatchupsFromSeeds(
        seedsFileWith({ matchups: [{ id: 'x', covers: 'c', seed: '0x1', p1: null, p2: {} }] }),
      ),
    ).toThrow(TypeError);
    expect(() =>
      goldenMatchupsFromSeeds(seedsFileWith({ matchups: [{ id: 'x', covers: 'c', seed: '0x1', p1: {}, p2: {} }] })),
    ).toThrow(TypeError);
    expect(() =>
      goldenMatchupsFromSeeds(
        seedsFileWith({ matchups: [{ id: 'x', covers: 'c', seed: 'nope', p1: {}, p2: {} }] }),
      ),
    ).toThrow(TypeError);
    expect(() =>
      goldenMatchupsFromSeeds(
        seedsFileWith({
          matchups: [
            {
              id: 'x',
              covers: 'c',
              seed: '0x1',
              p1: { bot: 'pebble', source: '' },
              p2: { bot: 'drifter', source: 'spec-kit/examples/drifter.fb' },
            },
          ],
        }),
      ),
    ).toThrow(TypeError);
    expect(() => goldenMatchupsFromSeeds(seedsFileWith({ ghost_seed_elo: { drifter: 950 } }))).toThrow(TypeError);
    expect(() => goldenMatchupsFromSeeds(seedsFileWith({ ghost_seed_elo: { pebble: -1, drifter: 950 } }))).toThrow(TypeError);
    expect(() =>
      goldenMatchupsFromSeeds(
        seedsFileWith({
          matchups: [
            {
              id: 'x',
              covers: 'c',
              seed: '0x1',
              p1: { bot: 'pebble', source: 'spec-kit/examples/does-not-exist.fb' },
              p2: { bot: 'drifter', source: 'spec-kit/examples/drifter.fb' },
            },
          ],
        }),
      ),
    ).toThrow(/missing/);
    expect(() =>
      goldenMatchupsFromSeeds(
        seedsFileWith({
          matchups: [
            {
              id: 'x',
              covers: 'c',
              seed: '0x1',
              p1: { bot: 'pebble', source: 'web/src/golden/testdata/no-chassis.fb' },
              p2: { bot: 'drifter', source: 'spec-kit/examples/drifter.fb' },
            },
          ],
        }),
      ),
    ).toThrow(/Hardware/);
    expect(() =>
      goldenMatchupsFromSeeds(
        seedsFileWith({
          matchups: [
            {
              id: 'x',
              covers: 'c',
              seed: '0x1',
              p1: { bot: 'pebble', source: 'spec-kit/examples/golden-seeds.json' },
              p2: { bot: 'drifter', source: 'spec-kit/examples/drifter.fb' },
            },
          ],
        }),
      ),
    ).toThrow(/does not compile/);
  });
});

describe('goldenFixturesFrom — the fixtures at the edge', () => {
  it('[normal] the committed fixtures file loads through the validator', () => {
    expect(loadGoldenFixtures().hashes).toEqual(fixtures.hashes);
  });

  it('[boundary] an empty hashes object is the unrecorded state', () => {
    const loaded = goldenFixturesFrom(fixturesFileWith({ hashes: {} }));
    expect(loaded.hashes).toEqual({});
  });

  it('[invalid] wrong versions, non-hex digests and malformed hash entries throw', () => {
    expect(() => goldenFixturesFrom(null)).toThrow(TypeError);
    expect(() => goldenFixturesFrom(fixturesFileWith({ sim_version: '' }))).toThrow(TypeError);
    expect(() => goldenFixturesFrom(fixturesFileWith({ balance_version_id: 2 }))).toThrow(TypeError);
    expect(() => goldenFixturesFrom(fixturesFileWith({ balance_version_id: '1' }))).toThrow(TypeError);
    expect(() => goldenFixturesFrom(fixturesFileWith({ balance_sha256: 'zz'.repeat(32) }))).toThrow(TypeError);
    expect(() => goldenFixturesFrom(fixturesFileWith({ hashes: null }))).toThrow(TypeError);
    expect(() => goldenFixturesFrom(fixturesFileWith({ hashes: { m: null } }))).toThrow(TypeError);
    expect(() => goldenFixturesFrom(fixturesFileWith({ hashes: { m: 'abc123' } }))).toThrow(TypeError);
  });
});

describe('goldenBalanceSha256 — the balance fingerprint', () => {
  it('[normal] it is a sha256 hex digest, stable across calls', () => {
    expect(goldenBalanceSha256()).toMatch(/^[0-9a-f]{64}$/);
    expect(goldenBalanceSha256()).toBe(goldenBalanceSha256());
  });

  it('[state] it hashes the canonical catalog-plus-arena document the sim consumes', () => {
    expect(PARTS.length).toBeGreaterThan(0);
    expect(DEFAULT_ARENA_CONFIG.sizeMm).toBe(200000);
    // The recompute uses only the public telemetry pieces — the harness
    // must not depend on a private path for its own fingerprint.
    const canonical = canonicalJson({ catalog: PARTS, arena: DEFAULT_ARENA_CONFIG });
    expect(goldenBalanceSha256()).toBe(sha256Hex(new TextEncoder().encode(canonical)));
  });
});
