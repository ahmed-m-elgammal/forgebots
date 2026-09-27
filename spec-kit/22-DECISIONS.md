# 22 — Canonical Decisions

> **Purpose:** this doc records every ambiguity that was open in docs
> 00–21 and the **single answer** the rest of the spec kit now uses.
> When two docs disagreed, the conflict was resolved *here* and then
> propagated. If you find a doc contradicting this file, this file wins
> and the doc is a bug.
>
> **Status:** decisions ratified for spec kit **v0.6**.
> Owners: founder (product calls) + engineering (technical calls).

---

## D1 — Fixed-point format (was: unresolved / overflowing)

| Layer | Representation |
|---|---|
| Simulator internal state (position, velocity, angle, mass) | **Q16.16, 1 world unit = 1 metre** |
| Range | ±32,767 m (arena is 200 m — 160× headroom) |
| Precision | 1/65536 m ≈ 0.015 mm |
| Angles | **16-bit circular, 65536 = 2π** (`π` = 32768) |
| Trig return values | **Q16.16, 65536 = 1.0** (deliberately *different* from the angle unit) |
| DSL-visible lengths | **integer millimetres** |
| Replay / API wire format | **integer millimetres** |

- Conversion helpers live in `simulator/src/fixed.ts`:
  `mmToFixed(mm)`, `fixedToMm(fx)`, `fdiv`, `fmul`, `clamp`.
- **Why:** the previous spec said "Q16.16 with mm precision", which
  overflows at ±32.7 m — the arena is 200 m and radar ranges are 80 m.
  Millimetres are the *external* unit so every existing distance literal
  (30 000 = 30 m) stays valid; they are never stored in Q16.16.
- **Rule:** anything that crosses the wire (replay JSON, API, telemetry,
  `fx-table`) is integer millimetres. Anything the physics touches is
  Q16.16 metres. Nothing in between.

## D2 — The VM is a tree-walking IR interpreter (was: bytecode vs tree-walking)

- Pipeline: `text DSL ┐` / `blocks ─┴─► IR (JSON tree) ─► verifier ─► tree-walking VM`
- **No bytecode stage.** There is no opcode stream, no instruction
  encoding, and no per-opcode cost table. The cost table in
  `09-AI-DSL.md § 4` is a **per-IR-node** table, and "node" is the word
  used throughout.
- **Why:** `20-IMPLEMENTATION-PLAN.md` Phase 06 builds a tree-walker
  and no later phase builds a compiler, so the plan is the design.
  A tree-walker over a JSON IR is auditable (goal 6 in `09 § 1`) and
  fast enough for the budget in D9.

## D3 — The simulator runs on the server only (was: TS sim in a Godot client)

- The Godot client **never** runs the simulator. It renders replays.
- The simulator is TypeScript in `simulator/` and runs in Node only.
  `simulator/` has **no** C# or GDScript port and never will in MVP.
- All previews are server-side:
  - `POST /bots/{id}/simulate` — quick-match (default 300 ticks).
  - `wss://…/preview` — live frame stream (editor "Run preview").
- Cross-platform parity therefore means: **every viewer sees the same
  replay**, because there is only one replay. No client-side
  determinism claim is made or tested.
- **Why:** the old spec required byte-identical replays on
  iOS/Android *and* ran the sim on the client, which is impossible with
  a TypeScript core in a C#/GDScript client without a second
  implementation — i.e. a second determinism surface.

## D4 — Cycle budget over-run has exactly one behaviour

1. The verifier rejects any program whose **static worst-case** estimate
   exceeds 1000 cycles/tick. So over-run should be unreachable.
2. At runtime, if a bot's VM reaches 1000 cycles mid-node, the tick is
   **abandoned**: every actuator queued by that bot this tick is
   discarded, the bot does nothing, and a `vm_yield` event is emitted
   with `reason: "budget"`.
3. A runtime `vm_yield` means the static estimator has a gap. It is a
   bug, it is logged, and it is filed. There is **no** auto-throttle
   and **no** partial-state carry-over.
- **Why:** the old spec had four different behaviours (abort / suspend /
  discard / auto-throttle). "Discard yielded state" also made looping
   bots unable to make progress, which is a worse failure than doing
   nothing.

## D5 — Two named RNG streams (was: one global + per-bot, unstated)

