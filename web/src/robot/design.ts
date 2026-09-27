// The robot context's design vocabulary (06-ARCHITECTURE.md § 2:
// design.ts holds Design, Chassis, ChassisStats, CHASSIS_LIMITS).
//
// Vocabulary is load-bearing (22-DECISIONS.md D12, AGENTS.md N3): a
// "design" is one chassis + one program; the program itself joins at
// match/ level because robot/ may import only math/ and its own
// directory (06 § 5.2) — program/ is a sibling context.
//
// Units (D1): masses are integer kilograms exactly as the 04 § 3.2
// catalog table states them; power crosses this module in integer
// milliwatts (D6) so no caller can mistake watts for the drain scale.

import type { PartId } from './parts';

export const CHASSIS_LIMITS = {
  partSlots: 8,
  massKg: 50,
  // Signed sum: a generator's negative power frees headroom (D6).
  // The catalog's watt numbers cross the boundary scaled by 1000.
  netPowerMilliwatts: 80000,
  designsPerBotMin: 1,
  designsPerBotMax: 3,
  robotsPerDesignMax: 4,
  robotsPerSideMax: 6,
} as const;

export interface Chassis {
  readonly parts: readonly PartId[];
}

export interface Design {
  readonly name: string;
  readonly chassis: Chassis;
}

// One fitted weapon as combat/ will consume it (task 3). Hitscan weapons
// carry rangeMm; the grenade is an arcing splash projectile (04 § 3.2.1)
// and carries splashRadiusMm instead — the ballistic model lands with
// combat/ and must not be invented here.
export interface WeaponLoadout {
  readonly partId: PartId;
  readonly damagePerHit: number;
  readonly cooldownTicks: number;
  readonly rangeMm: number | null;
  readonly splashRadiusMm: number | null;
}

export interface ChassisStats {
  readonly massKg: number;
  // Signed power in milliwatts (D6): draw and generation kept separate
  // for the builder's three-number display (13 § 4), net for the drain.
  readonly powerDrawMilliwatts: number;
  readonly powerGenerationMilliwatts: number;
  readonly netPowerMilliwatts: number;
  readonly maxHullHp: number;
  readonly maxShieldHp: number;
  readonly shieldRegenMilliHpPerSecond: number;
  readonly carryCapacity: number;
  readonly energyMax: number;
  readonly topSpeedMmPerSec: number;
  // 10000 = x1.0. The hover unit's +30 % accel (04 § 3.2) is relative to
  // a base the physics phase defines; storing the ratio keeps that base
  // out of the catalog.
  readonly accelPermyriad: number;
  readonly ignoresFriction: boolean;
  readonly radarRangeMm: number;
  readonly scanRangeMm: number;
  readonly scanConeBrads: number;
  readonly proximityRangeMm: number;
  readonly buildRateMilliKgPerSecond: number;
  readonly weapons: readonly WeaponLoadout[];
}

export const DESIGN_ERROR_CODES = {
  count: 'E_DESIGN_COUNT',
  name: 'E_DESIGN_NAME',
} as const;

export type DesignErrorCode = (typeof DESIGN_ERROR_CODES)[keyof typeof DESIGN_ERROR_CODES];

export interface DesignIssue {
  readonly code: DesignErrorCode;
  readonly limit?: number;
  readonly actual?: number;
  readonly designIndex?: number;
}

export type DesignVerdict = { readonly ok: true } | { readonly ok: false; readonly issues: readonly DesignIssue[] };

// A saved bot fields 1-3 designs (D12). Each design needs a non-empty
// name because the replay's stable robot id embeds it (11 § 3:
// p1.<design>.<index>).
export function validateDesignList(designs: readonly Design[]): DesignVerdict {
  const issues: DesignIssue[] = [];
  if (
    designs.length < CHASSIS_LIMITS.designsPerBotMin ||
    designs.length > CHASSIS_LIMITS.designsPerBotMax
  ) {
    issues.push({
      code: DESIGN_ERROR_CODES.count,
      limit: CHASSIS_LIMITS.designsPerBotMax,
      actual: designs.length,
    });
  }
  for (let i = 0; i < designs.length; i++) {
    if (designs[i]!.name.length === 0) {
      issues.push({ code: DESIGN_ERROR_CODES.name, designIndex: i });
    }
  }
  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}
