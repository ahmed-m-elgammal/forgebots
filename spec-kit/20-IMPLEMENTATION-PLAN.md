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

---

## 0. Reading guide

- **§ 1 — Phase overview** — one-line summary of every phase.
- **§ 2 — Phase dependency graph** — ASCII + table.
- **§ 3 to § 14 — Phase detail** — for each phase: depends on, goal,
  tasks, sub-tasks, definition of done, AI agent context, hand-off.
- **§ 15 — Cross-cutting tools** — what lives across all phases
  (CI, format, lint).
- **§ 16 — How to use this plan with AI agents** — concrete prompts
  for each phase.

---

## 1. Phase overview

| # | Phase | One-line | Solo-dev ETA |
|---|---|---|---|
| 01 | Foundation | Repo, build, CI, lint, format | 1 day |
| 02 | Deterministic Math Core | RNG, fixed-point, vec/angle | 1 day |
| 03 | Hardware Catalog | Parts data + aggregation | 0.5 day |
| 04 | DSL Front-End | Lexer, parser, AST, errors | 2 days |
| 05 | IR & Verifier | Typed IR, cycle estimator | 1 day |
| 06 | Sandbox VM | Cycle-budgeted interpreter | 2 days |
| 07 | Sensor System | radar / scan / food / ally / enemy | 1 day |
| 08 | Actuator System | move / aim / fire / eat / build / say | 1.5 days |
| 09 | Bot State | snapshot, tickBot, env snapshot | 1 day |
| 10 | Match Driver | tick loop, ordering, win check | 2 days |
| 11 | Combat Resolver | hitscan, damage, death, biomass | 1.5 days |
| 12 | Arena & Resources | walls, pillars, biomass spawn | 1 day |
| 13 | Energy & Shield Regen | passive power, shield ticks | 0.5 day |
| 14 | Replay & Golden Tests | event log, hash, golden match | 1.5 days |

**Total: ~17 working days** for one engineer. With overlap and
context-switching overhead, expect ~3 weeks wall-clock.

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
| 02 Math Core | `10-DETERMINISM.md` | 01 |
| 03 Parts | `04-GAME-DESIGN.md` § 3 | 01, 02 |
| 04 DSL Front | `09-AI-DSL.md` § 2 | 01 |
| 05 IR & Verify | `09-AI-DSL.md` § 3–5 | 01, 04 |
| 06 VM | `09-AI-DSL.md` § 6, `10-DETERMINISM.md` § 2 | 02, 05 |
| 07 Sensors | `09-AI-DSL.md` § 2.2 (sensors), `10-DETERMINISM.md` § 2 | 06, 09 (read-only) |
| 08 Actuators | `09-AI-DSL.md` § 2.2 (actuators), `04-GAME-DESIGN.md` § 3 | 06 |
| 09 Bot State | `04-GAME-DESIGN.md` § 3.1 | 02, 03, 06 |
| 10 Match Driver | `04-GAME-DESIGN.md` § 6, `11-REPLAY-FORMAT.md` | 07, 08, 09 |
| 11 Combat | `04-GAME-DESIGN.md` § 3.2 (weapons) | 10 |
| 12 Arena | `04-GAME-DESIGN.md` § 5 | 10 |
| 13 Energy | `04-GAME-DESIGN.md` § 3.2 | 10 |
| 14 Replay | `11-REPLAY-FORMAT.md` | 10, 11, 12, 13 |

### 2.2 Parallelisable tracks

After Phase 06 (VM) is done, the following are independent and can be
parallelised:

- **Track A** — Phase 07 (Sensors) → Phase 10 (Match) → Phase 11 (Combat)
- **Track B** — Phase 08 (Actuators) [feeds into 10]
- **Track C** — Phase 09 (Bot State) [feeds into 10]
- **Track D** — Phase 12 (Arena) [feeds into 10]

---

## 3. Phase 01 — Foundation

### 3.1 Goal
Repo + tooling that satisfies `10-DETERMINISM.md` § 3 (no forbidden
APIs in sim code).

