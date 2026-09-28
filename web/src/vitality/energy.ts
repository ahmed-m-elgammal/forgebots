// The energy pool — the drain half of Phase 4 task 4 (23 § 7.4;
// 20-IMPLEMENTATION-PLAN.md Phase 13 T15.1, T15.4, T15.5;
// 22-DECISIONS.md D6). Power is signed milliwatts; the pool is integer
// energy MILLI-units, and the per-tick drain carries its remainder so a
// 5 W draw costs 83 milli-units/tick and never floor(5/60) = 0 — the
// floor-to-zero bug that made every sub-60 W part free.
//
// The accumulator, exactly: each tick adds netPowerMilliwatts to
// energyRemainder (milliwatt-ticks), then floor-divides it by
// TICKS_PER_SECOND. The quotient is the pool change in milli-units; the
// remainder stays in [0, 60) for the next tick. Floor division (not
// truncation) is what keeps recharge symmetric: a 10 W reactor banks
// 167 milli-units on tick 1 and 166 on tick 3, averaging exactly
// 166 2/3. Over one second a 5 W draw costs 250 milli-units = 5 W·s —
// dimensionally exact, drift-free, integer end to end.
//
// Starvation (D6, Phase 13 steps 4-5): a pool at 0 triggers the
// emergency conversion — min(10, carry) biomass at the 10:5 ratio,
// floored to whole energy units — and a pool still at 0 after that is
// death by starvation, with the cause literal this context owns (the
// combat kill's literal lives in combat/damage.ts; the import rule
// forbids sharing one map, so each context owns the cause it emits).
//
// The player-issued eat (04 § 4.2: "convert carried biomass to energy,
// 10 biomass → 5 energy") is the same batch, requested instead of
// automatic; match/ calls convertCarriedBiomass for it and stamps the
// eat record's reason, since the reason — player or starvation — is the
// caller's distinction, not the arithmetic's.
//
// Context note: vitality/ may import only math/ and itself (06 § 5.2),
// so EnergizedRobot is structural — robot/Robot satisfies it without
// either context importing the other. The tick order this function
// assumes lives with match/ in Phase 5: combat first, then vitality.
// Corpses do not metabolise: a robot killed by combat this tick is
// skipped, not thrown on — the sweep naturally covers fresh dead.

export const MILLI_PER_ENERGY = 1000;
// The fixed tick (10-DETERMINISM.md § 2.1): every drain is per 1/60 s.
export const TICKS_PER_SECOND = 60;
export const EMERGENCY_CONVERSION_BIOMASS = 10;
export const EMERGENCY_CONVERSION_ENERGY = 5;
export const DEATH_CAUSE_STARVATION = 'starvation';

// The accumulator's floor division is int32 arithmetic and the catalog
// caps a chassis at ±80 000 mW; 1 kW is 12.5x that and any balance row
// beyond it is a catalog bug, not a drain.
export const MAX_NET_POWER_MILLIWATTS = 1000000;

export interface EnergizedRobot {
  readonly id: string;
  // The pool's ceiling in milli-units (energyMax × 1000).
  readonly energyMaxMilli: number;
  energyMilli: number;
  // Milliwatt-ticks carried toward the next milli-unit; in [0, 60)
  // after every tick.
  energyRemainder: number;
  biomassCarried: number;
  alive: boolean;
}

// The eat event's starvation shape (11 § 4: bot, amount, reason:
// "starvation"): consumed biomass and the energy units it bought.
export interface EmergencyConversionRecord {
  readonly botId: string;
  readonly consumedBiomass: number;
  readonly gainedEnergy: number;
}

export interface StarvationDeathRecord {
  readonly botId: string;
  readonly cause: typeof DEATH_CAUSE_STARVATION;
  readonly killerId: null;
}

export interface EnergyTickResult {
  readonly netPowerMilliwatts: number;
  // Signed milli-unit movement of the pool from the drain step alone,
  // before clamping and before any emergency conversion.
  readonly poolDeltaMilli: number;
  readonly conversion: EmergencyConversionRecord | null;
  readonly starvationDeath: StarvationDeathRecord | null;
}

