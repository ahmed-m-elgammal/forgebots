import { describe, expect, it } from 'vitest';
import {
  BASE_ACCEL_PERMYRIAD,
  BASE_CARRY_CAPACITY,
  BASE_ENERGY_MAX,
  CHASSIS_ERROR_CODES,
  PART_CATEGORY,
  PART_ID,
  PARTS,
  PARTS_BY_ID,
  aggregate,
  parseCatalog,
  validateChassis,
} from './index';
import { CHASSIS_LIMITS } from './design';
import type { Chassis } from './design';
import type { PartCategory, PartId } from './parts';
import catalogDocument from './parts-catalog.json';

// The catalog is the code surface of 04-GAME-DESIGN.md § 3.2. Every row
// is pinned against the spec table, and the six chassis contracts of
// 04 § 3.1 / D6 get their exact-edge tests (T5): the limits are contracts
// (G4), so 50 kg passes and 51 fails, 8 slots pass and 9 fail.

const chassis = (...parts: string[]): Chassis => ({ parts: parts as Chassis['parts'] });

describe('parts catalog (04 § 3.2)', () => {
  it('[normal] lists every MVP part with its exact mass and signed power', () => {
    const expected: Array<[PartId, PartCategory, number, number]> = [
      [PART_ID.mk1Engine, PART_CATEGORY.mobility, 4, 5],
      [PART_ID.mk2Engine, PART_CATEGORY.mobility, 8, 9],
      [PART_ID.hoverUnit, PART_CATEGORY.mobility, 6, 7],
      [PART_ID.shortRadar, PART_CATEGORY.sensor, 2, 1],
      [PART_ID.longRadar, PART_CATEGORY.sensor, 6, 4],
      [PART_ID.directionalScanner, PART_CATEGORY.sensor, 3, 2],
      [PART_ID.proximity, PART_CATEGORY.sensor, 1, 0],
      [PART_ID.blaster, PART_CATEGORY.weapon, 4, 6],
      [PART_ID.heavyBlaster, PART_CATEGORY.weapon, 8, 12],
      [PART_ID.grenade, PART_CATEGORY.weapon, 5, 8],
      [PART_ID.lightShield, PART_CATEGORY.defense, 3, 4],
      [PART_ID.heavyShield, PART_CATEGORY.defense, 7, 9],
      [PART_ID.constructor, PART_CATEGORY.construction, 10, 15],
      [PART_ID.storage, PART_CATEGORY.construction, 2, 0],
      [PART_ID.solarPanel, PART_CATEGORY.energy, 1, -5],
      [PART_ID.reactor, PART_CATEGORY.energy, 8, -10],
    ];
    expect(PARTS).toHaveLength(expected.length);
    for (const [id, category, massKg, powerW] of expected) {
      const part = PARTS_BY_ID[id];
      expect(part, id).toBeDefined();
      expect(part!.category, id).toBe(category);
      expect(part!.massKg, id).toBe(massKg);
      expect(part!.powerW, id).toBe(powerW);
    }
  });

  it('[determinism] the catalog and id map are frozen between calls', () => {
    expect(Object.isFrozen(PARTS)).toBe(true);
    expect(Object.isFrozen(PARTS_BY_ID)).toBe(true);
    expect(Object.keys(PARTS_BY_ID)).toHaveLength(PARTS.length);
  });

  it('[invalid] weapon rows carry exactly one of rangeMm or splashRadiusMm', () => {
    expect(PARTS_BY_ID[PART_ID.blaster]!.effect).toMatchObject({ kind: 'weapon', rangeMm: 30000, splashRadiusMm: null });
    expect(PARTS_BY_ID[PART_ID.heavyBlaster]!.effect).toMatchObject({ kind: 'weapon', rangeMm: 30000, cooldownTicks: 120 });
    // The grenade is the arcing splash weapon (04 § 3.2.1): splash radius
    // 12 000 mm, 6 s cooldown = 360 ticks, no hitscan range.
    expect(PARTS_BY_ID[PART_ID.grenade]!.effect).toMatchObject({
      kind: 'weapon',
      splashRadiusMm: 12000,
      rangeMm: null,
      cooldownTicks: 360,
    });
  });
});

