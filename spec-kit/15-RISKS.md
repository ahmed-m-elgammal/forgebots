# 15 — Risks & Mitigations

## 1. Highest risks (RAG-rated)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Simulator nondeterminism across server platforms | Low | Critical | Fixed-point everywhere, no floats, two-stream RNG, golden-hash gate on Linux/macOS/Windows. **Re-rated from Medium:** the simulator now runs in exactly one language on three platforms, and the previous "Medium" rating rested on a five-platform claim that included two we do not run on. |
| Godot mobile export pitfall (signing, plugins) | High | High | Spike on day 1 of week 5; budget 2 weeks of mobile-only QA |
| **Blockly-in-Godot bridge (visual editor)** | High | High | **1-day spike in week 4, before the client is built.** This is the riskiest single item in the plan and the only one with no spike today. Fallback is text-only, already in `12 § 6`. |
| Mobile UI too cramped for the builder | Medium | High | Rehearse wireframes on a phone-sized sketch early; RTL is in scope from day 1, not later |
| Network/play store approval delays | Medium | Medium | Internal track from week 6; TestFlight from week 8 |
| GPL contamination accident | Low | Critical | Clean-room rules in `02-LICENSING.md`; CI grep for forbidden patterns |
| Player's bot loops the simulation forever | Low | High | Static cycle estimate rejects at save time; runtime yields are a bug, not a throttle (`22-DECISIONS.md D4`). **Re-rated from Medium** for the same reason. |
| Match farming / Elo abuse | Medium | Medium | `matches.kind` separates pvp/ghost/preview/mission; only `kind = 'pvp'` moves Elo; rate limits; ghost matches at half weight |
| Server cost explodes on launch spike | Medium | Medium | MVP in-process sim; a dedicated pool is triggered at p95 sim wall time > 20 s |
| Solo dev burnout | High | High | 8-week plan + 2-week buffer; cut list defined; Friday afternoons off |
| Audience too niche (no commercial viability) | Medium | High | Validate with 5 closed-beta testers by end of week 4 |
| Visual editor (Blockly) too heavy on mobile | Medium | Medium | Fall back to text-only editor (already in plan) |
| **Balance model wrong: parts under 60 W are free** | *Was Critical, now fixed* | — | The old `floor(power/60)` rule is replaced by integer milliwatts with a carried remainder (`22-DECISIONS.md D6`). The regression test is a 5 W draw being measurably non-zero. Listed here because it is the single worst bug this spec contained. |

## 2. Determinism risks in detail

| Sub-risk | Mitigation |
|---|---|
| `Math.sin` on different CPUs | Lookup table only; all `Math.*` banned outside `math.ts` |
| `Map` iteration order differs across V8 versions | Use sorted arrays internally |
| Date-based seed leak | Reject `Date.now` / `performance.now` / `new Date()` via lint |
| JSON serialisation of NaN | Pre-validate before emit; canonical encoder |
| Float arithmetic in UI but not sim | UI may use doubles for display; `simulator/src/**` is integer-only, no exceptions |
| Two bots perturbing each other's RNG | Two named streams; `rng-int` reads only `botRng` (`22-DECISIONS.md D5`) |
| Energy rounding to zero | Integer milliwatts with a carried remainder (Phase 13) |
| Fixed-point overflow | Q16.16 in **metres**, not millimetres; 200 m uses 160× of the available range. A test asserts the arena extent fits. |
| Async I/O on server side | Sim is sync; the queue worker is async but only writes results |
| Database load skewing timings | The hash covers `seed ‖ balance sha ‖ final state ‖ events` and nothing else — no timestamps, no ids, no write order |

## 3. Legal risks

| Risk | Mitigation |
|---|---|
| Accidental GPL use | Clean-room rules; CI grep; legal review before launch |
| Trademark on "Grobots" name | We use ForgeBots; explicit attribution only |
| User-submitted code copyright | Users own their code; they license it to us for execution + display |
| Apple / Google policy violation (no IAP on digital goods) | All paid items route through App Store / Play IAP |
| GDPR / CCPA | `users.deleted_at` soft delete + email hash; `GET /users/me/export` (`08 § 9`) |
| Selling "bot slots" as pay-to-win | Documented in `14 § 1` as a capacity purchase, not a strength purchase; the only three SKUs are slots, share links and cosmetics |

## 4. Product risks

| Risk | Mitigation |
|---|---|
| Game is "too hard" — onboarding churn | Three scripted missions with a guaranteed-win third attempt (`17 § 3.3`); tooltips everywhere |
| Game is "too slow" — boring matches | 1500-tick cap = 25 s; tune via `balance_versions`, tracked via match-length distribution |
| Visual block editor is intimidating | Text fallback; sensible default bot scaffold; "Start from example" button |
| Async matchmaking empty at launch | 8 ghost bots seeded at season start, tracked Elo, half-weight (`19 § 5.1`) |

