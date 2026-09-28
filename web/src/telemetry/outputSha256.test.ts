import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from './canonical';
import { outputSha256, seedToBytes } from './outputSha256';

// outputSha256 — the composition 11 § 2.1 / 10 § 5 pin:
// sha256(seed_bytes ‖ balance_sha256_bytes ‖ canonical(final_state) ‖
// canonical(events)). The expected values here are built from RAW pieces
// (hand-written canonical strings, node:crypto for the digest) so the
// test cannot inherit a bug from the code it checks.

const UINT64_MAX = (1n << 64n) - 1n;

const cryptoOf = (...chunks: readonly Uint8Array[]): string => {
  const hash = createHash('sha256');
  for (const chunk of chunks) {
    hash.update(chunk);
  }
  return hash.digest('hex');
};

const hexBytes = (hex: string): Uint8Array => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
};

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

const BALANCE = 'aa'.repeat(32);
const BALANCE_BYTES = hexBytes(BALANCE);

describe('seedToBytes — normal cases', () => {
  it('[normal] encodes minimal big-endian bytes', () => {
    expect(Array.from(seedToBytes(1n))).toEqual([0x01]);
    expect(Array.from(seedToBytes(0xfeedn))).toEqual([0xfe, 0xed]);
    expect(Array.from(seedToBytes(256n))).toEqual([0x01, 0x00]);
  });
});

describe('seedToBytes — boundary cases', () => {
  it('[boundary] zero is one 0x00 byte, not none', () => {
    expect(Array.from(seedToBytes(0n))).toEqual([0x00]);
  });

  it('[boundary] the byte boundaries at 255/256 and the uint64 top', () => {
    expect(Array.from(seedToBytes(255n))).toEqual([0xff]);
    expect(Array.from(seedToBytes(UINT64_MAX))).toEqual(new Array(8).fill(0xff));
  });

  it('[boundary] values beyond uint64 still encode — the uint64 gate is outputSha256\'s', () => {
    expect(seedToBytes(1n << 64n)).toHaveLength(9);
  });
});

describe('seedToBytes — invalid input', () => {
  it('[invalid] refuses negative seeds', () => {
    expect(() => seedToBytes(-1n)).toThrow(RangeError);
  });
});

describe('seedToBytes — repeated calls / determinism', () => {
  it('[repeated][determinism] the same seed encodes to the same bytes, every time', () => {
    const seed = 0xc0ffeen;
    expect(Array.from(seedToBytes(seed))).toEqual(Array.from(seedToBytes(seed)));
    expect(Array.from(seedToBytes(seed))).toEqual([0xc0, 0xff, 0xee]);
  });
});

describe('outputSha256 — normal cases', () => {
  it('[normal][determinism] matches a hand-assembled hash of the raw parts', () => {
    const finalState = '{"a":1,"robots":[]}';
    const events = '[[],[{"kind":"move","t":1}]]';
    const expected = cryptoOf(
      hexBytes('c0ffee'),
      BALANCE_BYTES,
      utf8(finalState),
      utf8(events),
    );
    expect(outputSha256({
      seed: 0xc0ffeen,
      balanceSha256: BALANCE,
      finalState: { a: 1, robots: [] },
      events: [[], [{ t: 1, kind: 'move' }]],
    })).toBe(expected);
  });

  it('[normal][determinism] canonicalizes objects itself — key order in, digest out', () => {
    const left = outputSha256({ seed: 7n, balanceSha256: BALANCE, finalState: { a: 1, b: 2 }, events: [] });
    const right = outputSha256({ seed: 7n, balanceSha256: BALANCE, finalState: { b: 2, a: 1 }, events: [] });
    expect(left).toBe(right);
  });
});

describe('outputSha256 — boundary cases', () => {
  it('[boundary] a zero seed hashes as one 0x00 byte', () => {
    const expected = cryptoOf(new Uint8Array([0x00]), BALANCE_BYTES, utf8('{}'), utf8('[]'));
    expect(outputSha256({ seed: 0n, balanceSha256: BALANCE, finalState: {}, events: [] })).toBe(expected);
  });

  it('[boundary] the uint64 maximum seed is accepted', () => {
    const expected = cryptoOf(hexBytes('ff'.repeat(8)), BALANCE_BYTES, utf8('{}'), utf8('[]'));
    expect(outputSha256({ seed: UINT64_MAX, balanceSha256: BALANCE, finalState: {}, events: [] })).toBe(expected);
  });

  it('[boundary] empty events and final state are still bytes in the concat', () => {
    const withEmpty = outputSha256({ seed: 1n, balanceSha256: BALANCE, finalState: {}, events: [] });
    const withContent = outputSha256({ seed: 1n, balanceSha256: BALANCE, finalState: {}, events: [[{ t: 1, kind: 'move' }]] });
    expect(withEmpty).not.toBe(withContent);
  });
});

