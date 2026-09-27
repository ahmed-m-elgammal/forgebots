// The hardware catalog and the two functions that consume it — aggregate
// and validateChassis (06-ARCHITECTURE.md § 2 places all three in
// robot/parts.ts; 20-IMPLEMENTATION-PLAN.md Phase 03).
//
// The catalog is DATA (parts-catalog.json, 20 T03.3) so a balance patch
// can ship JSON, not TS; this module is the schema that validates it at
// load and the single owner of part ids as a const map (AGENTS.md rule 4,
// tier 2: 04 § 3.2's table is the source, this map is the code surface).
//
// Reconciliations with the spec, documented rather than silent:
// - The catalog forbids stacking exactly where 04 § 3.2 defines no
//   combination rule: one drivetrain per chassis (mobility category,
//   so mk1+mk2 is also rejected), one constructor; one of each sensor
//   id (two radars of different kinds are legal and the best range
//   wins — D16 gates radar() on presence and prices the part value).
//   Where the spec DOES define a combination, stacking is allowed and
//   bounded only by the 8 part slots: weapons ("fire every fitted
//   weapon", 04 § 4.2), shields (maxShieldHp = sum, D7), storage
//   (+25 each), generators (signed power sum, D6).
// - The hover unit's top speed is unspecified in 04 § 3.2. It is set to
//   Mk-1 parity (2500 mm/s) so its handling perks (+30 % accel, friction
//   immunity) are the reason to fit it and Mk-2 keeps the speed niche.
// - validateChassis enforces D6's signed-sum rule: generators free
//   power headroom. 13 § 4's "68 W left" display is the draw-only view;
//   the contract is the signed sum (22-DECISIONS.md D6 wins).
// - Power crosses this module in integer milliwatts (D6): a 5 W draw is
//   5000, never 5, never 0 — the floor(power/60) bug that made every
//   sub-60 W part free is guarded by a regression test (T6, AGENTS.md § 3).

import catalogJson from './parts-catalog.json';
// design.ts imports only a type from here, so this value import creates
// no runtime cycle.
import { CHASSIS_LIMITS } from './design';
import type { Chassis, ChassisStats, WeaponLoadout } from './design';

export const PART_ID = {
  mk1Engine: 'mk1_engine',
  mk2Engine: 'mk2_engine',
  hoverUnit: 'hover_unit',
  shortRadar: 'short_radar',
  longRadar: 'long_radar',
  directionalScanner: 'directional_scanner',
  proximity: 'proximity',
  blaster: 'blaster',
  heavyBlaster: 'heavy_blaster',
  grenade: 'grenade',
  lightShield: 'light_shield',
  heavyShield: 'heavy_shield',
  constructor: 'constructor',
  storage: 'storage',
  solarPanel: 'solar_panel',
  reactor: 'reactor',
} as const;

export type PartId = (typeof PART_ID)[keyof typeof PART_ID];

export const PART_CATEGORY = {
  mobility: 'mobility',
  sensor: 'sensor',
  weapon: 'weapon',
  defense: 'defense',
  construction: 'construction',
  energy: 'energy',
} as const;

export type PartCategory = (typeof PART_CATEGORY)[keyof typeof PART_CATEGORY];

export type PartEffect =
  | { readonly kind: 'mobility'; readonly topSpeedMmPerSec: number; readonly accelPermyriad: number; readonly ignoresFriction: boolean }
  | { readonly kind: 'radar'; readonly rangeMm: number; readonly rateHz: number }
  | { readonly kind: 'scanner'; readonly rangeMm: number; readonly coneBrads: number; readonly rateHz: number }
  | { readonly kind: 'proximity'; readonly rangeMm: number; readonly rateHz: number }
  | { readonly kind: 'weapon'; readonly damagePerHit: number; readonly cooldownTicks: number; readonly rangeMm: number | null; readonly splashRadiusMm: number | null }
  | { readonly kind: 'shield'; readonly shieldHp: number; readonly regenMilliHpPerSecond: number }
  | { readonly kind: 'constructor'; readonly buildRateMilliKgPerSecond: number }
  | { readonly kind: 'storage'; readonly bonusCarryCapacity: number }
  | { readonly kind: 'generator' };

export interface CatalogPart {
  readonly id: PartId;
  readonly category: PartCategory;
  readonly massKg: number;
  readonly powerW: number;
  readonly stackLimit: number;
  readonly effect: PartEffect;
}

