// Q16.16 fixed point — 1 world unit = 1 metre (22-DECISIONS.md D1).
// Raw storage is a 32-bit signed integer: 65536 raw = 1.0 m, precision
// 1/65536 m ≈ 0.015 mm, range ±32,767.99998 m (D1's ±32,767 m with 160×
// headroom over the 200 m arena).
//
// D1 named these helpers mmToFixed / fixedToMm / fdiv / fmul / clamp; the
// Phase 1 surface (23-WEB-CLIENT-PLAN.md § 4) uses fromMm / toMm /
// div / mul / clamp for the same operations. One vocabulary (AGENTS.md G11).
//
// Every value that crosses the wire (DSL, replay, API) is integer
// millimetres and converts here, at the boundary, and nowhere else (G33).
// Division by zero saturates instead of throwing, matching the
// predecessor machine (legacy/01 § 2). All arithmetic is integer; the
// BigInt intermediates exist only where a product would exceed 2^53.

declare const fixedBrand: unique symbol;

export type Fixed = number & { readonly [fixedBrand]: true };

export const RAW_PER_UNIT = 65536;
const FRACTION_BITS = 16;
const HALF_UNIT = 32768;
const MAX_RAW = 0x7fffffff;
const MIN_RAW = -MAX_RAW;
const MM_PER_UNIT = 1000;
const MAX_MM = 32767999;

export const FIXED_ZERO: Fixed = 0 as Fixed;
export const FIXED_ONE: Fixed = RAW_PER_UNIT as Fixed;
export const FIXED_MAX: Fixed = MAX_RAW as Fixed;
export const FIXED_MIN: Fixed = MIN_RAW as Fixed;

const asFixed = (raw: number): Fixed => raw as Fixed;

// Saturating cast from a wide exact integer into the Q16.16 range. Exported
// for sibling math modules that compute in BigInt (dot products, lengths)
// and must come back into Fixed without wrapping.
export function saturate(raw: bigint): Fixed {
  if (raw > BigInt(MAX_RAW)) return FIXED_MAX;
  if (raw < BigInt(MIN_RAW)) return FIXED_MIN;
  return asFixed(Number(raw));
}

function saturateNumber(raw: number): Fixed {
  if (raw > MAX_RAW) return FIXED_MAX;
  if (raw < MIN_RAW) return FIXED_MIN;
  return asFixed(raw);
}

function assertInteger(value: number, label: string): void {
  if (!Number.isInteger(value)) {
    throw new TypeError(`${label} must be an integer, got ${value}`);
  }
}

export function fromRaw(raw: number): Fixed {
  assertInteger(raw, 'Fixed raw value');
  if (raw > MAX_RAW || raw < MIN_RAW) {
    throw new RangeError(`Fixed raw value out of Q16.16 range, got ${raw}`);
  }
  return asFixed(raw);
}

export function rawValue(value: Fixed): number {
  return value;
}

// Rounds half away from zero: 1 mm → 66 raw (65.536 exactly). Millimetres
// beyond ±MAX_MM would round outside Q16.16, which is an impossible world
// coordinate, not a saturation case.
export function fromMm(mm: number): Fixed {
  assertInteger(mm, 'millimetre length');
  if (mm > MAX_MM || mm < -MAX_MM) {
    throw new RangeError(`millimetre length out of Q16.16 range, got ${mm}`);
  }
  const scaled = BigInt(mm) * BigInt(RAW_PER_UNIT);
  const quotient = scaled / BigInt(MM_PER_UNIT);
  const remainder = scaled % BigInt(MM_PER_UNIT);
  const magnitude = remainder < 0n ? -remainder : remainder;
  const rounded =
    magnitude * 2n >= BigInt(MM_PER_UNIT)
      ? quotient + (scaled < 0n ? -1n : 1n)
      : quotient;
  return asFixed(Number(rounded));
}

