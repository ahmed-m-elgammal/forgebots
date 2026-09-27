# 20 — Implementation Plan (Engine, Logic, Physics)

> **Scope:** this plan covers **engine, logic, simulation, physics, and
> server back-end only**. UI, client app, audio, art, and live-ops are
> out of scope — they are tracked in the docs but built by separate
> work streams.
>
> **Audience:** human implementer + AI coding agents. Each phase ends
> with a definition of done, an AI agent prompt template, and the
> artefacts an agent must produce.
>
> **Conflict-free:** every phase declares the spec docs and prior
> phases it depends on. No phase references a later one. No phase
> touches UI/UX concerns.
> Where this plan and another doc disagree on a *number*, the numbers
> live in [`22-DECISIONS.md`](22-DECISIONS.md) and this plan quotes
> them from there.

---

## 0. Reading guide

- **§ 1 — Phase overview** — one-line summary of every phase.
- **§ 2 — Phase dependency graph** — ASCII + table.
- **§ 3 to § 16 — Phase detail** — for each phase: depends on, goal,
  tasks, sub-tasks, definition of done, AI agent context, hand-off.
- **§ 17 — Cross-cutting tools** — what lives across all phases
  (CI, format, lint).
- **§ 18 — How to use this plan with AI agents** — concrete prompts
  for each phase.
- **§ 19 — After all 14 phases** — what is deferred.

Canonical starter-bot sources and golden seeds:
`spec-kit/examples/*.fb` and `spec-kit/examples/golden-seeds.json`.

**File layout.** Every phase writes into the bounded-context tree in
`06-ARCHITECTURE.md § 2`. A phase may create files in more than one
context, but a file may only import from `simulator/src/math/` and its
own context directory (`06 § 5.2`). No file exceeds **300 production
lines** (`AGENT.md § 5`).

---

## 1. Phase overview

| # | Phase | One-line | Solo-dev ETA |
|---|---|---|---|
| 01 | Foundation | Repo, build, CI, lint, format | 1 day |
| 02 | Deterministic Math Core | RNG, fixed-point, vec/angle | 1 day |
| 03 | Hardware Catalog | Parts data + aggregation | 0.5 day |
| 04 | DSL Front-End | Lexer, parser, AST, errors | 2 days |
| 05 | IR & Verifier | Typed IR, cycle estimator | 1 day |
| 06 | Sandbox VM | Cycle-budgeted tree-walking interpreter | 2 days |
| 07 | Sensor System | radar / scan / food / ally / enemy | 1 day |
| 08 | Actuator System | move / move-at / aim / fire / eat / build / say | 1.5 days |
| 09 | Bot State | snapshot, tickBot, env snapshot | 1 day |
| 10 | Match Driver | tick loop, ordering, win check | 2 days |
| 11 | Combat Resolver | hitscan, grenades, damage, death, biomass | 2 days |
| 12 | Arena & Resources | walls, pillars, biomass spawn | 1 day |
| 13 | Energy & Shield Regen | milliwatt drain, shield ticks, starvation | 0.5 day |
| 14 | Replay & Golden Tests | event log, hash, golden match | 1.5 days |

**Total: ~18 working days** for one engineer. These occupy weeks 1–2 of
`12-MVP-ROADMAP.md` with the remainder spilling into week 3 alongside
the server skeleton ([`22-DECISIONS.md` D20](22-DECISIONS.md)).

---

## 2. Phase dependency graph

```
01 Foundation ──┐
                │
02 Math Core ───┼──► 03 Parts ──┐
                │                │
                │                ├──► 06 VM ──┐
                │                │            │
04 DSL Front ───┼──► 05 IR & Verify ──────────┤
                │                            │
                │                            ├──► 07 Sensors ──┐
                │                            │                 │
                │                            ├──► 08 Actuators ┤
                │                            │                 │
                │                            ├──► 09 Bot State ┤
                │                            │                 │
                │                            │                 ▼
                │                            │           10 Match Driver
                │                            │                 │
                │                            │                 ├──► 11 Combat
                │                            │                 │
                │                            │                 ├──► 12 Arena
                │                            │                 │
                │                            │                 ├──► 13 Energy
                │                            │                 │
                │                            │                 └──► 14 Replay
                │                            │                       │
                │                            │                       ▼
                │                            │              (server work, deferred)
```

### 2.1 Depends-on table

| Phase | Depends on (spec) | Depends on (prior phase) |
|---|---|---|
| 01 Foundation | none | — |
| 02 Math Core | `10-DETERMINISM.md` § 2 | 01 |
| 03 Parts | `04-GAME-DESIGN.md` § 3 | 01, 02 |
| 04 DSL Front | `09-AI-DSL.md` § 2 | 01 |
| 05 IR & Verify | `09-AI-DSL.md` § 3–5 | 01, 04 |
| 06 VM | `09-AI-DSL.md` § 4, 6; `10-DETERMINISM.md` § 2 | 02, 05 |
| 07 Sensors | `09-AI-DSL.md` § 2.2 (sensors); `04-GAME-DESIGN.md` § 4.1 | 06 |
| 08 Actuators | `09-AI-DSL.md` § 2.2 (actuators); `04-GAME-DESIGN.md` § 4.2 | 06 |
| 09 Bot State | `04-GAME-DESIGN.md` § 3.1 | 02, 03, 06 |
| 10 Match Driver | `04-GAME-DESIGN.md` § 6; `11-REPLAY-FORMAT.md` | 07, 08, 09 |
| 11 Combat | `04-GAME-DESIGN.md` § 3.2 (weapons) | 10 |
| 12 Arena | `04-GAME-DESIGN.md` § 5 | 10 |
| 13 Energy | `04-GAME-DESIGN.md` § 3.2 (energy parts) | 10 |
| 14 Replay | `11-REPLAY-FORMAT.md`; `10-DETERMINISM.md` § 5 | 10, 11, 12, 13 |

Phase 07 depends on Phase 06 only. `perception/types.ts` (the `WorldView`/`BotEnv`
types) is introduced in Phase 07 and consumed by Phase 09; the earlier
version of this table listed "09 (read-only)" there, which was a
circular edge dressed up as a comment.

### 2.2 Parallelisable tracks

After Phase 06 (VM) is done, the following are independent and can be
parallelised:

