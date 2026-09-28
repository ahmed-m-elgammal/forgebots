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
- `src/match/` — Phase 5 task 8.1 (23 § 8.1): the tick loop with the
  explicit total ordering, win conditions, and first-class deaths.
  - `match.ts` — `runMatch(sides, config, sink?)`: the G31 skeleton
    lives in one function (`runTick`): world (respawn, the D5 stream
    before any bot steps) → actuators (VM steps in spawn order, intent
    application: move/move-at throttle plans, aim, fire/eat flags,
    build, say) → physics (accel-limited integration, arena clamp,
    pillar pushout, construction) → combat (cooldowns → resolveAttacks →
    volley → noteShieldDamage on shield damage) → biomass (contact
    pickup within the robot radius, player eat batches, shield regen +
    milliwatt drain + emergency conversion + starvation) → events → win
    check. Records are a typed discriminated union (the shapes of
    11 § 4, robot-attributed) handed to a `MatchSink` seam — telemetry/
    (23 § 8.2) implements the replay document over it next phase; the
    snapshot cadence (tick 1, then every 30 — 11 § 4) is the loop's.
    Construction: cost = Σ part mass, paid up front from carried
    biomass, duration = cost × 30 ticks (2 kg/s), caps (4 per design,
    6 per side) count in-progress builds, a builder's death drops the
    queue. `MatchResult` carries winner/reason/duration, every tick's
    records, the 30-tick snapshots, final robot snapshots and the
    standing cell indices.
  - `winCondition.ts` — Eliminator (D18): last side with a living robot
    wins (`elimination`); both extinct on the same tick is `draw_tick`;
    at the cap more total carried biomass wins (`tick_cap_biomass`) and
    a tie — both-zero included — is `draw_tie` (legacy/02 § 3.2's
    anti-stall pressure: a hider cannot win the cap).
  - `driver.ts` — the perception bridge: the VM's `VmEnv` answered from
    the world. Self state in wire units (04 § 4.1), `time`, `rng-int`
    on the robot's own stream (D5), and the five sensors: radar (part
    range, allies included), scan (40 m/30° cone on the requested
    angle), food (5 m, no part), ally/enemy (map-wide, team filtered).
    D16 rate limiting: radar 1 Hz, scan/food 4 Hz, ally/enemy every
    tick — a rate-limited sensor holds its last reading between
    refreshes (a 1 Hz radar is up to 60 ticks stale). Option payloads
    pack both millimetre coordinates into one exact integer
    (x * 2^19 + y). Nearest queries are exact squared-BigInt comparisons
    in spawn order, lowest index on ties, inclusive boundaries. The env
    never throws (the sandbox contract). Moves to perception/ whole
    when that context is scheduled.
  - `movement.ts` — the throttle conversion until actuation/ is
    scheduled: move/move-at set a target velocity ((throttle/65536) ×
    top speed, clamped ±65536 per axis, move-at full at ≥ 1 000 mm and
    tapering to 0 at the point, zero-distance guard coasts), velocity
    approaches the target by at most topSpeed × accelPermyriad/10000/60
    per tick (top speed reached in exactly one second at base accel;
    the hover unit's +30 % spools faster), and a no-command tick decays
    velocity under the same bound — that decay is friction, so
    `ignoresFriction` is the right to keep momentum when idle. The DoD
    is pinned: no actuator exceeds the chassis top speed, ever.
  - Cross-context extensions (rule 14 — modified, not forked):
    `robot/robot.ts` gains the seam fields `weapons` and
    `carryCapacity` (a Robot is ONE object satisfying combat's
    Combatant/Damageable views), `arena/biomass.ts`'s
    `respawnDueCells` returns the cells that came back (the
    biomass_spawn records), and `vitality/energy.ts` exports
    `convertCarriedBiomass` — the one 10:5 batch arithmetic shared by
    the player-issued eat and the D6 emergency conversion (the gain
    clamps at the pool ceiling).
  - Tests: 100 in match/ (driver 32, movement 21, winCondition 16,
    match 20, construction 5, pipeline 6) plus extensions to the
    robot/vitality suites — six dimensions per
    function, and the pipeline tests assert the G31 ordering through
    public behaviour: every tick's records read as stage blocks in
    pipeline order; the world's respawn lands at deplete + 300 as the
    FIRST record of its tick in the source cell's region; the killing
    shot records a position one tick's travel (≈ 41.7 mm) past the last
    snapshot (physics before hitscan — 0 mm would mean hitscan ran
    first); a bot's rng-int sequence is identical against a 1-robot and
    a 3-robot opposing side (D5 stream separation).
- Documented decisions awaiting the owner (spec edits for approval, not
  applied): the movement model (accel bound = top speed per second,
  friction = the idle decay the hover unit ignores) — 04 § 3.2 defers
  both to "the physics phase"; build payment is up front (04 § 3.2.1
  fixes cost and rate but neither pausing nor refunds); pickup is
  contact-based within the collision radius, one cell per robot per
  tick (the DSL has no take actuator; D15 makes depleted and picked up
  one event; Mission 1's model is walking to the food); a design may
  field zero starting robots as a constructor blueprint (a side must
  still field at least one robot); `eat` clamps at the pool ceiling —
  eating with a full pool burns the batch; and 23 § 8.1's movement
  before hitscan supersedes 20 Phase 12.3's combat-first prose (the
  Phase 4 combat-then-vitality wiring is unchanged).
- `src/telemetry/` — Phase 5 task 8.2 (23 § 8.2): the replay half of the
  phase. Owns the wire vocabulary, the EventLog sink, the replay
  document and `output_sha256`; imports nothing outside itself (06 §
  5.2) — match/'s record stream reaches it through structural views
  (`views.ts`, the Damageable seam pattern: the field names are the
  contract, so `runMatch(sides, config, eventLog)` typechecks with
  neither context importing the other).
  - `eventKinds.ts` — the one enum: 17 wire kinds of 11 § 4 as a const
    map plus the `ReplayEvent` wire union (snake_case fields, `"t"`
    duplicating the tick-bucket index). `death.cause`, `eat.reason` and
    `vm_yield.reason` flow through as the strings their owning contexts
    stamped — the closed vocabularies live upstream (06 § 5.2 forbids
    one shared map).
  - `fxTable.ts` — the 16 § 2.3 declarative fx table over every kind:
    `Record<EventKind, FxEntry>` makes a missing kind a compile error,
    the fxTable test re-checks at runtime (the 11 § 4 completeness
    contract), the three spec-pinned entries are verbatim (shot →
    muzzle_sparks/blaster_fire, death → explosion/death + hitStopMs 80,
    biomass_taken → sparkles/biomass_pickup), `'none'` records a
    deliberate no-juice decision, and the juice phase (18) extends this
    table rather than forking a second one.
  - `eventLog.ts` — the MatchSink: per-tick buckets gap-filled to the
    streamable `events` array of 11 § 3/§ 5 (tick 0 empty by
    construction, `"t"` equal to the bucket index), and D10's
    change-only `move`/`aim` — emitted only when the value differs from
    the robot's last EMITTED value (the first value always passes; a
    bot re-issuing `(move 65536 0)` every tick emits one event —
    integration-pinned: 300 records in, 1 event out). Ticks arrive in
    order or the log throws; `eventsUpTo(finalTick)` is a pure read
    handing out fresh arrays. build_start/birth resolve the design NAME
    from the side lists in the config, parsing only the spec-frozen
    `p1.`/`p2.` id prefix (design names may contain dots).
  - `canonical.ts` — canonical JSON (JCS behaviour for the replay's
    value domain): keys sorted by code unit, no whitespace, integers
    only (floats, NaN, bigint, class instances and collections throw at
    the edge — a non-integer in the hash input is a determinism bug
    upstream, not a rounding question), `-0` normalised, `localeCompare`
    never touched.
  - `sha256.ts` — SHA-256 in pure integer TypeScript (shifts, rotates,
    `(a + b) | 0`; 64-bit length field split by shifts). Bit-identical
    on every platform by construction, which is the point: 8.3's golden
    hash must agree on Linux, macOS and Windows. NIST vectors +
    node:crypto cross-checks over the padding boundaries (55/56, exact
    block multiples).
  - `outputSha256.ts` — the composition of 11 § 2.1 / 10 § 5:
    sha256(seed_bytes ‖ balance_sha256_bytes ‖ canonical(final_state) ‖
    canonical(events)). Two byte encodings are pinned here: the seed is
    minimal unsigned big-endian with zero as ONE 0x00 byte, and the
    balance hash is the hex DECODED to 32 raw bytes (so the digest
    cannot depend on the server's hex casing). Seeds are uint64-
    validated; the embedded `output_sha256` is structurally excluded
    from its own input — the builder hashes the parts before the
    document exists.
  - `replay.ts` — `buildReplayDocument` assembles the full 11 § 2 shape
    (version 1, sim_version, hex seed, balance reference, both players'
    exact designs as {name, parts, code}, tick-grouped events, canonical
    final state, output_sha256), stamps `match_end` once at the last
    tick from the result's winner/reason, and validates at the boundary
    (empty ids, fractional durations, malformed hashes, one-player
    lists, forged design payloads). The final state carries every
    robot's scalars with `alive` (a survivor and a corpse with the same
    scalars must not hash alike) plus the standing cell indices 8.1
    reserved for exactly this hash. `duration_ms` is the caller's
    wall-clock metadata: the simulator keeps no clock (G22/G35), and the
    hash never reads it.
  - Tests: 107 in telemetry/ (eventLog 25, outputSha256 18, replay 19 +
    barrel, canonical 17, sha256 13, fxTable 6, integration 8) — six
    dimensions per function, every digest cross-checked against
    node:crypto or hand-assembled byte concats so the tests cannot
    inherit a bug from the code they check. The integration tier runs
    real matches through the sink seam: kinds ⊆ enum, `t` = bucket
    index, snapshot cadence tick 1 + every 30 through the wire, the D10
    compression pin, draw_tie at the 1500 cap with a gap-filled final
    bucket and zero unintentional `vm_yield`s, and byte-identical
    documents (hash included) for repeated runs of the same seed.
- Documented decisions awaiting the owner from 8.2 (spec edits for
  approval, not applied): the `damage` wire event carries `x`/`y`
  although 11 § 4 lists them as neither required nor optional — 16 §
  2.3 renders events by "kind + position" and a splash without a centre
  cannot place its blast (to_hull and killed stay engine-side: to_hull
  is amount − to_shield, killed is the following death event's job);
  the fx table lives in telemetry/ until the juice phase, keyed by the
  wire kinds, so the completeness test and the future consumer share
  one table (rule 14); the seed's zero encoding (one 0x00 byte) and the
  balance hash's raw-bytes encoding are telemetry's to pin because 11 §
  2.1 fixes the concat but not the byte forms.


## Commands

```
pnpm install
pnpm lint          # includes the determinism rules
pnpm typecheck
pnpm test
pnpm test:coverage # 90/90 unit floor
```