### 3.2 Tasks
- **T01.1** — Repo init (pnpm workspace, TS strict mode, tsconfig.base).
- **T01.2** — Folder layout per `06-ARCHITECTURE.md` § 2.
- **T01.3** — ESLint config that bans `Math.random`, `Date.now`,
  `performance.now`, `fetch`, `fs`, `console.log` (allow only in tests)
  in `simulator/src/**`.
- **T01.4** — Prettier + EditorConfig.
- **T01.5** — Vitest config with golden-test directory reserved.
- **T01.6** — Husky pre-commit: lint + typecheck.

### 3.3 Sub-tasks
1. `pnpm init` → set `packageManager` to `pnpm@9`.
2. Add `workspaces: ["simulator", "server"]`.
3. Create `tsconfig.base.json` with `strict`, `noUncheckedIndexedAccess`,
   `verbatimModuleSyntax`, `isolatedModules`.
4. Create `.eslintrc.cjs` with the custom no-determinism rule (a
   one-file regex-based rule is fine for MVP).
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
- .eslintrc.cjs with the forbidden-API rule
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
- **T02.1** — `rng.ts`: Mulberry32 + xoshiro256** + `deriveSeed`.
- **T02.2** — `fixed.ts`: Q16.16 helpers + trig lookup table.
- **T02.3** — `vec.ts`: 2D vector ops (add, sub, scale, dot, len, len², normalise).
- **T02.4** — `angle.ts`: fixed-point angle helpers (wrap, lerp, diff).
- **T02.5** — Unit tests covering: RNG determinism, fixed-point
  rounding, trig table accuracy, angle wrap edge cases.

### 4.3 Sub-tasks
1. Implement `Mulberry32` first — simpler.
2. Implement `Rng` (xoshiro) — used by sim driver.
3. Implement `deriveSeed(matchSeed, id)` via FNV-1a 64-bit.
4. Implement `toFixed`, `fromFixed`, `fmul`, `fdiv`, `clamp`.
5. Implement `fsin`, `fcos`, `fatan2` — all three via the fixed
   lookup tables only (no `Math.*` calls in sim paths; `atan2` affects
   gameplay through `aim`, so it must be table-driven per
   `10-DETERMINISM.md` § 2.2).
6. Build `SIN_TABLE` with 4096 entries once at module load.
7. Tests must verify: same seed → same 10k outputs; `fsin(0) = 0`,
   `fsin(π/2) ≈ 65536`; `fatan2(0, -1) ≈ 32768`.

### 4.4 Definition of done
- All math helpers exported from `simulator/src/index.ts`.
- 100% coverage on `rng.ts`, `fixed.ts`.
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
- fixed.ts: Q16.16 helpers (toFixed, fromFixed, fmul, fdiv, clamp,
  fsin, fcos, fatan2, dist, dist2)
- vec.ts: 2D vector helpers
- angle.ts: wrap, lerp, diff (in fixed-point with 65536 = 2π)

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
- **T03.1** — `parts.ts`: full catalog (16 parts in MVP).
- **T03.2** — `chassis.ts`: chassis limits + aggregation.
- **T03.3** — JSON schema for parts (so balance patches can ship
  JSON not TS).

### 5.3 Sub-tasks
1. Encode every part from § 3.2 of `04-GAME-DESIGN.md` exactly.
2. Implement `aggregate(chassis)` → `ChassisStats`.
3. Implement `validateChassis(chassis)` — mass/power/slot rules.
4. Tests: every part ID listed in spec exists; aggregation produces
   expected stats for a sample chassis.

### 5.4 Definition of done
- All 16 MVP parts present with correct mass/power/effect strings.
- `aggregate()` matches a hand-computed test case for a sample
  chassis (e.g. the four-part chassis in § 5.5 below).
- `validateChassis()` rejects mass > 50, power > 80, slot count > 8.

