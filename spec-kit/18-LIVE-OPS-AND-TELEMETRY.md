# 18 — Live Ops, Seasons & Telemetry

> **Owner:** product manager + data engineer.
> **Cross-references:** `07-DATA-MODEL.md` (seasons table),
> `14-MONETIZATION.md` (cosmetics schedule), `12-MVP-ROADMAP.md`
> (post-MVP cadence), `15-RISKS.md` (player experience risks).

This document covers everything that happens *after* launch — what
ships per season, what we measure, how we know if the game is
working, and when we intervene.

## 1. Seasons

### 1.1 The model

A **season** is a 12-week window during which:
- The Elo ladder is competitive.
- A themed arena + skin set ships.
- One or two gameplay tweaks land (small numbers, see § 4).
- A free + premium progression track runs (post-MVP).

### 1.2 What changes per season

| Layer | Changes | Cadence |
|---|---|---|
| **Balance** | Hardware stats, AI behaviour, arena layout | every 4 weeks |
| **Arenas** | New themed arena every season | every 12 weeks |
| **Bots** | New AI opponent each season | every 12 weeks |
| **Cosmetics** | 1 chassis skin pack + 1 arena theme | every 4 weeks |
| **Game modes** | Rotating 1-of-3 (Eliminator / Domination / Collection) | every 4 weeks |
| **Achievements** | 1 seasonal + 3 always-on | every 4 weeks |

### 1.3 What does NOT change per season

- Core game rules (1v1 async, 1500-tick cap, biomass economy).
- Core programming model (DSL keywords are frozen).
- Hardware catalog (additions yes; removals only with 4-week deprecation).
- Replay format (`version: 1` is committed for 18 months — see
  `11-REPLAY-FORMAT.md`).

### 1.4 Seasonal ladder reset

- End of season: top 100 bots get a "Champion" badge.
- All other bots keep their Elo but get soft-reset within 100 points
  toward 1000 over the first 7 days of the new season (so newcomers
  can compete sooner).
- No hard reset (would invalidate replays / break trust).

## 2. Patch cadence

### 2.1 The weekly rhythm

| Day | What |
|---|---|
| Mon | Internal playtest of next patch on staging |
| Tue | Bug triage, balance discussion |
| Wed | Patch ships to internal track (TestFlight / Play internal) |
| Thu | Internal soak (24h of synthetic load) |
| Fri | Patch ships to production (if green) |
| Sat/Sun | Live observation + on-call |

### 2.2 Patch types

| Type | Lead time | Example |
|---|---|---|
| Hotfix | < 24 h | Crash, server outage, balance emergency |
| Patch | 1 week | Number tunings, new cosmetics, bug fixes |
| Season | 12 weeks | New arena, new AI opponent, ladder reset (see § 1.1–1.2) |

### 2.3 Balance patches

Triggered when ANY of:
- Win rate of any hardware part > 70% or < 30% over 1000 matches.
- Any AI opponent beat rate > 60% at its intended difficulty tier.
- Player feedback consensus (>20 complaints on Discord in a week).
- Pre-season planning every 4 weeks regardless.

Balance changes ship as `balance_json` deltas (see `04-GAME-DESIGN.md` §
10). Old replays remain valid; new replays use the new balance.

## 3. Telemetry

### 3.1 Tooling

- **Events:** PostHog (or Amplitude) — server-side ingestion, mobile
  events batched.
- **Logs:** pino JSON → Loki (deferred to v0.3; for MVP, file rotation).
- **Errors:** Sentry (server + Godot client).
- **Replay integrity:** custom job that runs the golden-match hash
  every hour and alerts on drift.

### 3.2 Event taxonomy

Every player-facing event has a stable name, schema, and version.
New events are additive; old events are kept forever (no removal).

| Event | Properties | Fired when |
|---|---|---|
| `app_open` | platform, locale, app_version, session_id | Cold start |
| `session_start` | session_id, source | First user input |
| `login` | method (email/apple/google) | Successful auth |
| `bot_create` | bot_id, hardware_count, parts_used | First save |
| `bot_update` | bot_id, version, hardware_diff | Subsequent saves |
| `bot_publish` | bot_id | Going public |
| `match_request` | bot_id, season_id, elo | POST /matches |
| `match_start` | match_id, opponent_type | Replay view begins |
| `match_end` | match_id, winner, duration_ticks, outcome | Replay view ends |
| `match_share` | match_id, channel | Share link generated |
| `purchase_intent` | sku, surface | Store opened with intent |
| `purchase_complete` | sku, price_cents, platform | Receipt verified |
| `mission_complete` | mission_id, attempts | Mission cleared |
| `mission_fail` | mission_id, tick_of_death | Mission failed |
| `error_client` | code, message, stack_hash | Client crash / API error |

### 3.3 KPIs we obsess over

