# simulator/ — Deterministic Simulation Core

> Placeholder scaffold — **no implementation code yet** (`.gitkeep` files
> only). Source files land phase-by-phase per
> [`spec-kit/20-IMPLEMENTATION-PLAN.md`](../spec-kit/20-IMPLEMENTATION-PLAN.md).

The pure-TypeScript, zero-I/O deterministic core — the *shared module* of
the architecture ([`06-ARCHITECTURE.md`](../spec-kit/06-ARCHITECTURE.md)
§ 1–2). It runs identically on the server and (optionally) in the client
for previews, and MUST NOT depend on HTTP, sockets, the file system,
wall-clock time, or unseeded randomness.

## Hard rules (enforced by CI lint — `10-DETERMINISM.md` § 3)

- Forbidden in `simulator/src/**`: `Math.random`, `Date.now`,
  `performance.now`, `new Date()`, `Promise`, `setTimeout`, `setInterval`,
  `fetch`, `http`, `fs`; `console.log` only in tests.
- All world-state arithmetic is fixed-point **Q16.16**; angles use a
  16-bit circular unit (2π = 65536); all trig is table-driven (4096-entry
  lookup tables).
- Single-threaded tick loop at exactly 60 Hz; all RNG seeded from the
  match seed (mulberry32 / xoshiro256\*\*).

## Planned layout (`06-ARCHITECTURE.md` § 2 + `20-IMPLEMENTATION-PLAN.md`)

| Path | Purpose | Phase |
|---|---|---|
| `src/rng.ts` | Seeded RNG (mulberry32 + xoshiro256\*\*), `deriveSeed` | 02 |
| `src/fixed.ts` | Q16.16 helpers + fixed trig tables | 02 |
| `src/math.ts` | Vector + angle ops (`vec.ts` / `angle.ts`) | 02 |
| `src/parts.ts` | Hardware catalog (16 MVP parts) | 03 |
| `src/ir.ts` | Bot program IR (JSON-serialisable) | 05 |
| `src/compiler.ts` | DSL lexer/parser → IR | 04–05 |
| `src/vm.ts` | Sandboxed, cycle-budgeted VM (≤ 1000 cycles/tick/bot) | 06 |
| `src/bot.ts` | Bot state + per-tick stepping | 09 |
| `src/arena.ts` | Map, walls, pillars, biomass spawning | 12 |
| `src/match.ts` | Match driver (deterministic tick loop) | 10 |
| `src/events.ts` | Event log (replay stream) | 14 |
| `src/index.ts` | Public exports | each phase |
| `test/` | Vitest unit tests | 01 (skeleton) |
| `test/fixtures/` | Golden-match fixtures (Pebble vs Drifter, Drifter vs Breeder, Swarm-Mind vs Reaper) | 14 |

## Current contents

Empty by design. Phase 01 (Foundation) of
[`20-IMPLEMENTATION-PLAN.md`](../spec-kit/20-IMPLEMENTATION-PLAN.md)
adds the build tooling (`package.json`, `tsconfig`, ESLint forbidden-API
rule, Vitest config); Phases 02–14 fill the source tree above.
