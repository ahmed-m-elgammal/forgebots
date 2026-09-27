// Public surface of the robot context (AGENTS.md G8): the arena builds
// spawn points, the match loop spawns robots and takes snapshots, and the
// builder UI validates chassis — all through this module, never through
// parts/design/robot internals.
export {
  CHASSIS_LIMITS,
  validateDesignList,
  DESIGN_ERROR_CODES,
} from './design';
export type {
  Chassis,
  ChassisStats,
  Design,
  DesignErrorCode,
  DesignIssue,
  DesignVerdict,
  WeaponLoadout,
} from './design';
export {
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
} from './parts';
export type {
  CatalogPart,
  ChassisErrorCode,
  ChassisIssue,
  ChassisVerdict,
  PartCategory,
  PartEffect,
  PartId,
} from './parts';
export { robotId, snapshotRobot, spawnRobot } from './robot';
export type { Robot, RobotSnapshot, SpawnRobotArgs } from './robot';
