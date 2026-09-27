import { describe, expect, it } from 'vitest';
import { angle, fixed, rng, vec2 } from './index';

// The barrel is the surface contexts import (AGENTS.md § 6). Namespaces
// keep the scalar and vector vocabularies distinct at the call site.

describe('math barrel', () => {
  it('[normal] exposes the four modules with their vocabularies intact', () => {
    expect(fixed.add(fixed.FIXED_ONE, fixed.FIXED_ONE)).toBe(fixed.fromRaw(131072));
    expect(vec2.add(vec2.VEC2_ZERO, vec2.VEC2_ZERO)).toEqual(vec2.VEC2_ZERO);
    expect(angle.wrapToPi(98304)).toBe(angle.ANGLE_PI);
    expect(typeof rng.createMatchRng).toBe('function');
  });

  it('[determinism] re-exports resolve to the same implementations', () => {
    expect(fixed.div).toBe(fixed.div);
    expect(fixed.fromRaw(1)).toBe(fixed.fromRaw(1));
  });
});
