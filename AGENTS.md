# AGENTS.md

Rules for writing code in ForgeBots. They apply to `simulator/`, `server/`, `client/`, `web/` and `tools/`.

## Ground rules

- **The spec decides behaviour; this file decides how it is written.** Before implementing, read the relevant `spec-kit/` section and `spec-kit/22-DECISIONS.md`. If it is still ambiguous, stop and ask. Never settle a spec question in code.
- **On conflict, the spec wins on behaviour and this file wins on structure and style.** Follow this file, and name the spec section that needs updating in your PR. Never diverge silently.
- **Find before you create.** Locate the file that already does the job and change that one (rule 14).
- **A failing check is fixed in code, never silenced.** No `eslint-disable`, no lowered thresholds, no edited golden hashes, no widened bounds (G4).

Known stale spec text, pending the owner's approval to edit: `09-AI-DSL.md § 6` (four-file VM split) and `20-IMPLEMENTATION-PLAN.md` Phase 04 (four-file compiler split). `execution/vm.ts` and `program/compiler.ts` are each one file, because each is one responsibility.

## Stop and ask before

- Editing a golden fixture, an `output_sha256`, or `sim_version`.
- Lowering a coverage floor, a speed budget, or a lint rule.
- Editing anything in `spec-kit/`. Propose the change in the PR; the owner approves it.
- Adding a cross-context import. It usually means a published interface is missing.
- Touching `execution/` to support a new part, weapon or sensor. Adding one must not need it.
- Installing a skill from the excluded list (see Skills).

## Commands

```sh
pnpm lint            # § 0 rules, determinism rule, dependency rule
pnpm typecheck
pnpm test            # unit tier only; each test under 100 ms
pnpm test:coverage   # per-module floors (§ 4)
```

Golden and e2e tiers run in CI. Run the narrowest check while iterating, and all four before you call the work done.

## Repo map

```
spec-kit/                      source of truth for behaviour; 22-DECISIONS.md settles ambiguity
spec-kit/examples/golden-seeds.json
simulator/src/                 deterministic core, one directory per bounded context (§ 6)
simulator/test/fixtures/       golden fixtures
server/src/domain/             application + domain, no framework imports
server/src/db/  http/          infrastructure adapters; main.ts is the only composition root
client/                        Godot: ui/ → logic/ → net/, plus theme/ and i18n/{locale}.arb
web/  tools/                   same rules apply
.opencode/skills/              installed skills (see Skills)
```

---

## 0. Hard rules

Rules marked **lint** fail the build. Rules marked **review** have no checker named here. Nothing will stop you, so police them yourself before you finish.

| # | Rule | Check |
|---|---|---|
| 1 | No hardcoded colours. Hex/rgb literals live only in `client/theme/`. | lint `no-hex-colour` |
| 2 | No hardcoded themes. No inline style or format literals in logic; one owned theme resource per platform. | review |
| 3 | No hardcoded user-facing strings. Every string a player reads comes from `t("key")` → `client/i18n/{locale}.arb`. | lint `no-inline-ui-string` |
| 4 | No hardcoded domain strings at call sites. Event kinds, part IDs, DSL builtins, channel names and status values are a const map or enum in the one module that owns them. | review; fx-table test (`11-REPLAY-FORMAT.md § 4`) |
| 5 | No god file. Split only when a file has two responsibilities, never because it got long (§ 5). | review |
| 6 | No magic numbers. Use a named constant or a balance value (see Numbers). | review |
| 7 | No metadata in comments: no `@param`, `@returns`, `@throws`, `@author`, `@since`, `@deprecated`, no type annotations. The signature carries them. | review |
| 8 | No `TODO`, `FIXME`, `HACK` or `XXX`. Work items live in the issue tracker. | review |
| 9 | No commented-out code. Delete it (G9). | review |
| 10 | No redundant comments. A comment that restates the next line is deleted. | review |
| 11 | Delete an obsolete comment in the same commit that makes it untrue. Do not mark it or date it. | review |
| 12 | DDD contexts and clean architecture, expressed through OOP. Dependency rule in § 6. | lint `no-restricted-imports` |
| 13 | No floats in `simulator/src/**` (`10-DETERMINISM.md § 2.2`). No exceptions. | lint `no-restricted-syntax` |
| 14 | Reuse and modify. Never create a near-duplicate of an existing file (§ 5). | review |

### Strings: three tiers (rules 3 and 4)

