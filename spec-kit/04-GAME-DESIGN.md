# 04 — Game Design

> Canonical decisions for units, energy, HP, arena geometry, sensors and
> vocabulary live in [`22-DECISIONS.md`](22-DECISIONS.md). This doc
> follows them.

## 1. Core fantasy

You are a **systems engineer in a brutal arena**. You design a chassis,
write a brain, and watch your creation fight for survival. Wins feel
*earned* because the simulation is honest — no real-time input, no
microtransactions, just better engineering.

## 2. The match loop

```
   ┌─────────────┐    ┌────────────┐    ┌─────────────┐
   │  Build bot  │ →  │  Submit to │ →  │ Watch replay │
   │  (builder)  │    │  match     │    │ (spectator)  │
   └─────────────┘    └────────────┘    └─────────────┘
                            │
                            ▼
                     ┌─────────────┐
                     │ Iterate on │
                     │ bot code   │
                     └─────────────┘
```

Match length cap: **1500 ticks = 25 s of simulated time** @ 60 Hz.
Most matches end earlier. Spectators usually watch replays at 2×–4×.
Average iteration cycle: **2–5 minutes**.

## 3. Hardware catalog (MVP)

All hardware has **mass** (kg) and **signed power** (W). **Positive
power = draw, negative power = generation.** There is no separate
"recharge rate" field: the engine sums the signs into a single
`netPower` and drains an energy pool over time
([`22-DECISIONS.md` D6](22-DECISIONS.md)).

### 3.1 Chassis & part-slot rules

A chassis has **8 part slots**.

- Part slots used: ≤ 8.
- `Σ mass ≤ 50 kg`.
- `Σ power ≤ 80 W` (generators count negative, so they free headroom).
- `maxHullHp = floor(Σ mass_kg × 1.5)` — bigger bots tank more.
- `maxShieldHp = Σ part.shieldHp` (Light 20, Heavy 50).

Shields are a damage buffer **in front of** hull HP — incoming damage
drains shield first, overflow hits hull — and regenerate after 1 s
without damage. They are always on in MVP; the Grobots shield toggle
is deferred ([`22-DECISIONS.md` D7](22-DECISIONS.md)).

> "Part slot" means one of the 8 hardware positions. It is never called
> a "bot slot" — that means a saved bot in an account
> ([`22-DECISIONS.md` D12](22-DECISIONS.md)).

### 3.2 Parts

16 parts. `power` is signed; see the note above.

| Category | Part | Mass | Power (W) | Effect |
|---|---|---|---|---|
| **Mobility** | Mk-1 Engine | 4 | 5 | top speed 2.5 m/s |
| | Mk-2 Engine | 8 | 9 | top speed 4.0 m/s |
| | Hover Unit | 6 | 7 | ignores friction, +30 % accel |
| **Sensors** | Short Radar | 2 | 1 | 25 000 mm radius, 360°, 1 Hz |
| | Long Radar | 6 | 4 | 80 000 mm radius, 360°, 1 Hz |
| | Directional Scanner | 3 | 2 | 40 000 mm, 30° cone, 4 Hz |
| | Proximity | 1 | 0 | 2 000 mm, 10 Hz (always-on) |
| **Weapons** | Blaster | 4 | 6 | 12 dmg/shot, 30 000 mm, 1 shot/s |
| | Heavy Blaster | 8 | 12 | 50 dmg/shot, 30 000 mm, 0.5 shot/s |
| | Grenade | 5 | 8 | 20 dmg, 12 000 mm splash, 6 s cooldown |
| **Defense** | Light Shield | 3 | 4 | +20 shield HP, regenerates 1 HP/s |
| | Heavy Shield | 7 | 9 | +50 shield HP, regenerates 0.5 HP/s |
| **Construction** | Constructor | 10 | 15 | builds children at 2 kg biomass/s |
| | Storage | 2 | 0 | +25 biomass carry capacity (base 25) |
| **Energy** | Solar Panel | 1 | −5 | generates 5 W |
| | Reactor | 8 | −10 | generates 20 W |

#### 3.2.1 Reading the numbers

- **Ranges are integer millimetres.** Every range in this table is
  millimetres (`25 000` = 25 m). The simulation stores metres in
  Q16.16; the DSL and the replay format speak millimetres
  ([`22-DECISIONS.md` D1](22-DECISIONS.md)).
- **Weapons deal damage per shot, not per second.** `damagePerHit` is
  the canonical field: Blaster 12, Heavy Blaster 50, Grenade 20 plus
  splash. The old "12 dmg/s" wording was ambiguous and is retired.
- **Grenades are arcing projectiles with splash**, not hitscan. They
  are integrated in `20-IMPLEMENTATION-PLAN.md` Phase 11 alongside the
  blaster raycast.
