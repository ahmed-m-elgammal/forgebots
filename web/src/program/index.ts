// Public surface of the program context (AGENTS.md G8). The editor, the
// server-side IR validation (09 § 1 goal 6) and Phase 3's VM all go through
// this module, never through compiler.ts internals.
export {
  BUILTIN_NAME,
  BUILTINS,
  CYCLE_BUDGET,
  INT_LITERAL_LIMIT,
  IR_COSTS,
  LOCALS_LIMIT,
  PAYLOAD_GETTERS,
  STACK_LIMIT,
  builtinSpec,
  compile,
  formatDiagnostic,
  tokenize,
} from './compiler';
export { evalPureBuiltin } from './builtins';
export type {
  BuiltinSpec,
  ChassisContext,
  CompileOptions,
  CompileResult,
  Diagnostic,
  DiagnosticCode,
  IrFn,
  IrNode,
  IrProgram,
  Token,
} from './compiler';