## 5. Technical debt watchlist

We're deliberately accepting some debt in MVP to ship. Call it out:

- **In-process sim worker.** Will be replaced with a queue when load
  hits 10 matches/min.
- **JSONB replays.** Will move to compressed object storage at 1 GB
  total replays.
- **No E2E tests.** Will add Godot integration tests post-MVP.
- **No dashboards.** pino logs + PostHog + a weekly query pack. The
  four Grafana boards are v0.2 (`18 § 3.5`).
- **Single Postgres.** No read replicas. Easy to add later.
- **Drizzle ORM raw SQL fallbacks.** Acceptable; SQL is small and readable.
- **One simulator, one language.** There is no client-side simulation,
  so offline play and live spectator mode both need a second
  implementation plus a cross-platform determinism budget. Deferred
  deliberately, not forgotten.

## 6. Security risks

| Risk | Mitigation |
|---|---|
| Auth bypass | Zod validates every input; JWT signed with HS256 + a `kid` header so the secret can rotate; refresh tokens rotatable and revocable (`08 § 2`) |
| Bot IR injection | Server runs `verify.ts`; rejects any program the server did not compile from submitted source |
| DOS via huge bots | Source length cap + static cycle cap + 64-slot stack cap |
| Replay tampering | `output_sha256` stored server-side; public reads go through an unexpired `replay_shares` token under RLS (`07 § 3`) |
| PII leak in logs | pino redact rules; no email in logs |
| DDoS on API | Fly.io edge + basic rate limits (60/min/user); replay streaming is exempt but bounded by retention |
| Cycle-budget accounting gap | A runtime `vm_yield` is treated as a bug, not throttled — so an estimator gap surfaces instead of being absorbed (`22-DECISIONS.md D4`) |

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
| **Game feels too slow (boring matches)** | Medium | High | 1500-tick cap = 25 s; tunable via `balance_versions`; tracked via match length distribution |
| **Game feels too hard (churn)** | Medium | Critical | 3-mission ladder with a guaranteed-win third attempt; ghost bots in matchmaking; Elo band ±200 for a player's first 5 rated matches |
| **Visual editor (Blockly) too cramped on phone** | High | High | 1-day spike in week 4; mobile-first sizing; fall back to text-only. Arabic RTL ships at launch, so the cramped case is tested in the harder direction first. |
| **Players feel "I have no chance" against top bots** | Medium | High | Elo matchmaking + seasonal soft-reset; casual vs ranked modes (post-MVP) |
| **Replay viewer too complex** | Low | Medium | Default speed 1×, simple timeline; advanced stats overlay off by default; iteration of UX post-launch |
| **No content after first 10 matches** | Medium | High | 8 starter bots + ladder + seasonal arena and AI every 12 weeks. *Re-rated from High:* 3 AI opponents was always going to run out; 8 plus the ladder is thinner but not empty. |
| **Audio is annoying / overpowering** | Low | Medium | Ducking, mute, SFX-only mode; user testing on first 50 players |
| **Localization missing at launch** | Medium | Medium | EN+AR ships at MVP via the `21` pipeline (extraction from day 1); further locales post-MVP |
| **Accessibility gaps block a player segment** | Medium | Medium | Platform contrast targets, reduce motion, tap targets ≥ 44 pt/dp, colourblind mode with mandatory shape cues; see `13 § 11` |
| **Push notifications become spam** | Medium | Medium | Frequency caps + quiet hours + per-channel opt-in, no non-disableable channel (`21 § 2.3`, `§ 2.4`) |

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
  the founder is alone, cut scope (text editor only, no Blockly) —
  the cut list is already ordered so this is week 6, not week 1.
- **Pricing launch strategy.** Free-to-play with a $4.99 pass, or
  $4.99 upfront? Hard call; affects the monetization ramp and whether
  the share-link paywall is the first thing players ever see.
- **Marketing budget.** Can we afford $5k of TikTok spend in launch
  week? If not, organic-only (slower ramp).
- **Localization day-1.** **RESOLVED: EN+AR ships at MVP** (see
  `21-LOCALIZATION-AND-NOTIFICATIONS.md` § 1.1); further locales
  post-MVP. Note the cash cost is ~$2,900 and the engineering cost is
  real, because Arabic RTL changes the layout work on every screen.
- **Voice-over for onboarding.** Deferred to v0.2 (§ `17 § 8`).
  Revisit only with a content budget attached.
- **Do we need a second simulator implementation?** Offline play and
  live spectator both need one. If either becomes a launch
  requirement, it invalidates the single-implementation decision in
  `22-DECISIONS.md D3` and needs a fresh determinism budget.

Document the call, ship the MVP, revisit.
