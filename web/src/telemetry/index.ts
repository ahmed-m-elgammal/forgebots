// Public surface of the telemetry context (AGENTS.md G8): the server's
// match runner, the golden tests and the future juice layer go through
// this module, never through file internals. telemetry/ imports nothing
// outside itself (06-ARCHITECTURE.md § 5.2); match/'s record stream
// reaches it through the structural views.
export { EVENT_KINDS } from './eventKinds';
export type { EventKind, ReplayEvent, ReplayFinalState, ReplayRobotState } from './eventKinds';
export { FX_TABLE } from './fxTable';
export type { FxEntry } from './fxTable';
export { canonicalJson } from './canonical';
export type { JsonValue } from './canonical';
export { sha256Hex } from './sha256';
export { outputSha256, seedToBytes } from './outputSha256';
export { EventLog } from './eventLog';
export type { EventLogConfig } from './eventLog';
export { buildReplayDocument, REPLAY_FORMAT_VERSION, SIM_VERSION } from './replay';
export type {
  ReplayBotSnapshotPayload,
  ReplayDesignPayload,
  ReplayDocument,
  ReplayDocumentInput,
  ReplayPlayerDocument,
  ReplayPlayerPayload,
} from './replay';
export type { MatchRecordView, MatchResultView, MatchSinkView, SnapshotRobotView } from './views';
