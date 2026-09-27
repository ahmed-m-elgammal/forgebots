// Weapon resolution — the aiming half of Phase 4 task 3 (23 § 7.3;
// 20-IMPLEMENTATION-PLAN.md Phase 11 T13.1, T13.4): cooldown tracking,
// the blaster hitscan raycast, and grenade ballistics with splash.
//
// WEAPON GEOMETRY, NOT WEAPON NAMES. Weapons are classified by shape:
// rangeMm present = hitscan, splashRadiusMm present = arcing splash
// projectile. combat/ never learns what a "blaster" or a "grenade" part
// is (G7) — a future splash weapon needs zero changes here, only a
// catalog row. The part id rides along as an opaque string for events.
//
// FRIENDLY FIRE (the decision of 23 § 7.3, see damage.ts): AIMED shots
// never hit allies — the raycast only considers the other side, and an
// ally standing in the ray neither blocks it nor takes damage. SPLASH is
// side-blind — a detonation damages every living robot in radius, the
// thrower included, which is exactly the 20 Phase 11 DoD line and what
// keeps grouping a trade-off instead of a pure upgrade.
//
// Grenade design (documented catalog decisions — 04 § 3.2 fixes splash
// radius and cooldown but no throw range, and 20 Phase 11 only says
// "arcing projectile, detonating on contact or at expiry"):
// - Throw range 24 000 mm = 2× the splash radius: at full range the
//   thrower stands one full splash radius clear of its own detonation,
//   so grenades are area denial rather than a suicide vest, while any
//   target that closes inside the splash still punishes the thrower.
// - Fuse 60 ticks (1 s): 24 000 mm / 60 ticks = 400 mm per tick of
//   flight, an order of magnitude inside the 500 mm hit radius, so a
//   per-tick contact check cannot tunnel through a standing robot.
// - Contact = any LIVING robot other than the thrower within the 500 mm
//   hit radius of the projectile. Bodies detonate grenades, allies
//   included — the thrower's own launch is exempt (armed after leaving
//   the tube), but its own splash is not.
// - A grenade in flight keeps flying if its thrower dies: it is a
//   physical object, and its splash can still earn the (dead) thrower
//   nothing — the bounty rules in damage.ts handle that.
//
// Exactness: the raycast compares raw BigInt products against
// range·65536 and radius·65536, never truncating before the comparison,
// so the perp = 500 mm and proj = 30 000 mm boundaries are exact (T5).
// Angles go through the fixed sin/cos tables (10-DETERMINISM.md § 2.2);
// at the four axis angles those tables are exact, which is where the
// boundary tests pin the geometry.
//
// Ordering is determinism: attackers fire in the order given (spawn
// order per Phase 11), weapons in design order (robot/aggregate), a ray
// hits the nearest enemy along it with ties to the lowest spawn index,
// and splash applies in spawn order. Deaths apply immediately, so a
// robot killed earlier in the pass neither fires nor takes further
// damage.

import { fcos, fsin, type Angle } from '../math/angle';
import { RAW_PER_UNIT, fromMm, mul as fixedMul, saturate, toMm, type Fixed } from '../math/fixed';
import { add as vecAdd, inRange, vec2, type Vec2 } from '../math/vec2';
import { applyDamage, type CombatDeathRecord } from './damage';

// D15's robot collision radius, reused as the aimed-shot hit bound and
// the grenade contact radius ("a hit requires perp <= 500", 20 Phase 11).
// combat/ cannot import arena/, so the constant lives here too — one
// number, two owners, noted for the owner like the other import-rule
// duplicates.
export const ROBOT_HIT_RADIUS_MM = 500;
// Grenade ballistics, see the header.
export const GRENADE_THROW_RANGE_MM = 24000;
export const GRENADE_FUSE_TICKS = 60;

// Structural mirror of robot/'s WeaponLoadout (the import rule forbids
// combat/ -> robot/; structural typing is the seam).
export interface CombatWeapon {
  readonly partId: string;
  readonly damagePerHit: number;
  readonly cooldownTicks: number;
  readonly rangeMm: number | null;
  readonly splashRadiusMm: number | null;
}

// Structural mirror of robot/'s Robot for combat purposes: the fields
// combat reads or mutates, nothing more.
export interface Combatant {
  readonly id: string;
  readonly side: number;
  readonly position: Vec2;
  readonly heading: Angle;
  hullHp: number;
  shieldHp: number;
  biomassCarried: number;
  alive: boolean;
  readonly carryCapacity: number;
  readonly weapons: readonly CombatWeapon[];
  // One countdown per fitted weapon, parallel to `weapons`; 0 = ready.
  weaponCooldowns: number[];
}

// 11 § 4 fire event fields: bot, weapon, success (hit or miss).
export interface FireAttemptRecord {
  readonly attackerId: string;
  readonly weaponPartId: string;
  readonly success: boolean;
}

// 11 § 4 shot event fields: bot, x, y, target, damage, weapon, to_shield.
export interface ShotRecord {
  readonly attackerId: string;
  readonly weaponPartId: string;
  readonly xMm: number;
  readonly yMm: number;
  readonly targetId: string;
  readonly damage: number;
  readonly toShield: number;
}

