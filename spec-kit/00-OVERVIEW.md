# ForgeBots — Spec Kit Overview

> **Working title:** *ForgeBots* — a modern, mobile-first, async-PvP programming
> arena inspired by the classic **Grobots** (Devon & Warren Schudy, 1996–2005,
> GPL).
>
> **Status:** pre-implementation. Spec kit version is tracked in
> `README.md` — it versions *this document set*, not the product.
> Owner: Mavis (planning agent). Target stack: **Godot 4 client** +
> **Node.js/TypeScript server** + **Postgres**.

---

## 1. What this document is

This folder is the single source of truth for the ForgeBots design. It is
ordered *bottom-up*, from infrastructure to UX:

```
05-TECH-STACK       06-ARCHITECTURE         07-DATA-MODEL
       ↓                    ↓                       ↓
            08-API-SURFACE → 09-AI-DSL → 10-DETERMINISM
                                      ↓
                              11-REPLAY-FORMAT
                                      ↓
       12-MVP-ROADMAP → 13-UI-UX-WIREFRAMES → 14-MONETIZATION
                                      ↓
                                  15-RISKS
```

Plus the up-front research and licensing notes (01, 02, 03, 04) that justify
*why* we make the choices below. Docs 16–21 (game feel, starter bots,
execution plan, localization) extend this core — see `README.md` for the
full map.

**`22-DECISIONS.md` is load-bearing.** It records every ambiguity that
was open across docs 00–21 and the single answer the rest of the kit
uses. Where two docs disagreed, the conflict was resolved there and
propagated. If a doc contradicts `22`, `22` wins and the doc is a bug.

## 2. The pitch (one paragraph)
ForgeBots is a competitive programming game where players design
autonomous robots that fight, gather resources, and reproduce inside a
deterministic arena. Robots are built from a hardware catalog (sensors,
engines, weapons, constructors) and programmed in a *safe,
visual-first DSL*. Battles play out as 1v1 async matches: you submit
your bot, the server simulates the fight, and you watch a frame-by-frame
replay. No code ever runs on a third-party machine in raw form — it
compiles to a verified IR that a cycle-budgeted VM executes
tick-for-tick, on the server and nowhere else.

## 3. Why "inspired by Grobots" and not a fork

Grobots is a beloved design but its 2005-era C++ engine, Forth dialect, and
desktop-only distribution are blockers for a modern commercial release:

- **GPL copyleft** — any derivative work must ship source under GPL. We want
  to ship a proprietary mobile product, so we will *not* copy source. (See
  `02-LICENSING.md` for the full reasoning.)
- **No mobile, no async PvP, no replay sharing** — modern players expect
  these.
- **Forth dialect** is fun for nerds, hostile for everyone else.

We *reuse the design ideas* (hardware-bounded autonomous robots in a
continuous arena with reproduction) but ship a fresh codebase, fresh brand,
fresh visuals.

## 4. Hard constraints

| Constraint | Why |
|---|---|
| No GPL code is reused or linked | Keep proprietary rights clean |
| No raw user code execution on server | Safety, determinism, anti-cheat |
| Server is authoritative for every match | Anti-cheat, replay fidelity |
| The simulator runs **only** on the server | One implementation, one determinism surface (`22-DECISIONS.md` D3) |
| 60 Hz fixed-tick simulation | Replays must match exactly |
| Fixed-point arithmetic, no floats in the sim | Same, on every CPU |
| Cross-platform: Android, iOS, Windows, macOS, Linux | One team, one codebase |
| Async PvP only in MVP | No real-time matching infra needed on day 1 |

## 5. The MVP (8 weeks, single dev + one artist)

1. Robot **hardware builder** (drag-and-drop chassis with 8 part slots)
2. Robot **AI editor** (visual blocks ↔ text DSL)
3. **Simulation arena** (200 m × 200 m, 1v1)
4. **Combat + resources** (energy, biomass, blasters, grenades, constructors)
5. **8 starter bots** — 3 of them are the tutorial missions, all 8 are
   matchmaking ghosts
6. **Deterministic simulator** with seeded RNG
7. **Replay viewer** with timeline scrub
8. **Account + bot save + 1v1 async match**
9. **Progression**: ranked Elo, unlockable chassis skins, bot slots

## 6. Out of scope for MVP

- Real-time multiplayer (live spectator mode)
- Tournament hosting UI (post-MVP — see `18-LIVE-OPS-AND-TELEMETRY.md` § 6;
  no tournament data model is in scope)
- Game modes beyond Eliminator (Domination / Collection are v0.2+ and
  need a mode data model this spec kit does not define —
  `22-DECISIONS.md` D18)
- Clans / friends list (which is also why the `friend_activity` push
  channel is off by default and has no data source — `21 § 2.3`)
- In-app purchases (placeholder store UI only)
- Web build (deferred to v0.3)
- Grafana dashboards / metrics (v0.2 — `06-ARCHITECTURE.md` § 8)

## 7. Glossary

| Term | Meaning |
|---|---|
| **Bot** | A saved loadout belonging to one player: **1–3 designs** |
| **Design** | One chassis (≤ 8 part slots) plus one program. The unit players actually build and name. |
| **Robot** | One spawned instance of a design in a match |
| **Part slot** | One of the 8 hardware positions on a design |
| **Bot slot** | How many *saved bots* an account may keep (3 free → 30) |
| **Side** | All robots belonging to one player in a match (≤ 6) |
| **Tick** | One simulation step (1/60 s) |
| **Match** | One head-to-head (or vs ghost / mission) battle |
| **Replay** | Tick-grouped event stream emitted by the simulator |
| **DSL** | The ForgeBots programming language (visual + text) |
| **Sandbox** | The cycle-budgeted tree-walking VM over a verified IR |
| **Hardware** | Parts: mobility, sensors, weapons, shields, construction, energy |
| **Arena** | Bounded 2D world with walls, pillars, biomass |
| **Ghost** | A starter-bot `bots` row (`is_ghost = true`) used as a fallback opponent |
| **Balance version** | One immutable `balance_versions` row; a match pins exactly one |

The bot / design / robot / part-slot / bot-slot distinction is the
single most load-bearing vocabulary rule in the spec kit
([`22-DECISIONS.md` D12](22-DECISIONS.md)).
