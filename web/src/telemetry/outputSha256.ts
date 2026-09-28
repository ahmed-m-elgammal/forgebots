// output_sha256 — the replay's integrity value (11-REPLAY-FORMAT.md
// § 2.1, 10-DETERMINISM.md § 5):
//
//     output_sha256 = sha256(
//       seed_bytes ‖ balance_sha256_bytes
//       ‖ canonical(final_state) ‖ canonical(events)
//     )
//
// Two encodings are pinned here and nowhere else, because the concat is
// only reproducible if every field's byte form is fixed:
//
// - seed_bytes: the seed's minimal unsigned big-endian encoding. A zero
//   seed is ONE 0x00 byte, not none — "seed value 0" must stay
//   distinguishable from an absent field, matching the convention every
//   mainstream BigInteger encoder uses.
// - balance_sha256: the hex string decoded to its 32 raw bytes. A digest
//   IS bytes; hashing the hex spelling instead would make the hash
//   sensitive to how the server happens to case the string.
//
// The copy of output_sha256 embedded in the replay document is excluded
// from its own hash input (11 § 2.1) — structural here, because the
// builder hashes the parts BEFORE the document exists; replay.test.ts
// pins it.

import { canonicalJson } from './canonical';
import { sha256Hex } from './sha256';

// matches.seed is a uint64 (the match driver validates the same bound).
const SEED_MAX = (1n << 64n) - 1n;
const BALANCE_SHA_HEX_LENGTH = 64;
const BALANCE_SHA_BYTES = 32;
const HEX_RADIX = 16;

const BALANCE_SHA_PATTERN = /^[0-9a-fA-F]{64}$/;

// The seed's minimal unsigned big-endian bytes; zero is one 0x00 byte.
export function seedToBytes(seed: bigint): Uint8Array {
  if (seed < 0n) {
    throw new RangeError(`seed must be non-negative, got ${seed}`);
  }
  if (seed === 0n) {
    return new Uint8Array([0x00]);
  }
  const byteCount = (seed.toString(2).length + 7) >> 3;
  const bytes = new Uint8Array(byteCount);
  let remaining = seed;
  for (let i = byteCount - 1; i >= 0; i--) {
    bytes[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return bytes;
}

export interface OutputSha256Input {
  readonly seed: bigint;
  readonly balanceSha256: string;
  // JSON-shaped by construction; canonicalJson validates at the edge.
  readonly finalState: unknown;
  readonly events: unknown;
}

export function outputSha256(input: OutputSha256Input): string {
  if (input.seed < 0n || input.seed > SEED_MAX) {
    throw new RangeError(`seed must be a uint64, got ${input.seed}`);
  }
  const balanceBytes = decodeBalanceSha256(input.balanceSha256);
  const seedBytes = seedToBytes(input.seed);
  const finalStateBytes = utf8Bytes(canonicalJson(input.finalState));
  const eventsBytes = utf8Bytes(canonicalJson(input.events));
  const totalLength = seedBytes.length + balanceBytes.length + finalStateBytes.length + eventsBytes.length;
  const concat = new Uint8Array(totalLength);
  concat.set(seedBytes, 0);
  concat.set(balanceBytes, seedBytes.length);
  concat.set(finalStateBytes, seedBytes.length + balanceBytes.length);
  concat.set(eventsBytes, seedBytes.length + balanceBytes.length + finalStateBytes.length);
  return sha256Hex(concat);
}

// Case-insensitive by construction: both spellings decode to the same
// 32 bytes, so the hash cannot depend on the server's hex casing.
function decodeBalanceSha256(hex: string): Uint8Array {
  if (!BALANCE_SHA_PATTERN.test(hex)) {
    throw new TypeError(`balance_sha256 must be ${BALANCE_SHA_HEX_LENGTH} hex characters, got ${JSON.stringify(hex)}`);
  }
  const bytes = new Uint8Array(BALANCE_SHA_BYTES);
  for (let i = 0; i < BALANCE_SHA_BYTES; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), HEX_RADIX);
  }
  return bytes;
}

function utf8Bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}
