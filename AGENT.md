# AGENT.md

Coding rules for ForgeBots. Applies to every file in `simulator/`,
`server/`, `client/`, `web/` and any tooling under `tools/`.

**Spec is upstream of code.** `spec-kit/` is the source of truth for
behaviour. This file governs *how* that behaviour is expressed. If the
two disagree, the spec is wrong and gets fixed — do not silently
diverge. If a spec is ambiguous, the answer lives in
`spec-kit/22-DECISIONS.md`; read it before implementing anything.

---

## 0. Non-negotiables

These fail CI. No exceptions, no "temporary" comments.

| # | Rule | How it is checked |
|---|---|---|
| 1 | **No hardcoded colours** | No hex/rgb literal outside `client/theme/`. Lint: `no-hex-colour` |
| 2 | **No hardcoded themes** | No inline style/format literals in logic. One owned theme resource per platform. |
| 3 | **No hardcoded user-facing strings** | No string literal in a UI position. Must come from `t("key")` → `client/i18n/{locale}.arb`. Lint: `no-inline-ui-string` |
| 4 | **No hardcoded domain strings at call sites** | Event kinds, part IDs, DSL builtins, channel names, status values live in one owning module as a const map or enum. |
| 5 | **No god file** | A file is split only when it has two responsibilities, never because it got long. See § 5. |
| 6 | **No magic numbers** | Named constants, or values read from a `balance_versions` row. |
| 7 | **No metadata in comments** | No `@param`/`@returns`/`@author`/`@since`/type annotations in comments. The signature carries those. |
| 8 | **No TODO/FIXME/HACK/XXX in code** | Work items live in the issue tracker. A TODO is a comment that will go stale, and stale comments are worse than none. |
| 9 | **No commented-out code** | It is dead code. G9 says delete it. |
| 10 | **No redundant comments** | A comment that restates the line below it is deleted, not kept. |
| 11 | **Obsolete comments are deleted in the same commit** | Not marked, not dated, not left with a "TODO remove". |
| 12 | **DDD domains + clean architecture, expressed through OOP** | See § 6. Dependency rule is enforced by lint. |
| 13 | **No floats in `simulator/src/**`** | Lint: `no-restricted-syntax`. Zero exceptions (`10-DETERMINISM.md § 2.2`). |
| 14 | **Reuse and modify. Never create a near-duplicate.** | If a file already does the job, change that file. See § 5. |

### The three-tier string rule (rules 3 and 4)

| Tier | What | Where it lives |
|---|---|---|
| **1 — User-facing** | Anything a player reads: labels, tooltips, errors, push copy, mission goals | `client/i18n/en.arb`, fetched via `t()`. Never in code. |
| **2 — Cross-boundary domain** | Event kinds (`"shot"`), part IDs (`"blaster"`), DSL builtins (`"radar"`), push channels, match statuses | A `const` map or `enum` in the **one** module that owns the concept. Imported at call sites. Never re-typed inline. |
| **3 — Local and obvious** | Internal, single-use, self-evident | Inline is fine. |

Rule 4 exists because of a real bug: replay event kinds were string
literals in the simulator, the fx table and the client. Adding a kind
meant editing three files and hoping. `11-REPLAY-FORMAT.md § 4` now
requires a test that fails if a kind has no fx entry.

---

## 1. Comments

| Rule | Statement |
|---|---|
| **No metadata in comments** | No `@param`, `@returns`, `@throws`, `@author`, `@since`, `@deprecated`, or type annotations. The type system is the metadata. If a tool needs it, generate it. |
| **Delete obsolete comments immediately** | A comment that is no longer true is removed in the commit that made it untrue. Not flagged for later. |
| **No redundant comments** | Never restate the code. `// increment i` above `i++` is deleted. |
| **(implied) Comment the *why*, never the *what*** | A comment earns its place only when the reasoning is not visible in the code. |

What a good comment looks like here:

```ts
// A 5 W draw must cost 83 milli-units per tick, not 0.
// floor(5 / 60) is 0, which made every sub-60 W part free.
const energyCostPerTick = (netPowerMilliwatts / TICKS_PER_SECOND) | 0;
```

Not:

```ts
// divide watts by 60
// @param netPowerMilliwatts the power in mW
const energyCostPerTick = (netPowerMilliwatts / TICKS_PER_SECOND) | 0;
```

---

## 2. Names (N1–N7)

