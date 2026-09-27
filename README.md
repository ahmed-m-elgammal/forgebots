# ForgeBots

A modern, mobile-first, async-PvP programming arena inspired by the
classic [Grobots](https://grobots.sourceforge.net/) (Devon & Warren
Schudy, GPL).

> **ForgeBots is an independent work.** No code or assets from the
> original Grobots project are reused. See
> [`spec-kit/02-LICENSING.md`](spec-kit/02-LICENSING.md) for the full
> clean-room rationale.

## What's in this repo

Right now: **a spec kit only**. No implementation code yet.

```
spec-kit/
├── README.md                  ← reading order
├── 00-OVERVIEW.md             ← one-paragraph pitch + MVP scope
├── 01-RESEARCH.md             ← Grobots deep-dive + modern field
├── 02-LICENSING.md            ← GPL clean-room rules
├── 03-DIFFERENTIATION.md      ← vs Gladiabots / Screeps / Robocode
├── 04-GAME-DESIGN.md          ← mechanics, hardware, arena, modes
├── 05-TECH-STACK.md           ← Godot 4 + Node + Postgres
├── 06-ARCHITECTURE.md         ← UI → Logic → Sim → Net → DB
├── 07-DATA-MODEL.md           ← full Postgres schema
├── 08-API-SURFACE.md          ← REST + WebSocket
├── 09-AI-DSL.md               ← safe programming system
├── 10-DETERMINISM.md          ← 60Hz fixed-tick + Q16.16 + RNG
├── 11-REPLAY-FORMAT.md        ← event schema + streaming
├── 12-MVP-ROADMAP.md          ← 8-week plan + cut list
├── 13-UI-UX-WIREFRAMES.md     ← every screen
├── 14-MONETIZATION.md         ← cosmetics, no pay-to-win
├── 15-RISKS.md                ← RAG-rated
└── examples/
    ├── sample-bot.fb          ← reference bot in the DSL
    └── drifter.fb             ← AI opponent template
```

## Quick pitch

Players design autonomous robots from a hardware catalog (engines,
sensors, weapons, constructors) and program them in a safe,
visual-first DSL. Battles play out as 1v1 async matches: you submit
your bot, the server simulates the fight deterministically, and you
watch a frame-by-frame replay. No raw user code ever runs on the
server — it compiles to a constrained bytecode that a cycle-budgeted
VM executes tick-for-tick.

## Working title

**ForgeBots** — open to better names. Trademarks and "Grobots" name
are explicitly avoided.

## License

The spec kit is released under **CC-BY 4.0** — share, remix, attribute.

```
Copyright 2026 Ahmed Elgammal / ForgeBots contributors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0
```

(When implementation starts, the simulator and server will be
proprietary; client may go MIT at v1.0.)

## Status

- Spec kit: **complete (v0.1)**
- Implementation: **not started**
- Last updated: 2026-09-27
