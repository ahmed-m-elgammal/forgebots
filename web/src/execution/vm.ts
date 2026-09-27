// The sandbox — Phase 3 (23-WEB-CLIENT-PLAN.md § 6), the VM of 09 § 6.
// Tree-walking over the verified IR (D2, no bytecode), charging the 09 § 4
// per-node costs, collecting actuator intents, and enforcing the two D4
// contracts: the 1000-cycle budget and the 64-slot stack.
//
// ONE FILE by rule: AGENTS.md § 9 resolution 1 reverted 09 § 6's four-file
// split (frame / interpreter / builtins / vm) because the pieces existed
// only to satisfy the 300-line cap. The VM is one responsibility; this file
// runs long and stays long (23 § 6 agrees).
//
// The VM never learns what a sensor is (06-ARCHITECTURE § 2, G7): sensors
// (radar, scan, food, ally, enemy), self state, time and rng-int are read
// through VmEnv — the seam perception/ implements in a later phase — and
// actuators are recorded as intents, never applied. Nothing moves here.
//
// Reconciliations with the spec, documented rather than silent:
// - The entry point is runVmAndCollectActuators, the name 23 § 6.3 demands
//   ("the name must not lie"); 20 § 8 called it runVm.
// - Cycle accounting charges each node when it begins, and a node runs
//   only if its whole cost fits the budget. A completing tick therefore
//   bills exactly the estimator's number on branch-free programs, and an
//   abandoned tick never overshoots: cyclesUsed stays ≤ CYCLE_BUDGET, and
//   the DoD's "abandons at exactly 1000" holds for fine-grained programs.
// - while's literal bound is a hard cap: after maxIters iterations the
//   loop exits WITHOUT re-testing the guard, so a full run bills exactly
//   maxIters × (cond + body) — the estimator's own formula. One cond more
//   would make verified programs over-run their estimate at runtime.
// - and / or fold eagerly (plain call nodes in the IR — see builtins.ts).
// - An Option renders as two slots always (09 § 2.3): tag 0 = none with an
//   unused filler slot, tag 1 = some with the payload above it. That is
//   what lets the frame mirror the verifier's slot model exactly.
// - Locals ARE stack slots (23 § 6.1): a let binding's value stays where
//   it was computed and the binding names that region, so the runtime
//   stack depth equals the verifier's static depth at every program point.
// - rng-int with a bound below 1 traps. The DSL contract is [0, n) (09 §
//   2.2), which is empty below 1; the verifier only catches literal bounds,
//   so the runtime has to catch computed ones.
// - Traps (payload read on none, stack over/underflow, unknown call target,
//   malformed IR) yield the whole tick exactly like a budget over-run —
//   23 § 6.4: reason budget | trap, actuators discarded, vm_yield emitted.
//   They are unreachable for compile() output; they exist because the VM
//   is a sandbox, and every one of them is tested.
// - Hostile IR can at worst misalign slot widths and trip a trap: the VM
//   never throws past its entry point, and the env is trusted to honour
//   its return contract (defending against a broken host is not possible
//   in general and not attempted).

import {
  BUILTIN_NAME,
  CYCLE_BUDGET,
  INT_LITERAL_LIMIT,
  IR_COSTS,
  PAYLOAD_GETTERS,
  STACK_LIMIT,
  builtinSpec,
  evalPureBuiltin,
} from '../program';
import type { IrFn, IrNode, IrProgram } from '../program';

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

// A sensor result as the env hands it over: plain data the VM renders into
// the two-slot stack form of 09 § 2.3.
export type OptionValue = { kind: 'none' } | { kind: 'some'; payload: number };

// What a bot asked for this tick (23 § 6.3): intent, not motion. The
// actuation context turns these into throttle and shots; clamping to
// ±65536 (D8) is that context's job, not the VM's.
export type ActuatorIntent =
  | { kind: 'move'; vx: number; vy: number }
  | { kind: 'move-at'; tx: number; ty: number }
  | { kind: 'aim'; angle: number }
  | { kind: 'fire' }
  | { kind: 'eat' }
  | { kind: 'build'; design: number }
  | { kind: 'say'; channel: number; value: number };

export type VmYieldReason = 'budget' | 'trap';

// The replay-facing event of 11 § 4; match/ attribution adds the robot.
// telemetry/ owns the full 17-kind enum when that context is born (23 §
// 8.2); until then the VM owns the one kind it can emit.
export const VM_YIELD_EVENT = 'vm_yield' as const;

export interface VmEvent {
  kind: typeof VM_YIELD_EVENT;
  cyclesUsed: number;
  reason: VmYieldReason;
}

export interface StepResult {
  actuators: ActuatorIntent[];
  cyclesUsed: number;
  yielded: boolean;
  yieldReason: VmYieldReason | null;
  events: VmEvent[];
}