| Stream | Seed | Advanced by | Exposed to DSL |
|---|---|---|---|
| `matchRng` | `matches.seed` | once per tick, **before** any bot steps | **No** |
| `botRng[i]` | `deriveSeed(seed, side, designIndex, robotIndex)` | only by that robot's own `rng-int` | **Yes**, via `rng-int` |

- `matchRng` drives world events only: biomass spawn/respawn placement,
  arena jitter. Nothing a player writes can perturb it.
- A bot's `rng-int` sequence is therefore independent of how many other
  bots exist or in what order they ran.

## D6 — Energy is a pool drained by net power (was: two competing models)

- `energy` is an integer pool, `0 … energyMax` (default `energyMax = 500`).
- Parts carry a signed `power` in watts. **Generators are negative**
  (Solar Panel `-5`, Reactor `-10`).
- `netPower = Σ part.power` (watts, signed).
- Each tick: `energy += netPower` scaled by a **milliwatt accumulator**,
  i.e. power is held as integer **milliwatts** and divided by 60 with the
  remainder carried to the next tick. A 5 W draw costs 83 energy
  milli-units/tick, never `floor(5/60) = 0`.
- `netPower > 0` drains; `netPower ≤ 0` recharges (clamped at `energyMax`).
- `energy ≤ 0` and `biomass > 0` → emergency conversion 10 biomass → 5
  energy (emits `eat` with `reason: "starvation"`).
- `energy ≤ 0` and `biomass ≤ 0` → death, `cause: "starvation"`.
- **Build rules:** ≤ 8 part slots, `Σ mass ≤ 50 kg`, `Σ power ≤ 80 W`
  (a generator's negative power reduces the sum, so a reactor frees
  headroom). Net-positive vs net-negative is a *balance* outcome, not a
  validation rule.
- **Why:** the old `floor(power/60)` made every part under 60 W free,
  and "recharge rate must cover" contradicted the energy-pool model.

## D7 — HP and shields (was: floor inconsistency, no damage model)

- `maxHullHp = floor(Σ mass_kg × 1.5)`; `maxShieldHp = Σ part.shieldHp`.
- Shields are a **damage buffer in front of hull HP**: incoming damage
  drains shield first, overflow hits hull. Shield HP regenerates at the
  part's rate after 1 s without taking damage.
- Shields are **always on** in MVP. The Grobots shield toggle is
  deferred (recorded in `01-RESEARCH.md § 1.4`).
- **Why:** the old spec added shield HP to max HP *and* regenerated it,
  which made shields strictly better HP with no tactical choice.

## D8 — DSL surface units and `move` (was: undefined; examples were wrong)

| Form | Unit |
|---|---|
| `self.x`, `self.y`, `food-x/y`, `hit-x/y` | integer millimetres |
| `dist`, all sensor ranges, weapon ranges | integer millimetres |
| `aim`, `scan`, `atan2` result | angle unit, 65536 = 2π |
| `sin`/`cos` result | Q16.16, 65536 = 1.0 |
| `move(vx, vy)` | **Q16.16 normalised throttle, 65536 = 100 % of top speed**, clamped to ±65536 per axis |
| `move-at(tx, ty)` | millimetres → sets throttle toward a point (65536 = full when ≥ 1 m away, tapering to 0 inside 1 m) |

- `move-at` is **new** and exists because every starter bot needs
  "steer toward a point" and the only previous spelling
  (`(/ dx 60)`) was meaningless.
- The engine converts throttle to m/s using the chassis top speed, mass
  and friction. A bot can never exceed its top speed by calling `move`.

## D9 — Timing numbers (was: 1 s / 2 s / 6 s / 18 s / 30 s all at once)

| Number | Value | Where |
|---|---|---|
| Cycle budget | 1000 / bot / tick | `09 § 9` |
| Worst-case cycles per match | 12 bots × 1000 × 1500 = **18 M** | `09 § 9` |
| Worst-case wall time, 1 core | **≈ 18 s** | `09 § 9` |
| Typical match (200–400 cycles/bot) | **3–6 s** | `09 § 9` |
| `POST /matches` → replay ready, p95 | **< 30 s** | `08`, `12`, `18` |
| `POST /matches` `eta_seconds` | **30** | `08` |
| `POST /bots/{id}/simulate` | 300 ticks, p95 **< 3 s** | `08` |
| Editor preview (WebSocket) | 300 ticks | `08 § 9` |
| Autoscale trigger | p95 sim wall time **> 20 s** | `05 § 5` |

