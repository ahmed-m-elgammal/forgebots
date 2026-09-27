// math/ — the one shared value-ownership module every context may import
// (AGENTS.md § 6). Nothing in here imports a framework, a clock, or a
// random source beyond the seeded streams rng.ts owns. Namespaces keep the
// two vocabularies distinct at a call site: fixed.add is scalar addition,
// vec2.add is component-wise vector addition.

export * as fixed from './fixed';
export * as angle from './angle';
export * as vec2 from './vec2';
export * as rng from './rng';