- **Track A** — Phase 07 (Sensors) → Phase 10 (Match) → Phase 11 (Combat)
- **Track B** — Phase 08 (Actuators) [feeds into 10]
- **Track C** — Phase 09 (Bot State) [feeds into 10]
- **Track D** — Phase 12 (Arena) [feeds into 10]

Note that Phases 07, 08 and 12 all extend `execution/` and `match/`.
Serialise those three file writes; parallelise the thinking.

---

## 3. Phase 01 — Foundation

### 3.1 Goal
Repo + tooling that satisfies `10-DETERMINISM.md` § 3 (no forbidden
APIs in sim code).

### 3.2 Tasks
- **T01.1** — Repo init (pnpm workspace, TS strict mode, tsconfig.base).
- **T01.2** — Folder layout per `06-ARCHITECTURE.md` § 2.
- **T01.3** — ESLint **flat config** (`eslint.config.js`) that bans
  `Math.random`, `Date.now`, `performance.now`, `new Date()`, any
  `Math.*`, `fetch`, `fs`, `Promise`, `setTimeout`, `setInterval`, and
  warns on `console.log` in `simulator/src/**`. The rule lives in one
  local plugin file, `tools/eslint-plugin-forge/determinism.js`.
- **T01.4** — Prettier + EditorConfig.
- **T01.5** — Vitest config with golden-test directory reserved.
- **T01.6** — Husky pre-commit: lint + typecheck.

### 3.3 Sub-tasks
1. `pnpm init` → set `packageManager` to `pnpm@12`.
2. Add `workspaces: ["simulator", "server"]`.
3. Create `tsconfig.base.json` with `strict`, `noUncheckedIndexedAccess`,
   `verbatimModuleSyntax`, `isolatedModules`.
4. Create `eslint.config.js` + `tools/eslint-plugin-forge/determinism.js`
   (one file, regex/AST based, is fine for MVP).
5. Create `.editorconfig`, `.prettierrc`, `.gitignore`.
6. Create `vitest.config.ts` per package.

### 3.4 Definition of done
- `pnpm install` succeeds from a clean clone.
- `pnpm -r build` succeeds.
- `pnpm -r test` runs (no tests yet).
- `pnpm lint` passes with the forbidden-API rule.
- Adding `Math.random()` to `simulator/src/**` fails lint.

### 3.5 AI agent context
```
You are building Phase 01 of ForgeBots — the foundation layer.

Spec to read before any code:
- spec-kit/06-ARCHITECTURE.md § 2 (folder layout)
- spec-kit/10-DETERMINISM.md § 3 (forbidden APIs)

You MUST produce:
- Root package.json with pnpm workspace
- tsconfig.base.json
- eslint.config.js + tools/eslint-plugin-forge/determinism.js
- .editorconfig, .prettierrc, .gitignore
- vitest.config.ts skeleton
- simulator/package.json and server/package.json placeholders

You MUST NOT:
- Add any sim logic yet
- Add any UI code
- Add any database code

Verify your work:
- `pnpm install` succeeds
- `pnpm lint` passes
- Add a temporary `simulator/src/illegal.ts` with `Math.random()` and
  confirm lint fails, then remove it
```

### 3.6 Hand-off
`/simulator/package.json` exists with empty `src/`, `test/`, ESLint
runs cleanly on it.

---

## 4. Phase 02 — Deterministic Math Core

### 4.1 Goal
RNG, fixed-point arithmetic, vector/angle helpers — all deterministic,
all unit-tested.

### 4.2 Tasks
- **T02.1** — `math/rng.ts`: Mulberry32 + xoshiro256** + `deriveSeed` + the
  two-stream split (`matchRng` / `botRng`).
- **T02.2** — `math/fixed.ts`: Q16.16 helpers + trig lookup table +
  `mmToFixed` / `fixedToMm`.
- **T02.3** — `math/vec.ts`: 2D vector ops (add, sub, scale, dot, len, len², normalise).
- **T02.4** — `math/angle.ts`: fixed-point angle helpers (wrap, lerp, diff).
- **T02.5** — Unit tests covering: RNG determinism, fixed-point
  rounding, trig table accuracy, angle wrap edge cases.

### 4.3 Sub-tasks
1. Implement `Mulberry32` first — simpler.
2. Implement `Rng` (xoshiro) — used by sim driver.
3. Implement `deriveSeed(matchSeed, side, designIndex, robotIndex)` via
   FNV-1a 64-bit.
4. Implement `toFixed`, `fromFixed`, `fmul`, `fdiv`, `clamp`,
   `mmToFixed`, `fixedToMm`.
5. Implement `fsin`, `fcos`, `fatan2` — all three via the fixed
   lookup tables only (no `Math.*` calls in sim paths; `atan2` affects
   gameplay through `aim`, so it must be table-driven per
   `10-DETERMINISM.md` § 2.2).
6. Build `SIN_TABLE` with 4096 entries once at module load.
7. Tests must verify: same seed → same 10k outputs; `fsin(0) = 0`,
   `fsin(π/2) = 65536` (Q16.16 full scale); `fatan2(0, -1) = 32768`
   (angle unit, π); `mmToFixed(200000) = 13107200` (200 m in Q16.16)
   and `fixedToMm(mmToFixed(x)) = x` for a set of millimetre values;
   the arena's 200 m extent does not overflow Q16.16.

### 4.4 Definition of done
- All math helpers exported from `simulator/src/index.ts`.
- 100% coverage on `math/rng.ts`, `math/fixed.ts`.
- Lint passes.
- `pnpm test` runs the math suite.

### 4.5 AI agent context
```
Phase 02: Deterministic Math Core.

Spec:
- spec-kit/10-DETERMINISM.md § 1–2 (determinism rules, Q16.16)
- spec-kit/09-AI-DSL.md § 6 (math rules for the VM)

Implement (in /simulator/src/):
- rng.ts: Mulberry32, Rng (xoshiro256**), deriveSeed
- fixed.ts: Q16.16 helpers (toFixed, fromFixed, mmToFixed, fixedToMm,
  fmul, fdiv, clamp, fsin, fcos, fatan2, dist, dist2)
- vec.ts: 2D vector helpers
- angle.ts: wrap, lerp, diff (in fixed-point with 65536 = 2π)
- rng.ts must expose two separate Rng instances (matchRng, botRng);
  see 22-DECISIONS.md D5

Tests (in /simulator/test/):
- rng.test.ts: same seed → same 10k outputs; deriveSeed is stable
- fixed.test.ts: rounding, table accuracy, edge cases
- vec.test.ts: known inputs → known outputs

NEVER use Math.random or Date.now anywhere.
Re-export everything from src/index.ts.

Acceptance: pnpm test passes, coverage ≥ 90% on the new files.
```