function assertInteger(value: number, label: string): void {
  if (!Number.isInteger(value)) {
    throw new TypeError(`${label} must be an integer, got ${value}`);
  }
}

// Floor division for the accumulator: truncation would round recharge
// toward zero and let the remainder go negative, breaking the [0, 60)
// invariant the carried-remainder model depends on.
function floorDiv(numerator: number, denominator: number): number {
  const quotient = (numerator / denominator) | 0;
  const remainder = numerator % denominator;
  const negativeRemainder = remainder < 0;
  const negativeDenominator = denominator < 0;
  if (remainder !== 0 && negativeRemainder !== negativeDenominator) {
    return quotient - 1;
  }
  return quotient;
}

// One 10:5 conversion batch, floored to whole units: a 3-biomass scrape
// buys 1 energy, a 1-biomass scrape buys 0 — brutal, but the pool never
// goes fractional. The gain clamps at the pool's ceiling: a batch into a
// nearly-full pool keeps what fits and burns the rest, exactly like a
// clamp at the top of drainEnergyForTick — the caller's job to check
// self.energy first. Both the player-issued eat and the automatic
// emergency conversion run this one arithmetic (G5).
export function convertCarriedBiomass(robot: EnergizedRobot): EmergencyConversionRecord | null {
  if (robot.biomassCarried <= 0) {
    return null;
  }
  const consumed = robot.biomassCarried < EMERGENCY_CONVERSION_BIOMASS ? robot.biomassCarried : EMERGENCY_CONVERSION_BIOMASS;
  robot.biomassCarried -= consumed;
  const gained = (consumed / 2) | 0;
  const charged = gained * MILLI_PER_ENERGY;
  const headroom = robot.energyMaxMilli - robot.energyMilli;
  robot.energyMilli += charged < headroom ? charged : headroom;
  return { botId: robot.id, consumedBiomass: consumed, gainedEnergy: gained };
}

// The emergency conversion of D6: the automatic batch when the pool is
// empty. Same arithmetic as the player-issued eat, different trigger.
function tryEmergencyConversion(robot: EnergizedRobot): EmergencyConversionRecord | null {
  return convertCarriedBiomass(robot);
}

// One tick of the milliwatt accumulator plus the starvation chain:
// drain, clamp to [0, energyMaxMilli], convert if empty and carrying,
// die if still empty. A clamped pool clears the remainder in the same
// tick — a full battery does not bank overproduction, and an empty one
// does not bank unserviced demand — so the accumulator only ever
// carries one tick's real arithmetic.
export function drainEnergyForTick(robot: EnergizedRobot, netPowerMilliwatts: number): EnergyTickResult {
  assertInteger(netPowerMilliwatts, 'net power milliwatts');
  if (netPowerMilliwatts > MAX_NET_POWER_MILLIWATTS || netPowerMilliwatts < -MAX_NET_POWER_MILLIWATTS) {
    throw new RangeError(`net power milliwatts beyond the accumulator bound, got ${netPowerMilliwatts}`);
  }
  if (!robot.alive) {
    return { netPowerMilliwatts, poolDeltaMilli: 0, conversion: null, starvationDeath: null };
  }

  robot.energyRemainder += netPowerMilliwatts;
  const drainMilli = floorDiv(robot.energyRemainder, TICKS_PER_SECOND);
  robot.energyRemainder -= drainMilli * TICKS_PER_SECOND;
  robot.energyMilli -= drainMilli;

  if (robot.energyMilli > robot.energyMaxMilli) {
    robot.energyMilli = robot.energyMaxMilli;
    robot.energyRemainder = 0;
  }
  if (robot.energyMilli < 0) {
    robot.energyMilli = 0;
    robot.energyRemainder = 0;
  }

  let conversion: EmergencyConversionRecord | null = null;
  let starvationDeath: StarvationDeathRecord | null = null;
  if (robot.energyMilli <= 0) {
    conversion = tryEmergencyConversion(robot);
    if (robot.energyMilli <= 0) {
      robot.alive = false;
      starvationDeath = { botId: robot.id, cause: DEATH_CAUSE_STARVATION, killerId: null };
    }
  }

  return {
    netPowerMilliwatts,
    poolDeltaMilli: -drainMilli,
    conversion,
    starvationDeath,
  };
}
