import { describe, expect, it } from 'vitest';
import {
  MATCH_END_REASON,
  WINNER,
  evaluateTickOutcome,
  resolveAtTickCap,
  type SideStanding,
} from './index';

// Win conditions (04 § 6, D18): elimination, the tick-cap biomass
// tiebreak, and the two draws. Pure functions — the six dimensions ride
// on standings, which are plain data.

const standing = (aliveRobots: number, totalCarriedBiomass = 0): SideStanding => ({
  aliveRobots,
  totalCarriedBiomass,
});

describe('evaluateTickOutcome — the per-tick elimination check', () => {
  it('[normal] one side extinct, the other alive: the survivor wins by elimination', () => {
    expect(evaluateTickOutcome(standing(0), standing(2))).toEqual({ winner: WINNER.p2, reason: MATCH_END_REASON.elimination });
    expect(evaluateTickOutcome(standing(2), standing(0))).toEqual({ winner: WINNER.p1, reason: MATCH_END_REASON.elimination });
  });

  it('[normal] both alive: the match continues (null)', () => {
    expect(evaluateTickOutcome(standing(1), standing(6))).toBe(null);
  });

  it('[boundary] both sides extinct on the same tick is a draw, not a race', () => {
    expect(evaluateTickOutcome(standing(0), standing(0))).toEqual({ winner: WINNER.draw, reason: MATCH_END_REASON.drawTick });
  });

  it('[boundary] one robot alive is enough to win — the "at least 1" edge', () => {
    expect(evaluateTickOutcome(standing(1), standing(0))!.winner).toBe(WINNER.p1);
  });

  it('[invalid] negative or fractional standings are impossible states and throw', () => {
    expect(() => evaluateTickOutcome(standing(-1), standing(1))).toThrow(RangeError);
    expect(() => evaluateTickOutcome(standing(1.5), standing(1))).toThrow(RangeError);
    expect(() => evaluateTickOutcome(standing(1, -2), standing(1))).toThrow(RangeError);
    expect(() => evaluateTickOutcome(standing(1), standing(1, 0.5))).toThrow(RangeError);
  });

  it('[state] the winner is independent of carried biomass — elimination is about robots', () => {
    expect(evaluateTickOutcome(standing(0, 100), standing(1, 0))!.winner).toBe(WINNER.p2);
  });

  it('[repeat] repeated calls on the same standings answer the same way', () => {
    const once = evaluateTickOutcome(standing(0), standing(3));
    expect(evaluateTickOutcome(standing(0), standing(3))).toEqual(once);
    expect(evaluateTickOutcome(standing(0), standing(3))).toEqual(once);
  });

  it('[determinism] the same inputs give the same result — no hidden state', () => {
    const run = (): string => JSON.stringify([evaluateTickOutcome(standing(2, 7), standing(1, 9)), evaluateTickOutcome(standing(0), standing(0))]);
    expect(run()).toBe(run());
  });
});

describe('resolveAtTickCap — the biomass tiebreak (legacy/02 § 3.2)', () => {
  it('[normal] the side holding more biomass wins the cap', () => {
    expect(resolveAtTickCap(standing(2, 12), standing(3, 4))).toEqual({ winner: WINNER.p1, reason: MATCH_END_REASON.tickCapBiomass });
    expect(resolveAtTickCap(standing(2, 4), standing(3, 12))).toEqual({ winner: WINNER.p2, reason: MATCH_END_REASON.tickCapBiomass });
  });

  it('[boundary] an exact biomass tie is a draw (draw_tie)', () => {
    expect(resolveAtTickCap(standing(2, 7), standing(3, 7))).toEqual({ winner: WINNER.draw, reason: MATCH_END_REASON.drawTie });
  });

  it('[boundary] zero vs zero is a tie — two hiders with no food draw, neither wins', () => {
    expect(resolveAtTickCap(standing(1, 0), standing(1, 0))).toEqual({ winner: WINNER.draw, reason: MATCH_END_REASON.drawTie });
  });

  it('[boundary] one kilogram is enough to break the tie', () => {
    expect(resolveAtTickCap(standing(1, 0), standing(1, 1))!.winner).toBe(WINNER.p2);
  });

  it('[invalid] impossible standings throw', () => {
    expect(() => resolveAtTickCap(standing(-3), standing(1))).toThrow(RangeError);
    expect(() => resolveAtTickCap(standing(1), standing(1, -1))).toThrow(RangeError);
  });

  it('[state] a hider cannot win the cap: alive robots without biomass lose to any carrier', () => {
    expect(resolveAtTickCap(standing(6, 0), standing(1, 1))!.winner).toBe(WINNER.p2);
  });

  it('[repeat] repeated calls resolve identically', () => {
    const once = resolveAtTickCap(standing(2, 5), standing(2, 5));
    expect(resolveAtTickCap(standing(2, 5), standing(2, 5))).toEqual(once);
  });

  it('[determinism] the same standings hash to the same outcome', () => {
    const run = (): string => JSON.stringify(resolveAtTickCap(standing(1, 3), standing(2, 2)));
    expect(run()).toBe(run());
  });
});