describe('outputSha256 — invalid input', () => {
  it('[invalid] refuses seeds outside the uint64 domain', () => {
    const base = { balanceSha256: BALANCE, finalState: {}, events: [] };
    expect(() => outputSha256({ ...base, seed: -1n })).toThrow(RangeError);
    expect(() => outputSha256({ ...base, seed: 1n << 64n })).toThrow(RangeError);
  });

  it('[invalid] refuses a balance hash that is not 64 hex characters', () => {
    const base = { seed: 1n, finalState: {}, events: [] };
    expect(() => outputSha256({ ...base, balanceSha256: 'aa'.repeat(31) })).toThrow(TypeError);
    expect(() => outputSha256({ ...base, balanceSha256: 'aa'.repeat(33) })).toThrow(TypeError);
    expect(() => outputSha256({ ...base, balanceSha256: 'zz'.repeat(32) })).toThrow(TypeError);
  });

  it('[invalid] propagates canonicalJson refusals for non-JSON values', () => {
    expect(() => outputSha256({ seed: 1n, balanceSha256: BALANCE, finalState: 0.5, events: [] })).toThrow(TypeError);
  });
});

describe('outputSha256 — state changes / repeated calls', () => {
  it('[state][repeated] pure over its inputs: repeated calls, same digest, inputs untouched', () => {
    const finalState = { robots: [{ id: 'p1.a.0', x: 1 }] };
    const events = [[{ t: 1, kind: 'snapshot' }]];
    const input = { seed: 9n, balanceSha256: BALANCE, finalState, events };
    const first = outputSha256(input);
    const second = outputSha256(input);
    expect(first).toBe(second);
    expect(finalState).toEqual({ robots: [{ id: 'p1.a.0', x: 1 }] });
    expect(events).toEqual([[{ t: 1, kind: 'snapshot' }]]);
  });
});

describe('outputSha256 — determinism', () => {
  it('[determinism] the balance hash is case-insensitive by construction', () => {
    const lower = outputSha256({ seed: 5n, balanceSha256: BALANCE, finalState: {}, events: [] });
    const upper = outputSha256({ seed: 5n, balanceSha256: 'AA'.repeat(32), finalState: {}, events: [] });
    expect(lower).toBe(upper);
  });

  it('[determinism] every field participates — change one, change the hash', () => {
    const base = { seed: 5n, balanceSha256: BALANCE, finalState: { a: 1 }, events: [[{ t: 1, kind: 'move' }]] as unknown };
    const seedChanged = outputSha256({ ...base, seed: 6n });
    const balanceChanged = outputSha256({ ...base, balanceSha256: 'bb'.repeat(32) });
    const stateChanged = outputSha256({ ...base, finalState: { a: 2 } });
    const eventsChanged = outputSha256({ ...base, events: [[{ t: 2, kind: 'move' }]] });
    const baseline = outputSha256(base);
    for (const variant of [seedChanged, balanceChanged, stateChanged, eventsChanged]) {
      expect(variant).not.toBe(baseline);
    }
  });

  it('[determinism] agrees with running the pieces through node:crypto directly', () => {
    const finalState = { robots: [{ alive: true, biomass: 0, energy: 500, hp: 15, id: 'p1.scout.0', shield: 0, x: 1234, y: 5678 }] };
    const events = [[{ bot: 'p1.scout.0', kind: 'move', t: 3, vx: 65536, vy: 0 }]];
    const digest = outputSha256({ seed: 123456789n, balanceSha256: BALANCE, finalState, events });
    const expected = cryptoOf(
      seedToBytes(123456789n),
      BALANCE_BYTES,
      utf8(canonicalJson(finalState)),
      utf8(canonicalJson(events)),
    );
    expect(digest).toBe(expected);
  });
});
