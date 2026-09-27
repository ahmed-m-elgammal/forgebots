# ForgeBots — Spec Kit Overview

> **Working title:** *ForgeBots* — a modern, mobile-first, async-PvP programming
> arena inspired by the classic **Grobots** (Devon & Warren Schudy, 1996–2005,
> GPL).
>
> **Status:** v0.1 spec — pre-implementation. Owner: Mavis (planning agent).
> Target stack: **Godot 4 client** + **Node.js/TypeScript server** + **Postgres**.

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

## 2. The pitch (one paragraph)

ForgeBots is a competitive programming game where players design autonomous
robots that fight, gather resources, and reproduce inside a deterministic
arena. Robots are built from a hardware catalog (sensors, engines, weapons,
constructors) and programmed in a *safe, visual-first DSL*. Battles play out
as 1v1 async matches: you submit your bot, the server simulates the fight,
and you watch a frame-by-frame replay. No code ever runs on a third-party
machine in raw form — it compiles to a constrained bytecode that the
server-side sandbox executes tick-for-tick.

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
| 60 Hz fixed-tick simulation | Replays must match exactly |
| Cross-platform: Android, iOS, Windows, macOS, Linux | One team, one codebase |
| Async PvP only in MVP | No real-time matching infra needed on day 1 |

## 5. The MVP (8 weeks, single dev + one artist)

1. Robot **hardware builder** (drag-and-drop chassis with parts)
2. Robot **AI editor** (visual blocks ↔ text DSL)
3. **Simulation arena** (200×200 tile map, 1v1)
4. **Combat + resources** (energy, biomass, blasters, constructors)
5. **3 AI opponents** (scripted scouts)
6. **Deterministic simulator** with seeded RNG
7. **Replay viewer** with timeline scrub
8. **Account + bot save + 1v1 async match**
9. **Progression**: ranked Elo, unlockable chassis skins, bot slots

## 6. Out of scope for MVP

- Real-time multiplayer (live spectator mode)
- Tournament hosting UI (post-MVP — see `18-LIVE-OPS-AND-TELEMETRY.md` § 6;
  no tournament data model is in scope)
- Clans / friends list
- In-app purchases (placeholder store UI only)
- Web build (deferred to v0.3)

## 7. Glossary

| Term | Meaning |
|---|---|
| **Bot** | A player-designed autonomous robot side (1..N types) |
| **Side** | All bots belonging to one player in a match |
| **Tick** | One simulation step (1/60 s in MVP) |
| **Match** | One head-to-head (or vs AI) battle |
| **Replay** | Sequence of events emitted by the simulator |
| **DSL** | The ForgeBots programming language (visual + text) |
| **Sandbox** | Constrained bytecode VM that runs compiled bots |
| **Hardware** | Sensors, engines, weapons, constructors, shields |
| **Arena** | Bounded 2D world with walls, resources, objectives |
