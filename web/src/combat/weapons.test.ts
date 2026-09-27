import { describe, expect, it } from 'vitest';
import { wrapToPi, type Angle } from '../math/angle';
import { fromMm, fromRaw } from '../math/fixed';
import { vec2, type Vec2 } from '../math/vec2';
import {
  GRENADE_FUSE_TICKS,
  GRENADE_THROW_RANGE_MM,
  GrenadeVolley,
  ROBOT_HIT_RADIUS_MM,
  resolveAttacks,
  tickWeaponCooldowns,
  type AttackResolution,
  type Combatant,
  type CombatWeapon,
  type DetonationResult,
} from './index';

// Hitscan, grenades and cooldowns per 20 Phase 11. The aimed-fire
// boundaries (perp 500 mm, range 30 000 mm) are pinned at the exact
// integer edge with heading 0, where the trig tables are exact (T5).
// Friendly fire is split: aimed OFF, splash ON — both halves pinned.

const BLASTER: CombatWeapon = {
  partId: 'blaster',
  damagePerHit: 12,
  cooldownTicks: 60,
  rangeMm: 30000,
  splashRadiusMm: null,
};
const HEAVY: CombatWeapon = { partId: 'heavy_blaster', damagePerHit: 50, cooldownTicks: 120, rangeMm: 30000, splashRadiusMm: null };
const GRENADE: CombatWeapon = { partId: 'grenade', damagePerHit: 20, cooldownTicks: 360, rangeMm: null, splashRadiusMm: 12000 };

let nextIdNumber = 0;

interface CombatantOverrides {
  readonly id?: string;
  readonly side?: number;
  readonly position?: Vec2;
  readonly heading?: Angle;
  readonly hullHp?: number;
  readonly shieldHp?: number;
  readonly biomassCarried?: number;
  readonly alive?: boolean;
  readonly carryCapacity?: number;
  readonly weapons?: readonly CombatWeapon[];
}

const makeCombatant = (overrides: CombatantOverrides = {}): Combatant => {
  const weapons = overrides.weapons ?? [];
  return {
    id: overrides.id ?? `r${nextIdNumber++}`,
    side: overrides.side ?? 0,
    position: overrides.position ?? vec2(fromMm(0), fromMm(0)),
    heading: overrides.heading ?? wrapToPi(0),
    hullHp: overrides.hullHp ?? 30,
    shieldHp: overrides.shieldHp ?? 20,
    biomassCarried: overrides.biomassCarried ?? 0,
    alive: overrides.alive ?? true,
    carryCapacity: overrides.carryCapacity ?? 25,
    weapons,
    weaponCooldowns: weapons.map(() => 0),
  };
};

const mm = (value: number): Vec2 => vec2(fromMm(value), fromMm(0));

// Steps the volley once per tick until something detonates (max the fuse
// length) and returns the detonating result.
const stepUntilDetonation = (volley: GrenadeVolley, combatants: readonly Combatant[]): DetonationResult => {
  for (let tick = 0; tick < GRENADE_FUSE_TICKS; tick++) {
    const result = volley.stepAll(combatants);
    if (result.detonations.length > 0) {
      return result;
    }
  }
  throw new Error('grenade never detonated within its fuse');
};

const fireOnce = (combatants: readonly Combatant[], attackers: readonly Combatant[], volley = new GrenadeVolley()): AttackResolution =>
  resolveAttacks(combatants, attackers, volley);

describe('tickWeaponCooldowns', () => {
  it('[normal] decrements every fitted weapon by one', () => {
    const robot = makeCombatant({ weapons: [BLASTER, GRENADE] });
    robot.weaponCooldowns = [60, 360];
    tickWeaponCooldowns(robot);
    expect(robot.weaponCooldowns).toEqual([59, 359]);
  });

  it('[boundary] a ready weapon stays at 0 — cooldowns never go negative', () => {
    const robot = makeCombatant({ weapons: [BLASTER] });
    tickWeaponCooldowns(robot);
    expect(robot.weaponCooldowns).toEqual([0]);
  });

  it('[repeat] a spent cooldown reaches 0 and stays there', () => {
    const robot = makeCombatant({ weapons: [BLASTER] });
    robot.weaponCooldowns = [3];
    for (let tick = 0; tick < 10; tick++) {
      tickWeaponCooldowns(robot);
    }
    expect(robot.weaponCooldowns).toEqual([0]);
  });

  it('[determinism] the same countdown always walks the same steps', () => {
    const run = (): number[] => {
      const robot = makeCombatant({ weapons: [BLASTER, HEAVY] });
      robot.weaponCooldowns = [61, 2];
      for (let tick = 0; tick < 3; tick++) {
        tickWeaponCooldowns(robot);
      }
      return [...robot.weaponCooldowns];
    };
    expect(run()).toEqual(run());
  });
});