// The shipped JSON passes through parseCatalog at module load; these
// tests drive drifted documents through the same gate, so a hand-edited
// or balance-patched catalog cannot smuggle a bad row in (20 T03.3).
describe('parseCatalog schema (20 T03.3)', () => {
  const drifted = (mutate: (document: Record<string, unknown>) => void): unknown => {
    const copy = JSON.parse(JSON.stringify(catalogDocument)) as Record<string, unknown>;
    mutate(copy);
    return copy;
  };
  const firstRow = (document: Record<string, unknown>): Record<string, unknown> =>
    (document['parts'] as Record<string, unknown>[])[0] as Record<string, unknown>;

  it('[normal] the shipped catalog passes and round-trips all 16 rows', () => {
    expect(parseCatalog(catalogDocument).map((part) => part.id)).toEqual(PARTS.map((part) => part.id));
  });

  it('[invalid] rejects a wrong version, unknown ids, duplicates and unknown categories', () => {
    expect(() => parseCatalog(drifted((doc) => { doc['version'] = 2; }))).toThrow(/version/);
    expect(() => parseCatalog(drifted((doc) => { firstRow(doc)['id'] = 'laser_cannon'; }))).toThrow(/PART_ID/);
    expect(() =>
      parseCatalog(drifted((doc) => {
        const parts = doc['parts'] as unknown[];
        parts.push({ ...(parts[0] as Record<string, unknown>) });
      })),
    ).toThrow(/twice/);
    expect(() => parseCatalog(drifted((doc) => { firstRow(doc)['category'] = 'magic'; }))).toThrow(/category/);
  });

  it('[invalid] rejects stack limits outside the part-slot bound and row-count drift', () => {
    expect(() => parseCatalog(drifted((doc) => { firstRow(doc)['stackLimit'] = 0; }))).toThrow(/stackLimit/);
    expect(() => parseCatalog(drifted((doc) => { firstRow(doc)['stackLimit'] = 9; }))).toThrow(/stackLimit/);
    expect(() =>
      parseCatalog(drifted((doc) => {
        (doc['parts'] as unknown[]).pop();
      })),
    ).toThrow(/exactly once/);
  });

  it('[invalid] rejects malformed effects per kind', () => {
    expect(() => parseCatalog(drifted((doc) => { firstRow(doc)['effect'] = { kind: 'teleport' }; }))).toThrow(/effect kind/);
    expect(() =>
      parseCatalog(drifted((doc) => {
        const blaster = (doc['parts'] as Record<string, unknown>[]).find((row) => row['id'] === 'blaster') as Record<string, unknown>;
        blaster['effect'] = { kind: 'weapon', damagePerHit: 12, cooldownTicks: 60 };
      })),
    ).toThrow(/rangeMm or splashRadiusMm/);
    expect(() =>
      parseCatalog(drifted((doc) => {
        firstRow(doc)['effect'] = { kind: 'mobility', topSpeedMmPerSec: 2.5 };
      })),
    ).toThrow(/integer/);
    expect(() =>
      parseCatalog(drifted((doc) => {
        firstRow(doc)['effect'] = { kind: 'mobility', topSpeedMmPerSec: 2500, ignoresFriction: 'no' };
      })),
    ).toThrow(/boolean/);
    expect(() =>
      parseCatalog(drifted((doc) => {
        firstRow(doc)['massKg'] = 'four';
      })),
    ).toThrow(/integer/);
    expect(() =>
      parseCatalog(drifted((doc) => {
        delete firstRow(doc)['effect'];
      })),
    ).toThrow(/effect kind/);
  });
});

