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
| **Balance** | Hardware stats, AI behaviour, arena layout | every 4 weeks → a new `balance_versions` row |
| **Arenas** | New themed arena (and its music track) | every 12 weeks |
| **Bots** | New AI opponent | every 12 weeks |
| **Cosmetics** | 1 chassis skin pack + 1 arena theme | every 4 weeks |
| **Achievements** | 1 seasonal + 3 always-on | every 4 weeks |
| **Game modes** | *n/a in MVP* | v0.2+ |

**Game modes.** An earlier version of this table promised a rotating
1-of-3 (Eliminator / Domination / Collection) every 4 weeks. MVP ships
**one** mode, Eliminator (`04-GAME-DESIGN.md § 6`), and
Domination/Collection need a mode data model — win conditions, per-mode
scoring, per-mode balance — that this spec kit does not define.
Promising them as a 4-week rotation meant promising a data model nobody
had specced ([`22-DECISIONS.md` D18](22-DECISIONS.md)). They are a v0.2
scope item.

### 1.3 What does NOT change per season

- Core game rules (1v1 async, 1500-tick cap, biomass economy).
- Core programming model (DSL keywords are frozen).
- Hardware catalog (additions yes; removals only with 4-week deprecation).
- Replay format (`version: 1` is committed for 18 months — see
  `11-REPLAY-FORMAT.md` § 9).
- **Simulator determinism guarantees.** A balance change may alter
  outcomes; it may never alter the replay format or the hash
  computation.

### 1.4 Seasonal ladder reset

- End of season: top 100 bots get a "Champion" badge
  (`user_achievements` + a `cosmetics.kind = 'skin'` grant,
  `07-DATA-MODEL.md § 2.11`).
- All other bots keep their Elo but are soft-adjusted within 100 points
  toward 1000 over the first 7 days of the new season (so newcomers can
  compete sooner).
- No hard reset (would invalidate replays / break trust).
- Ghost bots reset with everyone, so a new season does not leave new
  players facing season-1 ghosts at 1800 Elo.

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

Balance changes ship as a **new `balance_versions` row** inside the
current season (`07-DATA-MODEL.md § 2.3`), with its own `sha256`.
Existing rows are immutable. `matches.balance_version_id` pins the row
a match ran under, so:

- old replays remain valid and re-verifiable forever;
- new matches pick up the new row without an app update;
- the client fetches `GET /seasons/current` to render the builder
  against the right catalog.

This is the mechanism `04-GAME-DESIGN.md § 10` refers to. An earlier
version of the spec had balance as one `seasons.balance_json` document
with no home for a mid-season patch.

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
| `bot_create` | bot_id, designs, part_count, parts_used | First save |
| `bot_update` | bot_id, code_version, parts_diff | Subsequent saves |
| `bot_publish` | bot_id | Going public |
| `bot_verify_failed` | error_code, line | A save was rejected by the verifier |
| `preview_start` | bot_id, opponent, ticks | Editor "Run preview" |
| `match_request` | bot_id, season_id, bot_elo, band | `POST /matches` |
| `match_queued` | match_id, kind, opponent_type, eta_seconds | Sim job enqueued |
| `match_sim_done` | match_id, wall_ms, cycles_total, replay_bytes | Simulator finished |
| `match_end` | match_id, kind, winner, win_reason, duration_ticks, outcome, **contested** | Match resolved |
| `replay_opened` | match_id, since_tick | Replay view begins |
| `replay_scrub` | match_id, target_tick, direction | Scrub (sampled at 1 Hz) |
| `match_share` | match_id | Share link generated |
| `replay_bookmark` | replay_id | Bookmarked |
| `notification_sent` | channel, scheduled_lag_ms | Push dispatched |
| `notification_opened` | channel | Deep link opened |
| `purchase_intent` | sku, surface | Store opened with intent |
| `purchase_complete` | sku, price_cents, platform | Receipt verified |
| `mission_start` | mission_id, attempt | `POST /missions/{id}/start` |
| `mission_complete` | mission_id, attempts, tick_reached | Mission cleared |
| `mission_fail` | mission_id, tick_of_death, reason | Mission failed |
| `achievement_unlock` | achievement_key | Achievement granted |
| `error_client` | code, message, stack_hash | Client crash / API error |

**`contested` is not optional.** A match where the two sides never
detected each other is a walkover, and counting it as a normal win
makes a bot that farms easy ghost opponents look better in the data
than it is. The predecessor game hit exactly this: its survival metric
was quietly broken by "sterile" matches until the organisers added a
non-sterile column. `contested = false` when neither side acquired an
enemy hit for the whole match. See
`legacy/02-strategy-catalogue.md § 5`.

Corrections to the previous taxonomy:

- `match_start` / `match_end` used to fire when the **replay view**
  opened and closed, which is a UI event wearing a simulation event's
  name — and it collided with the `match_end` replay event kind
  (`11-REPLAY-FORMAT.md § 4`). Simulated lifecycle is `match_request` /
  `match_queued` / `match_sim_done` / `match_end`; viewing is
  `replay_opened` / `replay_scrub`.
