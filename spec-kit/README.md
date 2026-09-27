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
6. **[05-TECH-STACK.md](05-TECH-STACK.md)** — Godot + Node + Postgres
   + CI/CD + mobile perf budgets.
7. **[06-ARCHITECTURE.md](06-ARCHITECTURE.md)** — module layers,
   request flow, dependency rules.
8. **[07-DATA-MODEL.md](07-DATA-MODEL.md)** — Postgres schema.
9. **[08-API-SURFACE.md](08-API-SURFACE.md)** — REST endpoints.
10. **[09-AI-DSL.md](09-AI-DSL.md)** — the safe programming system.
11. **[10-DETERMINISM.md](10-DETERMINISM.md)** — how we stay byte-perfect.
12. **[11-REPLAY-FORMAT.md](11-REPLAY-FORMAT.md)** — replay schema.
13. **[12-MVP-ROADMAP.md](12-MVP-ROADMAP.md)** — 8-week plan + cut list.
14. **[13-UI-UX-WIREFRAMES.md](13-UI-UX-WIREFRAMES.md)** — steady-state
    screens + navigation map.
15. **[14-MONETIZATION.md](14-MONETIZATION.md)** — pricing & revenue.
16. **[15-RISKS.md](15-RISKS.md)** — engineering + player-experience
    risks + mitigations.
17. **[16-JUICE-AND-AUDIO.md](16-JUICE-AND-AUDIO.md)** — motion
    language, hit-stop, particles, SFX + music brief.
18. **[17-ONBOARDING.md](17-ONBOARDING.md)** — first-60-seconds beat
    sheet, mission ladder, bounce-back.
19. **[18-LIVE-OPS-AND-TELEMETRY.md](18-LIVE-OPS-AND-TELEMETRY.md)** —
    seasons, patch cadence, KPIs, dashboards, telemetry events.

## How the docs split responsibilities

- **Docs 00–15** are the *original* spec. Engineering + product core.
- **Docs 16–18** are the *game-feel additions* added after a critical
  review. They fill gaps that were missing from the engineering spec
  but matter for whether players stay.

| Doc | Owns |
|---|---|
| `13-UI-UX-WIREFRAMES.md` | Steady-state screens, navigation map, replay viewer |
| `16-JUICE-AND-AUDIO.md` | Motion language, particles, SFX catalog, music strategy |
| `17-ONBOARDING.md` | First 60 seconds, mission ladder, bounce-back, first-loss UX |
| `18-LIVE-OPS-AND-TELEMETRY.md` | Seasons, patches, KPIs, telemetry, dashboards |

If you're a new contributor:
- Engineers start at `05` → `11`.
- Designers start at `04` → `17`.
- Artists start at `13` → `16`.
- Product / ops start at `18` → `15` (risks).
- Founder reads `00` → all (skim-mode).

## Code that lives next to this spec kit

> Implementation is **deferred**. The spec kit is the deliverable for
> the planning phase. When implementation starts, the layout will be:

```
forgebots/
├── simulator/                    ← Deterministic TS core
├── server/                       ← Node.js + Fastify + Postgres
├── client/                       ← Godot 4 project
└── spec-kit/                     ← This folder
```

## Status

- Spec kit: **v0.2** (added juice/audio, onboarding, live-ops, plus
  CI/CD + mobile perf budgets in `05`, navigation map in `13`, player
  experience risks in `15`).
- Implementation: **not started** (deferred per planning phase).

Last updated: 2026-09-27.
