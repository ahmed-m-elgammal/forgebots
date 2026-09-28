// The wire vocabulary of the replay (11-REPLAY-FORMAT.md § 4) — the one
// owning module for the 17 event kinds (AGENTS.md rule 4, tier 2; 23 §
// 8.2 "kinds owned by one enum"). Every producer and consumer names a
// kind through EVENT_KINDS; a kind string never appears inline elsewhere.
//
// The ReplayEvent union is the wire shape the EventLog emits and the
// replay document stores. Field names are the format's snake_case
// (11 § 2/§ 4); `"t"` duplicates the tick-bucket index so a streaming
// client can validate chunk order (11 § 3). Optional fields are exactly
// the ones 11 § 4 marks optional — killer on death, weapon/to_shield on
// shot, reason on eat; this simulator always knows them, so the emitter
// fills them, and the type keeps them optional for other producers.

export const EVENT_KINDS = {
  snapshot: 'snapshot',
  shot: 'shot',
  damage: 'damage',
  death: 'death',
  birth: 'birth',
  buildStart: 'build_start',
  buildDone: 'build_done',
  biomassSpawn: 'biomass_spawn',
  biomassTaken: 'biomass_taken',
  biomassDepleted: 'biomass_depleted',
  fire: 'fire',
  move: 'move',
  aim: 'aim',
  say: 'say',
  eat: 'eat',
  vmYield: 'vm_yield',
  matchEnd: 'match_end',
} as const;

export type EventKind = (typeof EVENT_KINDS)[keyof typeof EVENT_KINDS];

// One robot's entry in a snapshot event (11 § 4): id, x, y, hp, shield,
// energy, biomass — millimetres and whole energy units.
export interface ReplayRobotState {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly hp: number;
  readonly shield: number;
  readonly energy: number;
  readonly biomass: number;
}

export type ReplayEvent =
  | { readonly t: number; readonly kind: 'snapshot'; readonly robots: readonly ReplayRobotState[] }
  | { readonly t: number; readonly kind: 'shot'; readonly bot: string; readonly x: number; readonly y: number; readonly target: string; readonly weapon: string; readonly damage: number; readonly to_shield?: number }
  // damage is the non-shot application (grenade splash). source is the
  // thrower. x/y ride along although 11 § 4 lists them as neither
  // required nor optional: 16 § 2.3 renders events by "kind + position",
  // and a splash without a centre cannot place its blast — flagged for
  // the format's owner rather than dropped silently.
  | { readonly t: number; readonly kind: 'damage'; readonly target: string; readonly amount: number; readonly source: string; readonly to_shield: number; readonly x: number; readonly y: number }
  | { readonly t: number; readonly kind: 'death'; readonly bot: string; readonly cause: string; readonly killer?: string }
  | { readonly t: number; readonly kind: 'birth'; readonly bot: string; readonly parent: string; readonly design: string }
  | { readonly t: number; readonly kind: 'build_start'; readonly bot: string; readonly design: string; readonly cost_kg: number }
  | { readonly t: number; readonly kind: 'build_done'; readonly bot: string; readonly child: string }
  | { readonly t: number; readonly kind: 'biomass_spawn'; readonly x: number; readonly y: number }
  | { readonly t: number; readonly kind: 'biomass_taken'; readonly bot: string; readonly amount: number }
  | { readonly t: number; readonly kind: 'biomass_depleted'; readonly x: number; readonly y: number }
  | { readonly t: number; readonly kind: 'fire'; readonly bot: string; readonly weapon: string; readonly success: boolean }
  // move/aim carry the engine's own scales: throttle axes are Q16.16 raw
  // (65536 = full), the angle is the 65536 = 2π unit (D1). Both are
  // change-only (D10) — see eventLog.ts.
  | { readonly t: number; readonly kind: 'move'; readonly bot: string; readonly vx: number; readonly vy: number }
  | { readonly t: number; readonly kind: 'aim'; readonly bot: string; readonly angle: number }
  | { readonly t: number; readonly kind: 'say'; readonly bot: string; readonly channel: number; readonly payload: number }
  | { readonly t: number; readonly kind: 'eat'; readonly bot: string; readonly amount: number; readonly reason?: string }
  | { readonly t: number; readonly kind: 'vm_yield'; readonly bot: string; readonly cycles_used: number; readonly reason: string }
  | { readonly t: number; readonly kind: 'match_end'; readonly winner: 'p1' | 'p2' | 'draw'; readonly reason: 'elimination' | 'tick_cap_biomass' | 'draw_tick' | 'draw_tie' };

// The canonical final state: every robot's scalar state at the last tick
// (corpses included, alive says which) plus the cells still standing.
// 11 § 2 leaves the shape as "canonical JSON of robot positions, hp,
// energy at tick T"; the cell indices are the biomass half 8.1's result
// already carried for exactly this hash.
export interface ReplayFinalState {
  readonly robots: readonly (ReplayRobotState & { readonly alive: boolean })[];
  readonly available_cell_indices: readonly number[];
}
