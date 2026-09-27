import { describe, expect, it } from 'vitest';
import { BUILTINS, compile, formatDiagnostic } from './index';

// The barrel is the surface the editor, the server and Phase 3's VM import
// (AGENTS.md G8). A smoke pass through it fails if an export drifts from
// compiler.ts without a rename rippling here.

describe('program barrel', () => {
  it('[normal] compiles through the public surface', () => {
    const result = compile('(defn step [] (move 65536 0))\n(every-tick step)');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ir.tick).toBe('step');
      expect(result.cycleEstimate).toBe(4 + 32);
    }
  });

  it('[normal] reports diagnostics with the catalog wording', () => {
    const result = compile('(defn step [] (nobody))\n(every-tick step)');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(formatDiagnostic(result.errors[0]!)).toContain('no builtin or defn');
    }
  });

  it('[determinism] the cost table is the single owner other contexts import', () => {
    expect(BUILTINS.move?.cost).toBe(30);
    expect(BUILTINS.build?.ret).toBe('void');
  });
});
