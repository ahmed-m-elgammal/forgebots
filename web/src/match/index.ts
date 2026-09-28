// Public surface of the match context (AGENTS.md G8): the server's match
// runner and the golden tests go through this module, never through
// match.ts internals. match/ is the one context allowed to orchestrate
// every other (06-ARCHITECTURE.md § 5.2); nothing may import match/
// except the composition root.
export {
  DEFAULT_TICK_LIMIT,
  CollectingSink,
  runMatch,
} from './match';
export type {
  MatchConfig,
  MatchDesignInput,
  MatchRecord,
  MatchResult,
  MatchSideInput,
  MatchSink,
  TickRecords,
} from './match';
export {
  FOOD_RANGE_MM,
  createVmDriver,
  createVmEnv,
  packPoint,
  unpackX,
  unpackY,
} from './driver';
export type { CachedReading, DriveOutcome, MatchWorld, RobotDriver } from './driver';
export {
  COAST_PLAN,
  MOVE_AT_FULL_MM,
  THROTTLE_LIMIT,
  headingFromAim,
  integrateMovement,
  planFromMove,
  planFromMoveAt,
} from './movement';
export type { ThrottlePlan } from './movement';
export {
  MATCH_END_REASON,
  WINNER,
  evaluateTickOutcome,
  resolveAtTickCap,
} from './winCondition';
export type { MatchEndReason, MatchOutcome, SideStanding, Winner } from './winCondition';