---

## 5. Phase 03 — Hardware Catalog

### 5.1 Goal
Data-driven parts catalog from `04-GAME-DESIGN.md` § 3.

### 5.2 Tasks
- **T03.1** — `robot/parts.ts`: full catalog (16 parts in MVP).
- **T03.2** — `robot/design.ts`: chassis limits + aggregation.
- **T03.3** — JSON schema for parts (so balance patches can ship
  JSON not TS).

### 5.3 Sub-tasks
1. Encode every part from § 3.2 of `04-GAME-DESIGN.md` exactly.
2. Implement `aggregate(chassis)` → `ChassisStats`.
3. Implement `validateChassis(chassis)` — mass/power/slot rules.
4. Tests: every part ID listed in spec exists; aggregation produces
   expected stats for a sample chassis.

### 5.4 Definition of done
- All 16 MVP parts present with correct mass / signed power / effect.
- `aggregate()` matches a hand-computed test case for a sample
  chassis (e.g. the four-part chassis in § 5.5 below).
- `validateChassis()` rejects: more than 8 part slots,
  `Σ mass > 50`, `Σ power > 80`, unknown part ids, duplicate part
  categories where the catalog forbids stacking.

### 5.5 AI agent context
```
Phase 03: Hardware Catalog.

Spec:
- spec-kit/04-GAME-DESIGN.md § 3 (parts catalog, part-slot rules)
- spec-kit/06-ARCHITECTURE.md § 2 (parts.ts lives in simulator/)
- spec-kit/22-DECISIONS.md D1 (units), D6 (signed power), D7 (HP)

Implement (in /simulator/src/):
- robot/parts.ts: PARTS array, PARTS_BY_ID map, aggregate(chassis),
  validateChassis
- robot/design.ts: type Design, ChassisStats, CHASSIS_LIMITS

Notes:
- `power` is SIGNED: positive = draw, negative = generation
  (solar -5, reactor -10). Do not take abs().
- Ranges are integer MILLIMETRES in the catalog; internal state is
  Q16.16 metres. Use mmToFixed/fixedToMm at the boundary.
- validateChassis checks slot count <= 8, sum(mass) <= 50,
  sum(power) <= 80. It does NOT require sum(power) <= 0 — a
  net-positive chassis is legal and simply starves.

Tests:
- parts.test.ts: every spec'd part exists; aggregate of
  [mk2_engine, long_radar, blaster, solar] yields
  { topSpeedMmPerSec: 4000, radarRangeMm: 80000, damagePerHit: 12, ... }
- validate rejects a 9-part chassis, a 51 kg chassis, an 81 W chassis
- validate accepts a reactor-only chassis (sum(power) = -10)

NEVER mutate PARTS_BY_ID; treat as readonly.

Acceptance: every test in parts.test.ts passes.
```

---

## 6. Phase 04 — DSL Front-End

### 6.1 Goal
Tokeniser + parser that turns DSL source into an untyped AST,
position-tracked for nice errors.

### 6.2 Tasks
- **T04.1** — `program/tokenizer.ts`: `tokenize(src)` returning
  `Token[]` with positions.
- **T04.2** — `program/parser.ts`: `Parser` class with
  `parseProgram()`.
- **T04.3** — `program/parser.ts` special forms: `if`, `when`, `do`,
  `let`, `while`, `loop`, `cond`, `defn`, `every-tick`.
- **T04.4** — `program/errors.ts`: source-mapped `CompileError`.
- **T04.5** — `program/compiler.ts`: `compile(src, meta)` as the single
  public entry point.
- **T04.6** — Round-trip tests on every example in `spec-kit/examples/`.

The tokenizer, parser and error mapping are **three files, not one**.
An earlier version of this phase put all of them in `compiler.ts`, which
cannot stay under the 300-line cap (`AGENT.md § 5`).

### 6.3 Sub-tasks
1. `tokenizer.ts` handles: parens, brackets (mapped to parens), strings,
   numbers, symbols (incl. `self.x` dotted and trailing `?`).
2. Comment stripping (`;` to end of line).
3. `parser.ts` is recursive-descent; respects spec for special forms.
4. `(let [x 5] body)` and `(let ((x 5)) body)` both accepted; multiple
   bindings accepted.
5. Empty `()` and `[]` accepted only in `defn` param position.
6. `.` is valid only inside `self.*`; reject it in user identifiers.
7. `errors.ts` produces line **and** col on every failure.
8. `every-tick` takes a bare symbol, not a form. Parse
   `(every-tick (move 0 0))` and report a useful `CompileError`.
9. `ast.ts` holds node types only — no behaviour, so it cannot drift
   from the parser.

### 6.4 Definition of done
- `compile(src, meta)` returns `IrProgram` with `fns[]` and `tick`.
- No file in `program/` exceeds 300 production lines.
- All `spec-kit/examples/*.fb` parse without error.
- Negative tests: malformed source throws `CompileError` with a
  useful line **and** column.
- `compiler.ts` exports `compile` and nothing else — it is the only
  public entry point into the front-end (`AGENT.md` G8).

### 6.5 AI agent context
```
Phase 04: DSL Front-End.

Spec:
- spec-kit/09-AI-DSL.md § 2 (DSL syntax)
- spec-kit/06-ARCHITECTURE.md § 2 (program/ context), § 5.2 (imports)
- spec-kit/examples/*.fb (canonical programs)
- spec-kit/22-DECISIONS.md D21 (bracket styles, every-tick, while, cond)
- AGENT.md § 0 (no magic numbers, no redundant comments), § 5 (300-line cap)

Implement FOUR files in /simulator/src/program/:
- tokenizer.ts  tokenize(src) -> Token[] with line/col
- ast.ts        AST node types (types only, no behaviour)
- parser.ts     recursive-descent Parser + the special forms
- errors.ts     CompileError + factories, always carrying line AND col
and ONE thin entry point:
- compiler.ts   compile(src, meta) -> IrProgram  (exports nothing else)

Do NOT create ir.ts / lower.ts / verify.ts — that is Phase 05.
For this phase the IR type is whatever the parser emits, kept minimal
and JSON-serialisable. The real IR is Phase 05's job.

HARD CONSTRAINTS:
- No file over 300 production lines. If parser.ts approaches it, that
  is a signal the grammar grew a concept that wants its own file.
- program/ may import only simulator/src/math/ (06 § 5.2).
- No comment that restates the line below it.

Acceptance:
- All *.fb examples parse cleanly
- Malformed input throws CompileError with line:col
- pnpm test passes (tokenizer.test.ts, parser.test.ts you create)
```

