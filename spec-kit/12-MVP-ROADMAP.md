# 12 — MVP Roadmap

## 1. The 8-week plan (single dev + 1 artist)

> **Week = 5 working days.** Estimates assume a senior full-stack dev
> who is comfortable in TypeScript and Godot.
>
> **Weeks 1–3 are specified in detail by
> `20-IMPLEMENTATION-PLAN.md`** (phases 01–14, ~18 working days). The
> engine estimate there is authoritative; this doc's week boundaries
> are a planning convenience, and the 7-day overlap into week 3 is
> deliberate ([`22-DECISIONS.md` D20](22-DECISIONS.md)).

### Week 1 — Simulator core

- [x] Spec kit complete (this folder)
- [ ] `simulator/` skeleton: rng, fixed-point math, parts catalog
      (doc 20 phases 01–03)
- [ ] DSL front-end + IR + verifier (doc 20 phases 04–05)
- [ ] Sandbox VM, cycle-budgeted (doc 20 phase 06)

### Week 2 — Match driver + events

- [ ] Sensors, actuators, bot state (doc 20 phases 07–09)
- [ ] Match driver, tick loop, win check (doc 20 phase 10)
- [ ] Combat, arena, energy (doc 20 phases 11–13)
- [ ] Replay format + golden match hash (doc 20 phase 14)

### Week 3 — Server skeleton

- [ ] Fastify project, Drizzle schema, migrations (`07-DATA-MODEL.md`)
- [ ] Auth (email/password + OAuth)
- [ ] Bots CRUD + validate endpoint
- [ ] Postgres docker-compose for local dev
- [ ] **Overlaps the tail of doc 20 phase 14** — the replay format is
  the contract the server writes against, so it lands first.

### Week 4 — Matchmaking + sim worker

- [ ] `POST /matches` claims a job from the `matches` table
- [ ] Sim worker runs the simulator, writes the replay, updates Elo
- [ ] Elo update + `elo_history`
- [ ] `GET /matches/{id}/replay` returns JSON
- [ ] Seed the 8 ghost bots (`19 § 5`)

### Week 5 — Godot client skeleton

- [ ] Project + scene tree + theme
- [ ] Login screen, dashboard, list-of-bots screen
- [ ] HTTP client wrapper (typed)
- [ ] Bot builder (drag parts into slots) — basic version
- [ ] **1-day spike on mobile export on day 1** (see § 6)

### Week 6 — Bot editor

- [ ] Visual editor (Blockly blocks via an HTML5 view in Godot)
- [ ] Text editor tab (DSL source with syntax highlight)
- [ ] "Run preview" → server-side 300-tick stream against Drifter
      (`08 § 11` — the client does **not** simulate)
- [ ] Save / publish

### Week 7 — Replay viewer + Ladder

- [ ] Replay viewer with timeline scrub, speed, event log
- [ ] Ladder screen (top 50)
- [ ] Match history
- [ ] Cosmetics placeholder UI

### Week 8 — Polish + mobile export

- [ ] iOS export + Android export
- [ ] Onboarding (3 missions vs Drifter / Pouncer / Breeder)
- [ ] Crash & bug bash
- [ ] TestFlight + Play internal track
- [ ] **EN + AR localisation pass** (`21`) — extraction has been
      running since week 5; this is the translation + RTL review

### Buffer (week 9–10)

- [ ] Performance work, balance tuning
- [ ] Real device testing (iOS, Android)
- [ ] Marketing site

## 2. Definition of Done for MVP

The MVP is shippable when ALL of these are true:

- [ ] A user can sign up, log in, build a bot, save it
- [ ] A user can submit a bot for a 1v1 match and receive a replay
  within **30 s (p95)**
- [ ] Re-running a stored match with the same seed **and the same
      balance version** produces an identical `output_sha256`
- [ ] A user can submit bots that compile, verify, and play through
      1500 ticks deterministically
- [ ] The 3 tutorial missions are beatable, and each has a
      guaranteed-win third attempt (`17 § 3.3`)
- [ ] The 8 starter bots all load, run and are covered by golden
      hashes (`spec-kit/examples/golden-seeds.json`)
- [ ] Elo updates correctly after each PvP match, and **not** after
      previews or missions
- [ ] EN + AR strings are complete with zero missing keys (`21 § 1.9`)
- [ ] iOS TestFlight build installs and runs on an iPhone 12
- [ ] Android internal track installs and runs on a Pixel 5
- [ ] No `Math.random` / `Math.*` / `Date.now` / `fetch` in
      `simulator/src/**` (CI lint passes)

## 3. Cut list

If we slip, drop these in order:

1. Cosmetics store UI (data model stays)
2. Mission onboarding (bots stay but no guided path)
3. Ladder screen (history stays)
4. GIF export from the replay viewer
5. Real-time preview stream — fall back to `POST /bots/{id}/simulate`
   returning a finished replay the client plays back, instead of a live
   frame stream. Same server cost, one extra second of latency.

We **never** cut: determinism, IR verification, server-authoritative
matchmaking, replays.

## 4. Quality bar per system

| System | Quality bar |
|---|---|
| Simulator | 100 % deterministic, golden-replay hash on CI (Linux/macOS/Windows) |
| Server | p95 latency < 200 ms, p99 < 500 ms |
| API | OpenAPI generated, all routes typed with Zod |
| Mobile client | 60 fps on iPhone 12 / Pixel 5 |
| Match SLA | Replay ready within 30 s of submit (p95) |
| Replay size | < 150 KB p50, 3 MB hard cap |
| Crash rate | < 0.5 % sessions on first week |
| Cold start | < 3 s to dashboard on mid-range device |

All timing numbers are owned by
[`22-DECISIONS.md` D9](22-DECISIONS.md) and D10; this table quotes them.

## 5. Team & roles (MVP)

| Role | Person |
|---|---|
| Founder / engineer / designer | you (or a hire) |
| Artist (2D pixel art, ui) | contractor |
| Sound (sfx only) | contractor |
| Arabic translation + cultural review | contractor, budgeted in `21 § 1.10` (~$2,900) |
| Marketing | deferred (Discord + Twitter only) |
| QA | same engineer + 5 beta testers |

## 6. Risks specifically called out in roadmap

- Week 5/6 are the crunchiest (Godot client + editor). If we're behind
  by end of week 4, **drop the visual block editor and ship text-only**.
  This loses ~30% of the casual audience but keeps us shipping.
- Mobile export in Godot has bitten many teams. Plan a **1-day spike**
  on day 1 of week 5 to confirm.
- The Blockly-in-Godot bridge is the single riskiest item in the plan
  and has **no spike**, unlike mobile export. If we only get one
  spike, it should be this one. See `15-RISKS.md § 1`.

## 7. After MVP

Once MVP is stable, the natural next moves are:

- v0.2 — Tournaments + clans + Domination/Collection modes + Grafana
  dashboards
- v0.3 — Web build + marketing site + Discord bot integration + dedicated
  sim pool
- v0.4 — Co-op mode (2v2 with ally chat) + community bot library
- v1.0 — Official launch + Steam release + console (Switch)
