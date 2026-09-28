// The seam telemetry/ opens towards match/ (23-WEB-CLIENT-PLAN.md § 8.2:
// telemetry consumes the tick loop's record stream and stamps the wire
// kinds over it).
//
// 06-ARCHITECTURE.md § 5.2 forbids any context importing match/ — the
// tick loop orchestrates every context and must never become someone
// else's dependency. So, exactly like combat/'s Damageable and
// vitality/'s EnergizedRobot, telemetry declares the STRUCTURAL views it
// needs and relies on the field names being the cross-context contract
// (match/match.ts documents the same promise from its side). TypeScript
// makes match/'s MatchRecord, RobotSnapshot and MatchResult assignable to
// these views, so an EventLog is accepted by runMatch(sides, config,
// sink) without either context knowing the other at runtime.
//
// The reason/cause fields are typed `string` on purpose: 11 § 4 pins
// their wire vocabularies, but the values are stamped upstream —
// 'combat' by combat/, 'starvation' by vitality/, the vm_yield reasons
// by execution/ (06 § 5.2 forbids one shared map). Telemetry renders
// whatever the engine stamped; adding a cause must not touch this file.
//
// The completeness tests (fxTable and the mapping's exhaustive switch)
// fail if either side of this seam drifts.

// One robot's scalar state at a tick, as the snapshot event (11 § 4) and
// the final state carry it. Positions are integer millimetres (D1);
// energy is whole units (the milli pool floors at the robot boundary).
export interface SnapshotRobotView {
  readonly id: string;
  readonly xMm: number;
  readonly yMm: number;
  readonly hp: number;
  readonly shield: number;
  readonly energy: number;
  readonly biomass: number;
  readonly alive: boolean;
}

// The typed record vocabulary one tick emits (11 § 4's event shapes
// before the wire kinds are stamped). move carries the EFFECTIVE throttle
// axes — the value the engine acts on and the value D10's change-only
// rule compares. damage's toHull and killed are engine-side detail the
// wire event omits: to_hull is amount − to_shield, and killed is
// announced by the following death event.
export type MatchRecordView =
  | { readonly kind: 'move'; readonly robotId: string; readonly vx: number; readonly vy: number }
  | { readonly kind: 'aim'; readonly robotId: string; readonly angle: number }
  | { readonly kind: 'say'; readonly robotId: string; readonly channel: number; readonly payload: number }
  | { readonly kind: 'vm_yield'; readonly robotId: string; readonly cyclesUsed: number; readonly reason: string }
  | { readonly kind: 'fire'; readonly robotId: string; readonly weaponPartId: string; readonly success: boolean }
  | { readonly kind: 'shot'; readonly attackerId: string; readonly weaponPartId: string; readonly xMm: number; readonly yMm: number; readonly targetId: string; readonly damage: number; readonly toShield: number }
  | { readonly kind: 'damage'; readonly throwerId: string; readonly xMm: number; readonly yMm: number; readonly targetId: string; readonly amount: number; readonly toShield: number; readonly toHull: number; readonly killed: boolean }
  | { readonly kind: 'death'; readonly botId: string; readonly cause: string; readonly killerId: string | null; readonly bounty: number }
  | { readonly kind: 'eat'; readonly botId: string; readonly consumedBiomass: number; readonly gainedEnergy: number; readonly reason: string }
  | { readonly kind: 'biomass_taken'; readonly robotId: string; readonly amount: number; readonly cellIndex: number }
  | { readonly kind: 'biomass_depleted'; readonly cellIndex: number; readonly xMm: number; readonly yMm: number }
  | { readonly kind: 'biomass_spawn'; readonly cellIndex: number; readonly xMm: number; readonly yMm: number }
  | { readonly kind: 'build_start'; readonly robotId: string; readonly designIndex: number; readonly costKg: number }
  | { readonly kind: 'build_done'; readonly robotId: string; readonly childId: string }
  | { readonly kind: 'birth'; readonly robotId: string; readonly parentRobotId: string; readonly designIndex: number };

// A match's end state, as the replay document reads it. winner and reason
// are closed unions because 11 § 2 pins them on the wire — if the win
// condition's vocabulary ever grows, the caller's assignment fails here
// loudly instead of producing an undocumented reason string.
export interface MatchResultView {
  readonly winner: 'p1' | 'p2' | 'draw';
  readonly reason: 'elimination' | 'tick_cap_biomass' | 'draw_tick' | 'draw_tie';
  readonly durationTicks: number;
  readonly finalRobots: readonly SnapshotRobotView[];
  // Indices of the cells standing at the end. The cell layout itself is
  // deterministic from seed + arena, so the indices are the biomass half
  // of the canonical final state.
  readonly availableCellIndices: readonly number[];
}

// The shape match/'s MatchSink expects from a sink. EventLog satisfies
// this structurally; nothing here is imported by match/.
export interface MatchSinkView {
  recordTick(tick: number, records: readonly MatchRecordView[]): void;
  snapshot(tick: number, robots: readonly SnapshotRobotView[]): void;
}
