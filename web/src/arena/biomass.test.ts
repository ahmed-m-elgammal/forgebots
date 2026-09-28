import { describe, expect, it } from 'vitest';
import {
  BIOMASS_CELL_COUNT,
  CELLS_PER_CLUSTER,
  CLUSTER_COUNT,
  KG_PER_CELL,
  REGION_COUNT,
  RESPAWN_TICKS,
  BiomassField,
  buildArena,
  DEFAULT_ARENA_CONFIG,
  regionOf,
} from './index';
import { fromMm, fromRaw } from '../math/fixed';
import { createMatchRng } from '../math/rng';
import type { Rng } from '../math/rng';

// Phase 4 task 1's biomass field (23 § 7.1, D15, legacy/02 § 6 req 4):
// 400 x 1 kg cells, 300-tick respawn, arrivals CLUSTERED IN REGIONS —
// the property that makes partitioning (each gatherer claims a region)
// a real strategy.

const arena = buildArena(DEFAULT_ARENA_CONFIG, 42n);

const field42 = () => BiomassField.build(arena, 42n);

const stubRng = (ints: number[] = []): { rng: Rng; draws: () => number } => {
  const queue = [...ints];
  let count = 0;
  return {
    rng: {
      nextUint32: () => {
        count++;
        return 0;
      },
      nextInt: () => {
        count++;
        return queue.length > 0 ? (queue.shift() as number) : 0;
      },
    },
    draws: () => count,
  };
};

describe('BiomassField.build (20 T14.3, clustered placement)', () => {
  it('[normal] builds 400 available 1 kg cells in valid regions', () => {
    const field = field42();
    expect(field.availableCount()).toBe(BIOMASS_CELL_COUNT);
    const interiorLow = fromMm(1000);
    const interiorHigh = fromRaw(13041664);
    for (const cell of field.allCells()) {
      expect(cell.available).toBe(true);
      expect(cell.kg).toBe(KG_PER_CELL);
      expect(cell.region).toBeGreaterThanOrEqual(0);
      expect(cell.region).toBeLessThan(REGION_COUNT);
      expect(cell.position.x).toBeGreaterThanOrEqual(interiorLow);
      expect(cell.position.x).toBeLessThanOrEqual(interiorHigh);
      expect(cell.position.y).toBeGreaterThanOrEqual(interiorLow);
      expect(cell.position.y).toBeLessThanOrEqual(interiorHigh);
    }
  });

  it('[normal] no cell starts inside a pillar or a wall', () => {
    const field = field42();
    for (const cell of field.allCells()) {
      expect(isCellBlocked(cell.position)).toBe(false);
    }
  });

  it('[normal] placement is clustered, not uniform — regions concentrate load', () => {
    // Golden pins for seed 42: 59 of 100 regions occupied, hottest region
    // holding 23 cells. A uniform scatter would light up ~all 100 regions
    // at ~4 cells each; the clusters make partitioning real.
    const loads = new Array(REGION_COUNT).fill(0) as number[];
    for (const cell of field42().allCells()) {
      loads[cell.region]!++;
    }
    const occupied = loads.filter((load) => load > 0).length;
    const hottest = Math.max(...loads);
    expect(occupied).toBe(59);
    expect(hottest).toBe(23);
    expect(hottest).toBeGreaterThan(2 * (BIOMASS_CELL_COUNT / REGION_COUNT));
    expect(CLUSTER_COUNT * CELLS_PER_CLUSTER).toBe(BIOMASS_CELL_COUNT);
  });

  it('[determinism] same seed, byte-identical layout; different seed, different layout', () => {
    const first = JSON.stringify(field42().allCells().map((cell) => [cell.position.x, cell.position.y, cell.region]));
    const second = JSON.stringify(field42().allCells().map((cell) => [cell.position.x, cell.position.y, cell.region]));
    expect(second).toBe(first);
    // Pin one cell exactly — any drift in the build algorithm breaks this.
    const cell0 = field42().cell(0);
    expect([cell0.position.x, cell0.position.y, cell0.region]).toEqual([7824937, 2577016, 15]);
    const otherSeed = JSON.stringify(
      BiomassField.build(arena, 1n).allCells().map((cell) => [cell.position.x, cell.position.y, cell.region]),
    );
    expect(otherSeed).not.toBe(first);
  });
});