### 5.5 AI agent context
```
Phase 03: Hardware Catalog.

Spec:
- spec-kit/04-GAME-DESIGN.md § 3 (parts catalog, slot rules)
- spec-kit/06-ARCHITECTURE.md § 2 (parts.ts lives in simulator/)

Implement (in /simulator/src/):
- parts.ts: PARTS array, PARTS_BY_ID map, aggregate(chassis), validateChassis
- chassis.ts (optional split): type Chassis, ChassisStats, CHASSIS_LIMITS

Tests:
- parts.test.ts: every spec'd part exists; aggregate of
  [mk2_engine, long_radar, blaster, solar] yields
  {topSpeed: 4000, radarRange: 80000, damagePerHit: 12, ...}

NEVER mutate PARTS_BY_ID; treat as readonly.

Acceptance: every test in parts.test.ts passes.
```

---

## 6. Phase 04 — DSL Front-End

### 6.1 Goal
Tokeniser + parser that turns DSL source into an untyped AST,
position-tracked for nice errors.

### 6.2 Tasks
- **T04.1** — `tokenize(src)` returning `Token[]` with positions.
- **T04.2** — `Parser` class with `parseProgram()`.
- **T04.3** — Special forms: `if`, `when`, `do`, `let`, `while`, `loop`,
  `defn`, `every-tick`.
- **T04.4** — Source-mapped errors with `CompileError`.
- **T04.5** — Round-trip tests on every example in `spec-kit/examples/`.

### 6.3 Sub-tasks
1. Tokeniser handles: parens, brackets (mapped to parens), strings,
   numbers, symbols (incl. `self.x` dotted).
2. Comment stripping (`;` to end of line).
3. Parser is recursive-descent; respects spec for special forms.
4. `(let ((x 5)) body)` and `(let (x 5) body)` both accepted; single
   binding `(x 5)` accepted.
5. Empty `()` and `[]` accepted only in `defn` param position.
6. Errors include line/col.

### 6.4 Definition of done
- `compile(src, meta)` returns `IrProgram` with `fns[]` and `tick`.
- All `spec-kit/examples/*.fb` parse without error.
- Negative tests: malformed source throws `CompileError` with a
  useful position.

### 6.5 AI agent context
```
Phase 04: DSL Front-End.

Spec:
- spec-kit/09-AI-DSL.md § 2 (DSL syntax)
- spec-kit/spec-kit/examples/*.fb (canonical programs)

Implement (in /simulator/src/):
- compiler.ts: tokenize, Parser, compile(src, meta) → IrProgram

The IR type comes from spec-kit/09-AI-DSL.md § 3 — but for THIS phase
produce a minimal IrProgram type that matches what the parser emits.
The full IR schema is Phase 05's job; just make the parser output
something typed and serialisable.

Acceptance:
- All *.fb examples parse cleanly
- Malformed input throws CompileError with line:col
- pnpm test passes (parser.test.ts you create)
```

---

## 7. Phase 05 — IR & Verifier

### 7.1 Goal
Promote the parser output to the canonical IR type. Add a verifier
that rejects unsafe programs.

### 7.2 Tasks
- **T05.1** — Final `IrProgram` + `IrNode` types per `09-AI-DSL.md` § 3.
- **T05.2** — `verify(ir)` — recursion-free, stack ≤ 64, cycles ≤ 1000.
- **T05.3** — Static cycle estimator (`estimateCycles(ir)`).
- **T05.4** — Round-trip: parser → IR → JSON.parse → identical.

### 7.3 Sub-tasks
1. Replace the temporary IrProgram from Phase 04 with the spec'd one.
2. Implement verifier as a recursive traversal.
3. Estimate worst-case cycles using the per-op cost table in
   `09-AI-DSL.md` § 4.
4. JSON round-trip test.

### 7.4 Definition of done
- IR matches spec exactly.
- Verifier rejects: recursive programs, unbounded `while`, stack
  depth > 64, cycle estimate > 1000.
- Round-trip is byte-stable.