#### Acquisition
| KPI | Target (90 days post-launch) |
|---|---|
| Install → account | 70% |
| Account → first bot built | 60% |
| First bot built → first PvP | 50% |

#### Retention
| KPI | Target |
|---|---|
| D1 | 45% |
| D7 | 22% |
| D30 | 12% |
| 90-day rolling | 8% |
| First-loss bounce-back (D7 of players who lose their first PvP, vs those who quit — see `15-RISKS.md` § 9.2) | tracked; intervene if the 3× lift disappears |

#### Engagement
| KPI | Target |
|---|---|
| Matches per active user per week | 6 |
| Bot iterations per user per week | 3 |
| Median bot Elo gain (first 10 matches) | +120 |

#### Monetisation (post-MVP)
| KPI | Target |
|---|---|
| Conversion to Forge Pass | 8% |
| ARPDAU | $0.04 |
| Paying user retention (D30) | 50% |

#### Quality
| KPI | Target |
|---|---|
| Crash-free sessions | ≥ 99.5% |
| Match completion rate | ≥ 99% |
| API p95 latency | < 200 ms |
| Sim SLA (p95) | < 30 s |

### 3.4 Funnels we monitor

Three primary funnels, each with weekly review:

1. **Install → Daily active**
   install → account → first bot → first match → 3 matches → day 1 return

2. **Match → Iteration**
   match end → editor open → save → next match → win → next match

3. **Free → Paid** (post-MVP)
   free match → store open → purchase intent → purchase complete

### 3.5 Dashboards

We ship four Grafana boards:

1. **Live** — match rate, error rate, sim queue depth, p95 latency.
2. **Retention** — cohort heatmap, D1/D7/D30, churn by source.
3. **Engagement** — matches per user, bot iteration rate, hardware
   popularity, AI opponent win rates.
4. **Economy** — Forge Pass conversion, ARPDAU, refund rate.

### 3.6 Privacy & consent

- All telemetry is opt-outable from Settings (default: opt-in for
  product analytics, opt-out for marketing).
- No PII in events. User IDs are opaque UUIDs.
- GDPR: account deletion soft-deletes + hashes email; events keep
  user_id but events older than 30 days are anonymised to `deleted_user`.
- We never sell or share event data.
- Privacy policy covers exactly what's collected — see § 7.

## 4. Live ops interventions

### 4.1 When we intervene

| Signal | Action |
|---|---|
| D1 retention drops 5pp WoW | A/B test a Phase 1 change |
| Win rate of one part > 70% | Hotfix balance in ≤ 7 days |
| Crash-free sessions < 99% | Stop feature work, fix crashes |
| Sim SLA p95 > 30 s | Spin up more sim workers (v0.3) |
| Match completion rate < 99% | Investigate sim determinism |
| Negative review spike | Triage within 24h |

### 4.2 When we do NOT intervene

- Hardcore players asking for harder content — release the AI opponents
  & difficulty modes over seasons instead.
- Single bad review with valid complaint but tiny impact — fix in next
  regular patch.
- "Game is too easy / too hard" debate — show numbers; if data says
  balanced, hold the line.

## 5. Communications calendar

| Channel | Cadence | Audience |
|---|---|---|
| In-app banner | At season launch + at every patch | All players |
| Push notification | Per-channel caps, ≤ 3/week global (`match_ready` exempt) — see `21-LOCALIZATION-AND-NOTIFICATIONS.md` § 2.4 | All opted-in |
| Discord | Daily | Community |
| Email | Monthly digest + season wrap | Account-holders with email |
| Twitter/X | 3× per week | Followers |
| Steam news (post v1.0) | At every patch | Steam users |

## 6. Tournaments & events (post-MVP)

- **Weekly automated tournament:** top 32 from the ladder face off in
  a single-elimination bracket, server-rendered, no live participation
  needed. Top 4 get cosmetic rewards.
- **Season finale event:** 4-week ladder, top 100 gets a unique skin.
- **Community tournaments:** players can submit their own brackets via
  admin tooling (v0.4).

## 7. Compliance & legal ops

- **GDPR / CCPA:** privacy policy URL on first launch, opt-in toggles
  in Settings, account deletion API.
- **Age ratings:** IARC questionnaire submitted for each platform.
- **EULA:** plain-language, version-tracked, accept-on-signup.
- **Refund handling:** honour App Store / Play Store rules, revoke
  cosmetics on refund.
- **Audit log:** `audit_log` table (see `07-DATA-MODEL.md`) records
  every account-level action for 2 years.

## 8. Open questions

- Should seasons be hard-reset (clean slate every 12 weeks) or
  persistent (no reset)? Currently: persistent + soft-adjust.
- Should we ship a "battle pass" in v0.2? Currently: yes, but only if
  Forge Pass conversion is < 5% (otherwise the pass is unnecessary).
- How aggressively do we balance? Currently: only when data crosses
  thresholds. Resist "patch for the loudest voice" trap.
