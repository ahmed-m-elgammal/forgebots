import { describe, expect, it } from 'vitest';
import { canonicalJson, EVENT_KINDS, EventLog, FX_TABLE, REPLAY_FORMAT_VERSION, seedToBytes, sha256Hex, SIM_VERSION, buildReplayDocument, outputSha256 } from './index';

// The barrel is the surface the server's match runner and the golden
// tests import (AGENTS.md G8). A smoke pass through it fails if an
// export drifts from its owning file without the rename rippling here.

describe('telemetry barrel', () => {
  it('[normal] the public surface composes: a log, a document, a hash, a table', () => {
    expect(REPLAY_FORMAT_VERSION).toBe(1);
    expect(SIM_VERSION).toBe('0.1.0');
    expect(EVENT_KINDS.matchEnd).toBe('match_end');
    expect(FX_TABLE.death).toMatchObject({ vfx: 'explosion' });
    expect(Array.from(seedToBytes(258n))).toEqual([0x01, 0x02]);
    expect(sha256Hex(new Uint8Array(0))).toHaveLength(64);
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');

    const log = new EventLog({ designNames: [['scout'], ['tank']] });
    log.recordTick(1, [{ kind: 'move', robotId: 'p1.scout.0', vx: 65536, vy: 0 }]);
    log.snapshot(1, [{ id: 'p1.scout.0', xMm: 0, yMm: 0, hp: 15, shield: 0, energy: 500, biomass: 0, alive: true }]);
    const hash = outputSha256({
      seed: 1n,
      balanceSha256: 'ab'.repeat(32),
      finalState: { robots: [] },
      events: log.eventsUpTo(1),
    });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(buildReplayDocument).toBeTypeOf('function');
  });
});