export function toMm(value: Fixed): number {
  const scaled = BigInt(value) * BigInt(MM_PER_UNIT);
  const quotient = scaled / BigInt(RAW_PER_UNIT);
  const remainder = scaled % BigInt(RAW_PER_UNIT);
  const magnitude = remainder < 0n ? -remainder : remainder;
  const rounded =
    magnitude * 2n >= BigInt(RAW_PER_UNIT)
      ? quotient + (scaled < 0n ? -1n : 1n)
      : quotient;
  return Number(rounded);
}

export function add(a: Fixed, b: Fixed): Fixed {
  return saturateNumber(a + b);
}

export function sub(a: Fixed, b: Fixed): Fixed {
  return saturateNumber(a - b);
}

export function neg(a: Fixed): Fixed {
  return a === FIXED_ZERO ? FIXED_ZERO : asFixed(-a);
}

export function mul(a: Fixed, b: Fixed): Fixed {
  return saturate((BigInt(a) * BigInt(b)) / BigInt(RAW_PER_UNIT));
}

// Truncates the exact quotient toward zero, like C integer division.
// Division by zero saturates toward the sign of the numerator (legacy/01 § 2).
export function div(a: Fixed, b: Fixed): Fixed {
  if (b === FIXED_ZERO) {
    return a >= FIXED_ZERO ? FIXED_MAX : FIXED_MIN;
  }
  return saturate((BigInt(a) * BigInt(RAW_PER_UNIT)) / BigInt(b));
}

export function cmp(a: Fixed, b: Fixed): -1 | 0 | 1 {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function min(a: Fixed, b: Fixed): Fixed {
  return a <= b ? a : b;
}

export function max(a: Fixed, b: Fixed): Fixed {
  return a >= b ? a : b;
}

export function clamp(value: Fixed, lo: Fixed, hi: Fixed): Fixed {
  if (lo > hi) {
    throw new RangeError(`clamp bounds inverted: lo ${lo} > hi ${hi}`);
  }
  if (value < lo) return lo;
  if (value > hi) return hi;
  return value;
}

// Arithmetic shift floors, which is exactly what floor means here. The only
// overflow edge is floor(FIXED_MIN), one raw unit below the symmetric range,
// which saturates rather than wrapping.
export function floor(value: Fixed): Fixed {
  return saturateNumber((value >> FRACTION_BITS) * RAW_PER_UNIT);
}

export function ceiling(value: Fixed): Fixed {
  return saturateNumber(-((-value >> FRACTION_BITS) * RAW_PER_UNIT));
}

// Half away from zero: round(2.5) = 3, round(-2.5) = -3. floor() alone is
// what made the predecessor's sub-60 W parts free — floor(5 / 60) is 0 —
// so the rounding semantics are pinned by tests at the exact halfway raw.
export function round(value: Fixed): Fixed {
  const negative = value < 0;
  const magnitude = negative ? -value : value;
  const shifted = magnitude + HALF_UNIT;
  const units = (shifted - (shifted % RAW_PER_UNIT)) / RAW_PER_UNIT;
  return saturateNumber(negative ? -units * RAW_PER_UNIT : units * RAW_PER_UNIT);
}


// floor(sqrt(wide)) for a non-negative bigint, by integer Newton iteration.
export function isqrt(wide: bigint): number {
  if (wide < 0n) {
    throw new RangeError(`isqrt of negative value ${wide}`);
  }
  if (wide === 0n) return 0;
  let r = wide;
  let next = (r + wide / r) >> 1n;
  while (next < r) {
    r = next;
    next = (r + wide / r) >> 1n;
  }
  return Number(r);
}

// sqrt in metres: raw_v metres has raw sqrt(v * 65536) = sqrt(v) · 256.
// Floors, like every other exactness-losing op here.
export function sqrt(value: Fixed): Fixed {
  if (value < FIXED_ZERO) {
    throw new RangeError(`sqrt of negative value ${value}`);
  }
  return asFixed(isqrt(BigInt(value) << BigInt(FRACTION_BITS)));
}