| # | Rule | Test |
|---|---|---|
| **N1** | **Choose descriptive names.** | `x`, `data`, `tmp`, `handle`, `process` are banned outside a 3-line scope. |
| **N2** | **Right abstraction level.** | Name for what it is *at this level*. `Bot`, not `Entity` and not `ScoutBotWithRadar`. |
| **N3** | **Use standard nomenclature.** | `robot` not `bot` where both exist — the spec reserves "bot" for a saved loadout. `design` not `type`. See `00-OVERVIEW.md § 7`. |
| **N4** | **Unambiguous names.** | If a reader could reasonably attach two meanings, rename. |
| **N5** | **Name length matches scope.** | A 3-line local may be `i`. A module export may not be. |
| **N6** | **No encodings.** | No `botX`, `matchIdx`, `isNotDead`, `robotList`. The type says it. |
| **N7** | **Names describe side effects.** | If calling it changes or consumes something, the name says so. |

**N3 is not optional in this repo.** The spec had four meanings of
"slot" and three of "bot". That is now fixed in
`22-DECISIONS.md D12`, and the vocabulary is load-bearing:

| Term | Means | Never means |
|---|---|---|
| `bot` | a saved loadout (1–3 designs) | a robot in a match |
| `design` | one chassis + one program | a robot type in Grobots |
| `robot` | one spawned instance | the player's account |
| `partSlot` | one of 8 hardware positions | a saved-bot allowance |
| `botSlot` | how many saved bots fit in an account | a hardware position |

**N7 examples from this codebase:**

```ts
runVm(state, ir)                    // returns actuators; name doesn't say so
runVmAndDiscardActuators(state, ir) // says it burns the tick

scheduleForQuietHoursWindows(now)   // side effect: enqueues
```

---

## 3. Tests (T1–T9)

| # | Rule | Enforcement |
|---|---|---|
| **T1** | **Test everything that could break.** | Coverage thresholds per module (§ 4). |
| **T2** | **Use coverage tools.** | `vitest --coverage`, enforced in CI. |
| **T3** | **Don't skip trivial tests.** | A one-line function is still a function. |
| **T4** | **Ignored test = ambiguity question.** | `.skip` / `.only` / `it.todo` require a written answer to: what is ambiguous? A skipped test with no reason is a defect. |
| **T5** | **Test boundary conditions.** | Every cast, clamp, limit and threshold gets its exact-edge test. |
| **T6** | **Exhaustively test near bugs.** | If you fixed a bug, the fix ships with a test that fails on the old code. |
| **T7** | **Look for patterns in failures.** | Three similar failures are one missing abstraction, not three bugs. |
| **T8** | **Check coverage when debugging.** | Low coverage on the failing path means the bug is somewhere you weren't looking. |
| **T9** | **Tests must be fast (< 100 ms each).** | Scoped to **unit** tests. See § 4 for the tag scheme. |

**T6 is the rule that would have caught the worst bugs in this spec.**
Non-examples from the starter bots, all of which shipped broken:

- `(dist 0 0 dx dy)` measured from the arena origin instead of the bot.
  A boundary test at the far corner catches it; a smoke test does not.
- `floor(power / 60)` made every part under 60 W free. The regression
  test is one line: *a 5 W draw is measurably non-zero.*
- A bot that built children only in the branch where it had no biomass.
  Only an integration test with an inventory assertion finds this.

---

## 4. Test tiers, speed budget, and coverage

| Tier | Scope | Budget | Runs on | Coverage floor |
|---|---|---|---|---|
| **unit** | one module, no I/O, no tick loop | **< 100 ms** (T9) | pre-commit | 90 % lines, 90 % branches |
| **integration** | several modules, or one full match | < 3 s | PR | 80 % on touched paths |
| **golden** | fixed seed → fixed `output_sha256` | seconds (1500 ticks) | PR, on Linux/macOS/Windows | n/a (hash is the assertion) |
| **e2e** | Godot scene against a local API | minutes | nightly | n/a |

- **Unit tests are the only thing allowed in the pre-commit hook.**
  Golden tests are in CI only — `10-DETERMINISM.md § 5` and
  `20-IMPLEMENTATION-PLAN.md` Phase 14. A literal reading of T9 would
  forbid the golden tests entirely, which would remove the determinism
  guarantee. The tier table is the resolution.
- **Coverage is measured, not assumed** (T2, T8). A module below its
  floor fails the build.
