// Angles — 16-bit circular, 65536 brads = 2π, π = 32768 (22-DECISIONS.md
// D1). This unit is deliberately different from the Q16.16 trig return
// scale (65536 = 1.0); conflating them is a spec violation, not a style
// choice. Trig tables arrive in a later phase; Phase 1 only owns wrapping
// and the shortest-path difference.
//
// wrapToPi is the reorient idea kept from the predecessor (legacy/01
// § 4.3): angles are a wrapped quantity and wrapping them is a real
// operation, normalised into (−π, π] — so −π maps to +π and a heading is
// always a single canonical integer.

import { assertInteger } from './fixed';

declare const angleBrand: unique symbol;

export type Angle = number & { readonly [angleBrand]: true };

export const BRADS_PER_TURN = 65536;
const HALF_TURN = 32768;

export const ANGLE_PI: Angle = 32768 as Angle;

// Accepts any integer heading — including unbounded accumulators — and
// normalises into (−π, π]. Every Angle in circulation satisfies that
// invariant because this is the only constructor.
export function wrapToPi(raw: number): Angle {
  assertInteger(raw, 'angle');
  let wrapped = raw % BRADS_PER_TURN;
  if (wrapped > HALF_TURN) {
    wrapped -= BRADS_PER_TURN;
  } else if (wrapped <= -HALF_TURN) {
    wrapped += BRADS_PER_TURN;
  }
  return wrapped as Angle;
}

// Signed shortest path from `from` to `to`: turning 179° → −179° yields
// +2°, not 358° (23-WEB-CLIENT-PLAN.md § 4, 1.2). At exact antipodes the
// result is +π — both directions are equally short and the positive one is
// the canonical choice.
export function angleDiff(from: Angle, to: Angle): Angle {
  return wrapToPi(to - from);
}

// Unsigned smallest angle between two headings, in [0, π].
export function angleBetween(a: Angle, b: Angle): Angle {
  const diff = angleDiff(a, b);
  return (diff < 0 ? -diff : diff) as Angle;
}