describe('aggregate (D6 milliwatts, 04 § 3.1 formulas)', () => {
  it('[normal] matches the 20 Phase 03 sample chassis', () => {
    const stats = aggregate(chassis(PART_ID.mk2Engine, PART_ID.longRadar, PART_ID.blaster, PART_ID.solarPanel));
    expect(stats.topSpeedMmPerSec).toBe(4000);
    expect(stats.radarRangeMm).toBe(80000);
    expect(stats.weapons).toHaveLength(1);
    expect(stats.weapons[0]).toMatchObject({ partId: PART_ID.blaster, damagePerHit: 12, cooldownTicks: 60, rangeMm: 30000 });
    expect(stats.massKg).toBe(19);
    expect(stats.maxHullHp).toBe(28);
  });

  it('[normal] reproduces the 13 § 4 builder preview numbers', () => {
    const stats = aggregate(chassis(PART_ID.mk1Engine, PART_ID.shortRadar, PART_ID.blaster, PART_ID.solarPanel));
    expect(stats.powerDrawMilliwatts).toBe(12000);
    expect(stats.powerGenerationMilliwatts).toBe(5000);
    expect(stats.netPowerMilliwatts).toBe(7000);
  });

  it('[state] T6: a 5 W draw aggregates to 5000 milliwatts, never 0', () => {
    // The predecessor's floor(power / 60) made every sub-60 W part free
    // (AGENTS.md § 3). The aggregate speaks milliwatts (D6), so the drain
    // scale cannot lose a 5 W part the way watts-through-floor did.
    const stats = aggregate(chassis(PART_ID.mk1Engine));
    expect(stats.powerDrawMilliwatts).toBe(5000);
    expect(stats.netPowerMilliwatts).toBe(5000);
  });

  it('[state] the power sign is preserved, never abs-ed', () => {
    const stats = aggregate(chassis(PART_ID.reactor));
    expect(stats.powerDrawMilliwatts).toBe(0);
    expect(stats.powerGenerationMilliwatts).toBe(10000);
    expect(stats.netPowerMilliwatts).toBe(-10000);
  });

  it('[boundary] hull HP floors mass x 1.5 at the exact halves', () => {
    expect(aggregate(chassis(PART_ID.proximity)).maxHullHp).toBe(1);
    // 3 kg x 1.5 = 4.5 floors to 4.
    expect(aggregate(chassis(PART_ID.shortRadar, PART_ID.proximity)).maxHullHp).toBe(4);
    // 50 kg is the mass limit and yields 75.
    expect(aggregate(chassis(PART_ID.constructor, PART_ID.mk2Engine, PART_ID.reactor, PART_ID.heavyShield, PART_ID.grenade, PART_ID.longRadar, PART_ID.blaster, PART_ID.storage)).maxHullHp).toBe(75);
    expect(aggregate(chassis()).maxHullHp).toBe(0);
  });

  it('[normal] shields stack by sum and carry their regen rates (D7)', () => {
    const stats = aggregate(chassis(PART_ID.lightShield, PART_ID.heavyShield));
    expect(stats.maxShieldHp).toBe(70);
    expect(stats.shieldRegenMilliHpPerSecond).toBe(1500);
    expect(aggregate(chassis(PART_ID.mk1Engine)).maxShieldHp).toBe(0);
  });

  it('[normal] storage adds on top of the 25 biomass base', () => {
    expect(BASE_CARRY_CAPACITY).toBe(25);
    expect(aggregate(chassis(PART_ID.storage, PART_ID.storage)).carryCapacity).toBe(75);
  });

  it('[normal] the hover unit carries its handling perks', () => {
    const stats = aggregate(chassis(PART_ID.hoverUnit));
    expect(stats.topSpeedMmPerSec).toBe(2500);
    expect(stats.accelPermyriad).toBe(13000);
    expect(stats.ignoresFriction).toBe(true);
    expect(aggregate(chassis(PART_ID.mk2Engine)).accelPermyriad).toBe(BASE_ACCEL_PERMYRIAD);
    expect(aggregate(chassis(PART_ID.mk2Engine)).ignoresFriction).toBe(false);
  });

  it('[normal] two radars keep the best range; the scanner cone converts to brads', () => {
    expect(aggregate(chassis(PART_ID.shortRadar, PART_ID.longRadar)).radarRangeMm).toBe(80000);
    expect(aggregate(chassis(PART_ID.shortRadar)).radarRangeMm).toBe(25000);
    const scanner = aggregate(chassis(PART_ID.directionalScanner));
    expect(scanner.scanRangeMm).toBe(40000);
    // 30 degrees of a 65536-brad turn, floored.
    expect(scanner.scanConeBrads).toBe(5461);
    expect(aggregate(chassis(PART_ID.proximity)).proximityRangeMm).toBe(2000);
  });

  it('[normal] weapon loadouts keep the design part order', () => {
    const stats = aggregate(chassis(PART_ID.grenade, PART_ID.blaster));
    expect(stats.weapons.map((weapon) => weapon.partId)).toEqual([PART_ID.grenade, PART_ID.blaster]);
    expect(stats.weapons[0]).toMatchObject({ damagePerHit: 20, splashRadiusMm: 12000, rangeMm: null, cooldownTicks: 360 });
  });

  it('[state] energy pool and carry defaults come from one owner', () => {
    expect(BASE_ENERGY_MAX).toBe(500);
    expect(aggregate(chassis(PART_ID.constructor)).energyMax).toBe(500);
    expect(aggregate(chassis(PART_ID.constructor)).buildRateMilliKgPerSecond).toBe(2000);
  });

  it('[invalid] an unknown part id throws instead of guessing', () => {
    expect(() => aggregate(chassis('laser_cannon'))).toThrow(TypeError);
  });

  it('[boundary] best-range aggregation keeps the maximum regardless of fit order', () => {
    // aggregate is total over known ids in any order (validateChassis is
    // the stacking gate) — a smaller sensor after a bigger one must not
    // shrink the stat.
    expect(aggregate(chassis(PART_ID.longRadar, PART_ID.shortRadar)).radarRangeMm).toBe(80000);
    expect(aggregate(chassis(PART_ID.mk2Engine, PART_ID.hoverUnit)).topSpeedMmPerSec).toBe(4000);
    expect(aggregate(chassis(PART_ID.proximity, PART_ID.proximity)).proximityRangeMm).toBe(2000);
  });

  it('[repeat] repeated calls are pure and identical', () => {
    const design = chassis(PART_ID.hoverUnit, PART_ID.blaster, PART_ID.lightShield, PART_ID.storage);
    const first = aggregate(design);
    const second = aggregate(design);
    expect(second).toEqual(first);
    expect(design.parts).toHaveLength(4);
  });
});

