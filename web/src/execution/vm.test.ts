import { describe, expect, it } from 'vitest';
import {
  type ActuatorIntent,
  type OptionValue,
  type StepResult,
  type VmEnv,
  VM_YIELD_EVENT,
  runVmAndCollectActuators,
} from './vm';
import {
  BUILTINS,
  CYCLE_BUDGET,
  compile,
  type IrFn,
  type IrNode,
  type IrProgram,
} from '../program';

// Phase 3 unit tier (AGENTS.md § 4): one module, no I/O, < 100 ms per test.
// Every important VM behaviour carries the six-category tags — normal,
// boundary, invalid, state changes, repeated calls, determinism — with the
// exact-budget and stack edges of 23 § 6 pinned both directions.

// ---------------------------------------------------------------------------
// IR and env builders
// ---------------------------------------------------------------------------

const num = (v: number): IrNode => ({ op: 'num', v });
const call = (fn: string, ...args: IrNode[]): IrNode => ({ op: 'call', fn, args });
const fn = (name: string, params: string[], body: IrNode): IrFn => ({
  name,
  params,
  body,
});
const bypassProgram = (fns: IrFn[], tick: string | null): IrProgram => ({
  fns,
  tick,
});
const entry = (body: IrNode): IrProgram => bypassProgram([fn('step', [], body)], 'step');

// Hand-built IR skips the verifier on purpose: the VM is a sandbox, and its
// defensive traps are only reachable through IR that never saw verify().
// Tests that go through compile() are marked as such.

interface EnvLog {
  selfFields: string[];
  timeCalls: number;
  rngBounds: number[];
  sensorCalls: { name: string; args: readonly number[] }[];
  payloadCalls: { getter: string; payload: number }[];
}

interface EnvOptions {
  self?: Record<string, number | boolean>;
  radar?: OptionValue;
  food?: OptionValue;
  rngValues?: number[];
}

// The fake perception/actuation seam. rngInt walks rngValues and then keeps
// cycling the last one, so stream continuity across ticks is observable.
function makeEnv(options: EnvOptions = {}): { env: VmEnv; log: EnvLog } {
  const log: EnvLog = {
    selfFields: [],
    timeCalls: 0,
    rngBounds: [],
    sensorCalls: [],
    payloadCalls: [],
  };
  let rngCursor = 0;
  const rngValues = [...(options.rngValues ?? [0])];
  const env: VmEnv = {
    selfField: (field) => {
      log.selfFields.push(field);
      const table = options.self ?? { x: 50000, y: 60000, biomass: 0 };
      if (field in table) return table[field] as number | boolean;
      if (field === 'alive') return true;
      return 1000;
    },
    time: () => {
      log.timeCalls += 1;
      return 7;
    },
    rngInt: (bound) => {
      log.rngBounds.push(bound);
      const value = rngValues[Math.min(rngCursor, rngValues.length - 1)] as number;
      rngCursor += 1;
      return ((value % bound) + bound) % bound;
    },
    sensor: (name, args) => {
      log.sensorCalls.push({ name, args });
      if (name === 'radar') return options.radar ?? { kind: 'none' };
      if (name === 'food') return options.food ?? { kind: 'none' };
      return { kind: 'none' };
    },
    payloadCoordinate: (getter, payload) => {
      log.payloadCalls.push({ getter, payload });
      // A deterministic, asymmetrical decode so swapped axes cannot pass.
      if (getter === 'hit-y' || getter === 'food-y') return payload + 1;
      return payload;
    },
  };
  return { env, log };
}

function run(env: VmEnv, ir: IrProgram): StepResult {
  return runVmAndCollectActuators(env, ir);
}

function compileOk(src: string): { ir: IrProgram; cycleEstimate: number } {
  const result = compile(src);
  if (!result.ok) {
    throw new Error(`expected compile success, got: ${result.errors.map((e) => e.code).join(', ')}`);
  }
  return { ir: result.ir, cycleEstimate: result.cycleEstimate };
}

const INT_MAX = 2147483647;

// ---------------------------------------------------------------------------
// Entry point and completion
// ---------------------------------------------------------------------------