- Golden fixtures live in `simulator/test/fixtures/`; seeds in
  `spec-kit/examples/golden-seeds.json`. Fixture hashes are reviewed
  like source — editing one to make a build pass is a lie told to
  production.

---

## 5. Reuse and modify (rule 14) and the 300-line cap

### The rule that outranks the line count

**If a file already does a job, you change that file. You do not create a
second file that does almost the same job.**

A near-duplicate is not an abstraction, it is a fork that nobody asked
for. It means the next bug fixed in one copy is still live in the other,
and the reader has to diff two files to learn one thing.

When you need behaviour that differs only slightly from what a file
already does — a different bound, an extra flag, one more case in a
switch — the correct move is to **extend that file** and make the
variation explicit inside it. Reach for a new file only when the
variation is a genuinely different responsibility.

| Situation | Do this |
|---|---|
| Need the same function with a different bound or threshold | Modify the existing file; pass the bound in |
| Need the same shape plus one more case | Modify the existing `switch`/map in place |
| Need it for a second caller who wants different data | Modify it; narrow what you return |
| Need a genuinely different responsibility | New file, and the existing one stops doing that work |

**The 300-line cap does not override this.** A 340-line file that owns
one responsibility is correct. A 180-line file that exists because we
refused to modify a 300-line one is not. Line count is a smell detector;
duplication is a defect.

### The cap

**Target 300 lines of production code per file**, counted as non-blank,
non-comment. Tests are governed by § 3/§ 4 instead. Exceeding it
briefly is acceptable and needs no justification. Exceeding it *to avoid
modifying an existing file* is a violation of rule 14.

When a file is long **and** has two responsibilities, split it — along a
seam that already exists in the spec, not arbitrarily.

| Symptom | Extract to |
|---|---|
| Two responsibilities | Two modules, one per responsibility |
| A type used elsewhere | Its own `types.ts` |
| A long `switch` on a discriminant | Polymorphic implementations behind an interface (G23) |
| Data that only some callers need | A narrower public interface (G8) |

**A long file with one responsibility is correct, not a violation.**

---

## 6. Architecture: DDD + clean architecture via OOP

### Bounded contexts

Each is a directory in `simulator/src/` with its own vocabulary.
Contexts do not reach into each other's internals; they communicate
through values or published interfaces. The tree is in
`06-ARCHITECTURE.md § 2`; the import rule is in `06 § 5.2`.

| Context | Owns |
|---|---|
| `math/` | shared value types — not a context, the only thing everyone may import |
| `arena/` | Arena geometry, walls, pillars, biomass cells, spawn points |
| `robot/` | Robot state, Design, Chassis, Parts catalog, `aggregate` |
| `program/` | Tokenizer, parser, AST, IR, lowering, verifier, cycle estimate, math builtins |
| `execution/` | The sandbox: frame, interpreter, dispatch, `runVm` |
| `perception/` | `radar`, `scan`, `food`, `ally`, `enemy`, `self.*`, `time`, `rng-int` |
| `actuation/` | `move`, `move-at`, `aim`, `fire`, `eat`, `build`, `say`, throttle conversion |
| `combat/` | Hitscan, grenades, shield-first damage, death, biomass bounty |
| `vitality/` | Energy pool, milliwatt drain, shield regen, starvation |
| `match/` | Tick loop, ordering, win conditions — the one context allowed to orchestrate the rest |
| `telemetry/` | EventLog, replay document, `outputSha256` |

**`server/src/domain/` — application + domain, same idea:**

`accounts/`, `roster/`, `scheduling/`, `seasons/`, `engagement/`,
`replayLibrary/`, `notifications/`, `commerce/`

**`client/` — Godot, three layers:**

`ui/` (scenes, no logic) → `logic/` (pure, no Node access) → `net/`
(adapters). The client **never** imports `simulator/`
(`22-DECISIONS.md D3`).

### The dependency rule

```
context  ──▶  math/ and its own directory. Nothing else.
app      ──▶  domain
infra    ──▶  app, via ports declared by app
```

- A context module imports **no** framework: no Fastify, no Drizzle, no
  Godot, no `Date.now`, no `Math.*`.
- `server/src/domain/` must not import `db/` or `http/`. It declares
  ports (`EloRepositoryPort`, `MatchQueuePort`, `BalanceVersionPort`);
  `db/` implements them. `main.ts` is the only composition root and the
  only place that reads config (G35).
- Violations fail lint (`no-restricted-imports`), not review.