describe('validateChassis (04 § 3.1, D6, G4 contracts)', () => {
  it('[normal] accepts the 8-part, 50 kg, signed-sum chassis', () => {
    // 8 slots, exactly 50 kg, 65 W signed sum.
    const verdict = validateChassis(
      chassis(PART_ID.constructor, PART_ID.heavyBlaster, PART_ID.mk2Engine, PART_ID.heavyShield, PART_ID.grenade, PART_ID.longRadar, PART_ID.blaster, PART_ID.storage),
    );
    expect(verdict).toEqual({ ok: true });
  });

  it('[boundary] rejects the 9th part slot', () => {
    const verdict = validateChassis(
      chassis(PART_ID.blaster, PART_ID.blaster, PART_ID.blaster, PART_ID.blaster, PART_ID.blaster, PART_ID.blaster, PART_ID.blaster, PART_ID.blaster, PART_ID.proximity),
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.issues).toContainEqual({
        code: CHASSIS_ERROR_CODES.slots,
        limit: CHASSIS_LIMITS.partSlots,
        actual: 9,
      });
    }
  });

  it('[boundary] rejects 51 kg and accepts 50 kg (23 § 7: 50.1 is the first violating sum)', () => {
    const at50 = chassis(PART_ID.constructor, PART_ID.heavyBlaster, PART_ID.mk2Engine, PART_ID.heavyShield, PART_ID.grenade, PART_ID.longRadar, PART_ID.blaster, PART_ID.storage);
    expect(validateChassis(at50)).toEqual({ ok: true });
    // 51 kg, still 8 slots, 65 W: the mass contract alone fires.
    const verdict = validateChassis(chassis(PART_ID.constructor, PART_ID.heavyBlaster, PART_ID.mk2Engine, PART_ID.heavyShield, PART_ID.grenade, PART_ID.longRadar, PART_ID.blaster, PART_ID.directionalScanner));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.issues).toEqual([
        { code: CHASSIS_ERROR_CODES.mass, limit: CHASSIS_LIMITS.massKg, actual: 51 },
      ]);
    }
  });

  it('[boundary] rejects an 81 W signed sum; 20 Phase 03 keeps net-negative legal', () => {
    // 6 heavy blasters + heavy shield = 81 W (mass also breaks — with the
    // 04 § 3.2 catalog's best 1.5 W/kg no legal-mass chassis can breach
    // 80 W alone, so the verdict carries both contracts at once).
    const verdict = validateChassis(
      chassis(PART_ID.heavyBlaster, PART_ID.heavyBlaster, PART_ID.heavyBlaster, PART_ID.heavyBlaster, PART_ID.heavyBlaster, PART_ID.heavyBlaster, PART_ID.heavyShield),
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.issues).toContainEqual({
        code: CHASSIS_ERROR_CODES.power,
        limit: CHASSIS_LIMITS.netPowerMilliwatts,
        actual: 81000,
      });
      expect(verdict.issues).toContainEqual({ code: CHASSIS_ERROR_CODES.mass, limit: 50, actual: 55 });
    }
    expect(validateChassis(chassis(PART_ID.reactor))).toEqual({ ok: true });
  });

  it('[invalid] unknown part ids are reported, one issue each', () => {
    const verdict = validateChassis(chassis('laser_cannon', 'plasma_lance'));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.issues).toEqual([
        { code: CHASSIS_ERROR_CODES.unknownPart, partId: 'laser_cannon' },
        { code: CHASSIS_ERROR_CODES.unknownPart, partId: 'plasma_lance' },
      ]);
    }
  });

  it('[invalid] stacking beyond a part stackLimit is rejected', () => {
    const verdict = validateChassis(chassis(PART_ID.mk1Engine, PART_ID.mk1Engine));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.issues).toContainEqual({
        code: CHASSIS_ERROR_CODES.stack,
        partId: PART_ID.mk1Engine,
        limit: 1,
        actual: 2,
      });
    }
  });

  it('[invalid] one drivetrain per chassis: mk1 + mk2 is a mobility error, not a stack error', () => {
    const verdict = validateChassis(chassis(PART_ID.mk1Engine, PART_ID.mk2Engine));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.issues).toEqual([{ code: CHASSIS_ERROR_CODES.mobility, limit: 1, actual: 2 }]);
    }
  });

  it('[state] the verdict is deterministic and does not mutate the chassis', () => {
    const design = chassis(PART_ID.blaster, PART_ID.grenade, PART_ID.hoverUnit);
    const first = validateChassis(design);
    const second = validateChassis(design);
    expect(second).toEqual(first);
    expect(first).toEqual({ ok: true });
    expect(design.parts).toHaveLength(3);
  });
});
