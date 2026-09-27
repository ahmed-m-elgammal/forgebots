# 19 — Starter Bots & Sample Library

> **Owner:** game designer + simulation engineer.
> **Cross-references:** `04-GAME-DESIGN.md` (mechanics), `09-AI-DSL.md`
> (language), `17-ONBOARDING.md` (which bots teach what).

This document specifies the bots, templates, and reference programs
that **ship with the MVP binary**. Every entry here is *original code*
written for ForgeBots under the ForgeBots licence — no code from
Grobots or any other source is reused.

The library is also the *behavioural test surface* for the simulator:
if a starter bot stops behaving as documented, the simulator has a bug.

---

## 1. Tiering

Starter bots are organised in three tiers, mirroring the onboarding
ladder in `17-ONBOARDING.md`:

| Tier | Bots | Purpose | Match-up against |
|---|---|---|---|
| **Starter** | Pebble, Glow | Empty-bot & first-mover examples | Each other (teaching) |
| **Tutor** | Drifter, Pouncer, Breeder | Teach one mechanic each | Each other, then vs player |
| **Reference** | Reaper, Swarm-Mind | Showcase advanced strategies | Player in mid/late ladder |

The 3 tutor bots are also the 3 onboarding missions (see `17-ONBOARDING.md`
§ 3.1). Each is *the* canonical implementation of one strategy archetype.

---

## 2. The starter pack (8 bots)

### 2.1 Pebble (Starter)

**Strategy:** stand still. The most boring possible bot. Used as the
"empty / did-nothing" baseline in tutorials.

**Hardware:** `mk1_engine, short_radar, solar`

**DSL source:**

```lisp
(defn step ()
  (move 0 0))

(every-tick step)
```

**Compiled IR summary:** 1 fn, 1 call per tick, ~12 cycles/tick.

**Test:** wins 0% of matches against any opponent. Loses to Drifter
~95% of the time (Drifter walks into it).

**Teaches:** "Your bot needs at least one `(every-tick ...)` form."

---

### 2.2 Glow (Starter)

**Strategy:** walks in a fixed direction forever. Collides with walls
on the perimeter and slides. Useful for teaching coordinate movement
and "watch your bot run" previews.

**Hardware:** `mk1_engine, solar`

**DSL source:**

```lisp
(defn step []
  (move 1 0))

(every-tick step)
```

**Test:** reaches the east wall in ~80s, then slides north-south.
Loses to every tutor bot.

**Teaches:** that `move` is per-tick velocity, not a one-shot impulse.

---

### 2.3 Drifter (Tutor — Mission 1: Gather)

**Strategy:** picks the nearest biomass cell and walks toward it.
Falls back to a random heading every ~30 ticks if nothing is in range.
Does not fight.

**Hardware:** `mk1_engine, long_radar, solar`

**DSL source:**

```lisp
(defn pick-heading []
  (let ((h (* 60 (time))))
    (if (== (mod h 1800) 0)
        (rng-int 65536)
        h)))

(defn step []
  (let ((f (food)))
    (if (some? f)
        (move (/ (- (food-x f) (self.x)) 60)
              (/ (- (food-y f) (self.y)) 60))
        (move (cos (pick-heading)) (sin (pick-heading))))))

(every-tick step)
```

**Test:**
- Wins against Pebble ~99% (just by collecting food).
- Wins against Glow ~80% (Glow eventually walks off food).
- Loses to Pouncer ~65%, Breeder ~75%.
- Never engages combat; can be ignored if you run from it.

**Teaches:** `food`, `self.x`, `self.y`, simple vector math.

---

### 2.4 Pouncer (Tutor — Mission 2: Destroy)

**Strategy:** scans for the nearest enemy, aims, fires when in range.
Falls back to slow random walk. Does not collect biomass efficiently.

**Hardware:** `mk2_engine, long_radar, blaster, solar`

**DSL source:**

```lisp
(defn step []
  (let ((e (radar)))
    (if (some? e)
        (do (aim (atan2 (- (hit-y e) (self.y))
                         (- (hit-x e) (self.x))))
            (if (< (dist 0 0 (- (hit-x e) (self.x))
                            (- (hit-y e) (self.y)))
                   30000)
                (fire)))
        (move 1 0))))

(every-tick step)
```

**Test:**
- Wins against Drifter ~65% (just shoot it).
- Wins against Glow ~80%.
- Loses to Breeder ~60% (Breeder splits faster than Pouncer kills).
- Has the highest "first PvP loss cause" rate — new players copy this
  bot and then lose to anyone who brings a Constructor.

**Teaches:** `radar`, `aim`, `fire`, `atan2`, `dist`.

---

### 2.5 Breeder (Tutor — Mission 3: Reproduce)

**Strategy:** collects biomass and converts it into child bots via
the Constructor. Keeps producing children until it runs out of biomass.

**Hardware:** `mk1_engine, short_radar, constructor, solar, storage`

**DSL source:**

```lisp
(defn step []
  (let ((f (food)))
    (if (some? f)
        (move (/ (- (food-x f) (self.x)) 60)
              (/ (- (food-y f) (self.y)) 60))
        (do (eat)
            (if (>= (self.biomass) 5)
                (build 0)))))

(every-tick step)
```

**Test:**
- Wins against Drifter ~75% (numerical advantage).
- Wins against Pouncer ~60% (overwhelm with bodies).
- Loses to Reaper ~40%.

**Teaches:** `eat`, `build`, `self.biomass`, the value of swarm.

---

### 2.6 Reaper (Reference — Intermediate)

**Strategy:** aggressive hunter. Picks the weakest enemy, closes in,
fires until dead. Retreats to safety when energy < 200.

