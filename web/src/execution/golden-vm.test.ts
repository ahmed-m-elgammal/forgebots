import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  type ActuatorIntent,
  type OptionValue,
  type VmEnv,
  runVmAndCollectActuators,
} from './index';
import { CYCLE_BUDGET, compile } from '../program';

// Integration tier (AGENTS.md § 4): every canonical starter bot compiled by
// Phase 2 and EXECUTED by Phase 3. The invariant under test is the premise
// D4 stands on — a verified program never over-runs its static estimate at
// runtime — plus the 100-run byte-identical contract of 23 § 6 across a
// full 100-tick match slice.

const EXAMPLES_DIR = new URL('../../../spec-kit/examples/', import.meta.url);

const exampleFiles = readdirSync(EXAMPLES_DIR).filter((name) => name.endsWith('.fb'));

const readExample = (name: string): string =>
  readFileSync(new URL(name, EXAMPLES_DIR), 'utf8');

function compileOk(src: string) {
  const result = compile(src);
  if (!result.ok) {
    throw new Error(`expected success, got: ${result.errors.map((e) => e.code).join(', ')}`);
  }
  return result;
}

interface WorldOptions {
  radar?: OptionValue;
  food?: OptionValue;
  self?: Record<string, number | boolean>;
}

// A scripted stand-in for the perception context. The payload decode is
// deliberately asymmetrical so a bot reading hit-y as hit-x cannot pass.
function makeWorld(tickCount: { value: number }, options: WorldOptions = {}): VmEnv {
  const self = options.self ?? { x: 50000, y: 60000, biomass: 0 };
  return {
    selfField: (field) => {
      if (field in self) return self[field] as number | boolean;
      if (field === 'alive') return true;
      return 1000;
    },
    time: () => tickCount.value,
    rngInt: (bound) => {
      tickCount.value += 1;
      return tickCount.value % bound;
    },
    sensor: (name) => {
      if (name === 'radar') return options.radar ?? { kind: 'none' };
      if (name === 'food') return options.food ?? { kind: 'none' };
      return { kind: 'none' };
    },
    payloadCoordinate: (getter, payload) =>
      getter === 'hit-y' || getter === 'food-y' ? payload + 1 : payload,
  };
}

const intentKinds = new Set([
  'move',
  'move-at',
  'aim',
  'fire',
  'eat',
  'build',
  'say',
]);

const isWellFormed = (intent: ActuatorIntent): boolean =>
  intentKinds.has(intent.kind);