- `18 s` is the *ceiling*, not the expectation. Nothing in the spec may
  claim a 1–6 s match.

## D10 — Replay size and event volume (was: "< 100 KB" vs per-tick move/aim)

- `move` and `aim` events are **change-only**: emitted when the value
  differs from the previously emitted value for that robot. Bots that
  re-issue the same `move` every tick (all of `19`'s bots) emit almost
  none.
- A `snapshot` event is emitted every **30 ticks** carrying scalar state
  for every robot, so the viewer can render any tick without replaying
  deltas.
- Replay size target: **< 150 KB p50**, 3 MB hard cap. It is a
  *measured budget with a CI alert*, not a design promise.
- `output_sha256` covers `seed ‖ canonical(final_state) ‖ canonical(events)`
  and is stored in the `replays` row. The copy embedded in the replay
  JSON for convenience is **excluded from the hash input** — stated
  explicitly in the format.

## D11 — Ghost opponents (was: "Elo-less" vs "Elo tracked")

- A ghost is a **real `bots` row** owned by a reserved system user,
  with a real `bots.elo` that **changes when it wins and loses**.
- Ghosts are excluded from the public ladder by `is_public = false`.
- Ghosts are never copies of player bots and carry no player data.
- The 8 starter bots from `19` are seeded once at season start, one
  row each, at the Elo listed in `19 § 1.1` (also machine-readable in
  `spec-kit/examples/golden-seeds.json` under `ghost_seed_elo`).
- Resolves `19 § 7` open question 3 in favour of **tracked Elo**.

## D12 — Vocabulary (was: "slot" meant four different things)

| Term | Means | Owner doc |
|---|---|---|
| **bot slot** | how many *saved bots* an account may keep (3 free → 30) | `00 § 7` |
| **part slot** | one of the 8 hardware positions on a design | `04 § 3.1` |
| **bot** | a saved loadout = 1–3 **designs** | `00 § 7`, `07 § 2.3` |
| **design** | one chassis (≤ 8 part slots) + one program | `07 § 2.3` |
| **robot** | one spawned instance of a design in a match | `04 § 6` |
| **side** | one player's robots in a match (≤ 6) | `04 § 6` |

- Caps: **1–3 designs per bot, 1–4 robots per design, ≤ 6 robots per
  side.** The per-side cap is the binding one; 3 × 4 is only reachable
  if the per-side cap is raised, which is not in MVP.

## D13 — Starter bots: 8 ship, 3 are the missions

- **8** starter bots ship in MVP (`19`). They are the campaign ladder
  *and* the matchmaking ghost pool.
- **3** of them (Drifter, Pouncer, Breeder) are the onboarding missions.
- Docs that said "3 AI opponents" now say "8 starter bots, 3 of which
  are the tutorial missions".

## D14 — Elo

- `E_a = 1 / (1 + 10^((R_b − R_a) / 400))`
- `K = 32` for a bot's first 10 rated matches, `K = 16` after.
- Ghost matches apply `K/2` (ghosts are not ladder opponents).
- Floor 0, no ceiling.
- **`bots.elo` is authoritative for matchmaking.** `users.elo` is a
  cached display value = the highest Elo among the user's bots,
  recomputed after every match.
- Matchmaking band: **±100** by default, **±200** for a player's first
  5 rated matches.
- Ghost Elo drifts because ghosts play ghost matches.

## D15 — Arena

- **200 m × 200 m**, `1 tile = 1 m` ⇒ a 200 × 200 tile grid. One unit.
- Perimeter walls 0.5 m thick.
- **8 interior pillars** on a 3 × 3 lattice with the centre cell empty
  ⇒ 9 pockets. (Reconciles the old "8 pillars (creates 9 pockets)" and
  "8 pillars at 3×3 grid".)
- Robot collision radius **0.5 m**.
- **400 biomass cells**, 1 kg each. A cell respawns **5 s (300 ticks)
  after it is depleted** — "depleted" and "picked up" are the same
  event; only one word is used.
- **There are no map solar cells.** Energy comes from the Solar Panel /
  Reactor parts only. (Removes a mechanic with no API.)
- **12 spawn points**, deterministic from the match seed, spaced around
  the perimeter — enough for the 12-robot worst case.

## D16 — Sensors (was: `food()` range undefined; radar/food contradiction)

| Sensor | Gated by a part | Range | Rate | Returns |
|---|---|---|---|---|
| `radar()` | Short/Long Radar | part value (25 m / 80 m) | 1 Hz | nearest **robot** in range |
| `scan(a)` | Directional Scanner | 40 m, 30° cone | 4 Hz | nearest robot in cone |
| `food()` | **nothing — always present, 0 mass, 0 W** | **5 m** | 4 Hz | nearest biomass cell |
| `ally()` | nothing | **map-wide** | every tick | nearest living ally |
| `enemy()` | nothing | **map-wide** | every tick | nearest living enemy |

- `radar()` never returns food. Food is `food()`'s job only.
- `ally()`/`enemy()` are map-wide because the bots that use them
  (`19 § 2.6` Reaper's retreat logic) need to reason about the whole
  board; they are the most expensive sensors (25 cycles) to compensate.

## D17 — Model / API gaps closed

- `matches.created_at` exists (the old indexes referenced a column that
  was never defined).
- `matches.replay_id` is **removed**; `replays.match_id` (unique) is the
  only join. No circular FK.
- `matches.balance_id` is **replaced** by `balance_version_id` →
  `balance_versions.id`. A season has many balance versions, so the
  4-week balance cadence in `18 § 2.3` has somewhere to live.
- New tables for features that were promised but had no home:
  `replay_bookmarks`, `replay_shares`, `missions`, `user_missions`,
  `achievements`, `user_achievements`, plus the three push tables from
  `21` (`push_tokens`, `notification_prefs`, `notifications`).
- RLS is enabled on `replays` too: owner read, or a valid unexpired
  `replay_shares` token.
- All primary keys are `uuid` v7, including the two `bigserial` tables.
- `users.deleted_at` exists (soft delete for GDPR).

## D18 — Game modes

- MVP ships **one** mode: **Eliminator** (last side standing, biomass
  tiebreak at the tick cap — `04 § 6`).
- Domination and Collection are **v0.2+** and need a mode data model
  that this spec kit does not define. `18 § 1.2` no longer promises
  them as a 4-week rotation.

## D19 — Dashboards

- MVP ships **no dashboards**. pino file logs + PostHog only.
- The four Grafana boards in `18 § 3.5` are a **v0.2** deliverable.
  (Reconciles `15 § 5` with `18`.)

## D20 — Engine schedule

- `20-IMPLEMENTATION-PLAN.md` phases 01–14 = **~18 working days** and
  are authoritative. They occupy **weeks 1–2 of `12-MVP-ROADMAP.md`
  with the remainder spilling into week 3** alongside the server
  skeleton.
- `12 § 1` weeks 1–2 now cite doc 20 instead of re-estimating.

## D21 — Naming for the DSL's two bracket styles

- `(let [x e] b)` and `(let ((x e)) b)` are both valid; brackets and
  parens are interchangeable everywhere. One parser, one AST.
- `cond` is Scheme-style: `(cond [test expr]… [else expr])` with at
  least one `else` required by the verifier.
- `(every-tick fn)` takes a **function name** only. Inlining a form is
  not valid. (Starter bots and `17` all use the name form.)
- `while` takes an explicit iteration bound:
  `(while cond max-iters body)`. A missing bound is a verifier error.
- Sensor results are `Option<T>`, rendered on the stack as
  `0 = none`, `1 = some` followed by the payload. Truthiness of an
  Option (`(if f …)`) is **not** valid; use `some?`.

## D22 — Document hygiene

- ESLint: **flat config** `eslint.config.js` + one local plugin file
  `tools/eslint-plugin-forge/determinism.js`. No `.eslintrc.*`.
- The canonical starter-bot sources live in `spec-kit/examples/*.fb`
  and the golden-match seeds in `spec-kit/examples/golden-seeds.json`.
  `19` renders them inline for reading; `10 § 5` and `20 § 14` load them
  from those paths.
- Spec-kit version (this file's header) tracks the **spec**, not the
  product. Product versions are v1.0 = launch.
- No document claims a feature is "in `07`" or "conflict-free with
  00–20" unless it is.

---

## Open questions this doc deliberately does **not** answer

These stay open and are listed in the owning doc's own "open questions"
section:

- Whether to ship starter-bot source or IR in the binary (`19 § 7`).
- Whether the ladder shows an "inspired by" badge (`19 § 7`).
- Whether `notification` delivery uses OneSignal or roll-your-own
  (`21 § 2.12`).
- Season hard-reset vs persistent (`18 § 8`).
