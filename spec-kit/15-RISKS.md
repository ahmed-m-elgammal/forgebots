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
| Game is "too slow" — boring matches | 90 s median match length is the target; tune via faster constructors |
| Visual block editor is intimidating | Text fallback; sensible default bot scaffold; "Start from example" button |
| Async matchmaking empty at launch | Seed with 10 ghost bots in week 4 |

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