| Tier | What | Where it lives |
|---|---|---|
| 1. User-facing | Anything a player reads: labels, tooltips, errors, push copy, mission goals | `client/i18n/en.arb`, fetched with `t()`. Never in code. |
| 2. Cross-boundary domain | Event kinds (`"shot"`), part IDs (`"blaster"`), DSL builtins (`"radar"`), push channels, match statuses | A `const` map or `enum` in the one module that owns the concept. Imported at call sites, never re-typed. |
| 3. Local and obvious | Internal, single-use, self-evident | Inline is fine. |

Rule 4 exists because replay event kinds were once string literals in the simulator, the fx table and the client. Adding a kind meant editing three files and hoping.

### Numbers (rule 6, G25, G35)

| Kind | Where it lives |
|---|---|
| Fixed by the spec: `TICKS_PER_SECOND`, the 1000-cycle cap, the 64-slot stack, the 50 kg / 80 W chassis limits | A named constant in the module that owns the concept. Never widen it (G4). |
| Tunable in a balance patch: damage, range, cost | A `balance_versions` row (or balance JSON), loaded at the composition root and passed in as plain data. Never in source, never read from inside `simulator/`. |

If a number would change in a balance patch, it is balance data.

---

## 1. Comments

Rules 7 to 11 say what to delete. What to write is the *why*, and only when the code cannot show it.

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

## 2. Names (N1 to N7)

- **N1** Descriptive names. `x`, `data`, `tmp`, `handle`, `process` are banned outside a 3-line scope.
- **N2** Name for what the thing is at this level: `Robot`, not `Entity` and not `ScoutRobotWithRadar`.
- **N3** Use the project vocabulary below. `design`, not `type`. See `00-OVERVIEW.md § 7`.
- **N4** If a reader could attach two meanings, rename.
- **N5** Name length matches scope. A 3-line local may be `i`; a module export may not.
- **N6** No encodings in names: `matchIdx`, `robotList`, `isNotDead`.
- **N7** A name says what a call consumes, mutates or discards: `runVmAndDiscardActuators` (burns the tick), `enqueueNotificationForQuietHours`.

### Vocabulary (N3 is not optional)

The spec once had four meanings of "slot" and three of "bot" (`22-DECISIONS.md` D12). A wrong term in code is a bug.

| Term | Means | Never means |
|---|---|---|
| `bot` | a saved loadout (1 to 3 designs) | a robot in a match |
| `design` | one chassis + one program | a robot type, as in Grobots |
| `robot` | one spawned instance in a match | the player's account |
| `partSlot` | one of 8 hardware positions | a saved-bot allowance |
| `botSlot` | how many saved bots fit in an account | a hardware position |

---

## 3. Tests (T1 to T9)

- **T1** Test everything that could break. Coverage floors are in § 4.
- **T2, T8** Use `pnpm test:coverage`. Low coverage on a failing path means the bug is somewhere you were not looking.
- **T3** A one-line function still gets a test.
- **T4** `.skip` and `it.todo` need a why-comment stating what is ambiguous. A skip with no reason is a defect. `.only` is never committed.
- **T5** Every cast, clamp, limit and threshold gets an exact-edge test.
- **T6** A bug fix ships with a test that fails on the old code. Bugs that shipped without one:
  - A starter bot measured `(dist 0 0 dx dy)` from the arena origin instead of the robot. A far-corner boundary test catches it; a smoke test does not.
  - `floor(power / 60)` made every part under 60 W free. The regression test is one line: a 5 W draw is measurably non-zero.
  - A starter bot built children only in the branch where it had no biomass. Only an integration test with an inventory assertion finds it.
- **T7** Three similar failures are one missing abstraction, not three bugs.
- **T9** Unit tests run in under 100 ms. This applies to the unit tier only.

---

## 4. Test tiers

| Tier | Scope | Budget | Runs on | Coverage floor |
|---|---|---|---|---|
| unit | one module, no I/O, no tick loop | < 100 ms | pre-commit | 90 % lines, 90 % branches |
| integration | several modules, or one full match | < 3 s | PR | 80 % on touched paths |
| golden | fixed seed → fixed `output_sha256`, 1500 ticks | seconds | PR, on Linux, macOS and Windows | none; the hash is the assertion |
| e2e | Godot scene against a local API | minutes | nightly | none |

- Only unit tests run in the pre-commit hook. Golden tests are CI-only (`10-DETERMINISM.md § 5`, `20-IMPLEMENTATION-PLAN.md` Phase 14).
- Put a new test beside the existing tests of its tier.
- A module below its floor fails the build.
- Golden fixtures live in `simulator/test/fixtures/`; seeds in `spec-kit/examples/golden-seeds.json`. Review fixture hashes like source. Editing one to make a build pass falsifies the result. A changed hash is either a bug or a deliberate `sim_version` bump.