describe('deplete (D15: depleted == picked up)', () => {
  it('[state] marks the cell unavailable and queues the unit for the 300-tick return', () => {
    const field = field42();
    field.deplete(5, 100);
    expect(field.cell(5).available).toBe(false);
    expect(field.pendingCount()).toBe(1);
    expect(field.availableCount()).toBe(BIOMASS_CELL_COUNT - 1);
  });

  it('[boundary] depleting at tick 0 queues the return for exactly tick 300', () => {
    const field = field42();
    expect(RESPAWN_TICKS).toBe(300);
    field.deplete(0, 0);
    const before = stubRng();
    field.respawnDueCells(299, before.rng);
    expect(field.pendingCount()).toBe(1);
    expect(before.draws()).toBe(0);
  });

  it('[invalid] depleting an unavailable, out-of-range or non-integer slot throws', () => {
    const field = field42();
    field.deplete(3, 0);
    expect(() => field.deplete(3, 50)).toThrow(Error);
    expect(() => field.deplete(-1, 0)).toThrow(RangeError);
    expect(() => field.deplete(BIOMASS_CELL_COUNT, 0)).toThrow(RangeError);
    expect(() => field.deplete(2.5, 0)).toThrow(TypeError);
  });
});

describe('respawnDueCells (23 § 7.1: region-sized clusters)', () => {
  it('[boundary] nothing happens before the due tick; the cell returns at exactly 300', () => {
    const field = field42();
    field.deplete(0, 0);
    const before = stubRng();
    field.respawnDueCells(299, before.rng);
    expect(field.cell(0).available).toBe(false);
    expect(before.draws()).toBe(0);
    field.respawnDueCells(300, stubRng().rng);
    expect(field.cell(0).available).toBe(true);
    expect(field.availableCount()).toBe(BIOMASS_CELL_COUNT);
  });

  it('[state] an arrival lands in its source cell\'s region — the cluster rule', () => {
    const field = field42();
    const sourceRegion = field.cell(0).region;
    field.deplete(0, 0);
    field.respawnDueCells(300, stubRng().rng);
    // Region 15 had exactly one free slot — cell 0 — so the biomass MUST
    // have come back there. A uniform respawn (D15's old rule) could have
    // landed on any of the other 399 slots; that is what this forbids.
    expect(field.cell(0).available).toBe(true);
    expect(field.cell(0).region).toBe(sourceRegion);
    expect(field.availableCount()).toBe(BIOMASS_CELL_COUNT);
  });

  it('[state] a unit lands on a neighbouring free slot and both units return (conservation dance)', () => {
    // Cells 1 and 2 both sit in region 26 (seed 42). Deplete cell 1 at
    // tick 0 (due 300) and cell 2 at tick 100 (due 400). The stub sends
    // cell 1's unit onto cell 2's slot at 300; cell 2's OWN unit still
    // fires at 400 and lands on the only free slot left — cell 1. Two
    // units, two returns, nothing cancelled: the count is conserved.
    const field = field42();
    expect(field.cell(1).region).toBe(field.cell(2).region);
    field.deplete(1, 0);
    field.deplete(2, 100);
    expect(field.availableCount()).toBe(BIOMASS_CELL_COUNT - 2);

    const mover = stubRng([1]);
    field.respawnDueCells(300, mover.rng);
    expect(field.cell(2).available).toBe(true);
    expect(field.cell(1).available).toBe(false);
    expect(field.availableCount()).toBe(BIOMASS_CELL_COUNT - 1);
    expect(field.pendingCount()).toBe(1);

    field.respawnDueCells(400, stubRng().rng);
    expect(field.cell(1).available).toBe(true);
    expect(field.cell(2).available).toBe(true);
    expect(field.availableCount()).toBe(BIOMASS_CELL_COUNT);
    expect(field.pendingCount()).toBe(0);
  });

  it('[state] two cells due the same tick respawn without double-count', () => {
    const field = field42();
    field.deplete(1, 0);
    field.deplete(2, 0);
    field.respawnDueCells(300, stubRng().rng);
    expect(field.availableCount()).toBe(BIOMASS_CELL_COUNT);
  });

  it('[repeat] processing the same tick twice adds nothing', () => {
    const field = field42();
    field.deplete(1, 0);
    field.respawnDueCells(300, stubRng().rng);
    expect(field.availableCount()).toBe(BIOMASS_CELL_COUNT);
    const secondPass = stubRng();
    field.respawnDueCells(300, secondPass.rng);
    expect(secondPass.draws()).toBe(0);
    expect(field.availableCount()).toBe(BIOMASS_CELL_COUNT);
  });

  it('[repeat] 200 deplete/respawn cycles keep the count at exactly 400 with an empty queue', () => {
    const field = field42();
    const rng = createMatchRng(999n);
    // Deplete cell `step` every 10 ticks; every due tick is a multiple of
    // 10, so stepping the clock by 10 visits each one exactly once.
    for (let step = 0; step <= 300; step++) {
      const tick = step * 10;
      if (step < 200) {
        field.deplete(step, tick);
      }
      field.respawnDueCells(tick, rng);
      if (step === 29) {
        // The earliest return is exactly tick 300 — 29 steps in, nothing
        // has come back yet (the D15 300-tick boundary, from below).
        expect(field.availableCount()).toBe(BIOMASS_CELL_COUNT - 30);
        expect(field.pendingCount()).toBe(30);
      }
    }
    expect(field.availableCount()).toBe(BIOMASS_CELL_COUNT);
    expect(field.pendingCount()).toBe(0);
  });

  it('[determinism] identical state and rng stream produce identical arrivals', () => {
    const run = (): string => {
      const field = field42();
      const rng = createMatchRng(1234n);
      field.deplete(1, 0);
      field.deplete(2, 0);
      field.deplete(3, 0);
      for (let tick = 0; tick <= 300; tick++) {
        field.respawnDueCells(tick, rng);
      }
      return JSON.stringify(field.allCells().map((cell) => [cell.index, cell.available]));
    };
    expect(run()).toBe(run());
  });

  it('[state] a tick with no due respawns never advances the match rng (D5 discipline)', () => {
    const field = field42();
    const counting = stubRng();
    field.respawnDueCells(42, counting.rng);
    expect(counting.draws()).toBe(0);
  });
});

