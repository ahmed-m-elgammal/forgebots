// The juice seam of the replay format (16-JUICE-AND-AUDIO.md § 2.3): a
// single declarative table mapping every event kind to its VFX/SFX
// resources. The spec pins the shape and three entries; the rest of the
// catalog is 16 § 3.1's to finalise — until then the identifiers below
// are this table's own vocabulary (AGENTS.md rule 4, tier 2), and the
// juice phase extends entries here rather than forking a second table
// (rule 14; hitStopMs already rides along for death per the spec
// example).
//
// The completeness contract is 11 § 4's, via AGENTS.md rule 4: a missing
// kind must be a build error, not a silent no-op. Record<EventKind, …>
// makes it one at compile time; the fxTable test re-checks at runtime so
// a cast or a widened record type cannot sneak past, and 'none' marks the
// kinds a viewer renders from state (snapshots, movement) or stays
// deliberately silent on — a decision recorded, not an omission.
import type { EventKind } from './eventKinds';

export interface FxEntry {
  readonly vfx: string;
  readonly sfx: string;
  readonly hitStopMs?: number;
}

export const FX_TABLE: Readonly<Record<EventKind, FxEntry>> = Object.freeze({
  snapshot: { vfx: 'none', sfx: 'none' },
  shot: { vfx: 'muzzle_sparks', sfx: 'blaster_fire' },
  damage: { vfx: 'blast_ring', sfx: 'grenade_blast' },
  death: { vfx: 'explosion', sfx: 'death', hitStopMs: 80 },
  birth: { vfx: 'spawn_flash', sfx: 'build_complete' },
  build_start: { vfx: 'construction_puffs', sfx: 'fabricator_start' },
  build_done: { vfx: 'spawn_flash', sfx: 'build_complete' },
  biomass_spawn: { vfx: 'cell_materialize', sfx: 'biomass_respawn' },
  biomass_taken: { vfx: 'sparkles', sfx: 'biomass_pickup' },
  biomass_depleted: { vfx: 'cell_fade', sfx: 'none' },
  fire: { vfx: 'none', sfx: 'dry_fire' },
  move: { vfx: 'none', sfx: 'none' },
  aim: { vfx: 'none', sfx: 'none' },
  say: { vfx: 'speech_bubble', sfx: 'radio_blip' },
  eat: { vfx: 'absorb_pulses', sfx: 'consume' },
  vm_yield: { vfx: 'none', sfx: 'none' },
  match_end: { vfx: 'result_banner', sfx: 'match_end' },
} satisfies Record<EventKind, FxEntry>);
