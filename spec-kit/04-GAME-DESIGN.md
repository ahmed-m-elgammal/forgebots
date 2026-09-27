# 04 — Game Design

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
                     ┌────────────┐
                     │ Iterate on │
                     │ bot code   │
                     └────────────┘
```

Average match length in MVP: **90 seconds** (1500 ticks @ 60 Hz).
Average iteration cycle: **2–5 minutes**.

## 3. Hardware catalog (MVP)

All hardware has **mass** (kg) and **energy cost per second** (W).

### 3.1 Chassis & slot rules

- 8 hardware slots per chassis.
- Total mass cap: 50 kg.
- Total power cap: 80 W (recharge rate must cover).
- HP = `floor(mass × 1.5 + shield_hp)` — bigger bots tank more.

### 3.2 Parts

| Category | Part | Mass | Power | Effect |
|---|---|---|---|---|
| **Mobility** | Mk-1 Engine | 4 | 5 | top speed 2.5 m/s |
| | Mk-2 Engine | 8 | 9 | top speed 4.0 m/s |
| | Hover Unit | 6 | 7 | ignores friction, +30% accel |
| **Sensors** | Short Radar | 2 | 1 | 25 m radius, 360°, 1 Hz |
| | Long Radar | 6 | 4 | 80 m radius, 360°, 1 Hz |
| | Directional Scanner | 3 | 2 | 40 m, 30° cone, 4 Hz |
| | Proximity | 1 | 0 | 2 m, 10 Hz (always-on) |
| **Weapons** | Blaster | 4 | 6 | 12 dmg/s, 30 m range, 1 Hz |
| | Heavy Blaster | 8 | 12 | 25 dmg/s, 30 m, 0.5 Hz |
| | Grenade | 5 | 8 | 20 dmg, 12 m splash, 6 s cooldown |
| **Defense** | Light Shield | 3 | 4 | +20 HP, regenerates 1 HP/s |
| | Heavy Shield | 7 | 9 | +50 HP, regenerates 0.5 HP/s |
| **Construction** | Constructor | 10 | 15 | builds child bots at 2 kg/s |
| | Storage | 2 | 0 | +25 biomass carry capacity |
| **Energy** | Solar Panel | 1 | -5 | +5 W recharge |
| | Reactor | 8 | -10 | +20 W recharge (no solar) |

### 3.3 Disabled by default

- EMP (anti-cheat against super-fast loops)
- Cloak (deferred to v0.3 — too strong in async context)
- Nuclear (deferred — visual scope creep)

## 4. Sensors and actuation (player API surface)

### 4.1 Sensors (read)

- `self.position` → `(x, y)` in metres, fixed-point (mm precision)
- `self.velocity` → `(vx, vy)`
- `self.energy` → `int` (0–1000)
- `self.hp` → `int`
- `self.biomass` → `int` (carried)
- `self.alive` → `bool`
- `radar()` → `Option<EntityHit>` — closest entity within radar range
- `scan(angle)` → `Option<EntityHit>` — directional scan
- `food()` → `Option<Vec2>` — nearest biomass cell in range
- `ally()` / `enemy()` → `Option<EntityHit>`
- `time()` → `int` (match tick)

### 4.2 Actuators (write)

- `move(direction, speed)` — set desired velocity
- `aim(angle)` — rotate chassis to angle (radians)
- `fire()` — fire currently-aimed weapon (subject to cooldown)
- `eat()` — convert carried biomass to energy (10 biomass → 5 energy)
- `build(type_id)` — request constructor to spawn a child of given type
- `say(channel, value)` — broadcast to allies within 30 m (32-byte payload)

### 4.3 Cost model

Every actuator call costs cycles (0–100). Default cycle budget: **1000
cycles / tick / bot**. Going over ends the tick early for that bot.

## 5. The arena (MVP map)

- **Size:** 200 m × 200 m square.
- **Walls:** all four sides + 8 interior pillars (creates 9 pockets).
- **Resources:**
  - **Biomass** — 400 cells, ~1 kg each, respawn 5 s after pickup at
    random free cell.
  - **Solar cells** — every 10 m along edges, no respawn (passive income).
- **Spawn points:** 8 starting cells along the perimeter, randomised.
- **Tick budget:** 1500 ticks (25 s wall clock at 60 Hz, but matches
  observe at 2× to 4× speed for spectators).

## 6. Match rules (MVP)

- **Mode:** 1v1 side vs side (1..3 robot types per side, 1..4 robots per
  type, total ≤ 6 robots per side).
- **Win:** last side with at least 1 alive robot.
- **Draw:** both sides extinct at same tick (rare — biomass starvation).
- **Time limit:** 1500 ticks. If both alive, side with more biomass wins.

## 7. AI opponents (scripted)

Three hand-crafted bots ship with MVP:

1. **Drifter** — random walk + collect food, never fights.
2. **Pouncer** — charge nearest enemy, fire blaster when in range.
3. **Breeder** — collector that splits into Constructors when full.

These are written in our IR directly (not DSL) and shipped with the
binary. They form the campaign ladder.

## 8. Progression (MVP)

- **Elo rank** per bot (per-player, per-bot).
- **Bot slots** — 3 free, up to 12 with IAP.
- **Cosmetics:** chassis skins, victory animations, arena themes.
- **Achievements:** "First win", "Win without weapons", etc.

## 9. UX principles

- **Watch your bot run** — every change is testable against a stand-in AI
  in <30 s.
- **No dead ends** — every screen has a "back" and a "next step".
- **Replay is the reward** — losing should feel like a puzzle, not a wall.

## 10. Balance knobs (server-controlled)

All numbers in this doc are stored as **balance constants** on the server
and shipped as a JSON patch per season. We can tune without an app
update.