export const BASE_CARRY_CAPACITY = 25;
export const BASE_ENERGY_MAX = 500;
export const BASE_ACCEL_PERMYRIAD = 10000;
// 30 degrees in the 16-bit circular unit (D1), floored to the nearest brad.
const SCANNER_CONE_DEGREES = 30;
const SCANNER_CONE_BRADS = ((SCANNER_CONE_DEGREES * 65536) / 360) | 0;
const MILLIWATTS_PER_WATT = 1000;
const HULL_HP_PER_MASS_HALF = 3;

function assertInt(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new TypeError(`catalog ${label} must be an integer, got ${String(value)}`);
  }
  return value;
}

function assertBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new TypeError(`catalog ${label} must be a boolean, got ${String(value)}`);
  }
  return value;
}

function parseEffect(id: string, raw: Record<string, unknown>): PartEffect {
  const kind = raw['kind'];
  switch (kind) {
    case 'mobility':
      return {
        kind,
        topSpeedMmPerSec: assertInt(raw['topSpeedMmPerSec'], `${id} topSpeedMmPerSec`),
        accelPermyriad: assertInt(raw['accelPermyriad'] ?? BASE_ACCEL_PERMYRIAD, `${id} accelPermyriad`),
        ignoresFriction: assertBoolean(raw['ignoresFriction'] ?? false, `${id} ignoresFriction`),
      };
    case 'radar':
    case 'proximity':
      return { kind, rangeMm: assertInt(raw['rangeMm'], `${id} rangeMm`), rateHz: assertInt(raw['rateHz'], `${id} rateHz`) };
    case 'scanner':
      return {
        kind,
        rangeMm: assertInt(raw['rangeMm'], `${id} rangeMm`),
        coneBrads: SCANNER_CONE_BRADS,
        rateHz: assertInt(raw['rateHz'], `${id} rateHz`),
      };
    case 'weapon': {
      const rangeMm = raw['rangeMm'] ?? null;
      const splashRadiusMm = raw['splashRadiusMm'] ?? null;
      if (rangeMm === null && splashRadiusMm === null) {
        throw new TypeError(`catalog ${id} weapon effect needs rangeMm or splashRadiusMm`);
      }
      return {
        kind,
        damagePerHit: assertInt(raw['damagePerHit'], `${id} damagePerHit`),
        cooldownTicks: assertInt(raw['cooldownTicks'], `${id} cooldownTicks`),
        rangeMm: rangeMm === null ? null : assertInt(rangeMm, `${id} rangeMm`),
        splashRadiusMm: splashRadiusMm === null ? null : assertInt(splashRadiusMm, `${id} splashRadiusMm`),
      };
    }
    case 'shield':
      return {
        kind,
        shieldHp: assertInt(raw['shieldHp'], `${id} shieldHp`),
        regenMilliHpPerSecond: assertInt(raw['regenMilliHpPerSecond'], `${id} regenMilliHpPerSecond`),
      };
    case 'constructor':
      return { kind, buildRateMilliKgPerSecond: assertInt(raw['buildRateMilliKgPerSecond'], `${id} buildRateMilliKgPerSecond`) };
    case 'storage':
      return { kind, bonusCarryCapacity: assertInt(raw['bonusCarryCapacity'], `${id} bonusCarryCapacity`) };
    case 'generator':
      return { kind };
    default:
      throw new TypeError(`catalog ${id} has unknown effect kind ${String(kind)}`);
  }
}

