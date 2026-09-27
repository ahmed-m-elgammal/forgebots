import { describe, expect, it } from 'vitest';
import {
  PART_ID,
  aggregate,
  snapshotRobot,
  spawnRobot,
  validateChassis,
} from './index';
import { fromMm } from '../math/fixed';

// The barrel is the surface the match loop and the builder UI import
// (AGENTS.md G8). A smoke pass through it fails if an export drifts from
// parts.ts / design.ts / robot.ts without a rename rippling here.

describe('robot barrel', () => {
  it('[normal] validates a design and spawns a snapshot-ready robot', () => {
    const design = {
      name: 'scout',
      chassis: { parts: [PART_ID.mk1Engine, PART_ID.shortRadar, PART_ID.blaster, PART_ID.solarPanel] },
    };
    expect(validateChassis(design.chassis)).toEqual({ ok: true });
    const robot = spawnRobot({
      seed: 42n,
      side: 0,
      designIndex: 0,
      robotIndex: 0,
      design,
      spawnPosition: { x: fromMm(50000), y: fromMm(60000) },
    });
    expect(robot.stats.weapons).toHaveLength(1);
    expect(snapshotRobot(robot).id).toBe('p1.scout.0');
    expect(aggregate(design.chassis).netPowerMilliwatts).toBe(7000);
  });
});