// The published surface of perception/ (06-ARCHITECTURE § 2: radar, scan,
// food, ally, enemy, self.*, time, rng-int) as the VM consumes it. The VM
// passes builtin names through opaquely; adding a part never touches this
// file. The env is trusted: it returns integers where the DSL expects them
// and constructs OptionValue honestly.
export interface VmEnv {
  selfField: (field: string) => number | boolean;
  time: () => number;
  rngInt: (bound: number) => number;
  sensor: (name: string, args: readonly number[]) => OptionValue;
  payloadCoordinate: (getter: string, payload: number) => number;
}

// ---------------------------------------------------------------------------
// Frame mechanics — the 64-slot stack and the locals that live on it
// ---------------------------------------------------------------------------

type SlotValue = number | boolean;

interface LocalSlot {
  index: number;
  width: number;
}

interface VmFrame {
  slots: SlotValue[];
  locals: Map<string, LocalSlot>;
}

// Internal control flow. Neither signal escapes runVmAndCollectActuators:
// Yield is caught at the entry point, Return at the frame that contains it.
class YieldSignal extends Error {
  readonly reason: VmYieldReason;
  constructor(reason: VmYieldReason) {
    super(reason);
    this.reason = reason;
  }
}

class ReturnSignal extends Error {
  readonly values: SlotValue[];
  readonly width: number;
  constructor(values: SlotValue[], width: number) {
    super('return');
    this.values = values;
    this.width = width;
  }
}

interface TickState {
  env: VmEnv;
  fns: Map<string, IrFn>;
  actuators: ActuatorIntent[];
  cyclesUsed: number;
}

function chargeCost(cost: number, state: TickState): void {
  if (state.cyclesUsed + cost > CYCLE_BUDGET) throw new YieldSignal('budget');
  state.cyclesUsed += cost;
}

function pushSlots(frame: VmFrame, values: SlotValue[]): void {
  if (frame.slots.length + values.length > STACK_LIMIT) {
    throw new YieldSignal('trap');
  }
  frame.slots.push(...values);
}

function popSlots(frame: VmFrame, width: number): SlotValue[] {
  if (width === 0) return [];
  if (frame.slots.length < width) throw new YieldSignal('trap');
  return frame.slots.splice(frame.slots.length - width, width);
}

function pushOption(frame: VmFrame, option: OptionValue): void {
  if (option.kind === 'some') {
    pushSlots(frame, [1, option.payload]);
    return;
  }
  pushSlots(frame, [0, 0]);
}

function readLocal(frame: VmFrame, name: string): LocalSlot {
  const local = frame.locals.get(name);
  if (local === undefined) throw new YieldSignal('trap');
  return local;
}

// A bool-typed slot is the only legal branch condition (09 § 5 rule 5: an
// Option is not a bool, and neither is an int).
function popCondition(frame: VmFrame): boolean {
  const [value] = popSlots(frame, 1);
  if (typeof value !== 'boolean') throw new YieldSignal('trap');
  return value;
}

function discardResult(frame: VmFrame, width: number): void {
  if (width !== 0) popSlots(frame, width);
}

// ---------------------------------------------------------------------------
// Builtin dispatch
// ---------------------------------------------------------------------------

function recordActuatorIntent(name: string, args: number[], state: TickState): void {
  switch (name) {
    case BUILTIN_NAME.move:
      state.actuators.push({
        kind: 'move',
        vx: args[0] as number,
        vy: args[1] as number,
      });
      return;
    case BUILTIN_NAME.moveAt:
      state.actuators.push({
        kind: 'move-at',
        tx: args[0] as number,
        ty: args[1] as number,
      });
      return;
    case BUILTIN_NAME.aim:
      state.actuators.push({ kind: 'aim', angle: args[0] as number });
      return;
    case BUILTIN_NAME.fire:
      state.actuators.push({ kind: 'fire' });
      return;
    case BUILTIN_NAME.eat:
      state.actuators.push({ kind: 'eat' });
      return;
    case BUILTIN_NAME.build:
      state.actuators.push({ kind: 'build', design: args[0] as number });
      return;
    case BUILTIN_NAME.say:
      state.actuators.push({
        kind: 'say',
        channel: args[0] as number,
        value: args[1] as number,
      });
      return;
    default:
      // A ret-void builtin without an intent shape is BUILTINS-table drift.
      throw new YieldSignal('trap');
  }
}

