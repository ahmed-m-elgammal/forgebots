import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from './sha256';

// sha256Hex — the primitive output_sha256 rests on (11 § 2.1). The NIST
// vectors anchor the algorithm; node:crypto cross-checks the boundary
// lengths the same way the float lint's tests cross-check integer math.

const hexOf = (text: string): Uint8Array => new TextEncoder().encode(text);
const cryptoHex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const bytesOf = (length: number, fill: number): Uint8Array => new Uint8Array(length).fill(fill);

describe('sha256Hex — normal cases', () => {
  it('[normal][determinism] the NIST "abc" vector, lowercase 64 hex', () => {
    expect(sha256Hex(hexOf('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('[normal][determinism] the NIST two-block vector', () => {
    const input = 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq';
    expect(sha256Hex(hexOf(input))).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });

  it('[normal][determinism] agrees with node:crypto on assorted inputs', () => {
    const inputs = ['ForgeBots', 'forgebots/23 § 8.2 — telemetry', '0123456789abcdef'.repeat(7)];
    for (const input of inputs) {
      expect(sha256Hex(hexOf(input))).toBe(cryptoHex(hexOf(input)));
    }
  });
});

describe('sha256Hex — boundary cases', () => {
  it('[boundary] the empty input is the NIST vector for zero bytes', () => {
    expect(sha256Hex(new Uint8Array(0))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  // Padding fits the first block only while length ≡ 55 (mod 64); one
  // past it spills into a second block. Both sides of the seam, plus the
  // exact block edges, cross-checked against node:crypto.
  it('[boundary][determinism] the 55/56-byte padding seam agrees with node:crypto', () => {
    for (const length of [54, 55, 56, 57]) {
      const bytes = bytesOf(length, 0xab);
      expect(sha256Hex(bytes)).toBe(cryptoHex(bytes));
    }
  });

  it('[boundary][determinism] exact block multiples and one past them', () => {
    for (const length of [63, 64, 65, 119, 120, 128, 129]) {
      const bytes = bytesOf(length, 0x5a);
      expect(sha256Hex(bytes)).toBe(cryptoHex(bytes));
    }
  });

  it('[boundary] a 0x00-filled input hashes differently from 0x80-filled of the same length', () => {
    expect(sha256Hex(bytesOf(70, 0x00))).not.toBe(sha256Hex(bytesOf(70, 0x80)));
  });
});

describe('sha256Hex — invalid input', () => {
  it('[invalid] refuses inputs beyond the 2^31 − 1 byte domain', () => {
    const oversized = { length: 0x80000000 } as unknown as Uint8Array;
    expect(() => sha256Hex(oversized)).toThrow(RangeError);
  });
});

describe('sha256Hex — state changes', () => {
  it('[state] the input is left untouched (pure, no in-place padding)', () => {
    const bytes = hexOf('mutable?');
    const copy = new Uint8Array(bytes);
    sha256Hex(bytes);
    expect(Array.from(bytes)).toEqual(Array.from(copy));
  });
});

describe('sha256Hex — repeated calls', () => {
  it('[repeated] hashing the same input twice returns the same digest', () => {
    const bytes = hexOf('repeat');
    expect(sha256Hex(bytes)).toBe(sha256Hex(bytes));
  });

  it('[repeated] hashing different inputs back to back does not cross-contaminate', () => {
    const first = sha256Hex(hexOf('first'));
    const second = sha256Hex(hexOf('second'));
    expect(second).toBe(cryptoHex(hexOf('second')));
    expect(first).not.toBe(second);
  });
});

describe('sha256Hex — determinism', () => {
  it('[determinism] equal content in fresh arrays hashes identically', () => {
    expect(sha256Hex(hexOf('same bytes'))).toBe(sha256Hex(hexOf('same bytes')));
  });

  it('[determinism] a one-bit input change changes the digest', () => {
    const left = bytesOf(32, 0x00);
    const right = bytesOf(32, 0x00);
    right[31] = 0x01;
    expect(sha256Hex(left)).not.toBe(sha256Hex(right));
  });
});