describe('golden bots through the VM', () => {
  it('[normal] every example bot runs a tick cleanly under its own estimate', () => {
    for (const file of exampleFiles) {
      const compiled = compileOk(readExample(file));
      const ticks = { value: 1 };
      const env = makeWorld(ticks, {
        radar: { kind: 'some', payload: 60000 },
        food: { kind: 'some', payload: 40000 },
        self: { x: 50000, y: 60000, biomass: 5 },
      });
      const result = runVmAndCollectActuators(env, compiled.ir);
      expect(result.yielded, `${file} yielded`).toBe(false);
      // D4's premise: the static worst case bounds the actual tick.
      expect(result.cyclesUsed, file).toBeLessThanOrEqual(compiled.cycleEstimate);
      expect(compiled.cycleEstimate, file).toBeLessThanOrEqual(CYCLE_BUDGET);
      for (const intent of result.actuators) {
        expect(isWellFormed(intent), `${file} intent ${JSON.stringify(intent)}`).toBe(true);
      }
    }
  });

  it('[state] pebble stands still every tick — 36 cycles of intent', () => {
    const compiled = compileOk(readExample('pebble.fb'));
    expect(compiled.ir.tick).toBe('step');
    const ticks = { value: 1 };
    const result = runVmAndCollectActuators(makeWorld(ticks), compiled.ir);
    expect(result.actuators).toEqual([{ kind: 'move', vx: 0, vy: 0 }]);
    expect(result.cyclesUsed).toBe(36);
  });

  it('[state] a bot with no (every-tick …) form does nothing at all', () => {
    // Pebble's header note: a program without an entry point is supported
    // and different from a program that stands still.
    const compiled = compileOk('(defn step [] (move 0 0))');
    expect(compiled.ir.tick).toBe(null);
    const ticks = { value: 1 };
    const result = runVmAndCollectActuators(makeWorld(ticks), compiled.ir);
    expect(result).toEqual({
      actuators: [],
      cyclesUsed: 0,
      yielded: false,
      yieldReason: null,
      events: [],
    });
  });

  it('[state] pouncer aims and fires at an enemy inside 30000 mm OF THE BOT', () => {
    // T6: the shipped bug measured (dist 0 0 …) from the arena origin. An
    // enemy 10 000 mm from this bot is 84 853 mm from the origin, so only
    // the bot-relative reading may produce the fire intent.
    const compiled = compileOk(readExample('pouncer.fb'));
    const ticks = { value: 1 };
    const env = makeWorld(ticks, {
      radar: { kind: 'some', payload: 60000 },
      self: { x: 50000, y: 60000 },
    });
    const result = runVmAndCollectActuators(env, compiled.ir);
    expect(result.yielded).toBe(false);
    const kinds = result.actuators.map((intent) => intent.kind);
    expect(kinds).toContain('aim');
    expect(kinds).toContain('fire');
    const aim = result.actuators.find((intent) => intent.kind === 'aim');
    if (aim?.kind === 'aim') {
      // atan2(hit-y − y, hit-x − x) = atan2(1, 10000) — a hair above east.
      expect(aim.angle).toBeGreaterThanOrEqual(0);
      expect(aim.angle).toBeLessThanOrEqual(2);
    }
  });

  it('[state] pouncer outside blaster range aims but never fires', () => {
    const compiled = compileOk(readExample('pouncer.fb'));
    const ticks = { value: 1 };
    // Enemy 100 000 mm east: the radar still sees it, the blaster cannot
    // reach it — an aim intent, no fire, and no walk (the else is gone).
    const env = makeWorld(ticks, {
      radar: { kind: 'some', payload: 150000 },
      self: { x: 50000, y: 60000 },
    });
    const result = runVmAndCollectActuators(env, compiled.ir);
    const kinds = result.actuators.map((intent) => intent.kind);
    expect(kinds).toEqual(['aim']);
  });

  it('[state] pouncer with nothing on radar walks forward instead', () => {
    const compiled = compileOk(readExample('pouncer.fb'));
    const ticks = { value: 1 };
    const env = makeWorld(ticks, { radar: { kind: 'none' } });
    const result = runVmAndCollectActuators(env, compiled.ir);
    expect(result.actuators).toEqual([{ kind: 'move', vx: 65536, vy: 0 }]);
  });

  it('[state] breeder follows its cond priority: food, then build, then drift', () => {
    const compiled = compileOk(readExample('breeder.fb'));
    const fed = runVmAndCollectActuators(
      makeWorld({ value: 1 }, { food: { kind: 'some', payload: 40000 } }),
      compiled.ir,
    );
    expect(fed.actuators).toEqual([{ kind: 'move-at', tx: 40000, ty: 40001 }]);

    const stocked = runVmAndCollectActuators(
      makeWorld({ value: 1 }, { self: { x: 50000, y: 60000, biomass: 5 } }),
      compiled.ir,
    );
    expect(stocked.actuators).toEqual([{ kind: 'build', design: 0 }]);

    const lean = runVmAndCollectActuators(
      makeWorld({ value: 1 }, { self: { x: 50000, y: 60000, biomass: 4 } }),
      compiled.ir,
    );
    expect(lean.actuators).toEqual([{ kind: 'move', vx: 32768, vy: 0 }]);
  });

  it('[determinism] 100 ticks of drifter replay byte-identically, never over-billing', () => {
    const compiled = compileOk(readExample('drifter.fb'));
    const runMatch = (): string => {
      const ticks = { value: 0 };
      const frames: unknown[] = [];
      for (let tick = 1; tick <= 100; tick++) {
        ticks.value = tick;
        // Food appears on even ticks only: both drifter branches run.
        const env = makeWorld(ticks, {
          food: tick % 2 === 0 ? { kind: 'some', payload: 40000 } : { kind: 'none' },
        });
        const result = runVmAndCollectActuators(env, compiled.ir);
        expect(result.yielded, `tick ${tick}`).toBe(false);
        expect(result.cyclesUsed).toBeLessThanOrEqual(compiled.cycleEstimate);
        frames.push(JSON.stringify(result.actuators));
      }
      return JSON.stringify(frames);
    };
    const first = runMatch();
    const second = runMatch();
    expect(first).toBe(second);
    const frames = JSON.parse(first) as string[];
    // Both branches actually ran: gather and drift.
    expect(new Set(frames).size).toBeGreaterThan(1);
  });
});