### 7.5 AI agent context
```
Phase 05: IR & Verifier.

Spec:
- spec-kit/09-AI-DSL.md § 3–5 (IR, verifier, cycle budget)

Implement (in /simulator/src/):
- ir.ts: exact types from § 3 (IrNode, IrProgram)
- verify.ts: verify(ir) → ok or throws VerificationError
- Update compiler.ts to emit these types

Acceptance:
- All examples pass verify
- A test bot with `(defn f () (f))` is rejected as recursive
- A test bot with `(while true 1)` is rejected as unbounded
- JSON.parse(JSON.stringify(ir)) deep-equals the original
```

---

## 8. Phase 06 — Sandbox VM

### 8.1 Goal
Cycle-budgeted interpreter for the IR. No I/O. Deterministic.

### 8.2 Tasks
- **T06.1** — `vm.ts`: tree-walking interpreter.
- **T06.2** — Per-op cost in cycles; budget enforcement.
- **T06.3** — Builtin dispatch table per `09-AI-DSL.md` § 4.
- **T06.4** — `runVm(env, ir) → StepResult`.
- **T06.5** — Cycle-budget enforcement test (run a 5000-cycle bot,
  confirm it yields at 1000).

### 8.3 Sub-tasks
1. Stack machine with depth cap 64.
2. Builtins for math + compare + booleans.
3. Sensor builtins initially as stubs returning `null`/0 (filled in
   Phase 07).
4. Actuator builtins as stubs accumulating into an array (filled in
   Phase 08).
5. Yielded state recorded: cycles used, reason (`budget` / `trap`).

### 8.4 Definition of done
- VM executes a trivial `(every-tick (move 1 0))` in < 100 cycles.
- VM halts a 5000-cycle program at exactly 1000 cycles with
  `yielded: true, yieldReason: 'budget'`.
- VM rejects calls to unknown builtins with `vm_trap` event.

### 8.5 AI agent context
```
Phase 06: Sandbox VM.

Spec:
- spec-kit/09-AI-DSL.md § 4–6 (builtins, cost table, VM rules)
- spec-kit/10-DETERMINISM.md § 2 (no floats in sim state)

Implement (in /simulator/src/vm.ts):
- runVm(env, ir) → { actuators, cyclesUsed, yielded, events }
- Tree-walking interpreter; cycle-counted
- Stack cap 64
- Stub out sensor/actuator builtins (Phase 07/08 will fill them)

Tests:
- 1000-cycle cap enforced
- Trivial program completes in < 100 cycles
- Unknown builtin → vm_trap

Acceptance: vm.test.ts passes, cycle cap test reproduces exactly.
```

---

## 9. Phase 07 — Sensor System

### 9.1 Goal
Sensor builtins query the world snapshot deterministically.

### 9.2 Tasks
- **T07.1** — `env.ts`: BotEnv + WorldView types.
- **T07.2** — `radar()`, `scan(angle)`, `food()`, `ally()`, `enemy()`.
- **T07.3** — Self state queries: `self.x/y/hp/energy/biomass/alive`.
- **T07.4** — RNG-backed `rng-int(n)`.
- **T07.5** — Sensor tests with hand-built worlds.

### 9.3 Sub-tasks
1. Define `WorldView` interface (snapshot of all bots + biomass).
2. Implement each sensor as a closure that reads the snapshot.
3. Range, arc, and rate come from the chassis stats.
4. Sensors return `Option<EntityHit>` — null if nothing in range.

### 9.4 Definition of done
- All 5 sensors return correct values for hand-crafted worlds.
- `radar` returns closest entity in range, prefers bots over food.
- `scan` honours cone width and range.
- Determinism: same world state → same sensor result.

### 9.5 AI agent context
```
Phase 07: Sensors.

Spec:
- spec-kit/09-AI-DSL.md § 2.2 (sensor builtins)
- spec-kit/04-GAME-DESIGN.md § 4.1 (sensor behaviour)

Implement (in /simulator/src/env.ts + update vm.ts):
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
- **T08.1** — `Actuator` union type (`move`, `aim`, `fire`, `eat`,
  `build`, `say`).
- **T08.2** — VM builtins emit Actuators into a per-tick list.
- **T08.3** — Validation hooks (e.g. `fire` only with weapon).
- **T08.4** — Actuator tests.

### 10.3 Sub-tasks
1. VM owns a per-tick `actuators: Actuator[]` accumulator.
2. Each actuator builtin pushes one entry.
3. Verification: builtins cannot bypass accumulator (no direct mutation).
4. Tests: a program calling `(move 1 0) (move 0 1)` produces 2 actuators.

### 10.4 Definition of done
- All 6 actuator builtins functional.
- Actuators are pure data, no side-effects beyond the list.
- Tests show that 2 calls → 2 actuators.

### 10.5 AI agent context
```
Phase 08: Actuators.