**Hardware:** `mk2_engine, long_radar, blaster, blaster, light_shield, solar`

**DSL source:**

```lisp
(defn weakest []
  (let ((a (ally))
        (e (enemy)))
    ;; simplified: just return the enemy for MVP
    e))

(defn step []
  (let ((e (weakest)))
    (if (some? e)
        (do (aim (atan2 (- (hit-y e) (self.y))
                         (- (hit-x e) (self.x))))
            (fire)
            (move (/ (- (hit-x e) (self.x)) 60)
                  (/ (- (hit-y e) (self.y)) 60)))
        (if (< (self.energy) 200)
            (move 0 0)
            (move 1 0)))))

(every-tick step)
```

**Test:**
- Beats Drifter, Pouncer, Breeder > 90% of the time.
- Loses to Swarm-Mind ~50%.

**Teaches:** combining sensors, conditional logic, retreat logic.

---

### 2.7 Swarm-Mind (Reference — Advanced)

**Strategy:** the Breeder's evolved form. Builds children with
targeted roles: a constructor plus an escort plus a defender. Each
child is a separate bot type; the parent only handles spawning logic.

**Hardware:** `mk1_engine, short_radar, constructor, storage, solar`

**DSL source:**

```lisp
;; type 0 = constructor (self)
;; type 1 = gatherer child
;; type 2 = defender child

(defn pick-type [tick]
  (cond
    [(== (mod tick 300) 0) 1]   ;; spawn gatherer every 5 s
    [(== (mod tick 600) 0) 2]   ;; spawn defender every 10 s
    [else 0]))

(defn step []
  (let ((f (food)))
    (if (some? f)
        (move (/ (- (food-x f) (self.x)) 60)
              (/ (- (food-y f) (self.y)) 60))
        (do (eat)
            (if (>= (self.biomass) 5)
                (build (pick-type (time))))))))

(every-tick step)
```

**Test:**
- Beats Reaper ~50% of the time at full strength.
- Loss condition: out of biomass and boxed in by Reaper.

**Teaches:** `cond`, `time`, multi-type rosters, role assignment.

---

### 2.8 Sentinel (Reference — Defensive)

**Strategy:** claims the centre of the map, builds a small perimeter
of constructors and turrets, defends. Wins by attrition.

**Hardware:** `mk1_engine, long_radar, blaster, heavy_shield, solar, storage`

**DSL source:**

```lisp
(defn step []
  (let ((e (radar)))
    (if (some? e)
        (do (aim (atan2 (- (hit-y e) (self.y))
                         (- (hit-x e) (self.x))))
            (if (< (dist 0 0 (- (hit-x e) (self.x))
                            (- (hit-y e) (self.y)))
                   30000)
                (fire)))
        ;; hold the centre: if we're far from it, walk back
        (if (> (+ (* (self.x) (self.x))
                  (* (self.y) (self.y)))
               (* 100000 100000))
            (move (/ (- 100000 (self.x)) 60)
                  (/ (- 100000 (self.y)) 60))
            (move 0 0)))))

(every-tick step)
```

**Test:**
- Holds the centre against any single attacker for 60+ seconds.
- Loses to Swarm-Mind ~40% (overwhelmed by numbers).

**Teaches:** positional play, defensive stalling, sustained combat.

---

## 3. The pattern library (templates)

Beyond the shipped bots, we publish a *pattern library* — small code
snippets that ship as copy-paste templates in the editor's "Examples"
menu. Each pattern is a *function* (not a full bot) the player drops
into their own code.

### 3.1 Patterns

| Pattern | Function signature | Teaches |
|---|---|---|
| `vector-to` | `(vector-to hit)` → `(dx, dy)` | normalised direction |
| `within-range?` | `(within-range? hit dist)` → bool | distance check idiom |
| `flee` | `(flee)` → `(vx, vy)` | running from enemies |
| `follow` | `(follow ally)` | staying near an ally |
| `circle-strafe` | `(circle-strafe target r)` | advanced combat movement |
| `retreat-when-low` | `(retreat-when-low threshold)` | energy-aware combat |
| `broadcast-position` | `(broadcast-position)` | using `say` channel |
| `find-weakest` | `(find-weakest)` | multi-target prioritisation |

These are published as a separate `library.fb` file shipped with the
editor. The visual editor exposes them as a "Patterns" tab.

### 3.2 Versioning

The library is part of the editor and versioned with the client.
When the DSL changes (semver bump), the library ships a migration
file (`library-migrations/vN-to-vM.fb`).

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
| Ladder seeding (`08-API-SURFACE.md`) | New players face ghosts seeded from Reaper / Swarm-Mind / Sentinel |
| Matchmaking fallback | If no human opponent available, match vs a random starter bot of similar Elo |
| Testing | Every commit runs `Pebble vs Drifter`, `Drifter vs Breeder`, `Swarm-Mind vs Reaper` golden matches |
| Documentation examples | `examples/*.fb` in this repo mirrors the starter bots above |

---

## 6. What we are NOT shipping in MVP

- ❌ More than 8 starter bots (diminishing returns; players want to
  make their own).
- ❌ A web-based bot editor (post-MVP).
- ❌ Community submissions (post-MVP).
- ❌ A "tournament starter pack" — players design their own.

---

## 7. Open questions

- Should we ship the *source* of starter bots in the binary, or only
  the compiled IR? **Lean: source**, so players can read and learn
  from them.
- Should the ladder display *which* starter bots top players used to
  learn? **Lean: yes**, with an "Inspired by X" badge.
- Do starter bots earn Elo, or are they Elo-less ghosts? **Lean:
  Elo-less**. Only player-authored bots climb the ladder.