---

## 7. Phase 05 — IR & Verifier

### 7.1 Goal
Promote the parser output to the canonical IR type. Add a verifier
that rejects unsafe programs.

### 7.2 Tasks
- **T05.1** — `program/ir.ts`: final `IrProgram` + `IrNode` types per
  `09-AI-DSL.md` § 3.
- **T05.2** — `program/lower.ts`: AST → IR.
- **T05.3** — `program/verify.ts` — the nine rules in
  `09-AI-DSL.md` § 5 (recursion-free, literal loop bounds, cycles
  ≤ 1000, stack ≤ 64, Option discipline, name resolution, payload
  bounds, exactly one entry point, part preconditions as warnings).
- **T05.4** — `program/cycleEstimate.ts`: static worst-case cycle cost.
- **T05.5** — Round-trip: parser → IR → JSON.parse → identical.
- **T05.6** — Rewire `program/compiler.ts` to `parse` → `lower`.

### 7.3 Sub-tasks
1. Replace the temporary IR from Phase 04 with the spec'd one.
2. `lower.ts` is a structural walk — it must not branch on anything
   except node kind.
3. `program/verify.ts` is a recursive traversal, independent of the parser.
4. `cycleEstimate.ts` multiplies loop bodies by their **literal** bounds
   and takes the worst branch of every `if`/`cond`, using the per-node
   cost table in `09-AI-DSL.md` § 4.
5. JSON round-trip test.
6. Emit warnings (not errors) for part preconditions.

### 7.4 Definition of done
- IR matches spec exactly.
- Verifier rejects: recursive programs, `while` without a literal
  bound, stack depth > 64, cycle estimate > 1000, `if` on a bare
  sensor result, `hit-x` outside a `some?`-true branch, a second
  `every-tick`, `every-tick` naming a function that takes arguments.
- Round-trip is byte-stable.
- Every file in `spec-kit/examples/` passes `verify()`.
- No file in `program/` over 300 production lines.

### 7.5 AI agent context
```
Phase 05: IR & Verifier.

Spec:
- spec-kit/09-AI-DSL.md § 3–5 (IR, verifier, cycle budget)
- spec-kit/06-ARCHITECTURE.md § 2 (program/ context)
- spec-kit/22-DECISIONS.md D2 (no bytecode), D21 (loop bounds)
- AGENT.md § 0, § 5, § 7 (G5 DRY, G8 minimal public interface)

Implement (in /simulator/src/program/):
- ir.ts: exact types from § 3 (IrNode, IrProgram)
- lower.ts: AST -> IR, structural walk only
- verify.ts: verify(ir) -> ok or throws VerificationError
- cycleEstimate.ts: estimateCycles(ir)
- rewire compiler.ts to parse -> lower
Acceptance:
- All spec-kit/examples/*.fb pass verify
- A test bot with `(defn f [] (call f))` is rejected as recursive
- A test bot with `(while (some? (food)) (move 0 0))` is rejected:
  the max-iters argument is missing
- A test bot with `(if (radar) (fire) (move 0 0))` is rejected:
  Option used as a condition
- JSON.parse(JSON.stringify(ir)) deep-equals the original
- No file over 300 production lines
```

---

## 8. Phase 06 — Sandbox VM

### 8.1 Goal
Cycle-budgeted **tree-walking** interpreter for the IR. No I/O.
Deterministic. There is no bytecode stage
([`22-DECISIONS.md` D2](22-DECISIONS.md)).

### 8.2 Tasks
- **T06.1** — `execution/frame.ts`: value stack + locals, the 64 / 32
  caps.
- **T06.2** — `execution/interpreter.ts`: the tree walk.
- **T06.3** — `execution/builtins.ts`: IR-node dispatch table.
- **T06.4** — `execution/vm.ts`: `runVm(env, ir) → StepResult`,
  cycle budget, abandon-the-tick.
- **T06.5** — Cycle-budget enforcement test (run a 5000-cycle program
  *bypassing the verifier*, confirm it abandons the tick at 1000).

The VM was previously specced as one ~400-line file, which cannot stay
under the 300-line cap (`AGENT.md § 5`). Four files, one responsibility
each.

### 8.3 Sub-tasks
1. `frame.ts` owns the stack and enforces both caps.
2. `interpreter.ts` charges the per-node cost from `09 § 4` and walks
   the tree. It has no notion of a sensor, a part, or a weapon.
3. `builtins.ts` dispatches by node kind. A `radar` node resolves to
   `perception/sensors.ts`; a `move` node to `actuation/throttle.ts`.
   That indirection is the whole design (`06 § 5.2`, G7) — adding a
   part must not touch `execution/`.
4. Sensor builtins initially stubbed to `none` (filled in Phase 07).
5. Actuator builtins initially accumulating into an array (Phase 08).
6. `execution/vm.ts` handles budget exhaustion: clear this tick's actuator list,
   emit `vm_yield { cycles_used, reason: "budget" }`, return.
7. `rng-int` must read `env.botRng` — never a module-level or
   match-level stream.

### 8.4 Definition of done
- VM executes a trivial `(every-tick step)` with `(move 65536 0)` in
  < 100 cycles.
- VM abandons a 5000-cycle program at exactly 1000 cycles with
  `yielded: true, yieldReason: 'budget'`, **and the actuator list is
  empty for that tick**.
- Unknown builtins are rejected at verify time (Phase 05); a
  `vm_trap` event exists for the defensive case and is tested.
- Two robots' `rng-int` sequences are identical whether they run alone
  or alongside five other robots.
- No file in `execution/` over 300 production lines.

