# ForgeBots — Spec Kit

The complete design and engineering specification for **ForgeBots**,
a modern, mobile-first, async-PvP programming arena inspired by the
classic Grobots (Devon & Warren Schudy, GPL).

## Reading order

1. **[00-OVERVIEW.md](00-OVERVIEW.md)** — the one-paragraph pitch and
   scope.
2. **[01-RESEARCH.md](01-RESEARCH.md)** — original Grobots + the
   modern field.
3. **[02-LICENSING.md](02-LICENSING.md)** — GPL analysis and our
   clean-room rules.
4. **[03-DIFFERENTIATION.md](03-DIFFERENTIATION.md)** — how we win.
5. **[04-GAME-DESIGN.md](04-GAME-DESIGN.md)** — mechanics, hardware,
   arena, modes.
6. **[05-TECH-STACK.md](05-TECH-STACK.md)** — Godot + Node + Postgres.
7. **[06-ARCHITECTURE.md](06-ARCHITECTURE.md)** — module layers,
   request flow, dependency rules.
8. **[07-DATA-MODEL.md](07-DATA-MODEL.md)** — Postgres schema.
9. **[08-API-SURFACE.md](08-API-SURFACE.md)** — REST endpoints.
10. **[09-AI-DSL.md](09-AI-DSL.md)** — the safe programming system.
11. **[10-DETERMINISM.md](10-DETERMINISM.md)** — how we stay byte-perfect.
12. **[11-REPLAY-FORMAT.md](11-REPLAY-FORMAT.md)** — replay schema.
13. **[12-MVP-ROADMAP.md](12-MVP-ROADMAP.md)** — 8-week plan + cut list.
14. **[13-UI-UX-WIREFRAMES.md](13-UI-UX-WIREFRAMES.md)** — screens,
    flow, visual system.
15. **[14-MONETIZATION.md](14-MONETIZATION.md)** — pricing & revenue.
16. **[15-RISKS.md](15-RISKS.md)** — RAG-rated risks + mitigations.

## Code that lives next to this spec kit

- **`/simulator/`** — the deterministic TypeScript simulation core.
- **`/server/`** — Node.js + Fastify + Postgres server.
- **`/client/`** — Godot 4 project (C# + GDScript).
- **`/forgebots.code-workspace`** — VS Code workspace file.

## Status

- Spec kit: **complete (v0.1)**.
- Simulator scaffold: **started** (rng, fixed-point math, parts catalog,
  basic VM).
- Server: **planned** (this folder; code in `/server/`).
- Client: **planned** (Godot project in `/client/`).

Last updated: 2026-09-27.
