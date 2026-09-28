// Canonical JSON — the serialisation the replay hash is defined over
// (11 § 2.1, 10 § 5: sha256 over canonical(final_state) and
// canonical(events)). "Canonical" here means: object keys sorted by code
// unit, no whitespace, integers rendered plainly, strings JSON-escaped,
// UTF-8 bytes. That is RFC 8785 (JCS) behaviour for the value domain a
// replay can contain — integers, strings, arrays, objects — and it is
// bit-stable on every platform because nothing but integer arithmetic
// and code-unit comparison touches the data.
//
// The input is accepted as `unknown` and validated here, at the edge
// (G33): non-integers are rejected rather than rounded — the simulator
// is integer-only by law (10 § 2.2), so a float reaching this function
// is a determinism bug upstream, and widening the format to spell it
// would freeze that bug into the hash (G4). Maps, Sets and class
// instances are rejected too: they have no canonical JSON spelling, and
// silently collapsing one to `{}` would hide a hash-breaking bug.

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export function canonicalJson(value: unknown): string {
  return serialize(value);
}

function serialize(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      return serializeNumber(value);
    case 'string':
      return JSON.stringify(value);
    case 'object':
      return Array.isArray(value) ? serializeArray(value) : serializeObject(value);
    default:
      throw new TypeError(`canonical JSON supports JSON values only, got ${typeof value}`);
  }
}

// Number.isInteger also refuses NaN and the infinities; -0 is normalised
// so it can never hash differently from 0.
function serializeNumber(value: number): string {
  if (!Number.isInteger(value)) {
    throw new TypeError(`canonical JSON refuses non-integer numbers, got ${value}`);
  }
  return value === 0 ? '0' : String(value);
}

function serializeArray(values: readonly unknown[]): string {
  if (values.length === 0) {
    return '[]';
  }
  return `[${values.map(serialize).join(',')}]`;
}

function serializeObject(record: object): string {
  const prototype = Object.getPrototypeOf(record);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`canonical JSON supports plain objects only, got ${prototype.constructor?.name ?? 'exotic object'}`);
  }
  const keys = Object.keys(record).sort(compareCodeUnits);
  if (keys.length === 0) {
    return '{}';
  }
  const fields = record as { readonly [key: string]: unknown };
  return `{${keys.map((key) => `${JSON.stringify(key)}:${serialize(fields[key])}`).join(',')}}`;
}

// Plain relational comparison, never localeCompare: the sort order must
// be the same on every platform and every locale (10 § 4).
function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
