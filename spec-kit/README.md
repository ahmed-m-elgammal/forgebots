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
20. **[19-STARTER-BOTS-AND-LIBRARY.md](19-STARTER-BOTS-AND-LIBRARY.md)** —
    8 starter bots (Pebble, Glow, Drifter, Pouncer, Breeder, Reaper,
    Swarm-Mind, Sentinel), pattern library, behavioural tests.
21. **[20-IMPLEMENTATION-PLAN.md](20-IMPLEMENTATION-PLAN.md)** —
    14-phase build plan for the engine/logic/physics stack (no UI/UX),
    each phase with spec deps, tasks, sub-tasks, AI-agent context.
22. **[21-LOCALIZATION-AND-NOTIFICATIONS.md](21-LOCALIZATION-AND-NOTIFICATIONS.md)** —
    string extraction (ARB source-of-truth, CI lint), translation
    workflow (Lokalise/POEditor), RTL layout for Arabic launch
    (EN+AR), Godot TranslationServer wiring, 6-channel push
    notification strategy with frequency caps, opt-in UX, deep
    links, and per-channel opt-out.
23. **[22-DECISIONS.md](22-DECISIONS.md)** — **read this first if
    anything looks contradictory.** Every ambiguity that was open
    across docs 00–21, and the single answer the rest of the kit
    uses. Where two docs disagreed, the conflict was resolved here
    and propagated. **Where a doc contradicts this one, this one
    wins and the doc is a bug.**

## How the docs split responsibilities

- **Docs 00–15** are the *original* spec. Engineering + product core.
- **Docs 16–18** are the *game-feel additions* added after a critical
  review. They fill gaps that were missing from the engineering spec
  but matter for whether players stay.
- **Docs 19–20** are the *execution layer*. 19 is what we ship
  pre-built; 20 is how we build the engine.
- **Doc 21** is the *launch-readiness layer*: localization (EN+AR) and
  push notifications.
- **Doc 22** is the *conflict-resolution layer*: the decisions that
  removed the contradictions between the above. It owns numbers
  (units, timings, Elo, geometry) and vocabulary.

| Doc | Owns |
|---|---|
| `04-GAME-DESIGN.md` | Mechanics, hardware catalog, arena, match rules |
| `09-AI-DSL.md` | The language, the verifier, the VM |
| `10-DETERMINISM.md` | Fixed point, RNG, hash, platform coverage |
| `11-REPLAY-FORMAT.md` | Replay schema, event volume, size budget |
| `13-UI-UX-WIREFRAMES.md` | Steady-state screens, navigation map, replay viewer |
| `16-JUICE-AND-AUDIO.md` | Motion language, particles, SFX catalog, music strategy |
| `17-ONBOARDING.md` | First 60 seconds, mission ladder, bounce-back, first-loss UX |
| `18-LIVE-OPS-AND-TELEMETRY.md` | Seasons, balance cadence, KPIs, telemetry |
| `19-STARTER-BOTS-AND-LIBRARY.md` | Starter bots, pattern library, ghost seeding |
| `20-IMPLEMENTATION-PLAN.md` | Phased build plan, AI-agent prompts, deps |
| `21-LOCALIZATION-AND-NOTIFICATIONS.md` | L10n pipeline (EN+AR launch), RTL, push strategy |
| `22-DECISIONS.md` | Units, timings, energy/HP model, vocabulary, resolved conflicts |
| `examples/*.fb` | Canonical starter-bot DSL sources (source of truth for doc 19) |
| `examples/golden-seeds.json` | Golden match definitions and seeds |

If you're a new contributor:
- Engineers start at `05` → `11`, then follow `20` for execution.
- Designers start at `04` → `17`, then `19`.
- Artists start at `13` → `16`.
- Product / ops start at `18` → `15` (risks).
- Founder reads `00` → all (skim-mode).
- AI coding agents: read the relevant section of `20` for prompts.

## Code that lives next to this spec kit

> Implementation is **deferred**. The spec kit is the deliverable for
> the planning phase. The directory skeleton below is now **in place**
> as empty placeholders (per-module README stubs + `.gitkeep`, no code);
> Phase 01+ of `20-IMPLEMENTATION-PLAN.md` fills it in:

```
forgebots/
├── simulator/                    ← Deterministic TS core (scaffolded)
│   ├── src/                      ← empty — Phases 02–14
│   └── test/fixtures/            ← empty — Phase 14 golden matches
├── server/                       ← Node.js + Fastify + Postgres (scaffolded)
│   ├── migrations/               ← empty — forward-only SQL (07 § 5)
│   └── src/                      ← empty — http/ db/ domain/ sim/ auth/ seasons/ notifications/
├── client/                       ← Godot 4 project (scaffolded)
│   ├── i18n/ · src/i18n/ · src/juice/  ← empty — doc 21 § 3, doc 16 § 5
│   └── scenes/ ui/ net/ editor/ sim/ assets/  ← empty — 06 § 2
├── web/                          ← Marketing site, optional (scaffolded)
└── spec-kit/                     ← This folder
```

Each module has a `README.md` stub mapping its planned files to the
spec sections that define them.

## Status

- Spec kit: **v0.6** (conflict-resolution pass). Every contradiction
  found across docs 00–21 was resolved in
  [`22-DECISIONS.md`](22-DECISIONS.md) and propagated to the owning
  doc. Summary of what changed in v0.6:
  - **Units.** Q16.16 in **metres** (the old "Q16.16 with mm
    precision" overflowed at ±32.7 m in a 200 m arena). DSL and wire
    formats are integer millimetres.
  - **One VM, one language.** The bytecode stage was dropped in favour
    of the tree-walking interpreter doc 20 already specified. The
    client **no longer simulates** — there is no C#/GDScript port, and
    the five-platform replay-hash claim is withdrawn.
  - **One cycle-budget behaviour.** Abort-and-discard, no partial
    carry-over, no auto-throttle.
  - **Energy model fixed.** `floor(watts/60)` made every part under
    60 W free. Now integer milliwatts with a carried remainder.
  - **Schema made executable.** `matches.created_at` now exists (three
    indexes referenced a missing column); the circular
    `matches.replay_id` ↔ `replays.match_id` pair is gone;
    `balance_versions` gives the 4-week balance cadence somewhere to
    live; bookmarks, share links, missions, achievements and the push
    tables now exist.
  - **Starter bots corrected.** Two had a `dist` bug that measured from
    the arena origin; one built only when it had no biomass; one had
    80-second assumptions in a 25-second match. Quoted win rates were
    mutually contradictory and never measured, so they are removed
    pending real output.
  - **Timing unified.** 1 s / 2 s / 6 s / 18 s / 30 s are now one table
    in `22-DECISIONS.md D9`.
- Project skeleton: **scaffolded** — `simulator/`, `server/`, `client/`,
  `web/` exist as empty placeholders (no implementation code).
- Implementation: **not started** (deferred per planning phase).

Last updated: 2026-09-27.
