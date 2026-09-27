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

## Commands

```
pnpm install
pnpm lint          # includes the determinism rules
pnpm typecheck
pnpm test
pnpm test:coverage # 90/90 unit floor
```
