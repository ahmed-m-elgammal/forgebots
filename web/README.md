# web/ — Game Client (TypeScript, Vite)

Per [`spec-kit/23-WEB-CLIENT-PLAN.md`](../spec-kit/23-WEB-CLIENT-PLAN.md):
the web client is the primary client; the browser never simulates — it
consumes the API and renders replays the server produced (D3). The
superseded Flutter marketing-site note lives in git history and in
`23` § 15 item 9.

## Layers (23 § 2)

| Layer | Contents | Rule |
|---|---|---|
| `src/logic/` | pure TypeScript | no DOM, no `fetch`, no React |
| `src/net/` | `fetch` + WebSocket | one function per endpoint (later phase) |
| `src/ui/` | components and screens | no business rules (later phase) |
| `src/theme/` | design tokens | only place a hex literal may appear |
| `src/i18n/` | `t()` and ARB loader | rule 3 (later phase) |

## Current state

- **Phase 0 foundations (scoped to this package)** — `package.json`,
  `tsconfig.json`, `vitest.config.ts` (90 % lines/branches unit floor per
  `AGENTS.md` § 4), `eslint.config.js` +
  `tools/eslint-plugin-forge/determinism.js` implementing
  `no-float-literal`, `no-ambient-clock`, `no-math-globals`
  (`Math.imul` allowed only inside `src/math/`, per `10-DETERMINISM.md`
  § 3) and `no-console-in-source` over `src/**`. When the root pnpm
  workspace (`23` § 3 task 0.1) lands, this package joins it unchanged.
- **Phase 1 `src/math/`** — Q16.16 fixed point, complete with the
  six-category test suite (normal / boundary / invalid / state / repeat /
  determinism per function):
  - `fixed.ts` — branded `Fixed` (G26), saturating `add`/`sub`/`mul`/`div`
    (division by zero saturates, `legacy/01` § 2), `cmp`/`min`/`max`/
    `clamp`, `floor`/`ceiling`/`round` (half away from zero), integer
    `sqrt`/`isqrt`, and the millimetre boundary conversions `fromMm`/
    `toMm` (D1, G33). Carries the T6 regression pins for the
    `floor(power / 60)` bug.
  - `angle.ts` — 16-bit circular angles (65536 = 2π, π = 32768, D1);
    `wrapToPi` into (−π, π], `angleDiff` shortest signed path
    (179° → −179° is +2°), `angleBetween`.
  - `vec2.ts` — immutable vector ops, `distance` between two points
    (T6 origin-bug regression), `angleOf` by integer CORDIC (worst case
    < 4 brads off the ±π seam), `inRange` decided on exact squared
    integers so the boundary carries no sqrt rounding.
  - `rng.ts` — Mulberry32 (10 § 2.3); `createMatchRng` /
    `createBotRng` / `deriveSeed` per D5, rejection-sampled `nextInt`
    matching the DSL `(rng-int n)` contract. Golden sequences pin the
    algorithm against drift.
- **Phase 2 `src/program/`** — the DSL compiler, one file per 23 § 5 and
  `AGENTS.md` § 9 resolution 2 (source → verified IR is one
  responsibility; the 300-line target is deliberately overridden):
  - `compiler.ts` — `tokenize` (every token carries line/column; parens
    and brackets interchangeable per D21; `;` comments; float and string
    literals rejected at the lexer, 10 § 2.2), the recursive-descent
    parser (09 § 2.2 forms plus the 23 § 5.2 `set`/`repeat`/`return`
    spellings; `cond` desugars to nested ifs with a required trailing
    else per D21), lowering to the JSON IR (D2 — no bytecode, nodes
    shaped like the 09 § 3 example, source positions ride along as a
    non-enumerable property so the IR stays byte-stable), the verifier
    (all nine 09 § 5 rules: DAG-only calls, literal loop bounds, the
    1000-cycle static estimate, 64-slot stack, 32 locals per frame,
    Option discipline with some?-flow analysis, identifier resolution,
    the entry-point contract, part preconditions as chassis-context
    warnings), the 09 § 4 cost table (single owner; Phase 3's VM
    charges the same numbers), and `formatDiagnostic` — the i18n seam
    where the editor swaps message catalogs.
  - `compile(src, options)` is the public entry point; `tokenize` and
    `formatDiagnostic` are exported for the editor's gutter and squiggles.
  - `compiler.test.ts` + `golden-examples.test.ts` — 136 tests in the
    six categories. The golden file compiles every
    `spec-kit/examples/*.fb` (19 § 5.3), asserts byte-stable IR across
    repeated compiles and JSON round-trip (20 T05.5), and carries the
    starter-bot T6 regressions: pouncer/sentinel measure `dist` from the
    bot, breeder's cond priority order, drifter's `move-at`/`rng-int`
    fallback, reaper's direct `enemy()`, and sentinel's 100 000 mm centre.

- `src/execution/` — Phase 3 (23 § 6): the sandbox, one file by AGENTS.md
  § 9 resolution 1.
  - `vm.ts` — `runVmAndCollectActuators(env, ir)`: a tree-walking
    evaluator over the verified IR that charges the 09 § 4 per-node costs
    (imported from program/, the single owner), renders Options as the
    two-slot form of 09 § 2.3 with locals living ON the 64-slot stack so
    runtime depth equals the verifier's static depth, collects the seven
    actuator intents (nothing moves — 23 § 6.3), and enforces both D4
    contracts: a node runs only if its whole cost fits the 1000-cycle
    budget, and every over-run or trap abandons the tick whole —
    actuators discarded, one `vm_yield` event with reason budget | trap.
    Sensors, self state, time and rng-int arrive through the `VmEnv` seam
    (the published surface perception/ will implement); the VM never
    learns what a radar is. The file header documents every reconciliation
    with the spec, including the while hard-cap that keeps a full run
    billing exactly the estimator's number.
  - `builtins.ts` (in program/) — the pure DSL builtins (06 § 2 places
    math/compare/boolean/trig there): saturating int32 arithmetic,
    truncating division with the legacy/01 § 2 divide-by-zero rule,
    dividend-sign mod with mod-0 = 0, eager boolean folds, `dist` over
    the integer sqrt, and trig dispatched to math/angle's fixed tables.
  - `vm.test.ts` + `golden-vm.test.ts` + `index.test.ts` — 73 tests in
    the six categories: exact budget edges both directions (1000
    completes, 1001 abandons at exactly 1000), the 64-slot stack edge
    through the compiler and one past it by bypass IR, every defensive
    trap, the D5 rng-stream continuity across ticks, 100-run
    byte-identical actuators (23 § 6), and the golden bots — each run
    under its own static estimate, with pouncer's bot-relative dist and
    breeder's cond priority re-proven at runtime and 100 ticks of
    drifter replaying byte-identically.
- `src/math/angle.ts` — now also owns the DSL's fixed trig (10 § 2.2):
  `fsin`/`fcos`/`fatan2` over 4096-entry-per-quadrant lookup tables built
  once at module load by integer CORDIC (constants generated by
  `scripts/gen-cordic-constants.py`, committed — no float exists at
  runtime). Exact at every quadrant boundary, axis and diagonal;
  exhaustive sweeps pin fsin within 30 Q16.16 units and fatan2 within
  6 brads (≈ 0.03°) across all 65 536 headings.

## Commands

```
pnpm install
pnpm lint          # includes the determinism rules
pnpm typecheck
pnpm test
pnpm test:coverage # 90/90 unit floor
```
