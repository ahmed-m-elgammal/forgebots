// Arena geometry — Phase 4 task 1 (23-WEB-CLIENT-PLAN.md § 7.1): walls,
// pillars, spawn points. 200 m x 200 m (D15), 0.5 m perimeter walls, 8
// interior pillars on the 3 x 3 cell lattice with the centre cell empty,
// robot collision radius 0.5 m.
//
// Tiles are a rendering convenience and never appear here: positions are
// Q16.16 metres (D1), config arrives in integer millimetres (the wire
// unit) and converts at this boundary (G33).
//
// Reconciliations with the spec, documented rather than silent:
// - D15 names no pillar radius. 2000 mm (4x the robot radius) is the
//   catalog decision: pillars read as cover on a 66 m cell, leave ~30 m
//   gaps to the walls, and the exclusion circle stays far from every
//   other pillar's, so one push-out pass can never chain into a wall.
// - 20 T14.1's buildArena(cfg, seed) builds pillars and spawn POINTS
//   from cfg alone (D15 fixes them exactly); the seed drives the spawn
//   ORDER permutation, the one thing 04 § 5 calls seed-derived. Build
//   draws use a dedicated matchRng instance created from the match seed,
//   so they can never perturb the runtime per-tick stream (D5).
// - Spawn points sit 1.5 m in from each wall (0.5 m wall + 0.5 m robot
//   radius + 0.5 m clearance), three per side at the 1/4, 1/2 and 3/4
//   marks — 12 points, enough for the 12-robot worst case (D15).

import { FIXED_ZERO, clamp as fixedClamp, fromMm, add as fixedAdd, sub as fixedSub, isqrt, saturate, type Fixed } from '../math/fixed';
import { createMatchRng } from '../math/rng';
import { add, vec2, distanceSquared, type Vec2 } from '../math/vec2';

export interface ArenaConfig {
  readonly sizeMm: number;
  readonly wallThicknessMm: number;
  readonly pillarRadiusMm: number;
  readonly robotRadiusMm: number;
  readonly spawnInsetMm: number;
}

export const DEFAULT_ARENA_CONFIG: ArenaConfig = {
  sizeMm: 200000,
  wallThicknessMm: 500,
  pillarRadiusMm: 2000,
  robotRadiusMm: 500,
  spawnInsetMm: 1500,
};

export interface Arena {
  readonly size: Fixed;
  readonly wallThickness: Fixed;
  readonly pillarRadius: Fixed;
  readonly robotRadius: Fixed;
  readonly spawnInset: Fixed;
  readonly pillars: readonly Vec2[];
  readonly spawnPoints: readonly Vec2[];
  // Permutation of spawn-point indices: the i-th spawned robot takes
  // spawnPoints[spawnOrder[i]] (04 § 5 — deterministic order from seed).
  readonly spawnOrder: readonly number[];
}

const SPAWN_POINTS_PER_SIDE = 3;
const SPAWN_POINT_COUNT = 12;
const LATTICE_DIVISIONS = 3;
const LATTICE_HALF_STEPS = 6;
const QUARTER_MARKS = 4;
const MAX_MM = 32767999;

function assertConfigPart(value: number, label: string): number {
  if (!Number.isInteger(value)) {
    throw new TypeError(`arena config ${label} must be an integer, got ${value}`);
  }
  if (value <= 0) {
    throw new RangeError(`arena config ${label} must be positive, got ${value}`);
  }
  return value;
}

// Pillar centres: the 8 outer cells of the 3 x 3 lattice, each pillar at
// its cell's centre. Integer lattice arithmetic — no float, no rounding
// drift: the centre of column c is ((2c + 1) * size) / 6 truncated, which
// is deterministic on every platform by construction.
function pillarCentres(size: Fixed): Vec2[] {
  const centres: Vec2[] = [];
  for (let row = 0; row < LATTICE_DIVISIONS; row++) {
    for (let col = 0; col < LATTICE_DIVISIONS; col++) {
      if (row === 1 && col === 1) {
        continue;
      }
      const x = (((2 * col + 1) * size) / LATTICE_HALF_STEPS) | 0;
      const y = (((2 * row + 1) * size) / LATTICE_HALF_STEPS) | 0;
      centres.push(vec2(x as Fixed, y as Fixed));
    }
  }
  return centres;
}

function spawnPointPositions(size: Fixed, inset: Fixed): Vec2[] {
  const far = fixedSub(size, inset);
  const points: Vec2[] = [];
  for (let mark = 1; mark <= SPAWN_POINTS_PER_SIDE; mark++) {
    const along = ((size * mark) / QUARTER_MARKS) | 0;
    points.push(vec2(along as Fixed, inset));
  }
  for (let mark = 1; mark <= SPAWN_POINTS_PER_SIDE; mark++) {
    const along = ((size * mark) / QUARTER_MARKS) | 0;
    points.push(vec2(far, along as Fixed));
  }
  for (let mark = SPAWN_POINTS_PER_SIDE; mark >= 1; mark--) {
    const along = ((size * mark) / QUARTER_MARKS) | 0;
    points.push(vec2(along as Fixed, far));
  }
  for (let mark = SPAWN_POINTS_PER_SIDE; mark >= 1; mark--) {
    const along = ((size * mark) / QUARTER_MARKS) | 0;
    points.push(vec2(inset, along as Fixed));
  }
  return points;
}

// Seeded Fisher-Yates over the 12 spawn slots: the permutation itself is
// the deterministic spawn order the spec asks for.
function spawnOrderFromSeed(seed: bigint): number[] {
  const rng = createMatchRng(seed);
  const order: number[] = [];
  for (let i = 0; i < SPAWN_POINT_COUNT; i++) {
    order.push(i);
  }
  for (let i = SPAWN_POINT_COUNT - 1; i >= 1; i--) {
    const j = rng.nextInt(i + 1);
    const temp = order[i]!;
    order[i] = order[j]!;
    order[j] = temp;
  }
  return order;
}