describe('nearestAvailable (the future food() query shape)', () => {
  it('[normal] returns the nearest available cell and skips depleted ones', () => {
    const field = field42();
    const target = field.cell(10);
    const probe = { x: target.position.x + 100 as typeof target.position.x, y: target.position.y };
    const seen = field.nearestAvailable(probe, fromMm(50));
    expect(seen?.index).toBe(10);
    field.deplete(10, 0);
    const second = field.nearestAvailable(probe, fromMm(50));
    expect(second === null || second.index !== 10).toBe(true);
  });

  it('[boundary] exactly-at-range counts; one raw beyond does not', () => {
    const field = field42();
    // Cells 32 and 35 sit at exactly 145388 raw from the midpoint.
    const midpoint = { x: fromRaw(2752492), y: fromRaw(13041664) };
    expect(field.nearestAvailable(midpoint, fromRaw(145388))?.index).toBe(32);
    expect(field.nearestAvailable(midpoint, fromRaw(145387))).toBeNull();
  });

  it('[determinism] an exact distance tie resolves to the lowest index', () => {
    const field = field42();
    const midpoint = { x: fromRaw(2752492), y: fromRaw(13041664) };
    expect(field.nearestAvailable(midpoint, fromRaw(145388))?.index).toBe(32);
    field.deplete(32, 0);
    expect(field.nearestAvailable(midpoint, fromRaw(145388))?.index).toBe(35);
  });

  it('[boundary] a zero range only finds a cell at the exact position', () => {
    const field = field42();
    const on = field.cell(20).position;
    expect(field.nearestAvailable(on, fromRaw(0))?.index).toBe(20);
    const off = { x: on.x + 1 as typeof on.x, y: on.y };
    expect(field.nearestAvailable(off, fromRaw(0))).toBeNull();
  });

  it('[invalid] a negative range is a caller bug and throws', () => {
    const field = field42();
    expect(() => field.nearestAvailable({ x: fromRaw(0), y: fromRaw(0) }, fromRaw(-1))).toThrow(RangeError);
  });
});

describe('regionOf (10 x 10 grid over the arena)', () => {
  it('[boundary] corners and the far edge map inside the grid', () => {
    expect(regionOf(arena, { x: fromRaw(0), y: fromRaw(0) })).toBe(0);
    expect(regionOf(arena, { x: fromRaw(13107199), y: fromRaw(13107199) })).toBe(REGION_COUNT - 1);
    expect(regionOf(arena, { x: fromRaw(6553600), y: fromRaw(6553600) })).toBe(55);
    // The defensive clamp: a position exactly on the far edge would land
    // on column/row 10, which is outside the grid.
    expect(regionOf(arena, { x: fromRaw(13107200), y: fromRaw(13107200) })).toBe(REGION_COUNT - 1);
  });
});

function isCellBlocked(position: { x: number; y: number }): boolean {
  const low = fromMm(500);
  const high = 13107200 - low;
  if (position.x < low || position.y < low || position.x > high || position.y > high) {
    return true;
  }
  const exclusion = fromMm(2500);
  const exclusionSq = BigInt(exclusion) * BigInt(exclusion);
  return arena.pillars.some((pillar) => {
    const dx = BigInt(position.x) - BigInt(pillar.x);
    const dy = BigInt(position.y) - BigInt(pillar.y);
    return dx * dx + dy * dy < exclusionSq;
  });
}