---

## 5. Reuse and modify (rule 14), and file size

If a file already does a job, **change that file**. Do not create a second file that does almost the same job. A near-duplicate is a fork nobody asked for: the next bug fixed in one copy stays live in the other.

| Situation | Do this |
|---|---|
| Same function, different bound or threshold | Modify the existing file; pass the bound in |
| Same shape plus one more case | Add the case to the existing `switch` or map |
| A second caller wants different data | Modify it; narrow what it returns |
| A genuinely different responsibility | New file, and the old one stops doing that work |

Length is a prompt to look, not a reason to split. Around 400 lines of production code (non-blank, non-comment), ask whether the file has two responsibilities.

- **Yes:** split along a seam that already exists in the spec, not an arbitrary one.
- **No:** leave it. A 440-line file with one responsibility is correct. A 240-line file that exists because someone avoided modifying a 400-line one is a violation.

| Symptom | Extract to |
|---|---|
| Two responsibilities | Two modules, one per responsibility |
| A type used elsewhere | Its own `types.ts` |
| A long `switch` on a discriminant | Polymorphic implementations behind an interface (G23) |
| Data only some callers need | A narrower public interface (G8) |

---

## 6. Architecture

DDD bounded contexts and clean architecture, expressed through OOP. The tree is `06-ARCHITECTURE.md § 2`, the import rule is `06 § 5.2`, and server port layering is `06 § 5.3`.

### `simulator/src/` contexts

| Context | Owns |
|---|---|
| `math/` | Shared value types. Not a context; the only thing every context may import |
| `arena/` | Arena geometry, walls, pillars, biomass cells, spawn points |
| `robot/` | Robot state, Design, Chassis, Parts catalog, `aggregate` |
| `program/` | Tokenizer, parser, AST, IR, lowering, verifier, cycle estimate, math builtins |
| `execution/` | The sandbox: frame, interpreter, dispatch, `runVm` |
| `perception/` | `radar`, `scan`, `food`, `ally`, `enemy`, `self.*`, `time`, `rng-int` |
| `actuation/` | `move`, `move-at`, `aim`, `fire`, `eat`, `build`, `say`, throttle conversion |
| `combat/` | Hitscan, grenades, shield-first damage, death, biomass bounty |
| `vitality/` | Energy pool, milliwatt drain, shield regen, starvation |
| `match/` | Tick loop, ordering, win conditions. The one context allowed to orchestrate the rest |
| `telemetry/` | EventLog, replay document, `outputSha256` |

Contexts talk through values or published interfaces, never through each other's internals.

### Server and client

- `server/src/domain/`: `accounts/`, `roster/`, `scheduling/`, `seasons/`, `engagement/`, `replayLibrary/`, `notifications/`, `commerce/`.
- `client/` (Godot): `ui/` (scenes, no logic) → `logic/` (pure, no Node access) → `net/` (adapters). The client never imports `simulator/` (`22-DECISIONS.md` D3).

### Dependency rule

```
context ──▶ math/ and its own directory. Nothing else.
app     ──▶ domain
infra   ──▶ app, via ports declared by app
```

- A context module imports no framework: no Fastify, no Drizzle, no Godot, no `Date.now`, no `Math.*`.
- `server/src/domain/` never imports `db/` or `http/`. It declares ports (`EloRepositoryPort`, `MatchQueuePort`, `BalanceVersionPort`) and `db/` implements them.
- `main.ts` is the only composition root and the only place that reads config (G35).
- Coupling test: if adding a part, weapon or sensor forces a change in a file, that file is too tightly coupled. Adding a part must not touch `execution/`.

### Classes and functions

Use a class where there is state to protect or a contract to program against. Use a pure function for pure computation. Do not build a class hierarchy to host free functions.

A `Robot` base class must not know that a `ConstructorPart` or a `BlasterPart` exists. An `if (part instanceof BlasterPart)` in the damage path violates G7, G14 and G23 at once. `execution/` dispatches to `perception/` and `actuation/` through published entry points and never learns what a sensor is.

### Simulator determinism

- Fixed-point integers only (rule 13).
- No `Date.now`, `Math.*`, ambient RNG or module-level clock. Take them as parameters (G22).
- A change that alters a golden `output_sha256` is either a bug or a deliberate `sim_version` bump.

---

## 7. Code quality (G1 to G36)

