# 15 — Risks & Mitigations

## 1. Highest risks (RAG-rated)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Simulator nondeterminism on iOS/Android | Medium | Critical | Fixed-point math, CI replay hash, golden test |
| Godot mobile export pitfall (signing, plugins) | High | High | Spike on day 1 of week 5; budget 2 weeks of mobile-only QA |
| Mobile UI too cramped for the builder | Medium | High | Rehearse wireframes on a phone-sized sketch early |
| Network/play store approval delays | Medium | Medium | Internal track from week 6; TestFlight from week 8 |
| GPL contamination accident | Low | Critical | Clean-room rules in `02-LICENSING.md`; CI grep for forbidden patterns |
| Player's bot loops the simulation forever | Medium | High | Cycle budget enforced at VM level |
| Match farming / Elo abuse | Medium | Medium | Elo updates bounded per day per bot; rate limits |
| Server cost explodes on launch spike | Low | Medium | MVP in-process sim; defer dedicated pool |
| Solo dev burnout | High | High | 8-week plan + 2-week buffer; cut list defined; Friday afternoons off |
| Audience too niche (no commercial viability) | Medium | High | Validate with 5 closed-beta testers by end of week 4 |
| Visual editor (Blockly) too heavy on mobile | Medium | Medium | Fall back to text-only editor (already in plan) |

## 2. Determinism risks in detail

| Sub-risk | Mitigation |
|---|---|
| `Math.sin` on different CPUs | Lookup table only |
| `Map` iteration order differs across V8 versions | Use sorted arrays internally |
| Date-based seed leak | Reject `Date.now` / `performance.now` via lint |
| JSON serialisation of NaN | Pre-validate before emit; canonical encoder |
| Float arithmetic in UI but not sim | UI uses Godot doubles; sim uses TS ints |
| Async I/O on server side | Sim is sync; queue worker is async but writes results |
| Database load skewing timings | Replay hash is computed *after* DB write, against deterministic sim output only |

## 3. Legal risks

| Risk | Mitigation |
|---|---|
| Accidental GPL use | Clean-room rules; CI grep; legal review before launch |
| Trademark on "Grobots" name | We use ForgeBots; explicit attribution only |
| User-submitted code copyright | Users own their code; they license it to us for execution + display |
| Apple / Google policy violation (no IAP on digital goods) | All paid items route through App Store / Play IAP |
| GDPR / CCPA | Account deletion soft-delete + hash; export-my-data endpoint |

## 4. Product risks

| Risk | Mitigation |
|---|---|
| Game is "too hard" — onboarding churn | Three scripted AI opponents; tutorial missions; tooltips everywhere |
| Game is "too slow" — boring matches | 25 s median match length is the target (1500 ticks @ 60 Hz); tune via faster constructors |
| Visual block editor is intimidating | Text fallback; sensible default bot scaffold; "Start from example" button |
| Async matchmaking empty at launch | Seed matchmaking with the 8 starter bots as ghost opponents in week 4 |

## 5. Technical debt watchlist

We're deliberately accepting some debt in MVP to ship. Call it out:

- **In-process sim worker.** Will be replaced with a queue when load
  hits 10 matches/min.
- **JSONB replays.** Will move to compressed object storage at 1 GB
  total replays.
- **No E2E tests.** Will add Playwright + Godot integration tests post-MVP.
- **No metrics dashboard.** Pino logs only.
- **Single Postgres.** No read replicas. Easy to add later.
- **Drizzle ORM raw SQL fallbacks.** Acceptable; SQL is small and readable.

## 6. Security risks

| Risk | Mitigation |
|---|---|
| Auth bypass | Zod validates every input; JWT signed with HS256 + rotating secret |
| Bot IR injection | Server runs verifier; rejects any IR not produced by our compiler |
| DOS via huge bots | IR size cap + cycle cap + memory cap |
| Replay tampering | `output_sha256` stored; viewers trust server replay only |
| PII leak in logs | Pino redact rules; no email in logs |
| DDoS on API | Fly.io edge + basic rate limits (60/min/user) |

## 7. When to abandon a feature

Hard rule: if a feature doesn't have a unit test by end of its planned
week, it's cut. Better to ship a smaller game than to ship a broken one.

## 8. The "things I'd want to know in 6 months" list

- What was the median cycle count for top-of-ladder bots? (Tune the
  cap.)
