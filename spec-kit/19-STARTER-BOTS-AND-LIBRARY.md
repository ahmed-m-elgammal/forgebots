# 19 — Starter Bots & Sample Library

> **Owner:** game designer + simulation engineer.
> **Cross-references:** `04-GAME-DESIGN.md` (mechanics), `09-AI-DSL.md`
> (language), `17-ONBOARDING.md` (which bots teach what),
> `spec-kit/examples/*.fb` (the canonical sources),
> `spec-kit/examples/golden-seeds.json` (golden match seeds).

This document specifies the bots, templates, and reference programs
that **ship with the MVP binary**. Every entry here is *original code*
written for ForgeBots — no code from Grobots or any other source is
reused.

The library is also the *behavioural test surface* for the simulator:
if a starter bot stops behaving as documented, the simulator has a bug.

> **Sources of truth.** The `.fb` files in `spec-kit/examples/` are
> canonical. The listings in this doc are rendered from them for
> reading, and CI asserts they match. Do not edit a listing here
> without editing the file. Every program below compiles and passes
> `verify()` (`09 § 5`).

---

## 1. Tiering

Starter bots are organised in three tiers, mirroring the onboarding
ladder in `17-ONBOARDING.md`:

| Tier | Bots | Purpose | Match-up against |
|---|---|---|---|
| **Starter** | Pebble, Glow | Empty-bot & first-mover examples | Each other (teaching) |
| **Tutor** | Drifter, Pouncer, Breeder | Teach one mechanic each | Each other, then vs player |
| **Reference** | Reaper, Swarm-Mind, Sentinel | Showcase advanced strategies | Player in mid/late ladder |

The 3 tutor bots are also the 3 onboarding missions (see
`17-ONBOARDING.md` § 3.1). Each is *the* canonical implementation of
one strategy archetype.

**8 bots ship.** All 8 are the matchmaking ghost pool
(`22-DECISIONS.md` D11, D13); 3 of them are the missions.

### 1.1 Ghost seed Elo

Ghost bots start each season at these Elo values and drift from there
by winning and losing ghost matches:

| Bot | Seed Elo |
|---|---|
| Pebble | 800 |
| Glow | 850 |
| Drifter | 950 |
| Pouncer | 1100 |
| Breeder | 1250 |
| Reaper | 1450 |
| Sentinel | 1500 |
| Swarm-Mind | 1650 |

---

## 2. The starter pack (8 bots)

### 2.1 Pebble (Starter)

**Strategy:** stand still. The most boring possible bot. Used as the
"empty / did-nothing" baseline in tutorials.

**Hardware:** `mk1_engine, short_radar, solar`

**DSL source** — `spec-kit/examples/pebble.fb`:
```lisp
(defn step []
  (move 0 0))

(every-tick step)
```

**Compiled IR summary:** 1 fn, 1 call per tick, ~12 cycles/tick.

**Test:** loses to every opponent. It has no weapon, so it can only
lose; the assertion is that it never kills anything and never wins.
Its purpose is as a zero baseline for the simulator, not a tuned
matchup — do not write a win-rate target for a robot that cannot
attack.

**Teaches:** "Your bot needs an `(every-tick …)` form naming a
function."

---

### 2.2 Glow (Starter)

**Strategy:** walks in a fixed direction forever. Hits the east wall
and slides. Useful for teaching coordinate movement and "watch your bot
run" previews.

**Hardware:** `mk1_engine, solar`

**DSL source** — `spec-kit/examples/glow.fb`:
```lisp
(defn step []
  (move 65536 0))

(every-tick step)
```

**Test:** with Mk-1 top speed 2.5 m/s and a 200 m arena, Glow reaches
the east wall in **~80 s — which is longer than a 1500-tick (25 s)
match.** It therefore never reaches a wall in a real match. That is
fine and is the point: it demonstrates a match running out of clock.
Do not assert wall contact; assert that it travels ≥ 50 m.

**Teaches:** that `move` sets a *throttle* each tick (Q16.16,
65536 = top speed), not a one-shot impulse. `move 1 0` — the older
spelling — is 0.0015 % throttle and looks like a broken bot.

---

### 2.3 Drifter (Tutor — Mission 1: Gather)