export function buildArena(cfg: ArenaConfig, seed: bigint): Arena {
  const sizeMm = assertConfigPart(cfg.sizeMm, 'sizeMm');
  const wallThicknessMm = assertConfigPart(cfg.wallThicknessMm, 'wallThicknessMm');
  const pillarRadiusMm = assertConfigPart(cfg.pillarRadiusMm, 'pillarRadiusMm');
  const robotRadiusMm = assertConfigPart(cfg.robotRadiusMm, 'robotRadiusMm');
  const spawnInsetMm = assertConfigPart(cfg.spawnInsetMm, 'spawnInsetMm');
  if (sizeMm > MAX_MM) {
    throw new RangeError(`arena config sizeMm must fit Q16.16 (max ${MAX_MM}), got ${sizeMm}`);
  }
  if (wallThicknessMm * 2 >= sizeMm) {
    throw new RangeError(`arena config wallThicknessMm ${wallThicknessMm} leaves no interior in ${sizeMm}`);
  }
  const insetFloorMm = wallThicknessMm + robotRadiusMm;
  if (spawnInsetMm < insetFloorMm || spawnInsetMm > sizeMm - insetFloorMm) {
    throw new RangeError(
      `arena config spawnInsetMm ${spawnInsetMm} must land a robot inside the walls (${insetFloorMm}..${sizeMm - insetFloorMm})`,
    );
  }
  const size = fromMm(sizeMm);
  const wallThickness = fromMm(wallThicknessMm);
  const pillarRadius = fromMm(pillarRadiusMm);
  const robotRadius = fromMm(robotRadiusMm);
  const spawnInset = fromMm(spawnInsetMm);
  const pillars = Object.freeze(pillarCentres(size));
  const spawnPoints = Object.freeze(spawnPointPositions(size, spawnInset));
  return Object.freeze({
    size,
    wallThickness,
    pillarRadius,
    robotRadius,
    spawnInset,
    pillars,
    spawnPoints,
    spawnOrder: Object.freeze(spawnOrderFromSeed(seed)),
  });
}

// Strictly inside the wall band: a position exactly on the inner wall
// face is interior (touching is not entering).
export function isInWall(arena: Arena, position: Vec2): boolean {
  const far = arena.size - arena.wallThickness;
  return (
    position.x < arena.wallThickness ||
    position.y < arena.wallThickness ||
    position.x > far ||
    position.y > far
  );
}

// Clamps a centre so the whole robot disc stays inside the walls. Used
// per tick after movement; idempotent by construction.
export function clampToArena(arena: Arena, position: Vec2): Vec2 {
  const lo = fixedAdd(arena.wallThickness, arena.robotRadius);
  const hi = fixedSub(arena.size, lo);
  return vec2(fixedClamp(position.x, lo, hi), fixedClamp(position.y, lo, hi));
}

// Overlap is strict: a disc exactly touching a pillar is not inside it,
// so a robot can rest against the stone without being pushed forever.
export function pillarExclusionRadius(arena: Arena): Fixed {
  return fixedAdd(arena.pillarRadius, arena.robotRadius);
}

export function isInsidePillar(arena: Arena, position: Vec2): boolean {
  const exclusionSq = BigInt(pillarExclusionRadius(arena)) * BigInt(pillarExclusionRadius(arena));
  return arena.pillars.some((pillar) => distanceSquared(position, pillar) < exclusionSq);
}

// Pushes an overlapping robot disc out of every pillar it intersects,
// radially to the exclusion boundary, pillars in index order. The push
// is exact integer arithmetic — each component is scaled by
// exclusion/len and rounded AWAY FROM ZERO, so the resolved distance can
// never land a raw unit short of the boundary through rounding (G21):
// with both components at or past their exact radial values, the norm is
// at or past the exclusion radius. The exactly-at-centre case pushes
// east: a zero direction has no radial, and the tie-break must be
// deterministic.
export function resolvePillarOverlap(arena: Arena, position: Vec2): Vec2 {
  const exclusion = BigInt(pillarExclusionRadius(arena));
  const exclusionSq = exclusion * exclusion;
  let resolved = position;
  for (const pillar of arena.pillars) {
    if (distanceSquared(resolved, pillar) >= exclusionSq) {
      continue;
    }
    const rawDx = BigInt(resolved.x) - BigInt(pillar.x);
    const rawDy = BigInt(resolved.y) - BigInt(pillar.y);
    if (rawDx === 0n && rawDy === 0n) {
      resolved = add(pillar, vec2(pillarExclusionRadius(arena), FIXED_ZERO));
      continue;
    }
    const length = isqrt(rawDx * rawDx + rawDy * rawDy);
    const wideLength = BigInt(length);
    const pushX = scaleAwayFromZero(rawDx * exclusion, wideLength);
    const pushY = scaleAwayFromZero(rawDy * exclusion, wideLength);
    resolved = vec2(
      saturate(BigInt(pillar.x) + pushX),
      saturate(BigInt(pillar.y) + pushY),
    );
  }
  return resolved;
}

// (value / divisor) rounded away from zero, pure BigInt. The radial push
// above relies on the away-from-zero direction for its at-least-exclusion
// guarantee.
function scaleAwayFromZero(value: bigint, divisor: bigint): bigint {
  if (value >= 0n) {
    return (value + divisor - 1n) / divisor;
  }
  return (value - divisor + 1n) / divisor;
}