describe('runVmAndCollectActuators — entry', () => {
  it('[normal] collects a move intent from the DoD example under 100 cycles', () => {
    const { env, log } = makeEnv();
    const result = run(env, entry(call('move', num(65536), num(0))));
    expect(result.yielded).toBe(false);
    expect(result.events).toEqual([]);
    expect(result.actuators).toEqual([{ kind: 'move', vx: 65536, vy: 0 }]);
    expect(result.cyclesUsed).toBe(4 + 1 + 1 + 30);
    expect(result.cyclesUsed).toBeLessThan(100);
    expect(log.sensorCalls).toEqual([]);
  });

  it('[normal] runs the public pipeline: compile() output is executable', () => {
    const { env } = makeEnv();
    const { ir, cycleEstimate } = compileOk(
      '(defn step [] (move 65536 0))\n(every-tick step)',
    );
    const result = run(env, ir);
    expect(result.actuators).toEqual([{ kind: 'move', vx: 65536, vy: 0 }]);
    expect(result.cyclesUsed).toBe(cycleEstimate);
    expect(result.cyclesUsed).toBe(36);
  });

  it('[boundary] a program with no entry point does nothing and spends nothing', () => {
    const { env } = makeEnv();
    const result = run(env, bypassProgram([fn('idle', [], call('move', num(1), num(0)))], null));
    expect(result).toEqual({
      actuators: [],
      cyclesUsed: 0,
      yielded: false,
      yieldReason: null,
      events: [],
    });
  });

  it('[boundary] an immediate (return) ends the tick after the entry dispatch', () => {
    const { env } = makeEnv();
    const result = run(env, entry({ op: 'return' }));
    expect(result.actuators).toEqual([]);
    expect(result.cyclesUsed).toBe(4);
    expect(result.yielded).toBe(false);
  });

  it('[invalid] a tick naming an unknown function traps (hostile IR)', () => {
    const { env } = makeEnv();
    const result = run(env, bypassProgram([fn('other', [], num(1))], 'step'));
    expect(result.yielded).toBe(true);
    expect(result.yieldReason).toBe('trap');
    expect(result.actuators).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The cycle budget (D4) — exact edges in both directions
// ---------------------------------------------------------------------------

describe('cycle budget', () => {
  it('[boundary] a program needing exactly 1000 cycles completes intact', () => {
    const { env } = makeEnv();
    // 4 entry + 4 loop + 31 × (1 + 1 + 30) = 1000 — the verifier's own
    // canonical boundary case, now executed.
    const { ir } = compileOk('(defn step [] (loop 31 (move 0 0)))\n(every-tick step)');
    const result = run(env, ir);
    expect(result.yielded).toBe(false);
    expect(result.cyclesUsed).toBe(CYCLE_BUDGET);
    expect(result.actuators).toHaveLength(31);
  });

  it('[boundary] needing 1001 abandons the tick at exactly 1000', () => {
    const { env } = makeEnv();
    // Hand-built: the verifier would reject this statically (E_BUDGET), so
    // the runtime edge is only reachable by bypassing it (20 § 8 T06.5).
    const ir = entry({
      op: 'do',
      body: [
        { op: 'loop', count: 31, body: call('move', num(0), num(0)) },
        call('time'),
      ],
    });
    const result = run(env, ir);
    expect(result.yielded).toBe(true);
    expect(result.yieldReason).toBe('budget');
    expect(result.cyclesUsed).toBe(CYCLE_BUDGET);
    expect(result.actuators).toEqual([]);
    expect(result.events).toEqual([
      { kind: VM_YIELD_EVENT, cyclesUsed: CYCLE_BUDGET, reason: 'budget' },
    ]);
  });

  it('[boundary] a 5000-cycle program abandons at exactly 1000 (T06.5)', () => {
    const { env } = makeEnv();
    const ir = entry({ op: 'loop', count: 5000, body: call('time') });
    const result = run(env, ir);
    expect(result.yielded).toBe(true);
    expect(result.yieldReason).toBe('budget');
    expect(result.cyclesUsed).toBe(CYCLE_BUDGET);
  });

  it('[boundary] an unaffordable node never runs and never over-bills', () => {
    const { env } = makeEnv();
    // 4 + 4 + 30 × 32 = 968 spent; a 40-cycle fire does not fit.
    const ir = entry({
      op: 'do',
      body: [
        { op: 'loop', count: 30, body: call('move', num(0), num(0)) },
        call('fire'),
      ],
    });
    const result = run(env, ir);
    expect(result.yielded).toBe(true);
    expect(result.yieldReason).toBe('budget');
    expect(result.cyclesUsed).toBe(968);
    expect(result.cyclesUsed).toBeLessThanOrEqual(CYCLE_BUDGET);
    expect(result.actuators).toEqual([]);
  });

  it('[state] the budget resets every tick — no partial carry-over (D4)', () => {
    const { env } = makeEnv();
    const ir = entry({ op: 'loop', count: 5000, body: call('time') });
    for (let i = 0; i < 3; i++) {
      const result = run(env, ir);
      expect(result.cyclesUsed).toBe(CYCLE_BUDGET);
      expect(result.yieldReason).toBe('budget');
    }
  });
});

// ---------------------------------------------------------------------------
// The 64-slot stack (G4 contract)
// ---------------------------------------------------------------------------

describe('stack slots', () => {
  it('[boundary] a verified program at static depth exactly 64 runs clean', () => {
    const { env } = makeEnv();
    const literals = Array.from({ length: 64 }, () => '1').join(' ');
    const { ir, cycleEstimate } = compileOk(
      `(defn step [] (+ ${literals}))\n(every-tick step)`,
    );
    expect(cycleEstimate).toBe(4 + 1 + 64);
    const result = run(env, ir);
    expect(result.yielded).toBe(false);
    expect(result.cyclesUsed).toBe(cycleEstimate);
  });

  it('[boundary] depth 65 overflows: yields a trap instead of throwing (23 § 6)', () => {
    const { env } = makeEnv();
    const ir = entry(
      call('+', ...Array.from({ length: 65 }, () => num(1))),
    );
    const result = run(env, ir);
    expect(result.yielded).toBe(true);
    expect(result.yieldReason).toBe('trap');
    expect(result.actuators).toEqual([]);
    expect(result.events).toEqual([
      { kind: VM_YIELD_EVENT, cyclesUsed: result.cyclesUsed, reason: 'trap' },
    ]);
  });

  it('[boundary] 31 option bindings occupy exactly 62 slots and run clean', () => {
    const { env, log } = makeEnv({ radar: { kind: 'some', payload: 42 } });
    // Deepest verified nesting: 31 × 2 slots of Option locals plus the
    // body's one slot lands on the 64-slot boundary exactly.
    const source = `(defn step [] (radar) ${Array.from({ length: 31 }, (_, i) =>
      `(let [v${i} (radar)]`,
    ).join(' ')} (time) ${')'.repeat(31)})\n(every-tick step)`;
    const { ir, cycleEstimate } = compileOk(source);
    expect(cycleEstimate).toBe(4 + 31 * (25 + 2) + 1 + 25);
    const result = run(env, ir);
    expect(result.yielded).toBe(false);
    expect(result.cyclesUsed).toBe(cycleEstimate);
    expect(log.sensorCalls).toHaveLength(32);
  });

  it('[invalid] underflow — a payload getter with no argument traps', () => {
    const { env } = makeEnv();
    const result = run(env, entry(call('hit-x')));
    expect(result.yielded).toBe(true);
    expect(result.yieldReason).toBe('trap');
  });
});

// ---------------------------------------------------------------------------
// Option mechanics and payload reads
// ---------------------------------------------------------------------------

describe('options and payload getters', () => {
  it('[normal] some? is true on a some and false on a none', () => {
    const some = makeEnv({ radar: { kind: 'some', payload: 42 } });
    const guarded = compileOk(
      '(defn step [] (if (some? (radar)) (move 1 0) (move 2 0)))\n(every-tick step)',
    );
    const hit = run(some.env, guarded.ir);
    expect(hit.actuators).toEqual([{ kind: 'move', vx: 1, vy: 0 }]);

    const none = makeEnv({ radar: { kind: 'none' } });
    const miss = run(none.env, guarded.ir);
    expect(miss.actuators).toEqual([{ kind: 'move', vx: 2, vy: 0 }]);
  });

  it('[normal] payload getters decode through the env with the right getter name', () => {
    const { env, log } = makeEnv({ radar: { kind: 'some', payload: 1234 } });
    // The verifier's rule 7: payload reads live behind a some?-proven
    // variable — the guarded form is the only spelling that compiles.
    const { ir } = compileOk(
      '(defn step [] (let [e (radar)] (if (some? e) (move (hit-x e) (hit-y e)) (move 0 0))))\n(every-tick step)',
    );
    const result = run(env, ir);
    expect(log.payloadCalls).toContainEqual({ getter: 'hit-x', payload: 1234 });
    expect(log.payloadCalls).toContainEqual({ getter: 'hit-y', payload: 1234 });
    expect(result.actuators).toEqual([{ kind: 'move', vx: 1234, vy: 1235 }]);
  });

  it('[invalid] a payload read on none traps even though the verifier forbids it', () => {
    const { env } = makeEnv({ radar: { kind: 'none' } });
    // compile('(hit-x (radar)) …') rejects with E_PAYLOAD_UNPROVEN; the VM
    // still defends against IR that skipped verify().
    const result = run(env, entry(call('hit-x', call('radar'))));
    expect(result.yielded).toBe(true);
    expect(result.yieldReason).toBe('trap');
  });

  it('[invalid] some? over a non-option slot traps (hostile IR)', () => {
    const { env } = makeEnv();
    const result = run(env, entry(call('some?', num(5))));
    expect(result.yielded).toBe(true);
    expect(result.yieldReason).toBe('trap');
  });

  it('[state] an Option passed through a user fn keeps its payload', () => {
    const { env } = makeEnv({ radar: { kind: 'some', payload: 77 } });
    const { ir } = compileOk(
      '(defn aim-at [e] (if (some? e) (hit-x e) 0))\n' +
        '(defn step [] (move (call aim-at (radar)) 0))\n(every-tick step)',
    );
    const result = run(env, ir);
    expect(result.actuators).toEqual([{ kind: 'move', vx: 77, vy: 0 }]);
  });
});

// ---------------------------------------------------------------------------
// Branches, loops, locals — the evaluator's control flow
// ---------------------------------------------------------------------------

describe('control flow', () => {
  it('[normal] the taken branch bills; the untaken one never runs', () => {
    const { env, log } = makeEnv();
    const { ir, cycleEstimate } = compileOk(
      '(defn step [] (if (< 1 2) (eat) (fire)))\n(every-tick step)',
    );
    // The estimator bills the worst branch (fire = 40); the walk takes eat.
    expect(cycleEstimate).toBe(4 + 3 + 2 + 40);
    const result = run(env, ir);
    expect(result.cyclesUsed).toBe(4 + 3 + 2 + 25);
    expect(result.cyclesUsed).toBe(cycleEstimate - (40 - 25));
    expect(result.actuators).toEqual([{ kind: 'eat' }]);
    expect(log.sensorCalls).toEqual([]);
  });

  it('[boundary] a false condition without else runs nothing and leaks no slots', () => {
    const { env, log } = makeEnv();
    // The then branch produces an Option the static type discards; the
    // walk must discard it too or the following move would misalign.
    const { ir } = compileOk(
      '(defn step [] (do (if (< 2 1) (radar)) (move 0 0)))\n(every-tick step)',
    );
    const result = run(env, ir);
    expect(result.yielded).toBe(false);
    expect(result.actuators).toEqual([{ kind: 'move', vx: 0, vy: 0 }]);
    expect(log.sensorCalls).toEqual([]);
    expect(result.cyclesUsed).toBe(4 + 3 + 2 + 32);
  });

  it('[state] a true condition without else discards the produced value', () => {
    const { env, log } = makeEnv();
    const { ir } = compileOk(
      '(defn step [] (do (if (< 1 2) (radar)) (move 0 0)))\n(every-tick step)',
    );
    const result = run(env, ir);
    expect(result.yielded).toBe(false);
    expect(result.actuators).toEqual([{ kind: 'move', vx: 0, vy: 0 }]);
    expect(log.sensorCalls).toHaveLength(1);
    expect(result.cyclesUsed).toBe(4 + 3 + 2 + 25 + 32);
  });

  it('[normal] while exits on a false guard and bills each guard test', () => {
    let tick = 0;
    const env: VmEnv = {
      ...makeEnv().env,
      time: () => ++tick,
    };
    const { ir } = compileOk(
      '(defn step [] (while (< (time) 3) 10 (move 0 0)))\n(every-tick step)',
    );
    const result = run(env, ir);
    // Guards hold for time = 1, 2 and fail at 3: two iterations, three
    // guard evaluations: 8 + 3 × 3 + 2 × 32.
    expect(result.cyclesUsed).toBe(8 + 9 + 64);
    expect(result.actuators).toEqual(Array(2).fill({ kind: 'move', vx: 0, vy: 0 }));
    expect(tick).toBe(3);
  });

  it('[boundary] a never-false while stops at its bound without a final guard test', () => {
    const { env, log } = makeEnv();
    const { ir } = compileOk(
      '(defn step [] (while (> 1 2) 7 (eat)))\n(every-tick step)',
    );
    // (> 1 2) is false: zero iterations, one guard test (3 cycles).
    expect(run(env, ir).cyclesUsed).toBe(4 + 4 + 3);
    expect(log.timeCalls).toBe(0);
  });

  it('[boundary] the literal bound caps a loop whose guard never fails', () => {
    const { env, log } = makeEnv();
    const { ir } = compileOk(
      '(defn step [] (while (< (time) 1000) 7 (eat)))\n(every-tick step)',
    );
    const result = run(env, ir);
    expect(result.yielded).toBe(false);
    // Exactly 7 iterations, and the guard is NOT re-tested on forced exit:
    // 8 + 7 × (guard 3 + body 25) — one test more would break the estimate.
    expect(result.cyclesUsed).toBe(8 + 7 * 28);
    expect(log.timeCalls).toBe(7);
    expect(result.actuators).toEqual(Array(7).fill({ kind: 'eat' }));
  });

  it('[normal] loop runs its body exactly count times', () => {
    const { env } = makeEnv();
    const { ir } = compileOk('(defn step [] (loop 5 (eat)))\n(every-tick step)');
    const result = run(env, ir);
    expect(result.cyclesUsed).toBe(4 + 4 + 5 * 25);
    expect(result.actuators).toEqual(Array(5).fill({ kind: 'eat' }));
  });

  it('[normal] let binds, set overwrites, and shadowing restores on exit', () => {
    const { env } = makeEnv();
    const { ir } = compileOk(
      '(defn step [] (let [x 1] (do (let [x 2] (move x 0)) (move x 0))))\n(every-tick step)',
    );
    const result = run(env, ir);
    expect(result.actuators).toEqual([
      { kind: 'move', vx: 2, vy: 0 },
      { kind: 'move', vx: 1, vy: 0 },
    ]);
  });

  it('[state] set mutates a binding and the new value is what later reads see', () => {
    const { env } = makeEnv();
    const { ir } = compileOk(
      '(defn step [] (let [x 1] (do (set x 42) (move x 0))))\n(every-tick step)',
    );
    expect(run(env, ir).actuators).toEqual([{ kind: 'move', vx: 42, vy: 0 }]);
  });

  it('[state] set mutates a parameter slot', () => {
    const { env } = makeEnv();
    const { ir } = compileOk(
      '(defn bump [x] (do (set x (+ x 1)) x))\n' +
        '(defn step [] (move (call bump 41) 0))\n(every-tick step)',
    );
    expect(run(env, ir).actuators).toEqual([{ kind: 'move', vx: 42, vy: 0 }]);
  });

  it('[normal] (return) exits the frame immediately, skipping the rest', () => {
    const { env } = makeEnv();
    const { ir } = compileOk(
      '(defn f [] (do (move 1 0) (return) (move 2 0)))\n' +
        '(defn step [] (do (call f) (move 3 0)))\n(every-tick step)',
    );
    const result = run(env, ir);
    expect(result.actuators).toEqual([
      { kind: 'move', vx: 1, vy: 0 },
      { kind: 'move', vx: 3, vy: 0 },
    ]);
  });

  it('[boundary] a return inside a loop unwinds the whole frame, not one iteration', () => {
    const { env } = makeEnv();
    const { ir } = compileOk(
      '(defn f [] (loop 5 (do (move 1 0) (return))))\n' +
        '(defn step [] (call f))\n(every-tick step)',
    );
    const result = run(env, ir);
    expect(result.actuators).toEqual([{ kind: 'move', vx: 1, vy: 0 }]);
    expect(result.cyclesUsed).toBe(4 + 4 + 4 + 1 + 1 + 30);
  });

  it('[normal] cond executes the first true clause in priority order', () => {
    const { env } = makeEnv();
    const { ir } = compileOk(
      '(defn pick [] (cond [(< 1 2) (eat)] [(< 2 3) (fire)] [else (move 0 0)]))\n' +
        '(defn step [] (call pick))\n(every-tick step)',
    );
    expect(run(env, ir).actuators).toEqual([{ kind: 'eat' }]);
  });

  it('[normal] a user call bills 4 + nargs and passes plain arguments', () => {
    const { env } = makeEnv();
    const { ir, cycleEstimate } = compileOk(
      '(defn five [] 5)\n(defn step [] (move (call five) 0))\n(every-tick step)',
    );
    expect(cycleEstimate).toBe(4 + 4 + 0 + (1 + 1 + 30));
    expect(run(env, ir).actuators).toEqual([{ kind: 'move', vx: 5, vy: 0 }]);
  });
});

// ---------------------------------------------------------------------------
// Actuator intents (23 § 6.3) — nothing moves
// ---------------------------------------------------------------------------

describe('actuator intents', () => {
  const cases: { source: string; intent: ActuatorIntent }[] = [
    { source: '(move 65536 0)', intent: { kind: 'move', vx: 65536, vy: 0 } },
    { source: '(move-at 100000 50000)', intent: { kind: 'move-at', tx: 100000, ty: 50000 } },
    { source: '(aim 16384)', intent: { kind: 'aim', angle: 16384 } },
    { source: '(fire)', intent: { kind: 'fire' } },
    { source: '(eat)', intent: { kind: 'eat' } },
    { source: '(build 1)', intent: { kind: 'build', design: 1 } },
    { source: '(say 3 200)', intent: { kind: 'say', channel: 3, value: 200 } },
  ];
  for (const { source, intent } of cases) {
    it(`[normal] ${source} records ${intent.kind} and never mutates the world`, () => {
      const { env, log } = makeEnv();
      const { ir } = compileOk(`(defn step [] ${source})\n(every-tick step)`);
      const result = run(env, ir);
      expect(result.actuators).toEqual([intent]);
      // Nothing moved: the env's world reads were untouched by actuators.
      expect(log.sensorCalls).toEqual([]);
    });
  }

  it('[state] several intents accumulate in evaluation order', () => {
    const { env } = makeEnv();
    const { ir } = compileOk(
      '(defn step [] (do (move 1 0) (aim 2) (fire)))\n(every-tick step)',
    );
    expect(run(env, ir).actuators).toEqual([
      { kind: 'move', vx: 1, vy: 0 },
      { kind: 'aim', angle: 2 },
      { kind: 'fire' },
    ]);
  });

  it('[state] arguments evaluate left to right, once each', () => {
    let tick = 0;
    const env: VmEnv = { ...makeEnv().env, time: () => ++tick };
    const { ir } = compileOk(
      '(defn step [] (move (time) (time)))\n(every-tick step)',
    );
    expect(run(env, ir).actuators).toEqual([{ kind: 'move', vx: 1, vy: 2 }]);
    expect(tick).toBe(2);
  });

  it('[determinism] every ret-void builtin in BUILTINS has an intent shape', () => {
    // Table-drift proof: a ret-void row the VM does not know would trap.
    for (const [name, spec] of Object.entries(BUILTINS)) {
      if (spec.ret !== 'void') continue;
      const arity = spec.arity[0];
      const { env } = makeEnv();
      const ir = entry(
        call(name, ...Array.from({ length: arity }, () => num(1))),
      );
      const result = run(env, ir);
      expect(result.yielded).toBe(false);
      expect(result.actuators[0]?.kind).toBe(name);
    }
  });

  it('[state] intents are recorded faithfully even when compile-time warnings exist', () => {
    const { env } = makeEnv();
    // build with a negative index is E_BUILD_INDEX at compile time; the
    // VM's defensive intent path still records what hostile IR asked for.
    const result = run(env, entry(call('build', num(-1))));
    expect(result.actuators).toEqual([{ kind: 'build', design: -1 }]);
  });
});

// ---------------------------------------------------------------------------
// The world seam (VmEnv) and the RNG stream (D5)
// ---------------------------------------------------------------------------

describe('env seam', () => {
  it('[state] self reads pass field names through untouched', () => {
    const { env, log } = makeEnv({ self: { x: 11, y: 22, alive: true } });
    const { ir } = compileOk(
      '(defn step [] (move (self.x) (self.y)))\n(every-tick step)',
    );
    run(env, ir);
    expect(log.selfFields).toEqual(['x', 'y']);
  });

  it('[state] rng-int evaluates its bound and forwards it exactly once', () => {
    const { env, log } = makeEnv({ rngValues: [3] });
    const { ir } = compileOk(
      '(defn step [] (move (rng-int (+ 2 3)) 0))\n(every-tick step)',
    );
    const result = run(env, ir);
    expect(log.rngBounds).toEqual([5]);
    expect(result.actuators).toEqual([{ kind: 'move', vx: 3, vy: 0 }]);
  });

  it('[invalid] a computed bound below 1 traps at runtime, though only literals are caught at compile time', () => {
    const { env } = makeEnv();
    expect(compile('(defn step [] (rng-int 0))\n(every-tick step)').ok).toBe(false);
    const dynamic = compileOk(
      '(defn step [] (rng-int (- 1 1)))\n(every-tick step)',
    );
    const result = run(env, dynamic.ir);
    expect(result.yielded).toBe(true);
    expect(result.yieldReason).toBe('trap');
  });

  it('[state] the bot RNG stream continues across ticks — the VM never resets it (D5)', () => {
    const { env, log } = makeEnv({ rngValues: [17, 4, 9] });
    const { ir } = compileOk(
      '(defn step [] (move (rng-int 100) 0))\n(every-tick step)',
    );
    const first = run(env, ir);
    const second = run(env, ir);
    const third = run(env, ir);
    expect(log.rngBounds).toEqual([100, 100, 100]);
    const vxOf = (result: StepResult): number | undefined => {
      const intent = result.actuators[0];
      return intent?.kind === 'move' ? intent.vx : undefined;
    };
    expect([vxOf(first), vxOf(second), vxOf(third)]).toEqual([17, 4, 9]);
  });

  it('[state] scan forwards its evaluated angle to the sensor seam', () => {
    const { env, log } = makeEnv();
    const { ir } = compileOk(
      '(defn step [] (if (some? (scan 16384)) (fire)))\n(every-tick step)',
    );
    run(env, ir);
    expect(log.sensorCalls).toEqual([{ name: 'scan', args: [16384] }]);
  });
});

// ---------------------------------------------------------------------------
// Defensive traps for hostile IR
// ---------------------------------------------------------------------------

describe('defensive traps', () => {
  it('[invalid] an unknown call target traps instead of throwing', () => {
    const { env } = makeEnv();
    const result = run(env, entry(call('nope')));
    expect(result.yielded).toBe(true);
    expect(result.yieldReason).toBe('trap');
  });

  it('[invalid] an unbound variable read traps', () => {
    const { env } = makeEnv();
    const result = run(env, entry({ op: 'var', name: 'ghost' }));
    expect(result.yielded).toBe(true);
    expect(result.yieldReason).toBe('trap');
  });

  it('[invalid] a store to an unbound local traps', () => {
    const { env } = makeEnv();
    const result = run(env, entry({ op: 'store', name: 'ghost', value: num(1) }));
    expect(result.yielded).toBe(true);
    expect(result.yieldReason).toBe('trap');
  });

  it('[invalid] an out-of-range literal traps', () => {
    const { env } = makeEnv();
    const result = run(env, entry(call('move', num(65536), num(INT_MAX + 1))));
    expect(result.yielded).toBe(true);
    expect(result.yieldReason).toBe('trap');
  });

  it('[invalid] a non-boolean condition traps', () => {
    const { env } = makeEnv();
    const result = run(
      env,
      entry({ op: 'if', cond: num(1), then: call('fire') }),
    );
    expect(result.yielded).toBe(true);
    expect(result.yieldReason).toBe('trap');
  });

  it('[invalid] a non-boolean argument to not traps', () => {
    const { env } = makeEnv();
    const result = run(env, entry(call('not', num(1))));
    expect(result.yielded).toBe(true);
    expect(result.yieldReason).toBe('trap');
  });

  it('[invalid] cyclic user calls burn out on the budget instead of recursing forever', () => {
    const { env } = makeEnv();
    const ir = bypassProgram(
      [
        fn('f', [], call('g')),
        fn('g', [], call('f')),
      ],
      'f',
    );
    const result = run(env, ir);
    expect(result.yielded).toBe(true);
    expect(result.yieldReason).toBe('budget');
    expect(result.cyclesUsed).toBeLessThanOrEqual(CYCLE_BUDGET);
  });

  it('[state] a trap discards actuators queued earlier in the same tick (D4 wholeness)', () => {
    const { env } = makeEnv();
    const ir = entry({
      op: 'do',
      body: [call('move', num(1), num(1)), call('nope')],
    });
    const result = run(env, ir);
    expect(result.yielded).toBe(true);
    expect(result.yieldReason).toBe('trap');
    expect(result.actuators).toEqual([]);
    expect(result.cyclesUsed).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Purity, immutability, determinism
// ---------------------------------------------------------------------------

describe('purity and determinism', () => {
  const richSource =
    '(defn step [] (let [e (radar)]' +
    ' (if (some? e)' +
    ' (do (aim (atan2 (- (hit-y e) (self.y)) (- (hit-x e) (self.x))))' +
    ' (if (< (dist (self.x) (self.y) (hit-x e) (hit-y e)) 30000) (fire)) )' +
    ' (move 65536 0))))\n(every-tick step)';

  it('[determinism] 100 runs over the same IR and env state are byte-identical (23 § 6)', () => {
    const { ir } = compileOk(richSource);
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const { env } = makeEnv({ radar: { kind: 'some', payload: 60000 } });
      const result = run(env, ir);
      seen.add(JSON.stringify(result));
    }
    expect(seen.size).toBe(1);
    const sample: StepResult = JSON.parse(seen.values().next().value as string);
    expect(sample.yielded).toBe(false);
    expect(sample.actuators).toContainEqual({ kind: 'aim', angle: 0 });
    expect(sample.actuators).toContainEqual({ kind: 'fire' });
  });

  it('[state] the walk never mutates the IR, not even a deep-frozen one', () => {
    const { ir } = compileOk(richSource);
    const before = JSON.stringify(ir);
    const deepFreeze = (value: object): void => {
      Object.values(value).forEach((child) => {
        if (typeof child === 'object' && child !== null) deepFreeze(child);
      });
      Object.freeze(value);
    };
    deepFreeze(ir);
    const { env } = makeEnv({ radar: { kind: 'some', payload: 60000 } });
    expect(() => run(env, ir)).not.toThrow();
    expect(JSON.stringify(ir)).toBe(before);
  });

  it('[state] ticks are independent — no module state leaks between programs', () => {
    const first = compileOk('(defn step [] (move 1 0))\n(every-tick step)');
    const second = compileOk('(defn step [] (eat))\n(every-tick step)');
    const a = makeEnv();
    const b = makeEnv();
    const firstResult = run(a.env, first.ir);
    const secondResult = run(b.env, second.ir);
    expect(firstResult.actuators).toEqual([{ kind: 'move', vx: 1, vy: 0 }]);
    expect(secondResult.actuators).toEqual([{ kind: 'eat' }]);
    const again = run(makeEnv().env, first.ir);
    expect(again).toEqual(firstResult);
  });

  it('[determinism] cyclesUsed is part of the deterministic surface', () => {
    const { ir, cycleEstimate } = compileOk(richSource);
    expect(cycleEstimate).toBeGreaterThan(0);
    const runs = Array.from({ length: 25 }, () => {
      const { env } = makeEnv({ radar: { kind: 'some', payload: 60000 } });
      return run(env, ir).cyclesUsed;
    });
    expect(new Set(runs).size).toBe(1);
    // Runtime work never exceeds the static worst case (D4's premise).
    expect(runs[0]).toBeLessThanOrEqual(cycleEstimate);
    expect(cycleEstimate).toBeLessThanOrEqual(CYCLE_BUDGET);
  });
});