**Strategy:** picks the nearest biomass cell and walks toward it. Falls
back to a fresh random heading every 30 ticks if nothing is in range
(`food()` has a 5 000 mm radius, `22-DECISIONS.md D16`, so "in range"
is a real state). Does not fight.

**Hardware:** `mk1_engine, long_radar, solar`

**DSL source** — `spec-kit/examples/drifter.fb`:
```lisp
(defn pick-heading []
  (let ((h (* 2190 (time))))          ; ~1 radian per 29 ticks
    (if (== (mod h 65536) 0)
        (rng-int 65536)
        h)))

(defn step []
  (let ((f (food)))
    (if (some? f)
        (move-at (food-x f) (food-y f))
        (let ((h (pick-heading)))
          (move (cos h) (sin h))))))

(every-tick step)
```

> **What changed.** The fallback branch used to be
> `(move (/ (- (food-x f) (self.x)) 60) …)`, which had no defined unit,
> and `pick-heading` multiplied the tick by 60 and tested
> `mod 1800` — an arbitrary mix of ticks and radians. Now:
> `food()` has a real 5 000 mm radius
> (`22-DECISIONS.md D16`), `move-at` takes a point in millimetres, and
> `cos`/`sin` take an **angle** and return Q16.16 in `[-65536, 65536]`
> — which is exactly what `move` wants (`D8`). `pick-heading` advances
> ~1 radian per 29 ticks and re-rolls once per revolution.

**Test:**
- Wins against Pebble (Drifter collects; Pebble cannot).
- Beats Glow (Glow walks away from the food).
- Loses to Pouncer and Breeder.
- Never fires.

**Teaches:** `food`, `some?`, `move-at`, and that a sensor with a
radius is a sensor you can come up empty on.

---

### 2.4 Pouncer (Tutor — Mission 2: Destroy)

**Strategy:** acquires the nearest enemy, aims, fires when within the
30 000 mm blaster range. Falls back to a slow forward walk. Does not
collect biomass efficiently.

**Hardware:** `mk2_engine, long_radar, blaster, solar`

**DSL source** — `spec-kit/examples/pouncer.fb`:
```lisp
(defn step []
  (let ((e (radar)))
    (if (some? e)
        (do (aim (atan2 (- (hit-y e) (self.y))
                        (- (hit-x e) (self.x))))
            (if (< (dist (self.x) (self.y) (hit-x e) (hit-y e)) 30000)
                (fire)))
        (move 65536 0))))

(every-tick step)
```

> **Bug fixed.** The earlier version measured
> `(dist 0 0 (- (hit-x e) (self.x)) (- (hit-y e) (self.y)))` — i.e.
> distance from the **arena origin**, not from the bot. Near the
> origin that reads ~0 and Pouncer fires at anything the radar sees;
> near the far corner it reads ~200 000 and Pouncer never fires at
> all. The same bug was in Sentinel. The win-rate figures previously
> quoted for these bots were never measured; they were asserted.

**Test:**
- Beats Drifter and Glow.
- Loses to Breeder (Breeder out-multiplies it).
- Has the highest "first PvP loss cause" rate — new players copy this
  bot and then lose to anyone who brings a Constructor.

**Teaches:** `radar`, `some?`, `aim`, `fire`, `atan2`, `dist`, and that
weapon range and sensor range are different numbers.

---

### 2.5 Breeder (Tutor — Mission 3: Reproduce)

**Strategy:** collects biomass, and when it has enough, starts
building a child.

**Hardware:** `mk1_engine, short_radar, constructor, solar, storage`

**DSL source** — `spec-kit/examples/breeder.fb`:
```lisp
(defn step []
  (let ((f (food))
        (b (self.biomass)))
    (cond
      [(some? f) (move-at (food-x f) (food-y f))]
      [(>= b 5) (build 0)]
      [else (move 32768 0)])))

(every-tick step)
```