### 8.5 AI agent context
```
Phase 06: Sandbox VM.

Spec:
- spec-kit/09-AI-DSL.md § 4-6 (cost table, VM rules, file split)
- spec-kit/10-DETERMINISM.md § 2 (no floats in sim state)
- spec-kit/06-ARCHITECTURE.md § 2 (execution/ context), § 5.2 (import rule)
- spec-kit/22-DECISIONS.md D2, D4, D5
- AGENT.md § 0, § 5

Implement FOUR files in /simulator/src/execution/:
- frame.ts       value stack + locals; the 64-slot / 32-local caps
- interpreter.ts the tree walk; charges the 09 § 4 per-node costs
- builtins.ts    IR-node dispatch table (maps node kind -> handler)
- vm.ts          runVm(env, ir) -> { actuators, cyclesUsed, yielded,
                 yieldReason, events }; owns the budget and the
                 abandon-the-tick path

HARD CONSTRAINTS:
- TREE-WALKING over the IR. NOT a bytecode VM (22-DECISIONS D2).
- execution/ must NOT import robot/parts.ts, arena/biomass.ts, or
  combat/ (06 § 5.2). It dispatches to perception/ and actuation/
  through their published entry points only.
- Budget exhaustion ABANDONS the tick: discard actuators, emit
  vm_yield, return. No partial carry-over, no auto-throttle (D4).
- rng-int reads env.botRng only (D5).
- No file over 300 production lines.

Tests:
- 1000-cycle cap enforced, actuator list empty on yield
- Trivial program completes in < 100 cycles
- rng-int is per-robot and order-independent
- execution/ imports nothing from robot/ or arena/

Acceptance: vm.test.ts passes, cycle cap test reproduces exactly.
```

---

## 9. Phase 07 — Sensor System

### 9.1 Goal
Sensor builtins query the world snapshot deterministically.

### 9.2 Tasks
- **T07.1** — `perception/types.ts`: `WorldView`, `BotEnv`, `EntityHit`.
- **T07.2** — `radar()`, `scan(angle)`, `food()`, `ally()`, `enemy()`.
- **T07.3** — Self state queries: `(self.x)`, `(self.y)`, `(self.hp)`,
  `(self.shield)`, `(self.energy)`, `(self.biomass)`, `(self.alive)`.
- **T07.4** — `rng-int(n)` bound to the robot's own `botRng`.
- **T07.5** — Sensor tests with hand-built worlds.

### 9.3 Sub-tasks
1. Define `WorldView` interface (sorted arrays of robots + biomass).
2. Implement each sensor as a closure that reads the snapshot.
3. Range, arc and refresh rate come from the chassis stats, per
   `04-GAME-DESIGN.md § 4.1` and `22-DECISIONS.md D16`:
   - `radar` — part-gated, 25 000/80 000 mm, 1 Hz, **robots only**
   - `scan` — part-gated, 40 000 mm, 30° cone, 4 Hz, robots only
   - `food` — no part, 5 000 mm, 4 Hz
   - `ally` / `enemy` — no part, map-wide, every tick
4. Sensors return `Option<EntityHit>` — `none` if nothing in range.
   A `none` payload access must be impossible (verifier guarantees it).
5. Rate-limited sensors return their **last computed value**, refreshed
   on the tick their rate allows. Document the staleness window: a
   1 Hz radar is up to 60 ticks stale. This is a balance lever.