// A call to a builtin: name known, arity and argument types checked against
// the BUILTINS row, then routed — option mechanics and world reads here,
// intents for actuators, program/builtins for the pure vocabulary.
function evalBuiltinCall(
  name: string,
  args: SlotValue[],
  widths: number[],
  frame: VmFrame,
  state: TickState,
): number {
  const spec = builtinSpec(name);
  if (spec === undefined) throw new YieldSignal('trap');
  chargeCost(spec.cost, state);

  const argWidth = spec.arg === 'option' ? 2 : 1;
  for (const width of widths) {
    if (width !== argWidth) throw new YieldSignal('trap');
  }
  if (spec.arg === 'int') {
    for (const value of args) {
      if (
        typeof value !== 'number' ||
        !Number.isInteger(value) ||
        value > INT_LITERAL_LIMIT ||
        value < -INT_LITERAL_LIMIT
      ) {
        throw new YieldSignal('trap');
      }
    }
  } else if (spec.arg === 'bool') {
    for (const value of args) {
      if (typeof value !== 'boolean') throw new YieldSignal('trap');
    }
  }

  if (name === BUILTIN_NAME.some) {
    const tag = args[0];
    if (tag !== 0 && tag !== 1) throw new YieldSignal('trap');
    pushSlots(frame, [tag === 1]);
    return 1;
  }
  if (PAYLOAD_GETTERS.has(name)) {
    if (args[0] !== 1) throw new YieldSignal('trap');
    const payload = args[1] as number;
    pushSlots(frame, [state.env.payloadCoordinate(name, payload)]);
    return 1;
  }
  if (name === BUILTIN_NAME.time) {
    pushSlots(frame, [state.env.time()]);
    return 1;
  }
  if (name === BUILTIN_NAME.rngInt) {
    const bound = args[0] as number;
    if (bound < 1) throw new YieldSignal('trap');
    pushSlots(frame, [state.env.rngInt(bound)]);
    return 1;
  }
  if (spec.ret === 'option') {
    pushOption(frame, state.env.sensor(name, args as number[]));
    return 2;
  }
  if (spec.ret === 'void') {
    recordActuatorIntent(name, args as number[], state);
    return 0;
  }
  const result = evalPureBuiltin(name, args);
  pushSlots(frame, [result]);
  return 1;
}

// ---------------------------------------------------------------------------
// The tree walk
// ---------------------------------------------------------------------------

// Every expression leaves its result on top of the frame's stack and
// returns its slot width (0 = void, 1 = int or bool, 2 = Option). That is
// the verifier's own slot model, executed.
function evalNode(node: IrNode, frame: VmFrame, state: TickState): number {
  switch (node.op) {
    case 'num': {
      chargeCost(IR_COSTS.literal, state);
      if (
        !Number.isInteger(node.v) ||
        node.v > INT_LITERAL_LIMIT ||
        node.v < -INT_LITERAL_LIMIT
      ) {
        throw new YieldSignal('trap');
      }
      pushSlots(frame, [node.v]);
      return 1;
    }
    case 'bool': {
      chargeCost(IR_COSTS.literal, state);
      pushSlots(frame, [node.v]);
      return 1;
    }
    case 'var': {
      chargeCost(IR_COSTS.varRead, state);
      const local = readLocal(frame, node.name);
      pushSlots(
        frame,
        frame.slots.slice(local.index, local.index + local.width),
      );
      return local.width;
    }
    case 'self': {
      chargeCost(IR_COSTS.self, state);
      pushSlots(frame, [state.env.selfField(node.field)]);
      return 1;
    }
    case 'store': {
      chargeCost(IR_COSTS.store, state);
      const width = evalNode(node.value, frame, state);
      const local = readLocal(frame, node.name);
      if (local.width !== width) throw new YieldSignal('trap');
      const value = popSlots(frame, width);
      for (let i = 0; i < width; i++) {
        frame.slots[local.index + i] = value[i] as SlotValue;
      }
      return 0;
    }
    case 'do': {
      let lastWidth = 0;
      for (let i = 0; i < node.body.length; i++) {
        lastWidth = evalNode(node.body[i] as IrNode, frame, state);
        if (i < node.body.length - 1) discardResult(frame, lastWidth);
      }
      return lastWidth;
    }
    case 'if': {
      chargeCost(IR_COSTS.if, state);
      const conditionWidth = evalNode(node.cond, frame, state);
      if (conditionWidth !== 1) throw new YieldSignal('trap');
      const taken = popCondition(frame);
      if (!taken) {
        if (node.else === undefined) return 0;
        return evalNode(node.else, frame, state);
      }
      const width = evalNode(node.then, frame, state);
      if (node.else === undefined) {
        // Statically void: the then branch's value is discarded, exactly
        // as the verifier's slot model assumed it away.
        discardResult(frame, width);
        return 0;
      }
      return width;
    }
    case 'let': {
      const base = frame.slots.length;
      const shadowed: { name: string; previous: LocalSlot | undefined }[] = [];
      for (const binding of node.bindings) {
        chargeCost(IR_COSTS.store, state);
        const width = evalNode(binding.value, frame, state);
        if (width === 0) throw new YieldSignal('trap');
        shadowed.push({
          name: binding.name,
          previous: frame.locals.get(binding.name),
        });
        frame.locals.set(binding.name, {
          index: frame.slots.length - width,
          width,
        });
      }
      const width = evalNode(node.body, frame, state);
      const result = popSlots(frame, width);
      frame.slots.length = base;
      for (const entry of shadowed) {
        if (entry.previous === undefined) {
          frame.locals.delete(entry.name);
        } else {
          frame.locals.set(entry.name, entry.previous);
        }
      }
      pushSlots(frame, result);
      return width;
    }
    case 'while': {
      chargeCost(IR_COSTS.loop, state);
      for (let iterations = 0; iterations < node.maxIters; iterations++) {
        const conditionWidth = evalNode(node.cond, frame, state);
        if (conditionWidth !== 1) throw new YieldSignal('trap');
        if (!popCondition(frame)) break;
        discardResult(frame, evalNode(node.body, frame, state));
      }
      return 0;
    }
    case 'loop': {
      chargeCost(IR_COSTS.loop, state);
      for (let i = 0; i < node.count; i++) {
        discardResult(frame, evalNode(node.body, frame, state));
      }
      return 0;
    }
    case 'return': {
      if (node.value === undefined) throw new ReturnSignal([], 0);
      const width = evalNode(node.value, frame, state);
      throw new ReturnSignal(popSlots(frame, width), width);
    }
    case 'call': {
      const widths: number[] = [];
      for (const arg of node.args) {
        widths.push(evalNode(arg, frame, state));
      }
      const args = popSlots(
        frame,
        widths.reduce((total, width) => total + width, 0),
      );
      const userFn = state.fns.get(node.fn);
      if (userFn !== undefined) {
        return callUserFunction(userFn, args, widths, frame, state);
      }
      return evalBuiltinCall(node.fn, args, widths, frame, state);
    }
  }
}