> **Fixed.** The earlier version only ever called `eat` and `build`
> in the branch where **no food was in range** — so it built exactly
> when it had no biomass, and the described strategy ("collect, then
> reproduce") never happened. `eat` converts biomass to *energy* and is
> not a build trigger at all.
>
> The `cond` order is load-bearing: go for food first, build when
> stocked, drift otherwise. `22-DECISIONS.md D21` defines `cond` as
> Scheme-style with a required `else`.

**Test:**
- Beats Drifter and Pouncer by numbers over time.
- Loses to Reaper and Sentinel.
- Must be re-measured after the constructor-cost model lands — a child
  costs its design's mass at 2 kg biomass/s (`04 § 3.2.1`), which may
  make Breeder much weaker than the old description implies.

**Teaches:** `cond`, `build`, `self.biomass`, and the value of a swarm.

---

### 2.6 Reaper (Reference — Intermediate)

**Strategy:** aggressive hunter. Closes on the nearest enemy, fires
until it dies, retreats when energy is low.

**Hardware:** `mk2_engine, long_radar, blaster, blaster, light_shield, solar`

**DSL source** — `spec-kit/examples/reaper.fb`:
```lisp
(defn step []
  (let ((e (enemy)))
    (if (some? e)
        (do (aim (atan2 (- (hit-y e) (self.y))
                        (- (hit-x e) (self.x))))
            (if (< (dist (self.x) (self.y) (hit-x e) (hit-y e)) 30000)
                (fire))
            (move-at (hit-x e) (hit-y e)))
        (if (< (self.energy) 200)
            (move 0 0)
            (move 65536 0)))))

(every-tick step)
```

> **Simplified from the earlier version,** which wrapped a `weakest()`
> helper that called `(ally)` and then returned the enemy anyway. Dead
> code that referenced a sensor the robot could not use. This version
> uses `enemy()` directly, which is map-wide and needs no part
> (`22-DECISIONS.md D16`) — so Reaper does not need a scanner to
> retreat correctly.
>
> Two blasters: `fire()` fires every off-cooldown weapon, so Reaper's
> DPS is doubled until one is cooling down. That is intentional.

**Test:**
- Beats Drifter, Pouncer and Breeder.
- Loses to Swarm-Mind around even.
- Retreats correctly when energy is low (assert: energy does not hit
  0 while biomass is available).

**Teaches:** combining sensors, aim-then-approach, and energy-aware
tactics.

---

### 2.7 Swarm-Mind (Reference — Advanced)

**Strategy:** the Breeder's evolved form — a parent that spawns
children and does not fight. The role differentiation between child
types is **post-MVP**: the DSL has no way for a parent to configure a
child's parts, and a child's design must exist in the bot's own
`chassis_json` before the parent can `build` it.

**Hardware (parent):** `mk1_engine, short_radar, constructor, storage, solar`

**DSL source** — `spec-kit/examples/swarm-mind.fb`:
```lisp
(defn pick-design []
  (cond
    [(== (mod (time) 300) 0) 0]   ; build design 0 (gatherer) every 5 s
    [else 0]))

(defn step []
  (let ((f (food)))
    (if (some? f)
        (move-at (food-x f) (food-y f))
        (if (>= (self.biomass) 5)
            (build (pick-design))
            (move 0 0)))))

(every-tick step)
```

> **Simplified.** The earlier version described three chassis types
> (constructor / gatherer / defender) while listing parts for only one,
> and used a `cond` syntax the language never defined. Both are
> removed. The child designs are declared in the bot's `chassis_json`,
> not in the DSL — `build` takes a **design index** into the bot's own
> design list (`08 § 3`).
>
> The "defender child" role is genuinely blocked on a language gap: a
> parent cannot give a child a different program. That is the honest
> reason this bot is described as a swarm of gatherers rather than a
> swarm with roles. Tracked as post-MVP.

**Test:**
- Wins by attrition against single-robots, loses to Reaper's focused
  damage eventually.
- Must be re-measured against the constructor-cost model.

**Teaches:** `cond` on tick math, `build`, and that a Constructor has
real opportunity cost.

---

### 2.8 Sentinel (Reference — Defensive)

**Strategy:** claims the centre of the arena and holds it.

**Hardware:** `mk1_engine, long_radar, blaster, heavy_shield, solar, storage`

**DSL source** — `spec-kit/examples/sentinel.fb`:
```lisp
(defn step []
  (let ((e (radar)))
    (if (some? e)
        (do (aim (atan2 (- (hit-y e) (self.y))
                        (- (hit-x e) (self.x))))
            (if (< (dist (self.x) (self.y) (hit-x e) (hit-y e)) 30000)
                (fire)))
        ;; hold the centre: arena centre is 100000 mm on each axis
        (if (> (+ (* (self.x) (self.x))
                 (* (self.y) (self.y)))
             (* 100000 100000))
            (move-at 100000 100000)
            (move 0 0)))))

(every-tick step)
```

> **Fixed.** The earlier version had the same origin-distance `dist`
> bug as Pouncer, and its "is it far from centre" test used `100000`
> with no statement of what unit that was. It is millimetres: the arena
> is 200 m, `1 tile = 1 m`, so the centre is at 100 000 mm on each
> axis (`22-DECISIONS.md D1`, D15). The squared comparison is
> `fx > fx`, so it happens to be overflow-safe for the arena extent —
> which is only true *because* the unit is mm and the format is
> Q16.16 metres, not Q16.16 mm.

**Test:**
- Holds the centre and survives attrition against a single attacker.
- Loses to Swarm-Mind.
- Assert: distance from centre stays under 5 000 mm after the first
  300 ticks.

**Teaches:** positional play, defensive stalling, sustained combat,
and that world coordinates are millimetres.

---

## 3. The pattern library (templates)

Beyond the shipped bots, we publish a *pattern library* — small code
snippets that ship as copy-paste templates in the editor's "Examples"
menu.

**Multi-return is not supported by the DSL or the IR** (`09 § 2.3`:
`int`, `bool`, `Option<T>` and nothing else). Every pattern below is
therefore a `defn` that *performs* an action or returns a single
`bool`, not one that returns a tuple. A pattern like "return
`(dx, dy)`" has no representation, which is why the table is written in
terms of what the pattern does rather than what it returns.

### 3.1 Patterns

| Pattern | Signature | Teaches |
|---|---|---|
| `steer-to` | `(steer-to tx ty)` → sets throttle toward a point | the `move-at` idiom |
| `within-range?` | `(within-range? hit dist)` → `bool` | distance check without a tuple |
| `flee-from` | `(flee-from hit)` → sets throttle away from a point | running from enemies |
| `hold-centre` | `(hold-centre cx cy)` → steers back to a point | positional play |
| `circle-strafe` | `(circle-strafe target r)` → sets throttle tangentially | advanced combat movement |
| `retreat-when-low` | `(retreat-when-low threshold)` → retreats if energy is low | energy-aware combat |
| `broadcast-position` | `(broadcast-position)` | using `say` |
| `find-weakest` | `(find-weakest)` → `Option<EntityHit>` | multi-target prioritisation |

Example, to show the shape:

```lisp
(defn within-range? [h d]
  (< (dist (self.x) (self.y) (hit-x h) (hit-y h)) d))
```

- Published as `spec-kit/library.fb`, shipped with the editor.
- The visual editor exposes them under a "Patterns" tab.
- **No fetch endpoint in MVP.** The library ships inside the client
  build; a server-side library endpoint is a v0.2 item alongside the
  community library (§ 4). The previous version of this doc
  referenced `library.fb` and a "Patterns tab" with no file, no path and
  no delivery mechanism.

### 3.2 Versioning

The library is part of the editor and versioned with the client. When
the DSL changes (semver bump), the library ships a migration file
(`library-migrations/vN-to-vM.fb`).

---

## 4. The community library (post-MVP)

After launch, we open a curated community library:

- Players submit bots via the website (not the game).
- Submissions are reviewed by a 3-person rotation.
- Approved bots ship as opt-in additions to the "Examples" menu.
- Submission guidelines: see `community-submission.md` (post-MVP).
- All submissions must pass the same verifier as player bots.

The community library is **post-MVP** — out of scope for the 8-week
ship. It is documented here so we don't forget to design it.

---

## 5. How starter bots are used

| Surface | Use |
|---|---|
| Onboarding (`17-ONBOARDING.md`) | Drifter / Pouncer / Breeder are Missions 1/2/3 |
| Ladder seeding (`08-API-SURFACE.md`) | All 8 available as ghosts at the seed Elo in § 1.1 |
| Matchmaking fallback | If no human opponent is available within the Elo band, match vs the nearest ghost by Elo |
| Testing | Every commit runs the golden matchups from `spec-kit/examples/golden-seeds.json` |
| Documentation examples | The `.fb` files in `spec-kit/examples/` **are** the starter bots |

### 5.1 Ghost seeding

Ghost rows are created once per season by a migration/seed script, one
`bots` row per starter bot, owned by a reserved system user with
`is_ghost = true` and `is_public = false`
(`07-DATA-MODEL.md § 2.4`). Ghost matches are `matches.kind = 'ghost'`
and apply **half-weight Elo** so a ghost does not climb as fast as a
player (`22-DECISIONS.md D14`).

Ghost Elo drifts through ghost matches and is soft-reset each season
along with player Elo (`18 § 1.4`). A new player therefore never faces
a season-1 ghost at season-1 Elo.

### 5.2 Golden match seeds

The three golden matchups and their fixed seeds live in
`spec-kit/examples/golden-seeds.json`. They are:

| Matchup | What it covers |
|---|---|
| `pebble` vs `drifter` | the minimum: no-weapon vs foraging |
| `drifter` vs `breeder` | two collectors, no weapons, `cond` + `build` |
| `swarm-mind` vs `reaper` | the heaviest path: construction + aim + two blasters + shield |

`10-DETERMINISM.md § 5` and `20-IMPLEMENTATION-PLAN.md` Phase 14 both
load that file. An earlier version of those two docs said the seeds
were "defined in `19 § 5`" — this section pointed at a table of
matchups with no seeds in it.

### 5.3 Files in `spec-kit/examples/`

| File | Is it a starter bot? | Purpose |
|---|---|---|
| `pebble.fb` | yes (§ 2.1) | do-nothing baseline |
| `glow.fb` | yes (§ 2.2) | constant-throttle walk |
| `drifter.fb` | yes (§ 2.3) | Mission 1 |
| `pouncer.fb` | yes (§ 2.4) | Mission 2 |
| `breeder.fb` | yes (§ 2.5) | Mission 3 |
| `reaper.fb` | yes (§ 2.6) | hunter with energy retreat |
| `swarm-mind.fb` | yes (§ 2.7) | constructor parent |
| `sentinel.fb` | yes (§ 2.8) | centre-holding defender |
| `sample-bot.fb` | **no** | the simplest possible program, shown to a new player in the editor's Examples menu (`17 § 2.1`) |
| `golden-seeds.json` | n/a | golden match definitions and ghost seed Elo |

Every `.fb` file in that directory must parse and pass `verify()`
(`09 § 5`). CI asserts it, which is what stops a doc listing and a
shipped source from drifting apart again.

---

## 6. What we are NOT shipping in MVP

- ❌ More than 8 starter bots (diminishing returns; players want to
  make their own).
- ❌ A web-based bot editor (post-MVP).
- ❌ Community submissions (post-MVP).
- ❌ A "tournament starter pack" — players design their own.
- ❌ **Role-differentiated children** (a defender child with its own
  program). Blocked on the language: `build` takes a design index into
  the parent's own design list, and a child inherits the parent's
  program. Making children differ is a v0.2 language change.

## 7. Open questions

- Ship starter-bot **source** or compiled IR in the binary? **Lean:
  source** (`spec-kit/examples/*.fb` ships as-is), so players can read
  and learn from them. The client already has a text editor, so there
  is no new surface.
- Should the ladder show which starter bot a player learned from?
  **Lean: yes**, with an "Inspired by X" badge. Needs a
  `bots.derived_from` column; not yet in `07`.
- ~~Do starter bots earn Elo, or are they Elo-less ghosts?~~ **Resolved
  in `22-DECISIONS.md` D11: they carry real, tracked Elo at half
  weight.** This doc previously carried it as an open question while
  `07 § 2.4` stated the opposite as fact.
- **Unmeasured win rates.** The previous version of this doc quoted
  specific percentages ("loses to Reaper ~40%") that contradicted each
  other between sections and were never produced by a simulation. All
  of them are removed above. Win rates get written here **after** the
  Phase 14 golden tests run, from real output, with the seed recorded
  next to each number. Until then, "beats X" is a design intent, not a
  measurement.
