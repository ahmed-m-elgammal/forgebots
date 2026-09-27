// Public surface of the execution context (AGENTS.md G8). The match loop
// and the editor's preview path go through this module, never through
// vm.ts internals.
export {
  VM_YIELD_EVENT,
  runVmAndCollectActuators,
} from './vm';
export type {
  ActuatorIntent,
  OptionValue,
  StepResult,
  VmEnv,
  VmEvent,
  VmYieldReason,
} from './vm';
