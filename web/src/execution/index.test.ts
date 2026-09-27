import { describe, expect, it } from 'vitest';
import { VM_YIELD_EVENT, runVmAndCollectActuators } from './index';
import { compile } from '../program';

// The barrel is the surface the match loop and the editor's preview path
// import (AGENTS.md G8). A smoke pass through it fails if an export drifts
// from vm.ts without a rename rippling here.

describe('execution barrel', () => {
  it('[normal] runs a compiled program through the public surface', () => {
    const compiled = compile('(defn step [] (move 65536 0))\n(every-tick step)');
    expect(compiled.ok).toBe(true);
    if (compiled.ok) {
      const result = runVmAndCollectActuators(
        {
          selfField: () => 0,
          time: () => 0,
          rngInt: () => 0,
          sensor: () => ({ kind: 'none' }),
          payloadCoordinate: () => 0,
        },
        compiled.ir,
      );
      expect(result.actuators).toEqual([{ kind: 'move', vx: 65536, vy: 0 }]);
    }
  });

  it('[determinism] the yield event kind is the replay-format name (11 § 4)', () => {
    expect(VM_YIELD_EVENT).toBe('vm_yield');
  });
});