Spec:
- spec-kit/09-AI-DSL.md § 2.2 (actuator builtins)
- spec-kit/04-GAME-DESIGN.md § 3 (parts they reference)

Implement (in /simulator/src/vm.ts + new src/actuators.ts):
- Actuator union type
- VM emits Actuators into a list
- Each builtin pushes exactly one entry

Tests:
- 2 calls → 2 actuators in order
- Order is deterministic across runs

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
2. HP = mass × 1.5 + shieldHp.
3. Initial biomass 0, energy 500.
4. Snapshot only includes scalar state (no closures).
5. tickBot builds env from snapshot, runs VM.

### 11.4 Definition of done
- `spawnBot` produces a bot with correct stats.
- `tickBot` returns VM result.
- A dead bot's `tickBot` returns no-op.

### 11.5 AI agent context
```
Phase 09: Bot State.

Spec:
- spec-kit/04-GAME-DESIGN.md § 3.1 (HP formula), § 3.2 (energy parts)
- spec-kit/09-AI-DSL.md § 6 (BotEnv construction)

Implement (in /simulator/src/bot.ts):
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
- **T12.1** — `match.ts`: `runMatch(p1, p2, cfg) → MatchResult`.
- **T12.2** — Tick loop with deterministic ordering (spawn order).
- **T12.3** — Win-condition check.
- **T12.4** — Per-tick RNG seeding (deterministic per `10-DETERMINISM.md`).
- **T12.5** — Integration test: 2 bots → result with winner + events.

### 12.3 Sub-tasks
1. Build world snapshot at start of each tick.
2. For each alive bot (in spawn order): run VM, get actuators.
3. Apply actuators (move/aim/etc.).
4. Run physics (combat, energy, biomass).
5. Check win.
6. Repeat until tick limit.

### 12.4 Definition of done
- 1v1 match produces a `MatchResult` with non-empty events.
- Winner is one of `p1` / `p2` / `draw`.
- Same seed → same result byte-for-byte.
- `durationTicks` ≤ `tickLimit`.

### 12.5 AI agent context
```
Phase 10: Match Driver.

Spec:
- spec-kit/04-GAME-DESIGN.md § 6 (match rules)
- spec-kit/10-DETERMINISM.md § 2 (tick order, RNG)
- spec-kit/11-REPLAY-FORMAT.md § 2–4 (event kinds)

Implement (in /simulator/src/match.ts):
- runMatch(p1, p2, {seed, arena}) → MatchResult
- Tick loop in spawn order
- Win condition: last side with alive bots, or biomass tiebreak

Tests:
- Determinism: same seed → same result (compare event count + winner)
- Win condition: 1 bot vs 1 bot, one wins
- Draw condition: both starve

Acceptance: match.test.ts passes, determinism test byte-stable.
```

---

## 13. Phase 11 — Combat Resolver

### 13.1 Goal
Hitscan weapons, damage application, death, biomass-on-kill.

### 13.2 Tasks
- **T13.1** — Fire intent → raycast → hit detection.
- **T13.2** — Damage application to bot HP.
- **T13.3** — Death event + biomass transfer.
- **T13.4** — Cooldown tracking.
- **T13.5** — Combat tests.

### 13.3 Sub-tasks
1. After all intents processed, iterate fire events.
2. For each fire: raycast from `bot.x, bot.y` along `bot.angle` for
   `fireRange` mm; find first hit within `perp ≤ 1000 mm`.
3. Apply `damagePerHit` to hit bot's HP.
4. If HP ≤ 0: emit `death`, transfer 10 biomass to killer (kill
   bounty per `04-GAME-DESIGN.md` § 6).
5. Bot's `fireCooldown = fireRate`.

### 13.4 Definition of done
- Bot in range takes damage.
- Bot out of range takes none.
- Bot at HP ≤ 0 dies and emits `death` event.
- Killer gains biomass.
- `fireCooldown` blocks immediate re-fire.

### 13.5 AI agent context
```
Phase 11: Combat.