- **A Constructor consumes 2 kg of biomass per second of build time**,
  and a child's cost is the summed mass of its design's parts. A 26 kg
  design takes 13 s (780 ticks) to build — longer than half a match.
  MVP balance therefore expects small child designs; see `19 § 2.7`.
  Quantity beats quality in this economy — see
  `legacy/02-strategy-catalogue.md` § 2.
- **Base carry capacity is 25 biomass**; Storage adds 25.
- **Base energy pool is 500** (`energyMax`), and robots spawn at 500.
- **`food()` needs no part** (5 000 mm, 4 Hz) — see
  [`22-DECISIONS.md` D16](22-DECISIONS.md). This is why a bot with only
  a radar can still forage.

### 3.3 Not in the MVP catalog

These are **absent from season 1's `balance_json` entirely**, not
"disabled by default":

- EMP (anti-cheat against super-fast loops) — unnecessary; the
  1000-cycle budget already bounds the work.
- Cloak — too strong in an async context (deferred to v0.3).
- Nuclear — visual scope creep.
- Shield toggle (a Grobots feature, `01-RESEARCH.md` § 1.1) — deferred.

## 4. Sensors and actuation (player API surface)

### 4.1 Sensors (read)

Lengths are **integer millimetres**; angles are in the 65536 = 2π unit.

| Form | Returns | Gated by |
|---|---|---|
| `self.x`, `self.y` | position, integer mm | — |
| `self.energy` | `int` (0…`energyMax`, default 500) | — |
| `self.hp` | hull + shield HP, `int` | — |
| `self.shield` | remaining shield HP, `int` | — |
| `self.biomass` | carried, `int` (0…carry capacity) | — |
| `self.alive` | `bool` | — |
| `radar()` | `Option<EntityHit>` — nearest **robot** in radar range | Short/Long Radar |
| `scan(angle)` | `Option<EntityHit>` — nearest robot in a 30° cone | Directional Scanner |
| `food()` | `Option<Vec2>` — nearest biomass cell within 5 000 mm | nothing |
| `ally()` | `Option<EntityHit>` — nearest living ally, map-wide | nothing |
| `enemy()` | `Option<EntityHit>` — nearest living enemy, map-wide | nothing |
| `time()` | `int` (match tick) | — |
| `rng-int(n)` | `int` in `[0, n)` from **this robot's** RNG stream | — |

- Velocity is **not** exposed to the DSL in MVP — bots know their own
  move intents; see `09-AI-DSL.md` § 2.2 for the canonical self-state
  surface.
- `radar()` **never returns biomass**. Food is `food()`'s job only.
- `ally()` / `enemy()` are map-wide and unthrottled; they are the most
  expensive sensors (25 cycles) to compensate
  ([`22-DECISIONS.md` D16](22-DECISIONS.md)).

### 4.2 Actuators (write)

| Form | Effect |
|---|---|
| `move(vx, vy)` | set throttle; **Q16.16, 65536 = 100 % of top speed**, clamped to ±65536 per axis |
| `move-at(tx, ty)` | set throttle toward a point in mm (full at ≥ 1 000 mm, tapering to 0 at the point) |
| `aim(angle)` | rotate chassis to an absolute angle (65536 = 2π, **not** radians) |
| `fire()` | fire every fitted weapon that is off cooldown |
| `eat()` | convert carried biomass to energy (10 biomass → 5 energy) |
| `build(design_id)` | request the Constructor to spawn a child of that design |
| `say(channel, value)` | broadcast to allies within 30 000 mm (32-byte payload) |

- The engine converts throttle to m/s using the chassis top speed, mass
  and friction. **No actuator can push a robot past its top speed** —
  that is the point of the hardware budget
  ([`22-DECISIONS.md` D8](22-DECISIONS.md)).
- `move-at` exists because every starter bot needs "steer toward a
  point" and the previous spelling (`(/ (- (food-x f) (self.x)) 60)`)
  had no defined units.
- `fire()` with no weapon fitted is a no-op that still costs cycles.

### 4.3 Cost model

Two separate budgets — do not conflate them:

- **Cycles** (compute). Every IR node costs 0–100 cycles. Budget is
  **1000 cycles / tick / robot**. The single over-run behaviour (tick
  abandoned, actuators discarded, `vm_yield` emitted) is defined once in
  [`22-DECISIONS.md` D4](22-DECISIONS.md).
- **Energy** (in-world resource). Parts draw watts, generators supply
  watts, and the pool drains over time. Arithmetic lives in
  `20-IMPLEMENTATION-PLAN.md` Phase 13.

## 5. The arena (MVP map)

