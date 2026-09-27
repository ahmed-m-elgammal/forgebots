// Shield regeneration — the defence half of Phase 4 task 4 (23 § 7.4;
// 20-IMPLEMENTATION-PLAN.md Phase 13 T15.2, T15.3; 22-DECISIONS.md D7).
// Shields regenerate at the fitted parts' combined rate after 1 s
// without taking shield damage; they are always on in MVP.
//
// The carried remainder, shield edition: rates are milli-HP per second
// (Light 1000, Heavy 500), a tick is 1/60 s, and 0.5 HP/s must not floor
// to 0 — the same trap as the energy accumulator. The bank
// (shieldRegenRemainder) accumulates the per-second rate every tick and
// crystallises one full HP per SHIELD_REGEN_MILLI_TICKS_PER_HP
// (1000 milli-HP x 60 ticks): a Light shield grants 1 HP every 60 ticks,
// a Heavy one every 120, and a stack of both every 40 — the average is
// exact because the fraction rides in the bank, never in a float.
//
// Suppression (D7): shield damage sets shieldRegenSuppressTicks to 60
// via noteShieldDamage — the match loop calls it in Phase 5 whenever a
// damage outcome reports to_shield > 0. Regen ticks the countdown down;
// the first regen tick after a hit is exactly 60 ticks later, i.e. 1 s.
// The bank survives damage: it is already-regenerated material, and the
// suppression pauses production, not storage.
//
// A full pool stops banking (the bank clears): regen resumes from zero
// progress after the next depletion, never as an instant HP gift.
//
// Context note: vitality/ may import only math/ and itself (06 § 5.2),
// so ShieldedRobot is structural — robot/Robot satisfies it. Damage
// application itself lives in combat/ (D7's shield-first rule); this
// module owns only the regen policy and its suppression state.

// D7: regeneration resumes 1 s (60 ticks) after the last shield damage.
export const SHIELD_REGEN_SUPPRESSION_TICKS = 60;
// 1000 milli-HP per HP, 60 ticks per second: the bank's crystallisation
// threshold in milli-HP-ticks.
export const SHIELD_REGEN_MILLI_TICKS_PER_HP = 60000;

export interface ShieldedRobot {
  readonly id: string;
  // Regen stops at this ceiling; the robot is the runtime entity.
  readonly maxShieldHp: number;
  shieldHp: number;
  // Fractional regen banked toward the next full HP, in milli-HP-ticks.
  shieldRegenRemainder: number;
  // Ticks left before regen resumes; > 0 means suppressed.
  shieldRegenSuppressTicks: number;
  alive: boolean;
}

function assertInteger(value: number, label: string): void {
  if (!Number.isInteger(value)) {
    throw new TypeError(`${label} must be an integer, got ${value}`);
  }
}

// Marks that the shield just took damage: regen pauses for the full
// suppression window. A second hit inside the window restarts it rather
// than stacking — the window is "1 s since the LAST shield damage".
export function noteShieldDamage(robot: ShieldedRobot): void {
  robot.shieldRegenSuppressTicks = SHIELD_REGEN_SUPPRESSION_TICKS;
}

// One tick of regeneration under the combined fitted rate
// (regenMilliHpPerSecond, from robot/stats shield parts). Returns
// whether a full HP crystallised this tick. Suppressed ticks tick the
// countdown down and bank nothing; a full pool clears the bank and
// banks nothing.
export function regenerateShieldForTick(robot: ShieldedRobot, regenMilliHpPerSecond: number): boolean {
  assertInteger(regenMilliHpPerSecond, 'shield regen milli-HP per second');
  if (regenMilliHpPerSecond < 0) {
    throw new RangeError(`shield regen milli-HP per second must not be negative, got ${regenMilliHpPerSecond}`);
  }
  if (!robot.alive || robot.maxShieldHp <= 0) {
    return false;
  }
  if (robot.shieldRegenSuppressTicks > 0) {
    robot.shieldRegenSuppressTicks -= 1;
    return false;
  }
  if (robot.shieldHp >= robot.maxShieldHp) {
    robot.shieldRegenRemainder = 0;
    return false;
  }
  robot.shieldRegenRemainder += regenMilliHpPerSecond;
  const gained = (robot.shieldRegenRemainder - (robot.shieldRegenRemainder % SHIELD_REGEN_MILLI_TICKS_PER_HP)) / SHIELD_REGEN_MILLI_TICKS_PER_HP;
  if (gained < 1) {
    return false;
  }
  const headroom = robot.maxShieldHp - robot.shieldHp;
  const applied = gained < headroom ? gained : headroom;
  robot.shieldHp += applied;
  robot.shieldRegenRemainder -= applied * SHIELD_REGEN_MILLI_TICKS_PER_HP;
  if (applied < gained || robot.shieldHp >= robot.maxShieldHp) {
    robot.shieldRegenRemainder = 0;
  }
  return true;
}