Spec:
- spec-kit/04-GAME-DESIGN.md § 3.2 (weapons), § 4 (combat sensors)

Implement (in /simulator/src/match.ts or new combat.ts):
- resolveShots(bots, world, log, tick)
- Ray-circle intersection (bot treated as point)
- Damage + death + biomass transfer

Tests:
- In-range bot takes damage
- Out-of-range bot safe
- Death fires death event
- Killer gains 10 biomass

Acceptance: combat.test.ts passes.
```

---

## 14. Phase 12 — Arena & Resources

### 14.1 Goal
Map generation, biomass spawning, walls, pillars.

### 14.2 Tasks
- **T14.1** — `arena.ts`: `buildArena(cfg, seed) → Arena`.
- **T14.2** — `clampToArena`, `isInWall`, `isInsidePillar`.
- **T14.3** — Biomass spawn + respawn logic.
- **T14.4** — Per-tick movement clamping.
- **T14.5** — Arena tests.

### 14.3 Sub-tasks
1. Arena 200×200 with 500mm walls.
2. 8 pillars at 3×3 grid.
3. 400 biomass cells seeded deterministically from match seed.
4. Respawn at random free cell after 5 s (300 ticks).

### 14.4 Definition of done
- Arena is built deterministically from seed.
- Bot cannot leave arena bounds.
- Bot cannot enter pillar.
- Biomass respawns within 300 ticks of being depleted.

### 14.5 AI agent context
```
Phase 12: Arena & Resources.

Spec:
- spec-kit/04-GAME-DESIGN.md § 5 (arena)

Implement (in /simulator/src/arena.ts):
- buildArena(cfg, seed)
- clampToArena, isInWall, isInsidePillar

Tests:
- Deterministic build (same seed → same arena)
- Bot clamped at walls
- Biomass respawns within tick limit

Acceptance: arena.test.ts passes.
```

---

## 15. Phase 13 — Energy & Shield Regen

### 15.1 Goal
Passive energy regen, shield regen, starvation death.

### 15.2 Tasks
- **T15.1** — Per-tick energy regen from `energyGen`.
- **T15.2** — Per-tick shield regen from `shieldRegen`.
- **T15.3** — Power drain (passive).
- **T15.4** — Emergency biomass→energy conversion.
- **T15.5** — Starvation death.

### 15.3 Sub-tasks
1. Energy regen = `energyGen / 60` per tick (integer floor).
2. Power drain = `max(0, totalPower) / 60`.
3. Shield regen = `shieldRegen / 60` (Q16.16).
4. If energy ≤ 0 and biomass > 0: convert 10 biomass → 5 energy
   (same rate as the `eat` actuator in `04-GAME-DESIGN.md` § 4.2),
   emit `eat` event.
5. If energy ≤ 0 and biomass ≤ 0: bot dies (`cause: 'starvation'`).

### 15.4 Definition of done
- Solar panel bot never starves given food.
- Heavy-power bot with no solar starves when biomass runs out.
- Shield regenerates over time.

### 15.5 AI agent context
```
Phase 13: Energy & Shields.

Spec:
- spec-kit/04-GAME-DESIGN.md § 3.2 (energy parts)

Implement (in /simulator/src/match.ts):
- After all intents: regen energy, drain power, regen shields,
  emergency biomass conversion, starvation check

Tests:
- Solar bot: energy stable
- Reactor bot: positive net energy
- Starvation death fires correctly

