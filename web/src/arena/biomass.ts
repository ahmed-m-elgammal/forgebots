// The biomass field — the resource half of Phase 4 task 1 (23 § 7.1):
// 400 cells of 1 kg each (D15), seeded deterministically from the match
// seed, respawning 300 ticks (5 s) after depletion IN REGION-SIZED
// CLUSTERS, not uniformly.
//
// The cluster rule is the point. legacy/02 § 6 requirement 4 (via
// legacy/02 § 4.2): partitioning — each gatherer claims a region — is a
// real strategy, and D15's uniform "pseudo-random free cell" respawn
// makes it pointless. 23 § 7.1 adopts the requirement: a depleted cell's
// biomass re-enters the field on a free cell WITHIN ITS REGION.
//
// Reconciliations with the spec, documented rather than silent:
// - Regions are a 10 x 10 grid of 20 m x 20 m squares (REGIONS_PER_SIDE).
//   Neither doc fixes a region size; 20 m keeps a respawned patch
//   coherent at radar/food scale while leaving 100 regions for six
//   gatherers to partition. The 3 x 3 pockets are ~66 m — coarser than
//   one robot can hold — and are cover, not farmland.
// - Initial placement is clustered too (40 seeded cluster centres, 10
//   cells each within a 5 m jitter radius): legacy/02 § 4.2 asks for
//   "patches that are spatially coherent rather than uniformly mixed",
//   which a uniform scatter would not deliver on a 1500-tick map.
// - Build-time draws (cluster centres and jitter) use a dedicated
//   matchRng created from the match seed, exactly like geometry's spawn
//   order; respawn draws use the Rng the caller passes per tick — the
//   runtime matchRng stream, advanced once per tick before bots step
//   (D5). Nothing a player writes can perturb either stream.
// - "Depleted" and "picked up" are one event with one word (D15):
//   deplete().
//
// Respawn mechanics: depleting a cell releases a biomass UNIT bound to
// that cell's region, due back at tick + RESPAWN_TICKS. Units sit in a
// FIFO queue (depletion order is due order — the match clock only moves
// forward) and fire on schedule whether or not their home slot has since
// been refilled: two units are two returns, and nothing is cancelled or
// overwritten. A unit lands on a free slot of its region, chosen by the
// caller's rng over the free slots in ascending index order. Because a
// unit never leaves its region, each region's unit population is
// constant, so a firing unit always finds a free slot: its region holds
// exactly one more pending-or-firing unit than materialized ones.

import { add as fixedAdd, sub as fixedSub, fromMm, type Fixed } from '../math/fixed';
import { createMatchRng, type Rng } from '../math/rng';
import { distanceSquared, type Vec2 } from '../math/vec2';
import { clampToArena, resolvePillarOverlap, type Arena } from './geometry';

export const BIOMASS_CELL_COUNT = 400;
export const KG_PER_CELL = 1;
// D15: a cell respawns 5 s (300 ticks) after it is depleted.
export const RESPAWN_TICKS = 300;
export const REGIONS_PER_SIDE = 10;
export const REGION_COUNT = REGIONS_PER_SIDE * REGIONS_PER_SIDE;
export const CLUSTER_COUNT = 40;
export const CELLS_PER_CLUSTER = BIOMASS_CELL_COUNT / CLUSTER_COUNT;
export const CLUSTER_RADIUS_MM = 5000;
const CLUSTER_RADIUS_RAW = fromMm(CLUSTER_RADIUS_MM);

export interface BiomassCell {
  readonly index: number;
  readonly position: Vec2;
  readonly region: number;
  readonly kg: number;
  available: boolean;
}

interface PendingUnit {
  readonly region: number;
  readonly dueTick: number;
}

// Region grid over the whole arena: the row-major region index of a
// position. Interior positions always land in [0, REGION_COUNT); the
// clamp is defence for callers at the exact far edge.
export function regionOf(arena: Arena, position: Vec2): number {
  const col = ((position.x * REGIONS_PER_SIDE) / arena.size) | 0;
  const row = ((position.y * REGIONS_PER_SIDE) / arena.size) | 0;
  const clampedCol = col >= REGIONS_PER_SIDE ? REGIONS_PER_SIDE - 1 : col;
  const clampedRow = row >= REGIONS_PER_SIDE ? REGIONS_PER_SIDE - 1 : row;
  return clampedRow * REGIONS_PER_SIDE + clampedCol;
}

function placementBounds(arena: Arena): { low: Fixed; span: number } {
  const low = fixedAdd(arena.wallThickness, arena.robotRadius);
  return { low, span: fixedSub(arena.size, fixedAdd(low, low)) };
}

export class BiomassField {
  // Slot order is frozen and cells are exposed live: telemetry reads
  // state while the match runs, and all mutation goes through deplete()
  // and respawnDueCells() so availability and the pending queue agree.
  private readonly slots: readonly BiomassCell[];
  private readonly slotsByRegion: readonly (readonly number[])[];
  private readonly pending: PendingUnit[] = [];

