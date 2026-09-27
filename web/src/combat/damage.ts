// Damage application — the shield-first half of Phase 4 task 3
// (23-WEB-CLIENT-PLAN.md § 7.3; 20-IMPLEMENTATION-PLAN.md Phase 11 T13.2,
// T13.3; 22-DECISIONS.md D7). Incoming damage drains the shield pool
// first, overflow hits hull; hull at or below zero is death, and death
// pays the killer the biomass bounty of 04 § 6.
//
// FRIENDLY FIRE — the decision 23 § 7.3 asks to make first. Adopted from
// legacy/02 § 6 item 10's recommendation: **splash damage is friendly
// fire ON, aimed damage is friendly fire OFF.** This module is where the
// split lands: applyDamage is side-blind (whoever is handed to it takes
// damage — grenades splash everyone, the thrower included, per the 20
// Phase 11 DoD), while the raycast in weapons.ts only ever hands it
// enemies. Grouping therefore stays a genuine trade-off: aimed shots
// pass through allies untouched, area denial still hurts the group.
// The decision needs ratifying in 22-DECISIONS.md (noted for the owner).
//
// Units: hull, shield and damage are integer HP (D7, 04 § 3.2); biomass
// is integer kg (D15). No randomness: the same inputs always produce the
// same split, so combat replay hashes stay stable (10-DETERMINISM.md).
//
// Context note: combat/ may import only math/ and itself (06 § 5.2), so
// the Damageable surface below is structural — robot/Robot satisfies it
// without either context importing the other (the Phase 3 VmEnv pattern).
// The kill cause literal lives here because death from damage is this
// context's concept; vitality/ owns its own starvation literal the same
// way, and match/ stamps the event kinds in Phase 5.

export const DEATH_CAUSE_COMBAT = 'combat';

// min(10, victim.carriedBiomass) per 04 § 6.
export const KILL_BOUNTY_MAX = 10;

export interface Damageable {
  readonly id: string;
  hullHp: number;
  shieldHp: number;
  biomassCarried: number;
  alive: boolean;
  // Carry capacity of the killer's chassis, for the bounty clamp.
  readonly carryCapacity: number;
}

// The damage event's per-pool report (11-REPLAY-FORMAT.md § 4: amount,
// to_shield; the hull share is amount − to_shield).
export interface DamageOutcome {
  readonly toShield: number;
  readonly toHull: number;
  readonly killed: boolean;
  // Present exactly when this application killed the target.
  readonly death: CombatDeathRecord | null;
}

// The death event's fields for a combat kill (11 § 4: bot, cause, killer).
export interface CombatDeathRecord {
  readonly botId: string;
  readonly cause: typeof DEATH_CAUSE_COMBAT;
  readonly killerId: string | null;
  readonly bounty: number;
}

function assertDamageAmount(amount: number): void {
  if (!Number.isInteger(amount)) {
    throw new TypeError(`damage amount must be an integer, got ${amount}`);
  }
  if (amount < 1) {
    throw new RangeError(`damage amount must be positive, got ${amount}`);
  }
}

// The bounty transfer: the victim's carry is the source, the killer's
// remaining capacity is the bound. Biomass above what the killer can
// hold — and the victim's carry beyond the bounty cap — is lost with the
// corpse: the biomass field only ever changes through deplete/respawn
// (arena/biomass.ts), so a dead robot's carry cannot spill back into the
// world. A bounty is paid only to a LIVING killer other than the victim:
// a corpse gains nothing, and self-splash cannot farm itself.
function payBounty(victim: Damageable, killer: Damageable | null): number {
  if (killer === null || killer === victim || !killer.alive) {
    return 0;
  }
  const room = killer.carryCapacity - killer.biomassCarried;
  let payable = KILL_BOUNTY_MAX < victim.biomassCarried ? KILL_BOUNTY_MAX : victim.biomassCarried;
  if (payable > room) {
    payable = room;
  }
  victim.biomassCarried -= payable;
  killer.biomassCarried += payable;
  return payable;
}

// Kills the target, zeroes its carry, pays the bounty. The hull value is
// clamped to 0: the death condition is evaluated on the pre-clamp pool,
// and a wire snapshot of a dead robot should read 0, not negative.
export function killRobot(victim: Damageable, killer: Damageable | null): CombatDeathRecord {
  if (!victim.alive) {
    throw new Error(`robot ${victim.id} is already dead`);
  }
  victim.alive = false;
  const bounty = payBounty(victim, killer);
  victim.biomassCarried = 0;
  return {
    botId: victim.id,
    cause: DEATH_CAUSE_COMBAT,
    killerId: killer !== null && killer !== victim && killer.alive ? killer.id : null,
    bounty,
  };
}

// Applies one hit: shield first, overflow to hull, death on hull <= 0
// (D7; 20 Phase 11 steps 4-5). The shield absorbs min(shieldHp, amount)
// exactly — the boundary case "damage equals the shield pool" leaves
// hull untouched. toHull reports the full overflow even when the hull
// clamps at 0: the event is the damage ledger, the pool is the state.
// Dead targets never reach here: the callers (raycast, splash) only hand
// over living robots, so reaching this guard is a caller bug and throws
// instead of silently double-killing (G2).
export function applyDamage(target: Damageable, amount: number, source: Damageable | null): DamageOutcome {
  assertDamageAmount(amount);
  if (!target.alive) {
    throw new Error(`robot ${target.id} is dead and cannot take damage`);
  }
  const toShield = target.shieldHp < amount ? target.shieldHp : amount;
  target.shieldHp -= toShield;
  const toHull = amount - toShield;
  const remainingHull = target.hullHp - toHull;
  if (remainingHull > 0) {
    target.hullHp = remainingHull;
    return { toShield, toHull, killed: false, death: null };
  }
  target.hullHp = 0;
  const death = killRobot(target, source);
  return { toShield, toHull, killed: true, death };
}