**The test for "knows about":** if a file would need to change when a
new part, weapon or sensor is added, it is coupled too tightly. Adding
a part must not touch `execution/`.

### OOP is the default, functions the exception

Use classes where there is state to protect or a contract to program
against. Use pure functions for pure computation. Do not build class
hierarchies to host free functions.

**G7 in practice:** a `Robot` base class must not know that a
`ConstructorPart` or a `BlasterPart` exists. Polymorphism means the
caller does not branch. An `if (part instanceof BlasterPart)` in the
damage path is G23 and G14 violations at once. The same applies to
`execution/`, which dispatches to `perception/` and `actuation/`
through published entry points and never learns what a sensor is.

---

## 7. Code quality (G2–G36)

> G1 was not supplied. Numbering is preserved as given so these
> references stay stable; add G1 when you decide what it is.

### Behaviour

| # | Rule | In this repo |
|---|---|---|
| **G2** | Implement expected behavior | Do the obvious thing, not a surprising one. If the spec says "abandon the tick", the tick is abandoned — not half-run. |
| **G3** | Handle boundary conditions | Every clamp, limit, threshold and empty case is handled, not assumed away. |
| **G4** | Don't override safeties | Never widen a bound to make a test pass. The 1000-cycle cap, the 64-slot stack and the 50 kg / 80 W chassis limits are contracts. |
| **G26** | Be precise | No `number` where a fixed-point integer is meant. No `int` where a tick count is meant. |

### Structure

| # | Rule | In this repo |
|---|---|---|
| **G5** | DRY — no duplication | Two copies of a rule is two rules. The `dist`-from-origin bug appeared **twice** in the starter bots — that is G5 paying for itself. |
| **G6** | Consistent abstraction levels | All of a function's steps at the same level. Do not call a domain rule from inside a loop that also does bookkeeping. |
| **G30** | Functions do one thing | |
| **G34** | One abstraction level per function | No `verify()` that both walks the AST and formats user-facing errors. |
| **G32** | Don't be arbitrary | If a value is a choice, it is a named constant with a reason. |
| **G25** | Named constants, not magic numbers | `30000` is `BLASTER_RANGE_MM`. Balance values come from a `balance_versions` row, not from source. |

### Interfaces and coupling

| # | Rule | In this repo |
|---|---|---|
| **G8** | Minimize public interface | `export` only what another module calls. Default to module-private. |
| **G13** | No artificial coupling | Two modules do not both depend on a third "shared utils" module to avoid depending on each other. |
| **G22** | Make dependencies physical | Take what you need as a parameter. Do not reach for an ambient singleton, a global RNG, or a module-level clock. |
| **G36** | Law of Demeter | No train wrecks. A method talks to its own collaborators, not to `a.getB().getC().getD()`. |
| **G14** | No feature envy | If a method uses another object's fields more than its own, the method is in the wrong class. |
| **G7** | Base classes don't know children | Polymorphic dispatch, not `instanceof` chains. |
| **G18** | Prefer instance methods | Behaviour that needs no instance state is a function. A method that ignores `this` is a function. |

### Naming and expression

| # | Rule |
|---|---|
| **G16** | No obscured intent. Clever is not the goal. |
| **G20** | Function names say what they do. `runVmAndDiscardActuators`, not `handleVm`. |
| **G19** | Use explanatory variables. `energyCostPerTickMilliunits`, not `e`. |
| **G29** | Avoid negative conditionals. `if (hasNoFood)` over `if (!hasFood)`. |
| **G28** | Encapsulate conditionals. A condition appearing twice belongs in one named predicate. |
| **G33** | Encapsulate boundary conditions. Parse, validate and convert at the edge — once. |

### Design

| # | Rule | In this repo |
|---|---|---|
| **G23** | Prefer polymorphism to if/else | A growing `switch` on part kind or event kind is a missing interface. |
| **G2x** | **G15** — no selector arguments | A flag or mode parameter that switches behaviour means two methods. **Scoped:** this bans internal selector arguments. The DSL's *published language* may pass selectors (`build 0`, `aim angle`) because it is a specified external contract, not an internal API. |
| **G31** | Make temporal coupling explicit | If B must run after A, one function runs both, or the type makes the order impossible to violate. |
| **G35** | Config at high levels | Only the composition root reads `process.env`, `.env`, or balance JSON. Nothing below it reads configuration. |
| **G27** | Structure over convention | Prefer a type or module boundary that makes the error impossible over a lint rule that flags it. |