export interface AttackResolution {
  readonly attempts: readonly FireAttemptRecord[];
  // Hits only — a missed shot is an attempt with success: false.
  readonly shots: readonly ShotRecord[];
  readonly deaths: readonly CombatDeathRecord[];
}

// One splash application inside a detonation (the 11 § 4 damage event
// shape: target, amount, source, to_shield).
export interface SplashApplication {
  readonly targetId: string;
  readonly amount: number;
  readonly toShield: number;
  readonly toHull: number;
  readonly killed: boolean;
}

export interface DetonationRecord {
  readonly throwerId: string;
  readonly xMm: number;
  readonly yMm: number;
  readonly applications: readonly SplashApplication[];
}

export interface DetonationResult {
  readonly detonations: readonly DetonationRecord[];
  readonly deaths: readonly CombatDeathRecord[];
}

export interface GrenadeProjectile {
  readonly thrower: Combatant;
  readonly origin: Vec2;
  readonly landing: Vec2;
  position: Vec2;
  // Ticks flown so far; the volley advances it, nothing else writes it.
  progressTick: number;
  readonly fuseTicks: number;
  readonly damagePerHit: number;
  readonly splashRadius: Fixed;
}

// Cooldown recovery: every fitted weapon ticks down by one, floored at 0.
// Called for every living combatant each tick BEFORE fire resolution, so
// a blaster (cooldown 60) fired at tick T is ready again exactly at
// T + 60 (D8's 1 shot/s).
export function tickWeaponCooldowns(combatant: Combatant): void {
  for (let index = 0; index < combatant.weaponCooldowns.length; index++) {
    const remaining = combatant.weaponCooldowns[index]!;
    if (remaining > 0) {
      combatant.weaponCooldowns[index] = remaining - 1;
    }
  }
}

// Exact ray-to-point geometry on raw BigInts: the projection along the
// ray and the perpendicular distance, both in raw² units, compared
// against range·65536 and radius·65536 without any intermediate
// truncation. vec2's dot/cross truncate through Q16.16 and would blur
// exactly the boundaries these comparisons must decide (T5).
function rayProjection(rx: bigint, ry: bigint, cos: number, sin: number): bigint {
  return rx * BigInt(cos) + ry * BigInt(sin);
}

function rayPerpendicular(rx: bigint, ry: bigint, cos: number, sin: number): bigint {
  const raw = ry * BigInt(cos) - rx * BigInt(sin);
  return raw < 0n ? -raw : raw;
}

// Nearest living enemy on the ray, or null. Allies (and the attacker,
// same side) are invisible to aimed fire — friendly fire OFF. Ties on
// projection keep the first candidate in spawn order.
function nearestEnemyOnRay(attacker: Combatant, combatants: readonly Combatant[], weapon: CombatWeapon): Combatant | null {
  const cos = fcos(attacker.heading);
  const sin = fsin(attacker.heading);
  const rangeExact = BigInt(fromMm(weapon.rangeMm!)) * BigInt(RAW_PER_UNIT);
  const radiusExact = BigInt(fromMm(ROBOT_HIT_RADIUS_MM)) * BigInt(RAW_PER_UNIT);
  let best: Combatant | null = null;
  let bestProjection = 0n;
  for (const candidate of combatants) {
    if (candidate.side === attacker.side || !candidate.alive) {
      continue;
    }
    const rx = BigInt(candidate.position.x) - BigInt(attacker.position.x);
    const ry = BigInt(candidate.position.y) - BigInt(attacker.position.y);
    const projection = rayProjection(rx, ry, cos, sin);
    if (projection < 0n || projection > rangeExact) {
      continue;
    }
    if (rayPerpendicular(rx, ry, cos, sin) > radiusExact) {
      continue;
    }
    if (best === null || projection < bestProjection) {
      best = candidate;
      bestProjection = projection;
    }
  }
  return best;
}

// Resolves one tick's fire intents. Attackers fire in the order given
// (spawn order per Phase 11); each fires every fitted weapon that is off
// cooldown, consuming it (a miss costs the cooldown too — the shot left
// the barrel, 04 § 4.2). Cooldowns must already have ticked down this
// tick; a dead attacker does nothing. Grenade launches hand their
// projectile to the volley, which owns it from there.
export function resolveAttacks(combatants: readonly Combatant[], attackers: readonly Combatant[], volley: GrenadeVolley): AttackResolution {
  const attempts: FireAttemptRecord[] = [];
  const shots: ShotRecord[] = [];
  const deaths: CombatDeathRecord[] = [];
  for (const attacker of attackers) {
    if (!attacker.alive) {
      continue;
    }
    for (let index = 0; index < attacker.weapons.length; index++) {
      const weapon = attacker.weapons[index]!;
      const remaining = attacker.weaponCooldowns[index] ?? 0;
      if (remaining > 0) {
        continue;
      }
      attacker.weaponCooldowns[index] = weapon.cooldownTicks;
      if (weapon.rangeMm !== null) {
        const target = nearestEnemyOnRay(attacker, combatants, weapon);
        attempts.push({ attackerId: attacker.id, weaponPartId: weapon.partId, success: target !== null });
        if (target === null) {
          continue;
        }
        const outcome = applyDamage(target, weapon.damagePerHit, attacker);
        if (outcome.death !== null) {
          deaths.push(outcome.death);
        }
        shots.push({
          attackerId: attacker.id,
          weaponPartId: weapon.partId,
          xMm: toMm(attacker.position.x),
          yMm: toMm(attacker.position.y),
          targetId: target.id,
          damage: weapon.damagePerHit,
          toShield: outcome.toShield,
        });
      } else if (weapon.splashRadiusMm !== null) {
        volley.launch(attacker, weapon);
        attempts.push({ attackerId: attacker.id, weaponPartId: weapon.partId, success: true });
      } else {
        throw new TypeError(`weapon ${weapon.partId} is neither hitscan nor splash (catalog schema guarantees one)`);
      }
    }
  }
  return { attempts, shots, deaths };
}

