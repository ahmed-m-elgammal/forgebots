import { describe, expect, it } from 'vitest';
import { CHASSIS_LIMITS, DESIGN_ERROR_CODES, validateDesignList } from './index';
import { PART_ID, validateChassis } from './parts';
import type { Design } from './design';

// The saved-loadout vocabulary of D12: a bot fields 1-3 designs, each
// design needs a name because the replay robot id embeds it (11 § 3).

const design = (name: string): Design => ({
  name,
  chassis: { parts: [PART_ID.mk1Engine] },
});

describe('CHASSIS_LIMITS (G4 contracts, single owner)', () => {
  it('[determinism] pins the spec numbers', () => {
    expect(CHASSIS_LIMITS).toEqual({
      partSlots: 8,
      massKg: 50,
      netPowerMilliwatts: 80000,
      designsPerBotMin: 1,
      designsPerBotMax: 3,
      robotsPerDesignMax: 4,
      robotsPerSideMax: 6,
    });
  });

  it('[normal] the chassis contracts agree with validateChassis', () => {
    // The limit map and the validator must never drift apart.
    expect(validateChassis({ parts: Array.from({ length: CHASSIS_LIMITS.partSlots }, () => PART_ID.blaster) })).toEqual({ ok: true });
  });
});

describe('validateDesignList (D12 caps)', () => {
  it('[normal] accepts one and three named designs', () => {
    expect(validateDesignList([design('scout')])).toEqual({ ok: true });
    expect(validateDesignList([design('a'), design('b'), design('c')])).toEqual({ ok: true });
  });

  it('[boundary] rejects the 4th design with the cap in the issue', () => {
    const verdict = validateDesignList([design('a'), design('b'), design('c'), design('d')]);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.issues).toEqual([
        { code: DESIGN_ERROR_CODES.count, limit: CHASSIS_LIMITS.designsPerBotMax, actual: 4 },
      ]);
    }
  });

  it('[invalid] an empty roster is a count error, an unnamed design a name error', () => {
    expect(validateDesignList([]).ok).toBe(false);
    const verdict = validateDesignList([design(''), design('ok')]);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.issues).toEqual([{ code: DESIGN_ERROR_CODES.name, designIndex: 0 }]);
    }
  });
});