describe('resolveAttacks — hitscan raycast (20 Phase 11 step 2)', () => {
  it('[normal] an enemy straight ahead inside range takes the shot', () => {
    const attacker = makeCombatant({ id: 'shooter', side: 0, weapons: [BLASTER] });
    const target = makeCombatant({ id: 'victim', side: 1, position: mm(10000) });
    const resolution = fireOnce([attacker, target], [attacker]);
    expect(resolution.attempts).toEqual([{ attackerId: 'shooter', weaponPartId: 'blaster', success: true }]);
    expect(resolution.shots).toEqual([
      {
        attackerId: 'shooter',
        weaponPartId: 'blaster',
        xMm: 0,
        yMm: 0,
        targetId: 'victim',
        damage: 12,
        toShield: 12,
      },
    ]);
    expect(target.shieldHp).toBe(8);
    expect(target.alive).toBe(true);
  });

  it('[normal] empty range: the attempt is recorded, no shot event exists', () => {
    const attacker = makeCombatant({ weapons: [BLASTER] });
    const resolution = fireOnce([attacker], [attacker]);
    expect(resolution.attempts).toEqual([{ attackerId: attacker.id, weaponPartId: 'blaster', success: false }]);
    expect(resolution.shots).toEqual([]);
    expect(attacker.weaponCooldowns).toEqual([BLASTER.cooldownTicks]);
  });

  it('[boundary] a target centred exactly at 30 000 mm is hit, one millimetre more is safe', () => {
    const attacker = makeCombatant({ weapons: [BLASTER] });
    const atRange = makeCombatant({ side: 1, position: mm(30000) });
    expect(fireOnce([attacker, atRange], [attacker]).shots).toHaveLength(1);

    const attacker2 = makeCombatant({ weapons: [BLASTER] });
    const pastRange = makeCombatant({ side: 1, position: mm(30001) });
    expect(fireOnce([attacker2, pastRange], [attacker2]).shots).toHaveLength(0);
  });

  it('[boundary] perpendicular distance: exactly the 500 mm hit radius connects, 501 mm misses', () => {
    const attacker = makeCombatant({ weapons: [BLASTER] });
    const grazing = makeCombatant({ side: 1, position: vec2(fromMm(10000), fromMm(ROBOT_HIT_RADIUS_MM)) });
    expect(fireOnce([attacker, grazing], [attacker]).shots).toHaveLength(1);

    const attacker2 = makeCombatant({ weapons: [BLASTER] });
    const clear = makeCombatant({ side: 1, position: vec2(fromMm(10000), fromMm(ROBOT_HIT_RADIUS_MM + 1)) });
    expect(fireOnce([attacker2, clear], [attacker2]).shots).toHaveLength(0);
  });

  it('[boundary] the ray is two-sided: grazing from below connects at the same 500 mm edge', () => {
    const attacker = makeCombatant({ weapons: [BLASTER] });
    const grazingBelow = makeCombatant({ side: 1, position: vec2(fromMm(10000), fromMm(-ROBOT_HIT_RADIUS_MM)) });
    expect(fireOnce([attacker, grazingBelow], [attacker]).shots).toHaveLength(1);

    const attacker2 = makeCombatant({ weapons: [BLASTER] });
    const clearBelow = makeCombatant({ side: 1, position: vec2(fromMm(10000), fromMm(-ROBOT_HIT_RADIUS_MM - 1)) });
    expect(fireOnce([attacker2, clearBelow], [attacker2]).shots).toHaveLength(0);
  });

  it('[invalid] a combatant with no cooldown slots yet is treated as ready, not broken', () => {
    const attacker = makeCombatant({ weapons: [BLASTER] });
    attacker.weaponCooldowns = [];
    const target = makeCombatant({ side: 1, position: mm(10000) });
    const resolution = fireOnce([attacker, target], [attacker]);
    expect(resolution.shots).toHaveLength(1);
    expect(attacker.weaponCooldowns).toEqual([BLASTER.cooldownTicks]);
  });

  it('[normal] an enemy behind the shooter is outside the ray', () => {
    const attacker = makeCombatant({ weapons: [BLASTER] });
    const behind = makeCombatant({ side: 1, position: mm(-10000) });
    expect(fireOnce([attacker, behind], [attacker]).shots).toHaveLength(0);
  });

  it('[state] friendly fire is OFF for aimed shots: an ally neither blocks nor bleeds', () => {
    const attacker = makeCombatant({ weapons: [BLASTER] });
    const ally = makeCombatant({ side: 0, position: mm(5000) });
    const enemy = makeCombatant({ side: 1, position: mm(9000) });
    const resolution = fireOnce([attacker, ally, enemy], [attacker]);
    expect(resolution.shots).toHaveLength(1);
    expect(resolution.shots[0]!.targetId).toBe(enemy.id);
    expect(ally.hullHp).toBe(30);
    expect(ally.shieldHp).toBe(20);
    expect(ally.alive).toBe(true);
  });

  it('[state] the nearest enemy along the ray is hit, not a farther one', () => {
    const attacker = makeCombatant({ weapons: [BLASTER] });
    const far = makeCombatant({ id: 'far', side: 1, position: mm(20000) });
    const near = makeCombatant({ id: 'near', side: 1, position: mm(7000) });
    const resolution = fireOnce([attacker, far, near], [attacker]);
    expect(resolution.shots[0]!.targetId).toBe('near');
  });

  it('[determinism] two enemies at the same projection: spawn order decides', () => {
    const attacker = makeCombatant({ weapons: [BLASTER] });
    const first = makeCombatant({ id: 'first', side: 1, position: mm(10000) });
    const second = makeCombatant({ id: 'second', side: 1, position: mm(10000) });
    const resolution = fireOnce([attacker, first, second], [attacker]);
    expect(resolution.shots[0]!.targetId).toBe('first');
    expect(second.shieldHp).toBe(20);
  });

  it('[invalid] corpses neither fire nor get shot', () => {
    const shooter = makeCombatant({ weapons: [BLASTER] });
    const corpse = makeCombatant({ side: 1, position: mm(5000), alive: false });
    const liveEnemy = makeCombatant({ side: 1, position: mm(15000) });
    const deadAlly = makeCombatant({ weapons: [BLASTER], alive: false });
    const resolution = fireOnce([shooter, corpse, liveEnemy, deadAlly], [shooter, deadAlly]);
    expect(resolution.attempts).toHaveLength(1);
    expect(resolution.shots).toHaveLength(1);
    expect(resolution.shots[0]!.targetId).toBe(liveEnemy.id);
  });

  it('[state] a lethal shot flows the death record and the bounty to the shooter', () => {
    const attacker = makeCombatant({ weapons: [BLASTER], carryCapacity: 25 });
    const target = makeCombatant({
      side: 1,
      position: mm(10000),
      shieldHp: 0,
      hullHp: 12,
      biomassCarried: 8,
    });
    const resolution = fireOnce([attacker, target], [attacker]);
    expect(resolution.deaths).toEqual([
      { botId: target.id, cause: 'combat', killerId: attacker.id, bounty: 8 },
    ]);
    expect(attacker.biomassCarried).toBe(8);
    expect(target.alive).toBe(false);
  });

  it('[repeat] the blaster cadence is exactly 1 shot per 60 ticks (D8)', () => {
    const attacker = makeCombatant({ weapons: [BLASTER] });
    const target = makeCombatant({ side: 1, position: mm(10000) });
    const shotsPerTick: number[] = [];
    for (let tick = 0; tick < 121; tick++) {
      tickWeaponCooldowns(attacker);
      const resolution = fireOnce([attacker, target], [attacker]);
      shotsPerTick.push(resolution.shots.length);
    }
    expect(shotsPerTick.filter((shots) => shots === 1)).toHaveLength(3);
    expect(shotsPerTick[0]).toBe(1);
    expect(shotsPerTick[60]).toBe(1);
    expect(shotsPerTick[120]).toBe(1);
    expect(shotsPerTick[59]).toBe(0);
    expect(shotsPerTick[119]).toBe(0);
  });

  it('[state] a heavy blaster misses for 119 ticks after firing and is back at exactly 120', () => {
    const attacker = makeCombatant({ weapons: [HEAVY] });
    // Survives three 50-damage hits so the cadence, not a death, is what
    // the test observes.
    const target = makeCombatant({ side: 1, position: mm(10000), shieldHp: 0, hullHp: 1000 });
    fireOnce([attacker, target], [attacker]);
    expect(attacker.weaponCooldowns).toEqual([120]);
    expect(target.hullHp).toBe(950);
    for (let tick = 0; tick < 119; tick++) {
      tickWeaponCooldowns(attacker);
      expect(fireOnce([attacker, target], [attacker]).shots).toHaveLength(0);
    }
    tickWeaponCooldowns(attacker);
    expect(attacker.weaponCooldowns).toEqual([0]);
    expect(fireOnce([attacker, target], [attacker]).shots).toHaveLength(1);
  });
});

