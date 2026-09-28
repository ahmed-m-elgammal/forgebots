// Win conditions (23 § 8.1; 04-GAME-DESIGN.md § 6; 22-DECISIONS.md D18;
// 20-IMPLEMENTATION-PLAN.md Phase 10 T12.3). MVP ships one mode:
// Eliminator — last side with at least one alive robot wins. At the tick
// cap the side holding more total biomass wins, which is exactly the
// anti-stall pressure legacy/02 § 3.2 asks for: a hider with no food
// cannot win a tick cap. Both sides extinct on the same tick, or a
// biomass tie at the cap, is a draw.
//
// The end-reason vocabulary of 11-REPLAY-FORMAT.md § 2 ("the viewer's
// result card does not have to infer it") is owned here as a const map
// (AGENTS.md rule 4, tier 2) — telemetry/ stamps it into the match_end
// event in the next phase. Pure functions over side standings: no clock,
// no rng, no mutation, so the same standings always resolve the same way.

export const WINNER = {
  p1: 'p1',
  p2: 'p2',
  draw: 'draw',
} as const;

export type Winner = (typeof WINNER)[keyof typeof WINNER];

export const MATCH_END_REASON = {
  elimination: 'elimination',
  drawTick: 'draw_tick',
  tickCapBiomass: 'tick_cap_biomass',
  drawTie: 'draw_tie',
} as const;

export type MatchEndReason = (typeof MATCH_END_REASON)[keyof typeof MATCH_END_REASON];

// What one side fields right now: living robots and the biomass they
// carry. Dead robots are excluded at the source — a corpse's carry was
// zeroed at death (combat/damage.ts) — but the standing counts only the
// living, so the tiebreak reads the same either way.
export interface SideStanding {
  readonly aliveRobots: number;
  readonly totalCarriedBiomass: number;
}

export interface MatchOutcome {
  readonly winner: Winner;
  readonly reason: MatchEndReason;
}

function assertStanding(standing: SideStanding, label: string): void {
  if (!Number.isInteger(standing.aliveRobots) || standing.aliveRobots < 0) {
    throw new RangeError(`${label} aliveRobots must be a non-negative integer, got ${standing.aliveRobots}`);
  }
  if (!Number.isInteger(standing.totalCarriedBiomass) || standing.totalCarriedBiomass < 0) {
    throw new RangeError(`${label} totalCarriedBiomass must be a non-negative integer, got ${standing.totalCarriedBiomass}`);
  }
}

// One side extinct, the other not → the survivor wins by elimination.
// Both extinct on the same tick → draw (draw_tick: 04 § 6's "both sides
// extinct on the same tick"). Both alive → null: the match continues.
// Called once per tick, after the pipeline, so same-tick mutual
// destruction is seen as a draw rather than racing to who died first.
export function evaluateTickOutcome(p1: SideStanding, p2: SideStanding): MatchOutcome | null {
  assertStanding(p1, 'p1');
  assertStanding(p2, 'p2');
  const p1Dead = p1.aliveRobots === 0;
  const p2Dead = p2.aliveRobots === 0;
  if (p1Dead && p2Dead) {
    return { winner: WINNER.draw, reason: MATCH_END_REASON.drawTick };
  }
  if (p1Dead) {
    return { winner: WINNER.p2, reason: MATCH_END_REASON.elimination };
  }
  if (p2Dead) {
    return { winner: WINNER.p1, reason: MATCH_END_REASON.elimination };
  }
  return null;
}

// The tick-cap tiebreak (04 § 6): the side holding more total biomass
// wins; a tie — including both sides at zero — is a draw (draw_tie).
// This is the function that makes corner-hiding a losing strategy
// (legacy/02 § 3.2): hiding yields no biomass, so a hider cannot win the
// cap; it can only hope its opponent hides worse.
export function resolveAtTickCap(p1: SideStanding, p2: SideStanding): MatchOutcome {
  assertStanding(p1, 'p1');
  assertStanding(p2, 'p2');
  if (p1.totalCarriedBiomass > p2.totalCarriedBiomass) {
    return { winner: WINNER.p1, reason: MATCH_END_REASON.tickCapBiomass };
  }
  if (p2.totalCarriedBiomass > p1.totalCarriedBiomass) {
    return { winner: WINNER.p2, reason: MATCH_END_REASON.tickCapBiomass };
  }
  return { winner: WINNER.draw, reason: MATCH_END_REASON.drawTie };
}
