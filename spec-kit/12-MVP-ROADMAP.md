# 12 — MVP Roadmap

## 1. The 8-week plan (single dev + 1 artist)

> **Week = 5 working days.** Estimates assume a senior full-stack dev
> who is comfortable in TypeScript and Godot.

### Week 1 — Simulator core

- [x] Spec kit complete (this folder)
- [ ] `simulator/` skeleton: rng, fixed-point math, parts catalog
- [ ] Bot state + per-bot VM (text DSL → IR → bytecode)
- [ ] First golden test: 2 drifter bots → arena stays stable

### Week 2 — Match driver + events

- [ ] Tick loop, sensors, actuators wired to VM
- [ ] Event log emission
- [ ] Replay JSON shape
- [ ] Tests for shot/damage/death, build/reproduction, biomass

### Week 3 — Server skeleton

- [ ] Fastify project, Drizzle schema, migrations
- [ ] Auth (email/password + OAuth placeholders)
- [ ] Bots CRUD + IR validation endpoint
- [ ] Postgres docker-compose for local dev

### Week 4 — Matchmaking + sim worker

- [ ] `POST /matches` queues job in `matches` table
- [ ] Sim worker picks job, runs simulator, writes replay, updates Elo
- [ ] Elo update + history
- [ ] `GET /matches/{id}/replay` returns JSON

### Week 5 — Godot client skeleton

- [ ] Project + scene tree + theme
- [ ] Login screen, dashboard, list-of-bots screen
- [ ] HTTP client wrapper (typed)
- [ ] Bot builder (drag hardware into slots) — basic version

### Week 6 — Bot builder + AI editor

- [ ] Visual editor (Blockly blocks via HTML5 view in Godot)
- [ ] Text editor tab (DSL source with syntax highlight)
- [ ] "Run preview" button → live 5 s sim against Drifter
- [ ] Save / publish

### Week 7 — Replay viewer + Ladder

- [ ] Replay viewer with timeline scrub, speed, event log
- [ ] Ladder screen (top 50)
- [ ] Match history
- [ ] Cosmetics placeholder UI

### Week 8 — Polish + mobile export

- [ ] iOS export + Android export
- [ ] Onboarding (3 hand-crafted missions vs Drifter / Pouncer / Breeder)
- [ ] Crash & bug bash
- [ ] TestFlight + Play internal track

### Buffer (week 9–10)

- [ ] Performance work, balance tuning
- [ ] Real device testing (iOS, Android)
- [ ] Marketing site

## 2. Definition of Done for MVP

The MVP is shippable when ALL of these are true:

- [ ] A user can sign up, log in, build a bot, save it
- [ ] A user can submit a bot for a 1v1 match and receive a replay
  within 30 s
- [ ] The replay is byte-identical when re-run with the same seed
- [ ] A user can submit bots that compile, run, and play through 1500
  ticks deterministically
- [ ] Three AI opponents are unbeatable-by-default (lose to starter bot)
- [ ] Elo updates correctly after each match
- [ ] iOS TestFlight build installs and runs on an iPhone 12
- [ ] Android internal track installs and runs on a Pixel 5
- [ ] No `Math.random` / `Date.now` / `fetch` in `simulator/src/**`
  (CI lint passes)

## 3. Cut list

If we slip, drop these in order:

1. Cosmetics store UI (data model stays)
2. Mission onboarding (bots stay but no guided path)
3. Ladder screen (history stays)
4. Real-time preview (use the slower server preview instead)

We **never** cut: determinism, IR validation, server-authoritative
matchmaking, replays.

## 4. Quality bar per system

| System | Quality bar |
|---|---|
| Simulator | 100% deterministic, golden-replay test on CI |
| Server | p95 latency < 200 ms, p99 < 500 ms |
| API | OpenAPI generated, all routes typed with Zod |
| Mobile client | 60 fps on iPhone 12 / Pixel 5 |
| Match SLA | Replay ready within 30 s of submit (p95) |
| Crash rate | < 0.5% sessions on first week |
| Cold start | < 3 s to dashboard on mid-range device |

## 5. Team & roles (MVP)

| Role | Person |
|---|---|
| Founder / engineer / designer | you (or a hire) |
| Artist (2D pixel art, ui) | contractor |
| Sound (sfx only) | contractor |
| Marketing | deferred (Discord + Twitter only) |
| QA | same engineer + 5 beta testers |

## 6. Risks specifically called out in roadmap

- Week 5/6 are the crunchiest (Godot client + editor). If we're behind
  by end of week 4, **drop the visual block editor and ship text-only**.
  This loses ~30% of the casual audience but keeps us shipping.
- Mobile export in Godot has bitten many teams. Plan a **1-day spike**
  on day 1 of week 5 to confirm.

## 7. After MVP

Once MVP is stable, the natural next moves are:

- v0.2 — Tournaments + clans
- v0.3 — Web build + marketing site + Discord bot integration
- v0.4 — Co-op mode (2v2 with ally chat)
- v1.0 — Official launch + Steam release + console (Switch)
