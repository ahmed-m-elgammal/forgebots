# 05 — Tech Stack

## 1. The decision matrix

| Stack | Pros | Cons | Verdict |
|---|---|---|---|
| **Godot 4 (GDScript + C#)** | Cross-platform native export (Android/iOS/PC), first-class deterministic-friendly engine, headless server export, free, MIT | Slightly weaker mobile tooling than Unity; C# is the safer choice for our shared sim | ✅ **CHOSEN** |
| Unity | Massive ecosystem, mature mobile | Licensing cost (after revenue thresholds), IL2CPP determinism is fiddly | ❌ |
| Flutter + Flame | Lovely UI, single codebase | No native 3D, weaker on mobile game-feel, no headless server | ❌ for client; ✅ for marketing site |
| Custom C++ + custom engine | Full control | Massive cost, no shipping in 8 weeks | ❌ |
| Unreal | AAA-grade | Heavy, overkill, costs | ❌ |

## 2. The chosen stack

```
┌──────────────────────────────────────────────────────────┐
│  Client (Android, iOS, Windows, macOS, Linux)            │
│  Godot 4.7.x • C# (.NET 10) • GDScript for small bits    │
│  Custom UI + scene tree + deterministic preview sim      │
└──────────────────────────────────────────────────────────┘
                              │ HTTPS
                              ▼
┌──────────────────────────────────────────────────────────┐
│  Edge / API                                              │
│  Node.js 24 + Fastify 5 + TypeScript 7                   │
│  Auth, matchmaking, account, bot CRUD, replay fetch      │
└──────────────────────────────────────────────────────────┘
                              │ AMQP / pg-boss
                              ▼
┌──────────────────────────────────────────────────────────┐
│  Simulation worker                                       │
│  Node.js 24 + TypeScript 7 (same code as API)            │
│  Runs the deterministic simulator headlessly             │
│  Embeds the ForgeBots VM (sandboxed bytecode runner)     │
└──────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────┐
│  Postgres 18                                             │
│  Users, bots, matches, replays (JSONB), seasons          │
└──────────────────────────────────────────────────────────┘
```

## 3. Why this combination

### 3.1 Client = Godot 4

- **One export covers Android, iOS, Windows, macOS, Linux.** Mobile
  pipeline is mature since Godot 4.0.
- **Headless server export** lets us share a *visual* scene tree with the
  preview-replay viewer, but the actual authoritative sim runs on Node.
- **C# (.NET 10 LTS)** gives us types and modern tooling.
- **MIT licensed** — no per-seat fees.
- **Determinism-friendly** — fixed-step physics, custom integration loop.

### 3.2 Server = Node.js + TypeScript

- **Single language end-to-end on the server side** (simulator + API +
  worker) means we share types and IR between layers.
- **Fastify** is lean, fast, with first-class TypeScript.
- **Postgres JSONB** is perfect for replays (variable-length event
  sequences per match).
- The simulator is **pure TypeScript** — runs anywhere Node runs.
- Could also be embedded in the Godot client (via WebSocket-driven
  preview panel) — but the MVP keeps that simple.

### 3.3 DB = Postgres 18

- Familiar, cheap, reliable, JSONB for replays, row-level security for
  privacy, easy scaling via PgBouncer.

### 3.4 Cache / Queue (deferred to v0.3)

- MVP runs sims in-process. When load grows, we add **Redis** for
  matchmaking state and **pg-boss** (or RabbitMQ) for sim jobs.

## 4. Languages, runtimes, tools

| Layer | Choice | Version |
|---|---|---|
| Client | Godot | 4.7.x |
| Client logic | C# | .NET 10 |
| Server | Node.js | 24 LTS |
| Server language | TypeScript | 7.x (native compiler) |
| HTTP framework | Fastify | 5.x |
| DB | Postgres | 18 |
| ORM / query builder | Drizzle ORM | latest |
| Validation | Zod | 4.x |
| Tests | Vitest | 5.x |
| Simulator tests | Vitest + custom harness | — |
| CI | GitHub Actions | — |
| Container | Docker + Compose | — |

> **Version refresh (2026-09):** all majors bumped to current stable —
> Godot 4.7, .NET 10 LTS, Node.js 24 LTS, TypeScript 7 (native Go
> compiler, ~10x faster builds), Fastify 5, Postgres 18, Zod 4, Vitest 5,
> pnpm 12. No architectural changes; API-level code is unaffected.

## 5. Hosting & infra

| Component | MVP host | Cost |
|---|---|---|
| API server | Fly.io / Railway / Hetzner | ~$15/mo |
| DB | Managed Postgres (Neon / Supabase) | free–$25/mo |
| Sim workers | Same hosts, in-process | — |
| Object storage (replays) | S3 / R2 (deferred) | — |
| Email | Resend / Postmark | free tier |

MVP target: <$50/mo total infra. Auto-scale to dedicated sim pool only
once matches take >5 s wall time.

## 6. Local dev setup

- `pnpm` workspaces
- `docker compose up` boots Postgres
- `pnpm dev` starts API + worker
- `godot --path client` opens the client project
- `pnpm test` runs sim unit tests + golden-match tests

## 7. What we are NOT using

| Tool | Why not |
|---|---|
| Firebase | Vendor lock + per-row cost; Postgres + Drizzle is cheaper |
| MongoDB | JSONB in Postgres covers our needs |
| Socket.io | Long-poll async PvP doesn't need WebSockets |
| Cloudflare Workers | Latency + cold start hurt matchmaking |
| AWS Lambda | Same; sims take ~1 s, doesn't fit billable ms |
| WebRTC | Not in MVP |
| Unity, Unreal | Heavier, cost, no need |
| Direct port of original C++ | License (see 02-LICENSING.md) |

## 8. CI/CD pipeline

### 8.1 Tools

- **CI:** GitHub Actions, free tier.
- **Mobile builds:** Godot export templates installed on runners.
- **Simulator golden tests:** run on every PR; failing the replay-hash
  check fails the PR.
- **Mobile smoke tests:** Godot integration test scene, runs headless
  on Android emulator + iOS simulator in CI.
- **Store distribution:** Fastlane for Play Store; `xcrun notarytool` →
  Transporter for App Store; both from CI. (`altool` is retired by
  Apple; notarytool is the current standard.)

### 8.2 Pipeline stages

```
PR  →  Lint + TypeScript compile (30 s)
    →  Simulator unit tests + golden replay hash (60 s)
    →  Vitest integration tests (90 s)
    →  Godot headless smoke scene (90 s)
    →  Mobile export dry-run (Android APK + iOS IPA unsigned, 8 min)

main  →  Tag (semver)
     →  Sign (mobile)
     →  Upload to TestFlight + Play internal track
     →  Slack notification with build URL

weekly  →  Beta cohort (closed TestFlighters / Play internal)
```

### 8.3 Versioning

- **Semver** for the client + server: `MAJOR.MINOR.PATCH`.
- Build number (mono-incrementing int) ships separately.
- `sim_version` (semver) is stored in every replay; breaking changes
  bump MAJOR and ship a replay migration (see `11-REPLAY-FORMAT.md`).

### 8.4 Secrets

- Code signing keys in GitHub Encrypted Secrets.
- Apple Developer key in 1Password CLI → injected at build time.
- Never in `.env` files committed to the repo.

## 9. Mobile performance budgets

Concrete numbers, not vibes. CI must catch regressions.

| Metric | Target (iPhone 12) | Target (Pixel 5) |
|---|---|---|
| Cold start (splash → dashboard) | p50 ≤ 2.0 s, p95 ≤ 3.5 s | p50 ≤ 2.5 s, p95 ≤ 4.0 s |
| Steady-state FPS | 60 (vsync) | 60 (vsync) |
| Frame time p95 | ≤ 18 ms | ≤ 18 ms |
| Match scene draw calls | ≤ 80 | ≤ 80 |
| Texture memory resident | ≤ 50 MB | ≤ 50 MB |
| App install size | ≤ 80 MB | ≤ 80 MB |
| App size on disk (post-update) | ≤ 150 MB | ≤ 150 MB |
| Battery drain (10-min session) | ≤ 4% | ≤ 4% |
| Crash-free sessions | ≥ 99.5% | ≥ 99.5% |
| ANR / watchdog rate | < 0.05% | < 0.05% |

### 9.1 How we measure

- **In-engine:** Godot's built-in profiler on debug builds.
- **On device:** Sentry performance tracing + custom Godot exporter.
- **In CI:** a smoke scene runs every PR; if draw calls or texture
  memory regresses > 10% vs main, the PR fails.
- **In production:** weekly report from Sentry; alert if any budget
  is exceeded by 20% for 2 consecutive weeks.

### 9.2 Thermal handling

- On thermal warning (Godot exposes `OS.get_thermal_state()`), drop
  particle count by 50% and reduce audio sample rate.
- On thermal critical, drop to 30 fps cap and disable bloom/glow.

## 10. Risks of this stack

- **Godot mobile polish is still maturing.** Mitigation: budget 2 weeks
  of mobile-only QA in the MVP.
- **Node.js determinism is fine** as long as we avoid `Date.now`,
  `Math.random` outside our seeded RNG, and parallel workers. (See
  `10-DETERMINISM.md`.)
- **Drizzle ORM is younger than Prisma.** Mitigation: typed SQL via Drizzle
  is simpler and we can always drop down to raw queries.