### 9.4 Definition of done
- All 5 sensors return correct values for hand-crafted worlds.
- `radar` returns the nearest **robot** in range and **never** returns
  a biomass cell. (The old spec said "prefers bots over food", which
  contradicted `radar`'s `Option<EntityHit>` type.)
- `scan` honours cone width and range.
- `food` has a 5 000 mm radius even with no sensor part fitted.
- `ally`/`enemy` are map-wide and team-filtered.
- Determinism: same world state → same sensor result, and the result
  does not depend on how many other robots exist.

### 9.5 AI agent context
```
Phase 07: Sensors.

Spec:
- spec-kit/09-AI-DSL.md § 2.2 (sensor builtins)
- spec-kit/04-GAME-DESIGN.md § 4.1 (sensor behaviour)

Implement (in /simulator/src/perception/):
- WorldView { bots, foods, rng, tick }
- BotEnv { self, tick, radar, scan, food, ally, enemy, rngInt }
- Self-state queries

Tests:
- radar returns null when out of range
- radar prefers closer entity
- scan honours cone and range
- ally/enemy filter by team

Acceptance: all sensor.test.ts cases pass deterministically.
```

---

## 10. Phase 08 — Actuator System

### 10.1 Goal
Actuator builtins accumulate intent; later applied by the match driver.

### 10.2 Tasks
- **T08.1** — `actuation/types.ts`: the `Actuator` union (`move`,
    `move-at`, `aim`, `fire`, `eat`, `build`, `say`).
- **T08.2** — `execution/builtins.ts` emits Actuators into a per-tick
    list held by the VM.
- **T08.3** — `actuation/throttle.ts`: Q16.16 throttle × chassis top
    speed × mass/friction → m/s, clamped to top speed.
- **T08.4** — Validation hooks (e.g. `fire` only with a weapon part).
- **T08.5** — Actuator tests.

### 10.3 Sub-tasks
1. VM owns a per-tick `actuators: Actuator[]` accumulator.
2. Each actuator builtin pushes one entry.
3. Builtins cannot bypass the accumulator (no direct mutation).
4. `move-at(tx, ty)` computes a Q16.16 direction from the robot's
   position, tapering to 0 inside 1 000 mm. Guard the divide: at
   distance 0, throttle is 0, never NaN.
5. `aim` stores an absolute angle in the 65536 = 2π unit — **not**
   radians.
6. Tests: a program calling `(move 65536 0) (move 0 65536)` produces
   2 actuators; throttle 200 000 clamps to 65 536.

### 10.4 Definition of done
- All 7 actuator builtins functional.
- Actuators are pure data, no side effects beyond the list.
- 2 calls → 2 actuators, in order.
- No robot can exceed its chassis top speed under any input.

### 10.5 AI agent context
```
Phase 08: Actuators.

Spec:
- spec-kit/09-AI-DSL.md § 2.2 (actuator builtins)
- spec-kit/04-GAME-DESIGN.md § 4.2 (actuator semantics)
- spec-kit/22-DECISIONS.md D8 (move / move-at units)

Implement (in /simulator/src/actuation/):
- Actuator union type
- VM emits Actuators into a list
- Each builtin pushes exactly one entry
- move/move-at take Q16.16 throttle, 65536 = top speed
- aim takes the 65536 = 2π angle unit

Tests:
- 2 calls → 2 actuators in order
- Order is deterministic across runs
- Throttle clamping and move-at distance guard

Acceptance: actuators.test.ts passes.
```

---

## 11. Phase 09 — Bot State

### 11.1 Goal
Bot struct + per-tick stepping helper.

### 11.2 Tasks
- **T11.1** — `Bot` type with all live state.
- **T11.2** — `spawnBot(args)` factory.
- **T11.3** — `snapshot(bot)` → `BotSnapshot`.
- **T11.4** — `tickBot(bot, world)` returns `StepResult`.

### 11.3 Sub-tasks
1. Aggregate chassis stats on spawn.
2. `maxHullHp = floor(totalMassKg × 1.5)`; `maxShieldHp = Σ shieldHp`.
   Shields are a separate pool drained before hull
   (`22-DECISIONS.md D7`).
3. Spawn state: `biomass = 0`, `energy = energyMax = 500`, shield full.
4. Snapshot only includes scalar state (no closures).
5. `tickBot` builds the env from the snapshot, then runs the VM.
6. `botRng` is seeded here, from `deriveSeed(seed, side, designIndex,
   robotIndex)`.

### 11.4 Definition of done
- `spawnBot` produces a bot with correct stats.
- `tickBot` returns the VM result.
- A dead bot's `tickBot` returns a no-op.
- Two robots with the same design but different robot indices get
  different `botRng` streams.

### 11.5 AI agent context
```
Phase 09: Bot State.

Spec:
- spec-kit/04-GAME-DESIGN.md § 3.1 (HP formula), § 3.2 (energy parts)
- spec-kit/09-AI-DSL.md § 6 (BotEnv construction)

Implement (in /simulator/src/robot/robot.ts):
- Bot type
- spawnBot(args), snapshot(bot), tickBot(bot, world)

Tests:
- spawnBot stats match aggregate()
- tickBot on dead bot returns no-op
- snapshot round-trips scalar state

Acceptance: bot.test.ts passes.
```

---

## 12. Phase 10 — Match Driver

### 12.1 Goal
The deterministic tick loop that orchestrates everything.

### 12.2 Tasks
- **T12.1** — `match/match.ts`: `runMatch(p1, p2, cfg) → MatchResult`.
- **T12.2** — Tick loop with deterministic ordering (spawn order).
- **T12.3** — Win-condition check.
- **T12.4** — Per-tick RNG seeding (deterministic per `10-DETERMINISM.md`).
- **T12.5** — Integration test: 2 bots → result with winner + events.

### 12.3 Sub-tasks
1. Advance `matchRng` once, then build the world snapshot.
2. For each alive bot (in spawn order): run VM, collect actuators.
3. Apply actuators (move / move-at / aim / fire / eat / build / say).
4. Run physics: combat (Phase 11), arena clamping (Phase 12), energy
   and shields (Phase 13).
5. Check the win condition.
6. Repeat until the tick limit.

### 12.4 Definition of done
- 1v1 match produces a `MatchResult` with non-empty events.
- Winner is one of `p1` / `p2` / `draw`.
- Same seed + same balance version → same result byte-for-byte.
- `durationTicks` ≤ `tickLimit`.
- Win resolution matches `04-GAME-DESIGN.md § 6`: last side alive;
  at the tick cap, more total biomass; equal biomass → draw.

### 12.5 AI agent context
```
Phase 10: Match Driver.

Spec:
- spec-kit/04-GAME-DESIGN.md § 6 (match rules)
- spec-kit/10-DETERMINISM.md § 2.1 (tick order, RNG split)
- spec-kit/11-REPLAY-FORMAT.md § 2–4 (event kinds)
- spec-kit/22-DECISIONS.md D5, D15

Implement (in /simulator/src/match/match.ts):
- runMatch(p1, p2, { seed, balanceVersion, arena }) → MatchResult
- Advance matchRng once per tick, BEFORE any bot steps
- Tick loop in spawn order
- Win condition: last side with alive robots, or biomass tiebreak
- Return the balance_version_id used so the caller can store it

Tests:
- Determinism: same seed → same result (compare event count + winner)
- Win condition: 1 bot vs 1 bot, one wins
- Draw condition: both starve, and a biomass tie at the tick cap

Acceptance: match.test.ts passes, determinism test byte-stable.
```

---

## 13. Phase 11 — Combat Resolver

### 13.1 Goal
Hitscan weapons, arcing grenades, damage application, shield-first
damage, death, biomass-on-kill.

### 13.2 Tasks
- **T13.1** — Fire intent → hitscan raycast (blasters) and projectile
  integration (grenade).
- **T13.2** — Damage application: shield pool first, then hull.
- **T13.3** — Death event + biomass bounty transfer.
- **T13.4** — Cooldown tracking.
- **T13.5** — Combat tests.

### 13.3 Sub-tasks
1. After all intents are collected, iterate fire events in spawn order.
2. **Blasters:** raycast from `(bot.x, bot.y)` along `bot.angle` for
   `fireRangeMm` (30 000). Robot collision radius is **500 mm**, so a
   hit requires `perp ≤ 500` — the old "perp ≤ 1000 mm" was an
   undocumented 2 m hitbox. Apply `damagePerHit` (Blaster 12, Heavy
   Blaster 50).
3. **Grenades:** integrate an arcing projectile (fixed-step, no floats),
   detonating on contact or at 6 s cooldown expiry, applying 20 damage
   with a 12 000 mm splash radius to everything in radius. Grenades are
   *not* hitscan — the previous plan only implemented a raycast, so the
   catalog advertised a weapon the engine could not run.
4. Drain shield HP first, overflow to hull HP.
5. If hull HP ≤ 0: emit `death`, and transfer
   `min(10, victim.biomass)` biomass to the killer (kill bounty per
   `04-GAME-DESIGN.md § 6`). If the victim carried less than 10, the
   killer gets what it had.
6. `bot.fireCooldown = fireRate` (Blaster 1 s, Heavy Blaster 2 s,
   Grenade 6 s).
7. Shields stop regenerating for 1 s after taking damage.

### 13.4 Definition of done
- Bot in range takes damage; bot out of range takes none.
- Damage drains shield before hull, and is reported per-pool in the
  `damage` event.
- Bot at hull HP ≤ 0 dies and emits `death`.
- Killer gains `min(10, victim.biomass)`.
- `fireCooldown` blocks immediate re-fire.
- A grenade thrown at a robot damages everything in its splash radius,
  including the thrower.

### 13.5 AI agent context
```
Phase 11: Combat.

Spec:
- spec-kit/04-GAME-DESIGN.md § 3.2 (weapons), § 4 (sensors)
- spec-kit/22-DECISIONS.md D1 (units), D7 (shield-first damage)

Implement (in /simulator/src/combat/, called from match/match.ts):
- resolveShots(bots, world, log, tick)      // blasters, ray-circle
- stepGrenades(projectiles, world, log)     // arcing, splash
- applyDamage(target, amount, source)       // shield then hull
- die(bot, cause) + biomass bounty

Tests:
- In-range bot takes damage
- Out-of-range bot safe
- Shield soaks damage before hull
- Death fires a death event
- Killer gains min(10, victim.biomass) — including the < 10 case
- Grenade splash hits every robot in radius, thrower included

Acceptance: combat.test.ts passes.
```

---

## 14. Phase 12 — Arena & Resources

### 14.1 Goal
Map generation, biomass spawning, walls, pillars.

### 14.2 Tasks
- **T14.1** — `arena/geometry.ts`: `buildArena(cfg, seed) → Arena`.
- **T14.2** — `clampToArena`, `isInWall`, `isInsidePillar`.
- **T14.3** — Biomass spawn + respawn logic.
- **T14.4** — Per-tick movement clamping.
- **T14.5** — Arena tests.

### 14.3 Sub-tasks
1. Arena **200 m × 200 m** (Q16.16 metres: 13 107 200). Walls 0.5 m
   thick. `1 tile = 1 m` is a rendering concern only.
2. **8 pillars** on a 3 × 3 lattice with the **centre cell empty** →
   9 pockets. Positions come from `buildArena(cfg, seed)`.
3. 400 biomass cells, 1 kg each, seeded deterministically from the
   match seed via `matchRng`.
4. A depleted cell respawns **300 ticks (5 s)** later at a
   pseudo-random free cell drawn from `matchRng`.
5. Per-tick movement clamping to the arena interior and out of pillars.
6. Robot collision radius 500 mm.

### 14.4 Definition of done
- Arena is built deterministically from the seed.
- Bot cannot leave arena bounds or enter a pillar.
- Biomass respawns within 300 ticks of being depleted.
- The arena's 200 m extent is representable in Q16.16 without overflow
  (regression test).

### 14.5 AI agent context
```
Phase 12: Arena & Resources.

Spec:
- spec-kit/04-GAME-DESIGN.md § 5 (arena)
- spec-kit/22-DECISIONS.md D15 (arena geometry)

Implement (in /simulator/src/arena/):
- buildArena(cfg, seed)
- clampToArena, isInWall, isInsidePillar

Notes:
- 200 m × 200 m in Q16.16 metres, walls 0.5 m, 8 pillars on a 3x3
  lattice with the centre empty, robot radius 500 mm
- 400 biomass cells; respawn 300 ticks after DEPLETION
- All spawn randomness comes from matchRng

Tests:
- Deterministic build (same seed → same arena)
- Bot clamped at walls and blocked by pillars
- Biomass respawns within the tick limit
- 200 m fits in Q16.16

Acceptance: arena.test.ts passes.
```

---

## 15. Phase 13 — Energy & Shield Regen

### 15.1 Goal
Passive energy regen, shield regen, starvation death.

### 15.2 Tasks
- **T15.1** — Per-tick energy drain/recharge from `netPower`.
- **T15.2** — Per-tick shield regen from `shieldRegen`.
- **T15.3** — Shield-first damage application hook (with Phase 11).
- **T15.4** — Emergency biomass→energy conversion.
- **T15.5** — Starvation death.

### 15.3 Sub-tasks
1. **Power is held as integer milliwatts.** `netPower_mW = Σ part.power × 1000`
   (signed). Each tick:
   `energyMilli += netPower_mW`, then
   `energy = floor(energyMilli / 60)` with `energyMilli` keeping the
   remainder. A 5 W draw therefore costs 83 milli-units/tick, **not**
   `floor(5/60) = 0`. The old `floor(power/60)` rule made every part
   under 60 W free, which silently trivialised the whole energy system.
2. Clamp `energy` to `[0, energyMax]` (500).
3. Shield regen = `shieldRegenHpPerSec` in **hp per tick with a carried
   remainder** (same technique: 0.5 HP/s must not floor to 0). Regen is
   suppressed for 1 s after the shield takes damage.
4. If `energy ≤ 0` and `biomass > 0`: convert 10 biomass → 5 energy and
   emit `eat { bot, amount, reason: "starvation" }` — the reason field
   is what lets the client tell a player-issued `eat` from a
   starvation conversion.
5. If `energy ≤ 0` and `biomass ≤ 0`: bot dies, `cause: "starvation"`.

### 15.4 Definition of done
- A Mk-1 Engine + Solar Panel bot holds energy steady.
- A Reactor bot gains energy up to `energyMax` and stops.
- A bot with a positive `netPower` drains measurably and starves when
  biomass runs out. **A test asserts a 5 W draw is non-zero** — that is
  the regression guard for the floor-to-zero bug.
- Shield regenerates over time, including at 0.5 HP/s.
- A shield that took damage does not regenerate for 1 s.

### 15.5 AI agent context
```
Phase 13: Energy & Shields.

Spec:
- spec-kit/04-GAME-DESIGN.md § 3.2 (energy parts)
- spec-kit/06-ARCHITECTURE.md § 2 (vitality/ context)
- spec-kit/22-DECISIONS.md D6 (signed power, milliwatt accumulator),
  D7 (shield pool)

Implement TWO files in /simulator/src/vitality/:
- energy.ts   the milliwatt accumulator, drain/recharge, the emergency
  10-biomass-to-5-energy conversion, the starvation death
- shields.ts  the shield pool, its regen, and the 1 s suppression
  after damage

Then call them from match/match.ts, after all intents. The tick loop
orchestrates contexts; it does not implement them.
Notes:
- power is SIGNED (generators negative)
- Use integer MILLIwatts with a carried remainder. Never
  floor(watts / 60) — that makes sub-60 W parts free.
- Shield regen uses the same carried-remainder technique
- `eat` events carry a `reason` field: "player" | "starvation"

Tests:
- Solar bot: energy stable
- Reactor bot: charges to energyMax then holds
- 5 W draw is measurably non-zero  <-- regression test
- 0.5 HP/s shield regen is non-zero per tick over time
- Starvation death fires correctly

Acceptance: energy.test.ts passes.
```

---

## 16. Phase 14 — Replay & Golden Tests

### 16.1 Goal
Event log + golden-match CI test.

### 16.2 Tasks
- **T16.1** — `telemetry/eventLog.ts`: `EventLog` with per-tick buckets.
  **This phase creates the file** — no earlier phase does.
- **T16.2** — Emit all event kinds from spec, including change-only
  `move`/`aim` and the 30-tick `snapshot` kind.
- **T16.3** — `outputSha256(seed, balanceSha, events, finalState)`.
- **T16.4** — Golden match fixtures driven by
  `spec-kit/examples/golden-seeds.json`.
- **T16.5** — CI test: replay hash matches golden.

### 16.3 Sub-tasks
1. Implement `EventLog` with per-tick buckets and the change-only
   de-duplication described in `11-REPLAY-FORMAT.md § 4`.
2. Compute SHA-256 over `seed ‖ balanceSha ‖ canonical(finalState) ‖
   canonical(events)`. The hash covers exactly these four inputs —
   nothing else, and not itself.
3. Emit a `snapshot` every 30 ticks so a viewer can render any tick
   without replaying deltas.
4. Save the first deterministic output of each golden matchup to
   `simulator/test/fixtures/`.
5. Add the CI test: re-run + hash must match.

### 16.4 Definition of done
- Every event kind from `11-REPLAY-FORMAT.md` § 4 is emitted
  somewhere, and the change-only kinds are tested for de-duplication.
- Golden hash test passes in CI on Linux, macOS and Windows.
- Re-running with the same seed and balance version produces
  identical JSON.
- A 1500-tick 12-robot match serialises under 150 KB (p50 target from
  `22-DECISIONS.md D10`); the test asserts the hard cap.

### 16.5 AI agent context
```
Phase 14: Replay & Golden Tests.

Spec:
- spec-kit/11-REPLAY-FORMAT.md (event kinds, hash, size budget)
- spec-kit/10-DETERMINISM.md § 5 (golden matchups)
- spec-kit/22-DECISIONS.md D10 (size budget, hash scope)
- spec-kit/examples/golden-seeds.json (the seeds)

Implement (in /simulator/src/telemetry/):
- outputSha256(seed, balanceSha, events, finalState)
- EventLog with per-tick buckets + change-only move/aim + 30-tick
  snapshot
- Golden fixture loader reading spec-kit/examples/golden-seeds.json

Tests:
- Run each golden matchup; hash matches the committed fixture
- Same seed → same hash byte-for-byte
- move/aim emitted only on change
- 1500-tick match under the size cap

Acceptance: golden test passes in CI.
```

---

## 17. Cross-cutting tools

These live alongside every phase:

| Tool | Purpose | Owner |
|---|---|---|
| `pnpm lint` | ESLint flat config + local determinism rule | Phase 01 |
| `pnpm typecheck` | `tsc --noEmit` per package | Phase 01 |
| `pnpm test` | Vitest run | Phase 01 |
| `pnpm test:watch` | Vitest watch | Phase 01 |
| `eslint.config.js` | Root flat config | Phase 01 |
| `tools/eslint-plugin-forge/determinism.js` | The forbidden-API rule | Phase 01 |
| `simulator/test/fixtures/` | Golden match hashes | Phase 14 |
| `spec-kit/examples/*.fb` | Canonical starter-bot sources | Maintained with `19` |
| `spec-kit/examples/golden-seeds.json` | Golden match seeds | Maintained with `10 § 5` |

---

## 18. Using this plan with AI agents

### 18.1 Recommended workflow

1. Pick the next phase to work on (lowest number with all deps done).
2. Open `spec-kit/20-IMPLEMENTATION-PLAN.md` at the relevant section.
3. Read the **spec refs** in `§ X.5 AI agent context` first, then
   `spec-kit/22-DECISIONS.md` for any number the phase depends on.
4. Read the prior phases' code (they are the dependencies).
5. Use the **AI agent context** block as the prompt for your coding
   agent (Claude, GPT, etc.). Add any project-specific notes on top.
6. Verify the **Definition of done** before moving on.

Phases 07, 08, 09 and 12 all touch `execution/` or `match/`. Do them
serially, or split the files deliberately — they are not independent
in the working tree even though their logic is.

### 18.2 Master prompt template

```
You are an AI coding agent implementing Phase NN of ForgeBots —
[PHASE TITLE].

Spec you MUST read:
- spec-kit/[DOC].md
- spec-kit/22-DECISIONS.md (decisions D1–D22)

Prior phases you depend on (read their code first):
- simulator/src/[FILE].ts

Acceptance:
- pnpm test passes
- [PHASE-SPECIFIC ACCEPTANCE]

You MUST NOT:
- Touch UI/UX code
- Add forbidden APIs (Math.random, Math.*, Date.now, fetch, fs)
- Add floating point in simulator/src/**  (no exceptions)
- Implement any later phase's work
- Introduce circular imports between simulator/src modules
```

### 18.3 Anti-patterns to reject

- ❌ Skipping ahead (e.g. implementing Phase 11 before Phase 07).
- ❌ Adding UI to test logic (use plain vitest).
- ❌ Mixing Phase 14's golden tests into Phase 10's match driver.
- ❌ Coupling phases via shared mutable state (use immutable snapshots).
- ❌ Writing the server before Phase 14 (replay format is the contract).
- ❌ Introducing a bytecode compiler — the VM is tree-walking
  (`22-DECISIONS.md` D2).
- ❌ Introducing a client-side simulator (`22-DECISIONS.md` D3).

---

## 19. After all 14 phases

Once the engine/logic/physics stack is green:

- **Server, API, DB, auth** — deferred to a separate plan. The schema
  is fixed in `07-DATA-MODEL.md` and the endpoints in
  `08-API-SURFACE.md`; both are contracts Phase 14's replay format
  feeds.
- **Godot client, UI/UX** — deferred to a separate plan. Note the
  client does **not** run the simulator, so it has no dependency on
  `simulator/` at all beyond the replay schema.
- **Polish, audio, juice, art** — `16-JUICE-AND-AUDIO.md`, separate
  work stream.
- **Localization + push** — `21-LOCALIZATION-AND-NOTIFICATIONS.md`
  requires the `07` schema additions it lists; both are in scope for
  the launch build, not for this plan.

This plan (engine) plus `00`–`19` (product) plus `21` (launch
readiness) is the complete MVP contract. Docs `00`–`21` alone is not —
`21` adds real tables and a real build step.