// The catalog schema (20 T03.3): every row must carry an id from the
// PART_ID map, a known category, a stack limit inside the part-slot
// bound, and a well-formed effect for its kind. Exported because this IS
// the schema enforcement a drifted or hand-edited catalog document is
// tested against — the shipped JSON passes through the same gate.
export function parseCatalog(data: unknown): readonly CatalogPart[] {
  const version = assertInt((data as Record<string, unknown>)['version'], 'version');
  if (version !== 1) {
    throw new TypeError(`catalog version must be 1, got ${version}`);
  }
  const rows = (data as { parts: Record<string, unknown>[] }).parts;
  const seen = new Set<string>();
  const parts: CatalogPart[] = [];
  for (const row of rows) {
    const id = row['id'];
    if (typeof id !== 'string' || !Object.values(PART_ID).includes(id as PartId)) {
      throw new TypeError(`catalog part id ${String(id)} is not in the PART_ID map`);
    }
    const partId = id as PartId;
    if (seen.has(partId)) {
      throw new TypeError(`catalog lists ${partId} twice`);
    }
    seen.add(partId);
    const category = row['category'];
    if (typeof category !== 'string' || !(category in PART_CATEGORY)) {
      throw new TypeError(`catalog ${partId} has unknown category ${String(category)}`);
    }
    const stackLimit = assertInt(row['stackLimit'], `${partId} stackLimit`);
    if (stackLimit < 1 || stackLimit > CHASSIS_LIMITS.partSlots) {
      throw new TypeError(`catalog ${partId} stackLimit ${stackLimit} outside 1..${CHASSIS_LIMITS.partSlots}`);
    }
    parts.push({
      id: partId,
      category: category as PartCategory,
      massKg: assertInt(row['massKg'], `${partId} massKg`),
      powerW: assertInt(row['powerW'], `${partId} powerW`),
      stackLimit,
      effect: parseEffect(partId, (row['effect'] ?? {}) as Record<string, unknown>),
    });
  }
  if (parts.length !== Object.keys(PART_ID).length) {
    throw new TypeError(`catalog must list every PART_ID exactly once (${parts.length} of ${Object.keys(PART_ID).length})`);
  }
  return parts;
}

export const PARTS: readonly CatalogPart[] = Object.freeze(parseCatalog(catalogJson));

export const PARTS_BY_ID: Readonly<Record<PartId, CatalogPart>> = Object.freeze(
  Object.fromEntries(PARTS.map((part) => [part.id, part])) as Record<PartId, CatalogPart>,
);

// 04 § 3.2 defines no combination rule across mobility kinds, so at most
// one drivetrain part is fitted per chassis (see the header note).
const MOBILITY_STACK_LIMIT = 1;

export const CHASSIS_ERROR_CODES = {
  slots: 'E_CHASSIS_SLOTS',
  unknownPart: 'E_CHASSIS_UNKNOWN_PART',
  stack: 'E_CHASSIS_STACK',
  mobility: 'E_CHASSIS_MOBILITY',
  mass: 'E_CHASSIS_MASS',
  power: 'E_CHASSIS_POWER',
} as const;

export type ChassisErrorCode = (typeof CHASSIS_ERROR_CODES)[keyof typeof CHASSIS_ERROR_CODES];

export interface ChassisIssue {
  readonly code: ChassisErrorCode;
  readonly partId?: PartId;
  readonly limit?: number;
  readonly actual?: number;
}

export type ChassisVerdict = { readonly ok: true } | { readonly ok: false; readonly issues: readonly ChassisIssue[] };

// The six chassis contracts of 04 § 3.1 / D6 / 20 Phase 03, checked in a
// fixed order so a verdict is deterministic. All issues are reported, not
// just the first — the builder shows totals and errors together (13 § 4).
export function validateChassis(chassis: Chassis): ChassisVerdict {
  const issues: ChassisIssue[] = [];
  if (chassis.parts.length > CHASSIS_LIMITS.partSlots) {
    issues.push({ code: CHASSIS_ERROR_CODES.slots, limit: CHASSIS_LIMITS.partSlots, actual: chassis.parts.length });
  }
  const counts = new Map<PartId, number>();
  let massKg = 0;
  let netPowerMilliwatts = 0;
  let mobilityCount = 0;
  for (const partId of chassis.parts) {
    const part = PARTS_BY_ID[partId];
    if (part === undefined) {
      issues.push({ code: CHASSIS_ERROR_CODES.unknownPart, partId });
      continue;
    }
    counts.set(partId, (counts.get(partId) ?? 0) + 1);
    if (part.category === PART_CATEGORY.mobility) {
      mobilityCount++;
    }
    massKg += part.massKg;
    netPowerMilliwatts += part.powerW * MILLIWATTS_PER_WATT;
  }
  for (const [partId, count] of counts) {
    const limit = PARTS_BY_ID[partId]!.stackLimit;
    if (count > limit) {
      issues.push({ code: CHASSIS_ERROR_CODES.stack, partId, limit, actual: count });
    }
  }
  if (mobilityCount > MOBILITY_STACK_LIMIT) {
    issues.push({ code: CHASSIS_ERROR_CODES.mobility, limit: MOBILITY_STACK_LIMIT, actual: mobilityCount });
  }
  if (massKg > CHASSIS_LIMITS.massKg) {
    issues.push({ code: CHASSIS_ERROR_CODES.mass, limit: CHASSIS_LIMITS.massKg, actual: massKg });
  }
  if (netPowerMilliwatts > CHASSIS_LIMITS.netPowerMilliwatts) {
    issues.push({
      code: CHASSIS_ERROR_CODES.power,
      limit: CHASSIS_LIMITS.netPowerMilliwatts,
      actual: netPowerMilliwatts,
    });
  }
  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}

