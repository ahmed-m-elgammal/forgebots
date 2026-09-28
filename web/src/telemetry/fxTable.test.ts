import { describe, expect, it } from 'vitest';
import { EVENT_KINDS } from './eventKinds';
import { FX_TABLE } from './fxTable';

// The completeness contract of 11 § 4 via AGENTS.md rule 4: a replay
// event kind with no fx entry is a build error, not a silent no-op.
// Record<EventKind, FxEntry> makes a missing key a compile error; these
// runtime tests hold the line against casts, widened types and extra
// entries, and pin the three entries the spec names verbatim.

const tableKeys = Object.keys(FX_TABLE).sort();
const enumValues = Object.values(EVENT_KINDS);

describe('FX_TABLE — completeness', () => {
  it('[normal] every event kind has an fx entry — the 11 § 4 contract', () => {
    for (const kind of enumValues) {
      const entry = FX_TABLE[kind];
      expect(entry, `no fx entry for kind ${kind}`).toBeDefined();
      expect(entry!.vfx.length).toBeGreaterThan(0);
      expect(entry!.sfx.length).toBeGreaterThan(0);
    }
  });

  it('[boundary] the table carries exactly the enum’s kinds — no extras, no gaps', () => {
    expect(tableKeys).toEqual([...enumValues].sort());
    expect(tableKeys).toHaveLength(17);
  });

  it('[boundary] the spec-pinned entries are verbatim', () => {
    expect(FX_TABLE.shot).toMatchObject({ vfx: 'muzzle_sparks', sfx: 'blaster_fire' });
    expect(FX_TABLE.death).toMatchObject({ vfx: 'explosion', sfx: 'death', hitStopMs: 80 });
    expect(FX_TABLE.biomass_taken).toMatchObject({ vfx: 'sparkles', sfx: 'biomass_pickup' });
  });
});

describe('FX_TABLE — invalid input / state / determinism', () => {
  it('[invalid] a kind added to the enum without an fx decision fails loudly here', () => {
    // The table is Record<EventKind, FxEntry>: this test documents the
    // runtime half of the compile-time seal. If a kind were smuggled in
    // with a widened record type, the key-set equality above fails.
    expect(tableKeys).toEqual([...enumValues].sort());
  });

  it('[state] the table is frozen — no caller can grow it at runtime', () => {
    expect(Object.isFrozen(FX_TABLE)).toBe(true);
    expect(() => {
      (FX_TABLE as { snapshot?: unknown }).snapshot = undefined;
    }).toThrow(TypeError);
    expect(FX_TABLE.snapshot).toBeDefined();
  });

  it('[repeated][determinism] repeated reads return the same entries', () => {
    expect(FX_TABLE.move).toBe(FX_TABLE.move);
    expect(FX_TABLE.eat).toEqual({ vfx: 'absorb_pulses', sfx: 'consume' });
  });
});