describe('resolveAttacks — weapon mix and cooldown consumption', () => {
  it('[state] every ready weapon fires in design order; spent ones wait', () => {
    const attacker = makeCombatant({ weapons: [BLASTER, GRENADE, HEAVY] });
    attacker.weaponCooldowns = [0, 5, 0];
    const enemy = makeCombatant({ side: 1, position: mm(10000) });
    const volley = new GrenadeVolley();
    const resolution = resolveAttacks([attacker, enemy], [attacker], volley);
    expect(resolution.attempts.map((attempt) => attempt.weaponPartId)).toEqual(['blaster', 'heavy_blaster']);
    expect(volley.inFlight()).toHaveLength(0);
    expect(attacker.weaponCooldowns).toEqual([60, 5, 120]);
  });

  it('[normal] blaster and grenade both ready: a shot and a projectile in flight', () => {
    const attacker = makeCombatant({ weapons: [BLASTER, GRENADE] });
    const enemy = makeCombatant({ side: 1, position: mm(10000) });
    const volley = new GrenadeVolley();
    const resolution = resolveAttacks([attacker, enemy], [attacker], volley);
    expect(resolution.attempts.map((attempt) => attempt.weaponPartId)).toEqual(['blaster', 'grenade']);
    expect(resolution.shots).toHaveLength(1);
    expect(volley.inFlight()).toHaveLength(1);
    expect(attacker.weaponCooldowns).toEqual([60, 360]);
  });

  it('[invalid] a weapon that is neither hitscan nor splash is a schema violation', () => {
    const impossible: CombatWeapon = { partId: 'spooky', damagePerHit: 1, cooldownTicks: 1, rangeMm: null, splashRadiusMm: null };
    const attacker = makeCombatant({ weapons: [impossible] });
    expect(() => fireOnce([attacker], [attacker])).toThrow(TypeError);
  });
});