// massKg x 1.5, floored, in pure integers (04 § 3.1). massKg is a
// non-negative catalog sum, so truncation is floor here.
function hullHpForMass(massKg: number): number {
  return ((massKg * HULL_HP_PER_MASS_HALF) / 2) | 0;
}

// Aggregates a chassis into the derived stats every later context reads.
// Deterministic and total over known ids: sensors take the best fitted
// range, weapons keep the design's own part order (combat/ fires them in
// that order), stackable effects sum. Unknown ids throw — validateChassis
// is the boundary that catches them first (G33).
export function aggregate(chassis: Chassis): ChassisStats {
  let massKg = 0;
  let powerDrawMilliwatts = 0;
  let powerGenerationMilliwatts = 0;
  let maxShieldHp = 0;
  let shieldRegenMilliHpPerSecond = 0;
  let carryCapacity = BASE_CARRY_CAPACITY;
  let topSpeedMmPerSec = 0;
  let accelPermyriad = BASE_ACCEL_PERMYRIAD;
  let ignoresFriction = false;
  let radarRangeMm = 0;
  let scanRangeMm = 0;
  let scanConeBrads = 0;
  let proximityRangeMm = 0;
  let buildRateMilliKgPerSecond = 0;
  const weapons: WeaponLoadout[] = [];
  for (const partId of chassis.parts) {
    const part = PARTS_BY_ID[partId];
    if (part === undefined) {
      throw new TypeError(`unknown part id ${String(partId)}`);
    }
    massKg += part.massKg;
    if (part.powerW > 0) {
      powerDrawMilliwatts += part.powerW * MILLIWATTS_PER_WATT;
    } else {
      powerGenerationMilliwatts += -part.powerW * MILLIWATTS_PER_WATT;
    }
    const effect = part.effect;
    switch (effect.kind) {
      case 'mobility':
        topSpeedMmPerSec = effect.topSpeedMmPerSec > topSpeedMmPerSec ? effect.topSpeedMmPerSec : topSpeedMmPerSec;
        accelPermyriad = effect.accelPermyriad;
        ignoresFriction = ignoresFriction || effect.ignoresFriction;
        break;
      case 'radar':
        radarRangeMm = effect.rangeMm > radarRangeMm ? effect.rangeMm : radarRangeMm;
        break;
      case 'scanner':
        scanRangeMm = effect.rangeMm;
        scanConeBrads = effect.coneBrads;
        break;
      case 'proximity':
        proximityRangeMm = effect.rangeMm > proximityRangeMm ? effect.rangeMm : proximityRangeMm;
        break;
      case 'weapon':
        weapons.push({
          partId,
          damagePerHit: effect.damagePerHit,
          cooldownTicks: effect.cooldownTicks,
          rangeMm: effect.rangeMm,
          splashRadiusMm: effect.splashRadiusMm,
        });
        break;
      case 'shield':
        maxShieldHp += effect.shieldHp;
        shieldRegenMilliHpPerSecond += effect.regenMilliHpPerSecond;
        break;
      case 'constructor':
        buildRateMilliKgPerSecond = effect.buildRateMilliKgPerSecond;
        break;
      case 'storage':
        carryCapacity += effect.bonusCarryCapacity;
        break;
      case 'generator':
        break;
    }
  }
  return {
    massKg,
    powerDrawMilliwatts,
    powerGenerationMilliwatts,
    netPowerMilliwatts: powerDrawMilliwatts - powerGenerationMilliwatts,
    maxHullHp: hullHpForMass(massKg),
    maxShieldHp,
    shieldRegenMilliHpPerSecond,
    carryCapacity,
    energyMax: BASE_ENERGY_MAX,
    topSpeedMmPerSec,
    accelPermyriad,
    ignoresFriction,
    radarRangeMm,
    scanRangeMm,
    scanConeBrads,
    proximityRangeMm,
    buildRateMilliKgPerSecond,
    weapons,
  };
}