- `mission_start` was missing while `17-ONBOARDING.md § 6` measures a
  mission retry rate. Without it, a retry is indistinguishable from a
  first attempt.
- Push delivery had no events at all, despite `21` § 2.10 setting open
  and opt-out-rate targets per channel.
- `bot_create` reported `hardware_count`; the vocabulary is now designs
  and parts (`22-DECISIONS.md` D12).
- **A telemetry event name must never equal a replay event kind.** They
  are separate namespaces, joined by `match_id`.

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
| Replay size (p50) | < 150 KB |
| **Contest rate** — fraction of PvP matches where both sides engaged | **> 70%** |
| Golden-hash match with production | 100% |

**Contest rate is new, and it is the honest one.** Every other quality
metric can be satisfied by a game where nobody fights. This one cannot:
it measures whether players are actually playing each other rather than
walking into ghosts. It is the KPI the predecessor game had to invent
mid-project after discovering its survival numbers were measuring
nothing (`legacy/02-strategy-catalogue.md § 5`).

All retention figures elsewhere in this section are **post-launch
targets for a mature install base**, not launch-week promises. In week
one the denominators are too small for any of them to mean anything.

### 3.4 Funnels we monitor

Three primary funnels, each with weekly review:

1. **Install → Daily active**
   install → account → first bot → first match → 3 matches → day 1 return

2. **Match → Iteration**
   match end → editor open → save → next match → win → next match

3. **Free → Paid** (post-MVP)
   free match → store open → purchase intent → purchase complete

### 3.5 Dashboards

**No dashboards ship in MVP.** `15-RISKS.md` § 5 ("no metrics
dashboard, pino logs only") is the accurate statement; this section
previously claimed four Grafana boards shipped at launch, which
contradicted it and `06-ARCHITECTURE.md` § 8.

The four boards are a **v0.2** deliverable, built once there is enough
volume for a board to be worth maintaining:

1. **Live** — match rate, error rate, sim queue depth, p95 latency.
2. **Retention** — cohort heatmap, D1/D7/D30, churn by source.
3. **Engagement** — matches per user, bot iteration rate, part
   popularity, AI opponent win rates.
4. **Economy** — Forge Pass conversion, ARPDAU, refund rate.

**What replaces them in MVP:** the `notifications`, `replays` and
`elo_history` tables are queryable directly, `GET /health` gives the
golden replay hash, and a weekly query pack covers the KPI table in
§ 3.3. That is enough to run an 8-week launch; it is not enough to run
live ops, which is the honest reason this is on the v0.2 list.

### 3.6 Privacy & consent

- All telemetry is opt-outable from Settings (default: opt-in for
  product analytics, opt-out for marketing). The consent prompt is
  shown before the first `app_open` is sent, not after.
- **Push is separate from analytics consent.** No device token is
  registered, and no permission prompt is shown, until the player has
  won a match (`21` § 2.8). Bundling the two would let us ship a
  notification prompt on day one that we have no value to justify.
- No PII in events. User IDs are opaque UUIDs. `error_client.message` is
  truncated and pattern-scrubbed before it leaves the client — a stack
  message can contain user input.
- GDPR: account deletion soft-deletes (`users.deleted_at`) and clears
  the encrypted address; events keep `user_id` but events older than 30
  days are anonymised to `deleted_user`.
- We never sell or share event data.
- Privacy policy covers exactly what's collected — see § 7.
- The first launch shows the privacy policy URL and the consent choice
  **before** the sign-up form, not on a settings screen the player has
  to find.

## 4. Live ops interventions

### 4.1 When we intervene

| Signal | Action |
|---|---|
| D1 retention drops 5pp WoW | A/B test a Phase 1 change |
| Win rate of one part > 70% | Ship a new `balance_versions` row within 7 days |
| Crash-free sessions < 99% | Stop feature work, fix crashes |
| Sim SLA p95 > 30 s | Ship a dedicated sim pool (was v0.3; pull it forward) |
| Match completion rate < 99% | Investigate sim determinism — run the golden hashes by hand |
| Replay size p50 > 150 KB | Check that `move`/`aim` de-duplication still works |
| Contest rate < 70% | The ghost pool is too easy or too close in Elo. Widen the band, or add a stronger ghost |
| Negative review spike | Triage within 24h |

Every one of these is a query against `replays`, `notifications` and
`elo_history` plus the KPI queries in § 3.3. None needs a dashboard,
which is why MVP can ship without one.

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
| Email | Monthly digest + season wrap | Account-holders with a stored address who have not opted out |
| Twitter/X | 3× per week | Followers |
| Steam news (post v1.0) | At every patch | Steam users |

Nothing in this table is sent to anyone who has not opted in to that
channel. "All players" for the in-app banner is safe because the app is
open; it is not a licence to notify.

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
