import { describe, expect, it } from 'vitest';
import { canonicalJson, type JsonValue } from './canonical';

// canonicalJson — the byte form the replay hash is defined over (11 §
// 2.1). The property under test is simpler than any spec line: the same
// VALUE must always produce the same BYTES, whatever order the keys were
// built in, and nothing non-JSON may survive silently.

describe('canonicalJson — normal cases', () => {
  it('[normal] serializes a nested document with sorted keys and no whitespace', () => {
    const value = { b: 1, a: { d: [1, 2], c: 'x' } };
    expect(canonicalJson(value)).toBe('{"a":{"c":"x","d":[1,2]},"b":1}');
  });

  it('[normal] escapes strings per JSON and passes non-ASCII through raw', () => {
    expect(canonicalJson('quote"newline\nπ')).toBe('"quote\\"newline\\nπ"');
  });

  it('[normal] renders the JSON literals', () => {
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson(true)).toBe('true');
    expect(canonicalJson(false)).toBe('false');
  });

  it('[normal] preserves array order — arrays are sequences, not maps', () => {
    expect(canonicalJson([3, 1, 2] as JsonValue)).toBe('[3,1,2]');
  });
});

describe('canonicalJson — boundary cases', () => {
  it('[boundary] empty containers and the empty string', () => {
    expect(canonicalJson({})).toBe('{}');
    expect(canonicalJson([])).toBe('[]');
    expect(canonicalJson('')).toBe('""');
  });

  it('[boundary] sorts keys by code unit, not locale — digits, upper, lower, symbols', () => {
    const value = { b: 1, A: 2, a: 3, '1': 4, '!': 5 };
    expect(canonicalJson(value)).toBe('{"!":5,"1":4,"A":2,"a":3,"b":1}');
  });

  it('[boundary] normalises -0 to 0 so it cannot hash differently', () => {
    expect(canonicalJson(-0)).toBe('0');
  });

  it('[boundary] the largest safe integer stays exact', () => {
    expect(canonicalJson(9007199254740991)).toBe('9007199254740991');
  });

  it('[boundary] deep nesting survives', () => {
    const deep = { a: { b: { c: { d: [1, { e: 2 }] } } } };
    expect(canonicalJson(deep)).toBe('{"a":{"b":{"c":{"d":[1,{"e":2}]}}}}');
  });
});

describe('canonicalJson — invalid input', () => {
  it('[invalid] refuses non-integer numbers instead of freezing them into the hash', () => {
    expect(() => canonicalJson(0.5)).toThrow(TypeError);
    expect(() => canonicalJson(Number.NaN)).toThrow(TypeError);
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });

  it('[invalid] refuses values with no canonical JSON form', () => {
    expect(() => canonicalJson(9007199254740993n)).toThrow(TypeError);
    expect(() => canonicalJson(undefined)).toThrow(TypeError);
    expect(() => canonicalJson(() => 1)).toThrow(TypeError);
  });

  it('[invalid] refuses class instances and collections — they have no canonical spelling', () => {
    class Deceptive {
      visible = 1;
    }
    expect(() => canonicalJson(new Deceptive())).toThrow(TypeError);
    expect(() => canonicalJson(new Map([[1, 2]]))).toThrow(TypeError);
    expect(() => canonicalJson(new Set([1]))).toThrow(TypeError);
  });
});

describe('canonicalJson — state changes', () => {
  it('[state] the input object is not reordered or touched', () => {
    const value: { [key: string]: JsonValue } = { z: 1, a: 2 };
    const keyOrder = Object.keys(value);
    canonicalJson(value);
    expect(Object.keys(value)).toEqual(keyOrder);
  });
});

describe('canonicalJson — repeated calls', () => {
  it('[repeated] serializing the same value twice gives the same bytes', () => {
    const value = { a: [1, { b: 'x' }], c: null };
    expect(canonicalJson(value)).toBe(canonicalJson(value));
  });
});

describe('canonicalJson — determinism', () => {
  it('[determinism] key insertion order does not change the bytes', () => {
    const builtForward = { a: 1, b: 2, c: { p: 1, q: 2 } };
    const builtBackward = { c: { q: 2, p: 1 }, b: 2, a: 1 };
    expect(canonicalJson(builtForward)).toBe(canonicalJson(builtBackward));
  });

  it('[determinism] equal arrays of equal objects in different identities match', () => {
    const left = [{ id: 'p1.scout.0', hp: 15 }];
    const right = [{ hp: 15, id: 'p1.scout.0' }];
    expect(canonicalJson(left)).toBe(canonicalJson(right));
  });

  it('[determinism] distinct values never collide', () => {
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: 2 }));
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });
});