- **Size:** **200 m × 200 m**, `1 tile = 1 m`, so the grid is 200 × 200
  tiles. Tiles are a rendering convenience — the simulation works in
  metres (Q16.16), the DSL and replay speak millimetres.
- **Walls:** 0.5 m thick perimeter.
- **Pillars:** 8 interior pillars on a 3 × 3 lattice with the **centre
  cell empty** → 9 pockets. (This reconciles "8 pillars creating 9
  pockets" with `20`'s "8 pillars at 3×3 grid".)
- **Robot collision radius:** 0.5 m.
- **Resources:**
  - **Biomass** — 400 cells, 1 kg each. A cell **respawns 5 s
    (300 ticks) after it is depleted** at a deterministic pseudo-random
    free cell. *Depleted* and *picked up* are the same event; only one
    word is used, everywhere.
  - **There are no map solar cells.** Energy comes from the Solar Panel
    and Reactor parts. (Removed — a map resource with no API.)
- **Spawn points:** 12, spaced around the perimeter, assigned in a
  deterministic order derived from the match seed — enough for the
  12-robot worst case.
- **Tick cap:** 1500 ticks.

## 6. Match rules (MVP)

- **Mode:** **Eliminator** — the only MVP mode
  ([`22-DECISIONS.md` D18](22-DECISIONS.md)).
- **Sides:** 1 vs 1. Each side is one player's **bot**: 1–3 **designs**,
  1–4 **robots** per design, **≤ 6 robots per side**. The per-side cap
  is the binding one — 3 × 4 is only reachable if the per-side cap is
  raised, which is not in MVP.
- **Win:** last side with at least 1 alive robot.
- **Time limit:** 1500 ticks. If both sides are alive, the side holding
  more total biomass wins.
- **Draw:** both sides extinct on the same tick, or a biomass tie at
  the tick cap.
- **Kill bounty:** when a robot dies, the killer receives
  `min(10, victim.carriedBiomass)` biomass (feeds swarm strategies;
  implemented in `20-IMPLEMENTATION-PLAN.md` Phase 11).
- **Friendly fire: undefined — see the open question in
  `legacy/02-strategy-catalogue.md` § 6, item 10.** Grouping is the
  strongest late-game strategy and the archive is explicit that it
  costs splash hits. Recommended split: splash yes, aimed shots no.
  This needs a decision before Phase 11 is built.

## 7. Opponents

**Eight** starter bots ship with MVP
([`19-STARTER-BOTS-AND-LIBRARY.md`](19-STARTER-BOTS-AND-LIBRARY.md)).
They are written in the ForgeBots DSL, ship as source in
`spec-kit/examples/*.fb`, and serve three purposes at once:

1. The **tutorial missions** — Drifter, Pouncer, Breeder
   ([`17-ONBOARDING.md` § 3.1](17-ONBOARDING.md)).
2. The **matchmaking ghost pool** — all 8, at tracked Elo
   ([`22-DECISIONS.md` D11](22-DECISIONS.md)).
3. The **behavioural test surface** for the simulator.

There are no hand-written IR opponents: everything is DSL, so the
shipped bots exercise the same compiler and verifier that players do.

## 8. Progression (MVP)

- **Elo rank** per bot (per-player, per-bot). `bots.elo` is
  authoritative; `users.elo` is a cached display value
  ([`22-DECISIONS.md` D14](22-DECISIONS.md)).
- **Bot slots** — 3 free, up to 30 with IAP (Forge Pass → 12, slot
  packs → 30; see `14-MONETIZATION.md` § 2). *A "bot slot" is a saved
  bot in an account, never a part slot*
  ([`22-DECISIONS.md` D12](22-DECISIONS.md)).*
- **Cosmetics:** chassis skins, victory animations, arena themes.
- **Achievements:** "First win", "Win without weapons", etc. Stored in
  `achievements` / `user_achievements` (`07-DATA-MODEL.md` § 2.11).

## 9. UX principles

- **Watch your bot run** — every change is testable against a stand-in
  opponent in <30 s.
- **No dead ends** — every screen has a "back" and a "next step".
- **Replay is the reward** — losing should feel like a puzzle, not a wall.

## 10. Balance knobs (server-controlled)

Every number in § 3 lives in a `balance_versions.balance_json` row
(`07-DATA-MODEL.md` § 2.3), referenced by
`matches.balance_version_id`. A new **balance version** ships every
4 weeks; a new **season** is 12 weeks and also ships an arena and a new
AI opponent ([`18-LIVE-OPS-AND-TELEMETRY.md` § 2.3](18-LIVE-OPS-AND-TELEMETRY.md)).
Tuning therefore never requires an app update.
