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
- `src/robot/` — Phase 4 task 2 (23 § 7.2): the parts catalog, chassis
  aggregation and robot state.
  - `parts-catalog.json` — the 16-part MVP catalog as DATA (20 T03.3,
    the "parts catalog JSON" shared artifact of 23 § 2); `parts.ts` is
    its schema and accessor: `parseCatalog` validates every row at load
    (ids from the tier-2 `PART_ID` map, categories, stack limits,
    per-kind effects), `aggregate` derives `ChassisStats` with power in
    integer milliwatts (D6 — the 5 W draw is 5000, never 0, T6), hull HP
    floored from mass x 1.5 (04 § 3.1), sensors best-range, weapons in
    design order; `validateChassis` enforces the six chassis contracts
    (8 slots, unknown ids, per-part stack limits, one drivetrain,
    ≤ 50 kg, ≤ 80 W signed sum per D6) and reports every issue, not
    just the first. Documented decisions: hover unit top speed set to
    Mk-1 parity (the spec gives no number); stacking allowed exactly
    where the spec defines a combination rule (weapons per 04 § 4.2,
    shield sum per D7, storage, generators) and forbidden where it does
    not (one drivetrain, one constructor).
  - `design.ts` — `Design`/`Chassis`/`ChassisStats`, `CHASSIS_LIMITS`
    (the G4 contracts in one owner, including D12's 1-3 designs per bot)
    and `validateDesignList`.
  - `robot.ts` — `Robot` state, `spawnRobot` (validate at the boundary,
    full hull/shield/energy spawn state per 20 Phase 09, one rng-int
    stream per robot identity via `createBotRng`, D5), `snapshotRobot`
    (the 11 § 4 scalar view in wire millimetres, `hp` = hull + shield
    per 04 § 4.1, ids `p1.<design>.<index>`).
- `src/arena/` — Phase 4 task 1 (23 § 7.1): the world.
  - `geometry.ts` — `buildArena(cfg, seed)`: 200 m x 200 m in Q16.16
    (the DoD regression), 0.5 m perimeter walls, 8 pillars on the 3 x 3
    cell lattice with the centre cell empty (exact integer lattice
    arithmetic — pillar positions pinned), 12 perimeter spawn points
    with a seed-derived Fisher-Yates order; `clampToArena`,
    `isInWall`, `isInsidePillar` (strict overlap: touching is legal),
    and `resolvePillarOverlap` with an exact integer radial push whose
    away-from-zero rounding cannot land a raw short of the boundary.
    Documented decisions: pillar radius 2000 mm (D15 names none);
    build-time draws use a dedicated matchRng so they can never perturb
    the runtime per-tick stream (D5).
  - `biomass.ts` — the field of 400 x 1 kg cells (D15) with the
    cluster rule of 23 § 7.1 / legacy/02 § 6 req 4: initial placement in
    40 seeded clusters (10 cells within a 5 m jitter), and respawn as a
    FIFO queue of biomass UNITS, each returning 300 ticks after
    depletion to a free slot IN ITS REGION (a 10 x 10 grid of 20 m
    squares). Unit population per region is conserved, so a returning
    unit always finds a free slot, nothing is cancelled or overwritten,
    and the field never leaks or creates biomass. `nearestAvailable`
    gives perception/ its future food() query shape: inclusive boundary,
    exact squared comparison, lowest index on ties.
- `src/math/vec2.ts` — gains `distanceSquared` (exact bigint raw², the
  saturation-free primitive nearest-within-range queries compare on).
- `src/combat/` — Phase 4 task 3 (23 § 7.3): hitscan, grenades,
  shield-first damage, death, bounty — with the friendly fire decision
  of 23 § 7.3 / legacy/02 § 6 req 10 adopted and implemented: **splash
  on (side-blind, thrower included), aimed off (rays only ever see the
  other side; allies neither block nor bleed)**. Needs ratifying in
  `22-DECISIONS.md` (noted for the owner).
  - `damage.ts` — `applyDamage` (shield first, overflow to hull, hull ≤ 0
    is death, hull clamps at 0 while the event reports the full overflow,
    D7), `killRobot` and the 04 § 6 bounty `min(10, victim carry)` clamped
    to the killer's remaining capacity, paid only to a living killer other
    than the victim; the victim's carry is lost with the corpse, never
    spilled back into the field. Structural `Damageable` — robot/Robot
    satisfies it without a cross-context import (06 § 5.2).
  - `weapons.ts` — `tickWeaponCooldowns` (recovery floored at 0, ready
    again exactly at cooldown ticks after firing: blaster 1 Hz, heavy
    0.5 Hz, grenade 1/6 Hz), `resolveAttacks` (attackers in spawn order,
    weapons in design order, a miss still consumes the cooldown), the
    hitscan raycast comparing exact BigInt products against
    range·65536 and radius·65536 (the perp 500 mm / proj 30 000 mm
    boundaries are exact, T5), and `GrenadeVolley` — one-exact-division-
    per-tick interpolation (no drift, landing exact on the last tick),
    contact detonation within 500 mm of any living robot but the
    thrower, inclusive 12 000 mm splash, fuse 60 ticks. Documented
    decisions: throw range 24 000 mm = 2× splash (the thrower stands
    clear of its own blast at full range, and any target that closes
    inside the splash still punishes it); the 500 mm hit radius is
    combat's own copy of D15's collision radius (the import rule forbids
    combat → arena); a grenade outlives its thrower.
  - `integration.test.ts` — the Phase 5 wiring contract proven now: 20
    Phase 12.3's order (cooldowns → attacks → volley → vitality), a
    shot's `to_shield > 0` triggering `noteShieldDamage`, and a robot
    killed mid-tick stopping metabolising the same tick.
- `src/vitality/` — Phase 4 task 4 (23 § 7.4): the energy pool, shield
  regen, starvation.
  - `energy.ts` — the D6 milliwatt accumulator exactly: each tick adds
    net power (integer milliwatts) to a remainder, floor-divides by 60,
    keeps the remainder in [0, 60) — a 5 W draw costs 83 milli-units on
    tick 1 (the T6 regression against `floor(5/60) = 0`), a 10 W
    reactor banks 167/166/167 with no drift, clamps at
    [0, energyMax × 1000] clear the remainder (no banking overproduction
    or unserviced demand), and the starvation chain runs D6's rules:
    pool 0 → emergency conversion min(10, carry) biomass at the floored
    2:1 ratio, still empty → death by `starvation` with the cause
    literal this context owns. Structural `EnergizedRobot`.
  - `shields.ts` — regen with the same carried-remainder technique on a
    milli-HP bank (1 HP crystallises per 60 000 milli-HP-ticks: Light
    1 HP/s, Heavy 0.5 HP/s never floors to 0, stacks average exactly),
    the D7 suppression window (shield damage via `noteShieldDamage`
    pauses regen for exactly 60 ticks; the countdown decrements on
    suppressed ticks; the bank survives damage — production pauses,
    storage does not) and no banking at a full pool. Structural
    `ShieldedRobot`.
- `src/robot/robot.ts` — extends with the runtime state combat/ and
  vitality/ drive (the field names are the cross-context contract): the
  stable replay `id`, per-fitted-weapon `weaponCooldowns`, the
  `energyMilli` pool + `energyRemainder` accumulator (+ spawn-derived
  `energyMaxMilli`), the shield regen bank and suppression counter, and
  one cooldown slot per `stats.weapons` entry, all starting neutral at
  spawn.
- `src/robot/parts.ts` — hardens the catalog schema: weapon
  `damagePerHit`, `cooldownTicks`, `rangeMm` and `splashRadiusMm` must
  be ≥ 1 (a zero-cooldown weapon fires every tick and a zero-damage hit
  is a phantom event — catalog bugs, rejected at load, G4).

## Commands

```
pnpm install
pnpm lint          # includes the determinism rules
pnpm typecheck
pnpm test
pnpm test:coverage # 90/90 unit floor
```