Acceptance: energy.test.ts passes.
```

---

## 16. Phase 14 — Replay & Golden Tests

### 16.1 Goal
Event log + golden-match CI test.

### 16.2 Tasks
- **T16.1** — `EventLog` class with per-tick buckets.
- **T16.2** — Emit all event kinds from spec.
- **T16.3** — `outputSha256(events, finalState)`.
- **T16.4** — Golden match fixtures (`fixtures/*.json`: Pebble vs
  Drifter, Drifter vs Breeder, Swarm-Mind vs Reaper — per
  `19-STARTER-BOTS-AND-LIBRARY.md` § 5).
- **T16.5** — CI test: replay hash matches golden.

### 16.3 Sub-tasks
1. `EventLog` already exists in `events.ts`; verify completeness.
2. Compute SHA-256 deterministically.
3. Save first deterministic match output to `fixtures/`.
4. Add CI test: re-run + hash must match.

### 16.4 Definition of done
- Every event kind from `11-REPLAY-FORMAT.md` § 4 is emitted somewhere.
- Golden hash test passes in CI.
- Re-running with same seed produces identical JSON.

### 16.5 AI agent context
```
Phase 14: Replay & Golden Tests.

Spec:
- spec-kit/11-REPLAY-FORMAT.md (event kinds, hash)

Implement (in /simulator/src/replay.ts):
- outputSha256(events, finalState)
- Golden fixture loader
- Vitest golden test

Tests:
- Run golden fixture; hash matches
- Same seed → same hash byte-for-byte

Acceptance: golden test passes in CI.
```

---

## 17. Cross-cutting tools

These live alongside every phase:

| Tool | Purpose | Owner |
|---|---|---|
| `pnpm lint` | ESLint with custom rule | Phase 01 |
| `pnpm typecheck` | `tsc --noEmit` per package | Phase 01 |
| `pnpm test` | Vitest run | Phase 01 |
| `pnpm test:watch` | Vitest watch | Phase 01 |
| `simulator/test/fixtures/` | Golden matches | Phase 14 |
| `simulator/.eslintrc.cjs` | Bans forbidden APIs | Phase 01 |

---

## 18. Using this plan with AI agents

### 18.1 Recommended workflow

1. Pick the next phase to work on (lowest number with all deps done).
2. Open `spec-kit/20-IMPLEMENTATION-PLAN.md` at the relevant section.
3. Read the **spec refs** in `§ X.5 AI agent context` first.
4. Read the prior phases' code (they're the dependencies).
5. Use the **AI agent context** block as the prompt for your coding
   agent (Claude, GPT, etc.). Add any project-specific notes on top.
6. Verify the **Definition of done** before moving on.

### 18.2 Master prompt template

```
You are an AI coding agent implementing Phase NN of ForgeBots —
[PHASE TITLE].

Spec you MUST read:
- spec-kit/[DOC].md
- spec-kit/[DOC].md

Prior phases you depend on (read their code first):
- simulator/src/[FILE].ts

Acceptance:
- pnpm test passes
- [PHASE-SPECIFIC ACCEPTANCE]

You MUST NOT:
- Touch UI/UX code
- Add forbidden APIs (Math.random, Date.now, fetch, fs)
- Modify Phase 0X (later phases) — work strictly within your scope
- Introduce circular imports between simulator/src modules
```

### 18.3 Anti-patterns to reject

- ❌ Skipping ahead (e.g. implementing Phase 11 before Phase 07).
- ❌ Adding UI to test logic (use plain vitest).
- ❌ Mixing Phase 14's golden tests into Phase 10's match driver.
- ❌ Coupling phases via shared mutable state (use immutable snapshots).
- ❌ Writing the server before Phase 14 (replay format is the contract).

---

## 19. After all 14 phases

Once the engine/logic/physics stack is green:

- **Phase 15+ (deferred, separate plan):** server, API, DB, auth.
- **Phase 20+ (deferred, separate plan):** Godot client, UI/UX.
- **Phase 30+ (deferred, separate plan):** polish, audio, juice, art.

The MVP spec kit (`00-18`) plus this plan (`19-20`) is the complete
contract for the engine work. The client and server are separate
plans because they have separate teams (in the v0.3+ scaling case)
and separate release cadences.
