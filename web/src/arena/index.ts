// Public surface of the arena context (AGENTS.md G8). The match loop
// builds the arena and the biomass field and clamps movement through
// this module; perception/ (later) reads cells through the field, never
// through geometry internals.
export {
  DEFAULT_ARENA_CONFIG,
  buildArena,
  clampToArena,
  isInsidePillar,
  isInWall,
  pillarExclusionRadius,
  resolvePillarOverlap,
} from './geometry';
export type { Arena, ArenaConfig } from './geometry';
export {
  BIOMASS_CELL_COUNT,
  CELLS_PER_CLUSTER,
  CLUSTER_COUNT,
  CLUSTER_RADIUS_MM,
  KG_PER_CELL,
  REGIONS_PER_SIDE,
  REGION_COUNT,
  RESPAWN_TICKS,
  BiomassField,
  regionOf,
} from './biomass';
export type { BiomassCell } from './biomass';