**Behaviour and precision**
- **G2** Implement the expected behaviour. If the spec says "abandon the tick", abandon it; do not half-run it.
- **G3** Handle every boundary: each clamp, limit, threshold and empty case.
- **G4** Do not override safeties. Never widen a spec bound to make a test pass.
- **G21** Understand the algorithm. If you cannot explain why it is correct, it is not written yet.
- **G26** Be precise. No plain `number` where a fixed-point integer is meant; no bare integer where a tick count is meant.
- **G32** Do not be arbitrary. A chosen value is a named constant with a reason.

**Structure**
- **G5** No duplication. Two copies of a rule are two rules; the dist-from-origin bug shipped twice.
- **G25** Named constants, not magic numbers (see Numbers).
- **G30** A function does one thing.
- **G6, G34** One abstraction level per function. Do not call a domain rule from a loop that also does bookkeeping. Do not let `verify()` both walk the AST and format user-facing errors.
- **G17** Code lives in the module of the thing it operates on.
- **G31** Make temporal coupling explicit. If B must follow A, one function runs both, or the types forbid the wrong order.
- **G27** Prefer a type or module boundary that makes the error impossible over a lint rule that flags it.
- **G1** One language per source file. In production code, keep SQL, DSL source and markup out of TypeScript string literals; they live in their own files.

**Interfaces and coupling**
- **G8** Export only what another module calls. Default to module-private.
- **G13** No artificial coupling. Two modules must not both lean on a shared "utils" module to avoid depending on each other.
- **G22** Make dependencies physical. Take clocks, RNGs and collaborators as parameters, never ambient singletons.
- **G35** Only the composition root reads `process.env`, `.env` or balance data.
- **G36** Law of Demeter. No `a.getB().getC().getD()`.
- **G14** No feature envy. A method that uses another object's fields more than its own is in the wrong class.
- **G7** Base classes do not know their children.
- **G23** Prefer polymorphism to if/else. A growing `switch` on part kind or event kind is a missing interface.
- **G15** No selector arguments on internal APIs: a flag that switches behaviour means two methods. The DSL's published language is exempt (`build 0`, `aim angle`), because it is a specified external contract.
- **G18** A method that ignores `this` is a function. Behaviour that depends on an object's state is a method on that object.

**Expression**
- **G16** No obscured intent. Clever is not the goal.
- **G19** Explanatory variables: `energyCostPerTickMilliunits`, not `e`.
- **G20** Function names say what they do: `runVmAndDiscardActuators`, not `handleVm`.
- **G28** A condition that appears twice becomes one named predicate.
- **G29** Name a predicate for the state you branch on, and do not double-negate: `isStarving()`, not `!hasFood` or `hasNoFood`.
- **G33** Parse, validate and convert once, at the edge.

**Housekeeping**
- **G9** Delete dead code: unreachable, unused, superseded. A deprecation shim needs a caller and a removal date in the issue tracker.
- **G10** Declare variables next to their use.
- **G11** One way to do a thing in this codebase.
- **G12** Remove clutter: dead parameters, empty abstractions, single-use indirection.
- **G24** Follow conventions with one enforced formatter per language: ESLint + Prettier for TypeScript, `dotnet format` for C#, the Godot style guide for GDScript, PEP 8 for Python tooling.

---

## 8. Before you finish

- [ ] `pnpm lint` and `pnpm typecheck` pass
- [ ] `pnpm test` is green and inside budget
- [ ] `pnpm test:coverage`: every touched module meets its floor
- [ ] Golden hashes unchanged, or `sim_version` deliberately bumped with approval
- [ ] No new file duplicates an existing one; each new file has a *different* responsibility (rule 14)
- [ ] No file was split or created just to stay under 400 lines
- [ ] No new UI string literal, magic number, or comment you would not write today
- [ ] Every bug fixed has a test that fails on the old code (T6)
- [ ] Dependency rule holds: no domain → framework import
- [ ] Behaviour changed? The spec change is proposed in this PR

---

## Skills

`.opencode/skills/` holds 26 skills from `gamedev-skills/awesome-gamedev-agent-skills`: Godot 4 plus the cross-engine disciplines this project uses. Choose from the `skill` tool's own list; it is short enough to read directly.

Do not install:

| Skill | Why not |
|---|---|
| `game-ai` | Contradicts the DSL in `spec-kit/09-AI-DSL.md`. |
| `ai-behavior-trees-utility-ai` | `22-DECISIONS.md` D4 rules out behaviour trees in favour of the tree-walking IR VM. |
| `router` | Its routing table points at 162 skills that are not installed here. |
| Unity, Unreal, Roblox, Bevy, pygame, Phaser, PixiJS, three.js | The project does not use these engines. |