describe('GrenadeVolley — ballistics and splash (20 Phase 11 step 3)', () => {
  it('[normal] a grenade flies 24 000 mm along the heading — east at heading 0', () => {
    const thrower = makeCombatant({ weapons: [GRENADE] });
    const volley = new GrenadeVolley();
    resolveAttacks([thrower], [thrower], volley);
    const projectile = volley.inFlight()[0]!;
    expect(projectile.landing).toEqual(vec2(fromMm(GRENADE_THROW_RANGE_MM), fromMm(0)));
    expect(projectile.fuseTicks).toBe(GRENADE_FUSE_TICKS);
  });

  it('[normal] heading east-north-east quarter: the landing rotates with the aim', () => {
    const thrower = makeCombatant({ weapons: [GRENADE], heading: wrapToPi(16384) });
    const volley = new GrenadeVolley();
    resolveAttacks([thrower], [thrower], volley);
    expect(volley.inFlight()[0]!.landing).toEqual(vec2(fromRaw(0), fromMm(GRENADE_THROW_RANGE_MM)));
  });

  it('[invalid] launching a hitscan weapon is a caller bug', () => {
    const thrower = makeCombatant();
    const volley = new GrenadeVolley();
    expect(() => volley.launch(thrower, BLASTER)).toThrow(TypeError);
  });

  it('[boundary] the fuse lands exactly: in flight for 59 ticks, detonation on the 60th at the landing point', () => {
    const thrower = makeCombatant({ weapons: [GRENADE] });
    const volley = new GrenadeVolley();
    resolveAttacks([thrower], [thrower], volley);
    for (let tick = 1; tick < GRENADE_FUSE_TICKS; tick++) {
      const result = volley.stepAll([thrower]);
      expect(result.detonations).toHaveLength(0);
      expect(volley.inFlight()).toHaveLength(1);
    }
    const final = volley.stepAll([thrower]);
    expect(final.detonations).toHaveLength(1);
    expect(final.detonations[0]).toEqual({
      throwerId: thrower.id,
      xMm: GRENADE_THROW_RANGE_MM,
      yMm: 0,
      applications: [],
    });
    expect(volley.inFlight()).toHaveLength(0);
  });

  it('[normal] a body on the flight path detonates the grenade early', () => {
    const thrower = makeCombatant({ weapons: [GRENADE] });
    const blocker = makeCombatant({ side: 1, position: mm(5000) });
    const volley = new GrenadeVolley();
    resolveAttacks([thrower, blocker], [thrower], volley);
    let detonationTick = 0;
    for (let tick = 1; tick <= GRENADE_FUSE_TICKS; tick++) {
      const result = volley.stepAll([thrower, blocker]);
      if (result.detonations.length > 0) {
        detonationTick = tick;
        expect(result.detonations[0]!.xMm).toBe(4800);
        expect(result.detonations[0]!.yMm).toBe(0);
        break;
      }
    }
    expect(detonationTick).toBe(12);
    expect(volley.inFlight()).toHaveLength(0);
  });

  it('[state] splash is friendly fire ON: the thrower and allies inside the radius burn', () => {
    const thrower = makeCombatant({ id: 'thrower', weapons: [GRENADE] });
    const ally = makeCombatant({ id: 'ally', side: 0, position: mm(3000) });
    const volley = new GrenadeVolley();
    resolveAttacks([thrower, ally], [thrower], volley);
    const result = stepUntilDetonation(volley, [thrower, ally]);
    expect(result.detonations).toHaveLength(1);
    const targets = result.detonations[0]!.applications.map((application) => application.targetId);
    expect(targets).toContain(ally.id);
    expect(targets).toContain(thrower.id);
    // Shield 20 soaks the whole 20-damage blast; hull is untouched.
    expect(ally.shieldHp).toBe(0);
    expect(ally.hullHp).toBe(30);
    expect(thrower.shieldHp).toBe(0);
    expect(thrower.hullHp).toBe(30);
  });

  it('[state] the ally walking into the grenade detonates it and takes the blast', () => {
    const thrower = makeCombatant({ id: 'thrower', weapons: [GRENADE] });
    const blocker = makeCombatant({ id: 'blocker', side: 0, position: mm(6000) });
    const volley = new GrenadeVolley();
    resolveAttacks([thrower, blocker], [thrower], volley);
    const result = stepUntilDetonation(volley, [thrower, blocker]);
    // The 500 mm contact radius catches the projectile 400 mm short of
    // the body: tick 14 is at 5 600 mm, within 500 of the blocker.
    expect(result.detonations).toHaveLength(1);
    expect(result.detonations[0]!.xMm).toBe(5600);
    expect(result.detonations[0]!.applications.map((application) => application.targetId).sort()).toEqual([
      blocker.id,
      thrower.id,
    ]);
  });

  it('[boundary] splash radius is inclusive at exactly 12 000 mm and safe one millimetre past', () => {
    const thrower = makeCombatant({ weapons: [GRENADE], heading: wrapToPi(16384) });
    const edge = makeCombatant({ side: 1, position: vec2(fromMm(12000), fromMm(GRENADE_THROW_RANGE_MM)) });
    const volley = new GrenadeVolley();
    resolveAttacks([thrower, edge], [thrower], volley);
    let result = volley.stepAll([thrower, edge]);
    while (result.detonations.length === 0) {
      result = volley.stepAll([thrower, edge]);
    }
    expect(result.detonations[0]!.applications.map((application) => application.targetId)).toEqual([edge.id]);

    const thrower2 = makeCombatant({ weapons: [GRENADE], heading: wrapToPi(16384) });
    const outside = makeCombatant({ side: 1, position: vec2(fromMm(12001), fromMm(GRENADE_THROW_RANGE_MM)) });
    const volley2 = new GrenadeVolley();
    resolveAttacks([thrower2, outside], [thrower2], volley2);
    for (let tick = 0; tick < GRENADE_FUSE_TICKS; tick++) {
      const safe = volley2.stepAll([thrower2, outside]);
      expect(safe.detonations[0]?.applications ?? []).toEqual([]);
    }
    expect(outside.alive).toBe(true);
    expect(outside.shieldHp).toBe(20);
  });

  it('[boundary] at full throw range the thrower stands one splash radius clear of the blast', () => {
    const thrower = makeCombatant({ weapons: [GRENADE] });
    const volley = new GrenadeVolley();
    resolveAttacks([thrower], [thrower], volley);
    for (let tick = 0; tick < GRENADE_FUSE_TICKS; tick++) {
      volley.stepAll([thrower]);
    }
    expect(thrower.shieldHp).toBe(20);
    expect(thrower.hullHp).toBe(30);
    expect(thrower.alive).toBe(true);
  });

  it('[state] the dead are beyond splash, and a splash kill still pays the bounty', () => {
    const thrower = makeCombatant({ id: 'thrower', weapons: [GRENADE], carryCapacity: 25 });
    const corpse = makeCombatant({ id: 'corpse', side: 1, position: mm(3000), alive: false });
    const living = makeCombatant({ id: 'living', side: 1, position: mm(4000), shieldHp: 0, hullHp: 15, biomassCarried: 6 });
    const volley = new GrenadeVolley();
    resolveAttacks([thrower, corpse, living], [thrower], volley);
    const result = stepUntilDetonation(volley, [thrower, corpse, living]);
    const targets = result.detonations[0]!.applications.map((application) => application.targetId);
    // The corpse is skipped; the thrower is inside its own blast (FF on).
    expect(targets).toContain(living.id);
    expect(targets).not.toContain(corpse.id);
    expect(targets).toContain(thrower.id);
    expect(result.deaths).toEqual([{ botId: living.id, cause: 'combat', killerId: thrower.id, bounty: 6 }]);
    expect(thrower.biomassCarried).toBe(6);
    expect(living.alive).toBe(false);
  });

  it('[state] a grenade outlives its thrower and flies on', () => {
    const thrower = makeCombatant({ id: 'thrower', weapons: [GRENADE] });
    const volley = new GrenadeVolley();
    resolveAttacks([thrower], [thrower], volley);
    thrower.alive = false;
    const result = volley.stepAll([thrower]);
    expect(result.detonations).toHaveLength(0);
    expect(volley.inFlight()).toHaveLength(1);
  });

  it('[state] stacked grenades launch one projectile per fitted part', () => {
    const thrower = makeCombatant({ weapons: [GRENADE, GRENADE, GRENADE] });
    const volley = new GrenadeVolley();
    resolveAttacks([thrower], [thrower], volley);
    expect(volley.inFlight()).toHaveLength(3);
    expect(thrower.weaponCooldowns).toEqual([360, 360, 360]);
  });

  it('[determinism] the same throw, blocker and splash always produce the same ledger', () => {
    const run = (): string => {
      const thrower = makeCombatant({ id: 'thrower', weapons: [GRENADE] });
      const enemy = makeCombatant({ id: 'enemy', side: 1, position: mm(5000), biomassCarried: 4 });
      const volley = new GrenadeVolley();
      resolveAttacks([thrower, enemy], [thrower], volley);
      const steps: string[] = [];
      for (let tick = 0; tick < 13; tick++) {
        steps.push(JSON.stringify(volley.stepAll([thrower, enemy])));
      }
      return steps.join('|');
    };
    expect(run()).toBe(run());
  });
});