// A user call: the arguments become the callee's params (its initial
// locals, at the bottom of its own 64-slot frame), the body runs, and the
// result — normal or via (return) — lands on the caller's stack.
function callUserFunction(
  fn: IrFn,
  args: SlotValue[],
  widths: number[],
  caller: VmFrame,
  state: TickState,
): number {
  if (widths.length !== fn.params.length) throw new YieldSignal('trap');
  chargeCost(IR_COSTS.userCall + fn.params.length, state);
  const frame: VmFrame = { slots: [...args], locals: new Map() };
  let index = 0;
  fn.params.forEach((name, i) => {
    const width = widths[i] as number;
    if (width === 0) throw new YieldSignal('trap');
    frame.locals.set(name, { index, width });
    index += width;
  });
  try {
    const width = evalNode(fn.body, frame, state);
    const result = popSlots(frame, width);
    pushSlots(caller, result);
    return width;
  } catch (signal) {
    if (signal instanceof ReturnSignal) {
      pushSlots(caller, signal.values);
      return signal.width;
    }
    throw signal;
  }
}

// ---------------------------------------------------------------------------
// The tick
// ---------------------------------------------------------------------------

function completedTick(state: TickState): StepResult {
  return {
    actuators: state.actuators,
    cyclesUsed: state.cyclesUsed,
    yielded: false,
    yieldReason: null,
    events: [],
  };
}

function yieldedTick(state: TickState, reason: VmYieldReason): StepResult {
  // D4: every actuator queued this tick is discarded; the bot does nothing.
  const event: VmEvent = {
    kind: VM_YIELD_EVENT,
    cyclesUsed: state.cyclesUsed,
    reason,
  };
  return {
    actuators: [],
    cyclesUsed: state.cyclesUsed,
    yielded: true,
    yieldReason: reason,
    events: [event],
  };
}

export function runVmAndCollectActuators(env: VmEnv, ir: IrProgram): StepResult {
  const state: TickState = {
    env,
    fns: new Map(ir.fns.map((fn) => [fn.name, fn])),
    actuators: [],
    cyclesUsed: 0,
  };
  // A program without an entry point (verified as tick = null) does
  // nothing and spends nothing.
  if (ir.tick === null) return completedTick(state);
  const entry = state.fns.get(ir.tick);
  if (entry === undefined) return yieldedTick(state, 'trap');
  try {
    callUserFunction(entry, [], [], { slots: [], locals: new Map() }, state);
  } catch (signal) {
    if (signal instanceof YieldSignal) return yieldedTick(state, signal.reason);
    throw signal;
  }
  return completedTick(state);
}