### Housekeeping

| # | Rule |
|---|---|
| **G9** | Delete dead code. Unreachable, unused, superseded. No deprecation shims without a removal date and a caller. |
| **G10** | Variables near usage. Declare where used, not at the top of a 200-line function. |
| **G11** | Be consistent. One way to do a thing in this codebase. |
| **G12** | Remove clutter. Dead parameters, empty abstractions, single-use indirection. |
| **G17** | Code where expected. A function lives in the module of the thing it operates on. |
| **G21** | Understand the algorithm. If you cannot explain why the code is correct, it is not written yet. |
| **G24** | Follow conventions. PEP 8 for GDScript and Python tooling. For TypeScript and C#, the equivalent enforced style (ESLint + Prettier, `dotnet format`) — the rule is *one formatter, enforced*, not a specific document. |

---

## 8. Before you open a PR

- [ ] `pnpm lint` — determinism rule and the § 0 rules pass
- [ ] `pnpm typecheck`
- [ ] `pnpm test` — unit suite green and under budget
- [ ] `pnpm test:coverage` — touched modules meet their floor
- [ ] Golden replay hashes unchanged, or `sim_version` deliberately bumped
- [ ] No new file that duplicates an existing one — every new file earns its place by a *different* responsibility (rule 14)
- [ ] No file split or created just to stay under 300 lines
- [ ] No new string literal in a UI position
- [ ] No new magic number
- [ ] No comment you would not write today
- [ ] Every bug fixed this PR has a test that fails on the old code (T6)
- [ ] Dependency rule holds: no domain → framework import
- [ ] Spec updated if behaviour changed — code is not the place to settle a spec question

---

## 9. Conflicts between this file and `spec-kit/` v0.6

### Resolved

| # | Conflict | Resolution |
|---|---|---|
| **1** | 300-line cap vs the VM (`09 § 6` said "~400 LOC"). | **The VM is one responsibility, so it is one file.** `execution/vm.ts` runs long and stays long. It was previously split into `frame.ts` / `interpreter.ts` / `builtins.ts`; that split is reverted under rule 14, because the pieces existed only to satisfy the line count. If the VM ever grows a second responsibility, it splits — for that reason, not for its size. |
| **2** | 300-line cap vs the front-end (`20` Phase 04 put tokenize + parser + errors in one `compiler.ts`). | **One `program/compiler.ts`.** Tokenize, parse, and error formatting are one responsibility: turning source into a verified IR. The earlier four-file split existed only to satisfy the line count and is reverted under rule 14. |
| **6** | DDD had no per-context boundaries in `06`. | `06 § 2` now carries the bounded-context tree; `06 § 5.2` states the import rule; `06 § 5.3` adds the server port layering. Enforceable by lint. |

### Still open — needs your ratification

**Rule 14 makes these two spec sections wrong, and they are not yet
fixed:** `09-AI-DSL.md § 6` still prescribes the four-file VM split, and
`20-IMPLEMENTATION-PLAN.md` Phase 04 still prescribes the four-file
compiler split. Both need editing to match resolutions 1 and 2 above.
Per the precedence rule at the top of this file, the spec follows this
file — but the edits are yours to approve, since they are spec changes.

| # | Conflict | Working resolution |
|---|---|---|
| **3** | T9 (< 100 ms) vs golden replay tests (seconds). | § 4 tier table: unit tests only are in the pre-commit hook; golden tests are CI-only. Ratify, or rewrite T9. |
| **4** | G15 (no selector arguments) vs the DSL's `build 0` / `aim angle`. | § 7 scopes G15 to **internal** APIs; the DSL is a specified external language, not an internal interface. Ratify, or accept the language as an explicit exception. |
| **5** | G24 (PEP 8) vs a TypeScript / C# / GDScript stack. | § 7 maps it to "one formatter, enforced" — Prettier + ESLint for TS, `dotnet format` for C#, Godot's style for GDScript. Name the configs if you want them pinned. |

### Two things I decided that you may want to overrule

- **G1 does not exist.** Your list starts at G2. Numbering is preserved
  as given so references stay stable; add G1 when you decide what it is.
- **No TODO / FIXME / HACK in code** (§ 0 rule 8). I ruled them out
  because they are the main source of obsolete comments, and
  "delete obsolete comments immediately" cannot be enforced against a
  comment that exists in order to go stale. Work items go to the issue
  tracker. Say the word if you want them back.