// The in-flight grenade pool. match/ holds one volley for the match;
// launch happens inside resolveAttacks, stepAll runs once per tick after
// all attacks, in launch order.
export class GrenadeVolley {
  private projectiles: GrenadeProjectile[] = [];

  launch(thrower: Combatant, weapon: CombatWeapon): void {
    if (weapon.splashRadiusMm === null) {
      throw new TypeError(`weapon ${weapon.partId} has no splash radius and cannot be lobbed`);
    }
    const range = fromMm(GRENADE_THROW_RANGE_MM);
    const landing = vecAdd(
      thrower.position,
      vec2(fixedMul(fcos(thrower.heading) as Fixed, range), fixedMul(fsin(thrower.heading) as Fixed, range)),
    );
    this.projectiles.push({
      thrower,
      origin: thrower.position,
      landing,
      position: thrower.position,
      progressTick: 0,
      fuseTicks: GRENADE_FUSE_TICKS,
      damagePerHit: weapon.damagePerHit,
      splashRadius: fromMm(weapon.splashRadiusMm),
    });
  }

  // Exact linear interpolation along the flight path: one division per
  // component per tick, never accumulated, so position drift is
  // impossible and the last tick lands exactly on `landing`.
  private flyTo(projectile: GrenadeProjectile): Vec2 {
    const progress = BigInt(projectile.progressTick);
    const fuse = BigInt(projectile.fuseTicks);
    const x = saturate(BigInt(projectile.origin.x) + ((BigInt(projectile.landing.x) - BigInt(projectile.origin.x)) * progress) / fuse);
    const y = saturate(BigInt(projectile.origin.y) + ((BigInt(projectile.landing.y) - BigInt(projectile.origin.y)) * progress) / fuse);
    return vec2(x, y);
  }

  private findContact(projectile: GrenadeProjectile, combatants: readonly Combatant[]): boolean {
    const hitRadius = fromMm(ROBOT_HIT_RADIUS_MM);
    for (const candidate of combatants) {
      if (!candidate.alive || candidate.id === projectile.thrower.id) {
        continue;
      }
      if (inRange(projectile.position, candidate.position, hitRadius)) {
        return true;
      }
    }
    return false;
  }

  private detonate(projectile: GrenadeProjectile, combatants: readonly Combatant[], deaths: CombatDeathRecord[]): DetonationRecord {
    const applications: SplashApplication[] = [];
    for (const candidate of combatants) {
      if (!candidate.alive || !inRange(projectile.position, candidate.position, projectile.splashRadius)) {
        continue;
      }
      const outcome = applyDamage(candidate, projectile.damagePerHit, projectile.thrower);
      applications.push({
        targetId: candidate.id,
        amount: projectile.damagePerHit,
        toShield: outcome.toShield,
        toHull: outcome.toHull,
        killed: outcome.killed,
      });
      if (outcome.death !== null) {
        deaths.push(outcome.death);
      }
    }
    return {
      throwerId: projectile.thrower.id,
      xMm: toMm(projectile.position.x),
      yMm: toMm(projectile.position.y),
      applications,
    };
  }

  // Advances every projectile one tick, detonating on contact or at the
  // landing tick. Splash is side-blind and includes the thrower (FF on);
  // the inclusive inRange boundary puts exactly-at-radius robots inside
  // the blast. Detonations apply in launch order, splash targets in
  // spawn order, deaths immediately — a later blast never damages a
  // robot an earlier one just killed.
  stepAll(combatants: readonly Combatant[]): DetonationResult {
    const detonations: DetonationRecord[] = [];
    const deaths: CombatDeathRecord[] = [];
    const survivors: GrenadeProjectile[] = [];
    for (const projectile of this.projectiles) {
      projectile.progressTick += 1;
      projectile.position = this.flyTo(projectile);
      const exploded = projectile.progressTick >= projectile.fuseTicks || this.findContact(projectile, combatants);
      if (exploded) {
        detonations.push(this.detonate(projectile, combatants, deaths));
      } else {
        survivors.push(projectile);
      }
    }
    this.projectiles = survivors;
    return { detonations, deaths };
  }

  inFlight(): readonly GrenadeProjectile[] {
    return this.projectiles;
  }
}