  private constructor(slots: BiomassCell[], slotsByRegion: readonly (readonly number[])[]) {
    this.slots = slots;
    this.slotsByRegion = slotsByRegion;
  }

  // Deterministic in (arena, seed): same inputs, byte-identical layout.
  static build(arena: Arena, seed: bigint): BiomassField {
    const rng = createMatchRng(seed);
    const { low, span } = placementBounds(arena);
    const jitterSpan = 2 * CLUSTER_RADIUS_RAW + 1;
    const centres: Vec2[] = [];
    for (let i = 0; i < CLUSTER_COUNT; i++) {
      const centre = {
        x: (low + rng.nextInt(span + 1)) as Fixed,
        y: (low + rng.nextInt(span + 1)) as Fixed,
      };
      centres.push(resolvePillarOverlap(arena, clampToArena(arena, centre)));
    }
    const cells: BiomassCell[] = [];
    for (let i = 0; i < BIOMASS_CELL_COUNT; i++) {
      const centre = centres[(i / CELLS_PER_CLUSTER) | 0]!;
      const jittered = {
        x: (centre.x + rng.nextInt(jitterSpan) - CLUSTER_RADIUS_RAW) as Fixed,
        y: (centre.y + rng.nextInt(jitterSpan) - CLUSTER_RADIUS_RAW) as Fixed,
      };
      const position = resolvePillarOverlap(arena, clampToArena(arena, jittered));
      cells.push({
        index: i,
        position,
        region: regionOf(arena, position),
        kg: KG_PER_CELL,
        available: true,
      });
    }
    const slotsByRegion: number[][] = [];
    for (let region = 0; region < REGION_COUNT; region++) {
      slotsByRegion.push([]);
    }
    for (const cell of cells) {
      slotsByRegion[cell.region]!.push(cell.index);
    }
    return new BiomassField(cells, slotsByRegion);
  }

  // Marks a cell taken at `tick` and queues its biomass unit's return.
  // Depleting a cell that is not available is a caller contract violation
  // — the match loop only offers available cells — so it throws instead
  // of silently double-spending the field. `tick` is the match clock's
  // current tick; the queue stays due-ordered because that clock only
  // moves forward.
  deplete(index: number, tick: number): void {
    const cell = this.cell(index);
    if (!cell.available) {
      throw new Error(`biomass cell ${index} is not available (tick ${tick})`);
    }
    cell.available = false;
    this.pending.push({ region: cell.region, dueTick: tick + RESPAWN_TICKS });
  }

  // Fires every unit due at `tick` (or overdue, defensively), in FIFO
  // order, each landing on a free slot of its own region via the caller's
  // rng. Called once per tick with the runtime matchRng (D5). Returns the
  // cells that came back this call, in firing order — the match loop's
  // biomass_spawn records read their positions from it.
  respawnDueCells(tick: number, rng: Rng): BiomassCell[] {
    const respawned: BiomassCell[] = [];
    while (this.pending.length > 0 && this.pending[0]!.dueTick <= tick) {
      const unit = this.pending.shift()!;
      const candidates = this.slotsByRegion[unit.region]!.filter((index) => !this.slots[index]!.available);
      const chosenIndex = candidates[rng.nextInt(candidates.length)] as number;
      const cell = this.slots[chosenIndex]!;
      cell.available = true;
      respawned.push(cell);
    }
    return respawned;
  }

  // The nearest available cell within `range` of `position`, or null.
  // Inclusive boundary (exactly-at-range counts, matching vec2.inRange);
  // ties go to the lowest index, so the result is deterministic. Exact
  // squared comparison — no sqrt rounding at the boundary.
  nearestAvailable(position: Vec2, range: Fixed): BiomassCell | null {
    if (range < 0) {
      throw new RangeError(`range must not be negative, got ${range}`);
    }
    const rangeSq = BigInt(range) * BigInt(range);
    let best: BiomassCell | null = null;
    let bestSq: bigint | null = null;
    for (const cell of this.slots) {
      if (!cell.available) {
        continue;
      }
      const candidateSq = distanceSquared(position, cell.position);
      if (candidateSq > rangeSq) {
        continue;
      }
      if (bestSq === null || candidateSq < bestSq) {
        best = cell;
        bestSq = candidateSq;
      }
    }
    return best;
  }

  availableCount(): number {
    let count = 0;
    for (const cell of this.slots) {
      if (cell.available) {
        count++;
      }
    }
    return count;
  }

  // Biomass units out in the wild — depleted, not yet respawned.
  pendingCount(): number {
    return this.pending.length;
  }

  cell(index: number): BiomassCell {
    if (!Number.isInteger(index)) {
      throw new TypeError(`biomass cell index must be an integer, got ${index}`);
    }
    if (index < 0 || index >= BIOMASS_CELL_COUNT) {
      throw new RangeError(`biomass cell index must be in [0, ${BIOMASS_CELL_COUNT}), got ${index}`);
    }
    return this.slots[index]!;
  }

  allCells(): readonly BiomassCell[] {
    return this.slots;
  }
}