- What % of players use the visual editor vs text? (Drives roadmap.)
- What's the p95 matchmaking wait time? (Drives ghost-bot seeding.)
- What's the match length distribution? (Drives balance patches.)
- What's the crash-free sessions %? (Drives mobile QA.)
- What's the 1-day, 7-day, 30-day retention? (Drives everything.)

## 9. Player Experience Risks

These are the risks unique to a *game* (vs a generic app). They don't
kill you on day 1 — they kill you on day 30.

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Onboarding is too slow / unclear** | High | Critical | 60-second beat sheet (`17-ONBOARDING.md` § 2); pre-filled starter bot; bounce-back after 2 losses; measure funnel weekly |
| **First PvP loss feels unfair** | High | High | Mechanical advice card on loss, generated from event log; see `17-ONBOARDING.md` § 4.2 |
| **Match feels sterile without juice** | Medium | High | Dedicated juice/audio brief (`16-JUICE-AND-AUDIO.md`); hit-stop, camera shake, particles per event; music adaptive |
| **Game feels too slow (boring matches)** | Medium | High | 25 s median match (1500 ticks @ 60 Hz); tunable via balance.json; tracked via match length distribution |
| **Game feels too hard (churn)** | Medium | Critical | 3 mission ladder with bounce-back; ghost bots in matchmaking for new players; Elo ±200 in first 5 matches |
| **Visual editor (Blockly) too cramped on phone** | High | High | Mobile-first sizing; fall back to text-only editor; consider an "edit on web, sync to mobile" path post-MVP |
| **Players feel "I have no chance" against top bots** | Medium | High | Elo matchmaking + decay; seasonal soft-reset; casual vs ranked modes (post-MVP) |
| **Replay viewer too complex** | Low | Medium | Default speed 1×, simple timeline; advanced stats overlay off by default; iteration of UX post-launch |
| **No content after first 10 matches** | High | High | 3 AI opponents shipped MVP; ladder provides infinite social content; seasonal arena + AI per 12 weeks |
| **Audio is annoying / overpowering** | Low | Medium | Ducking, mute, SFX-only mode; user testing on first 50 players |
| **Localization missing at launch** | Medium | Medium | EN+AR ships at MVP via the `21-LOCALIZATION-AND-NOTIFICATIONS.md` pipeline (extraction from day 1); further locales post-MVP |
| **Accessibility gaps block a player segment** | Medium | Medium | WCAG AA + reduce motion + tap targets ≥ 44 pt; colorblind mode; see `13-UI-UX-WIREFRAMES.md` § 11 |
| **Push notifications become spam** | Medium | Medium | Frequency caps + quiet hours + opt-in only (`21-LOCALIZATION-AND-NOTIFICATIONS.md` § 2.4: ≤ 3 pushes/week across channels, `match_ready` exempt) |

### 9.1 The "fun ceiling" problem

A bot-programming game has a ceiling — once you've mastered the
DSL, what's left? Mitigations:

- **Seasonal content** — new arena + new AI each season.
- **Ladder** — social competition has no ceiling.
- **Tournament tooling** (v0.2) — community-run brackets.
- **Creative expression** — shareable bot code, replays, GIFs.
- **Mastery depth** — even at high Elo, players discover new strategies.

The fun ceiling is real, but it's *out-year* problem, not MVP. We
just need to make sure the ceiling is at least 6 months out for an
average player.

### 9.2 "The first loss is the most important moment"

Players who lose their first PvP match and bounce back to try again
have 3× the D7 retention of players who lose and quit. We measure
this metric (see `18-LIVE-OPS-AND-TELEMETRY.md` § 3.3) and intervene
when it drops.

## 10. Open risks requiring a human decision

These need a real call from the founder, not a spec:

- **Solo vs team ship.** MVP assumes one engineer + one artist. If
  the founder is alone, cut scope (text editor only, no Blockly).
- **Pricing launch strategy.** Free-to-play vs $4.99 upfront? Hard
  call; affects monetization ramp.
- **Marketing budget.** Can we afford $5k of TikTok spend in launch
  week? If not, organic-only (slower ramp).
- **Localization day-1.** RESOLVED: EN+AR ships at MVP (see
  `21-LOCALIZATION-AND-NOTIFICATIONS.md` § 1.1); further locales
  post-MVP.

Document the call, ship the MVP, revisit.
