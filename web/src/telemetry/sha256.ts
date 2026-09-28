// SHA-256 in pure integer TypeScript. telemetry owns it because 11 § 2.1
// defines output_sha256 over sha256(...) and 10 § 6 makes cross-platform
// portability of that value a tested guarantee (23 § 8.3's golden test
// proves it on Linux, macOS and Windows). Only shifts, rotates, xors and
// (a + b) | 0 additions are used — no floats, no Math.*, no platform
// primitives — so the digest is bit-identical everywhere the simulator
// runs, and the determinism lint has nothing to flag.
//
// All arithmetic stays exact: every intermediate is a 32-bit pattern held
// in a signed int32, addition mod 2^32 is exact because (a + b) of two
// int32 is at most 2^33 − 2, which a double holds without rounding, and
// |0 reduces it to the low 32 bits. The 64-bit bit-length field is split
// by shifts on the byte count, never by float division.

const ROUND_CONSTANTS: readonly number[] = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

const INITIAL_HASH: readonly number[] = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

const BLOCK_BYTES = 64;
const LENGTH_FIELD_BYTES = 8;
const BITS_PER_BYTE = 8;
// The 32-bit shifts below index the byte count; byte counts up to 2^31 − 1
// cover every replay the format's 3 MB cap (D10) could produce.
const MAX_INPUT_BYTES = 0x7fffffff;

export function sha256Hex(bytes: Uint8Array): string {
  if (bytes.length > MAX_INPUT_BYTES) {
    throw new RangeError(`sha256 input must be at most ${MAX_INPUT_BYTES} bytes, got ${bytes.length}`);
  }
  const padded = padMessage(bytes);
  const words = new Int32Array(BLOCK_BYTES);
  let h0 = INITIAL_HASH[0]!;
  let h1 = INITIAL_HASH[1]!;
  let h2 = INITIAL_HASH[2]!;
  let h3 = INITIAL_HASH[3]!;
  let h4 = INITIAL_HASH[4]!;
  let h5 = INITIAL_HASH[5]!;
  let h6 = INITIAL_HASH[6]!;
  let h7 = INITIAL_HASH[7]!;

  for (let blockStart = 0; blockStart < padded.length; blockStart += BLOCK_BYTES) {
    loadBlock(padded, blockStart, words);
    for (let i = 16; i < BLOCK_BYTES; i++) {
      const w15 = words[i - 15]!;
      const w2 = words[i - 2]!;
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      words[i] = (words[i - 16]! + s0 + words[i - 7]! + s1) | 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let i = 0; i < BLOCK_BYTES; i++) {
      const bigS1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temp1 = (h + bigS1 + choose + ROUND_CONSTANTS[i]! + words[i]!) | 0;
      const bigS0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (bigS0 + majority) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
    h5 = (h5 + f) | 0;
    h6 = (h6 + g) | 0;
    h7 = (h7 + h) | 0;
  }
  return hexWord(h0) + hexWord(h1) + hexWord(h2) + hexWord(h3) + hexWord(h4) + hexWord(h5) + hexWord(h6) + hexWord(h7);
}

// 0x80, zero fill to 56 mod 64, then the 64-bit big-endian bit length.
function padMessage(bytes: Uint8Array): Uint8Array {
  const carryBytes = (bytes.length + 1) % BLOCK_BYTES;
  const zeroBytes = (BLOCK_BYTES - LENGTH_FIELD_BYTES - carryBytes + BLOCK_BYTES) % BLOCK_BYTES;
  const padded = new Uint8Array(bytes.length + 1 + zeroBytes + LENGTH_FIELD_BYTES);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const highBits = bytes.length >>> 29;
  const lowBits = (bytes.length & 0x1fffffff) * BITS_PER_BYTE;
  writeWord(padded, padded.length - LENGTH_FIELD_BYTES, highBits);
  writeWord(padded, padded.length - 4, lowBits);
  return padded;
}

function loadBlock(source: Uint8Array, start: number, words: Int32Array): void {
  for (let i = 0; i < 16; i++) {
    const base = start + i * 4;
    words[i] = ((source[base]! << 24) | (source[base + 1]! << 16) | (source[base + 2]! << 8) | source[base + 3]!) | 0;
  }
}

function writeWord(target: Uint8Array, offset: number, value: number): void {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

function rotr(value: number, bits: number): number {
  return ((value >>> bits) | (value << (32 - bits))) | 0;
}

function hexWord(value: number): string {
  return (value >>> 0).toString(16).padStart(8, '0');
}
