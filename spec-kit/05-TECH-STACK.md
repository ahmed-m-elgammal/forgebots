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
│  Godot 4.3.x • C# (.NET 8) • GDScript for small bits     │
│  Custom UI + scene tree + deterministic preview sim      │
└──────────────────────────────────────────────────────────┘
                              │ HTTPS
                              ▼
┌──────────────────────────────────────────────────────────┐
│  Edge / API                                              │
│  Node.js 22 + Fastify 4 + TypeScript 5                   │
│  Auth, matchmaking, account, bot CRUD, replay fetch      │
└──────────────────────────────────────────────────────────┘
                              │ AMQP / pg-boss
                              ▼
┌──────────────────────────────────────────────────────────┐
│  Simulation worker                                       │
│  Node.js 22 + TypeScript 5 (same code as API)            │
│  Runs the deterministic simulator headlessly             │
│  Embeds the ForgeBots VM (sandboxed bytecode runner)     │
└──────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────┐
│  Postgres 16                                             │
│  Users, bots, matches, replays (JSONB), seasons          │
└──────────────────────────────────────────────────────────┘
```

## 3. Why this combination

### 3.1 Client = Godot 4

- **One export covers Android, iOS, Windows, macOS, Linux.** Mobile
  pipeline is mature since Godot 4.0.
- **Headless server export** lets us share a *visual* scene tree with the
  preview-replay viewer, but the actual authoritative sim runs on Node.
- **C# (Mono/.NET 8)** gives us types and modern tooling.
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

### 3.3 DB = Postgres 16

- Familiar, cheap, reliable, JSONB for replays, row-level security for
  privacy, easy scaling via PgBouncer.

### 3.4 Cache / Queue (deferred to v0.3)

- MVP runs sims in-process. When load grows, we add **Redis** for
  matchmaking state and **pg-boss** (or RabbitMQ) for sim jobs.

## 4. Languages, runtimes, tools

| Layer | Choice | Version |
|---|---|---|
| Client | Godot | 4.3.x |
| Client logic | C# | .NET 8 |
| Server | Node.js | 22 LTS |
| Server language | TypeScript | 5.5+ |
| HTTP framework | Fastify | 4.x |
| DB | Postgres | 16 |
| ORM / query builder | Drizzle ORM | latest |
| Validation | Zod | 3.x |
| Tests | Vitest | 2.x |
| Simulator tests | Vitest + custom harness | — |
| CI | GitHub Actions | — |
| Container | Docker + Compose | — |

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

## 8. Risks of this stack

- **Godot mobile polish is still maturing.** Mitigation: budget 2 weeks
  of mobile-only QA in the MVP.
- **Node.js determinism is fine** as long as we avoid `Date.now`,
  `Math.random` outside our seeded RNG, and parallel workers. (See
  `10-DETERMINISM.md`.)
- **Drizzle ORM is younger than Prisma.** Mitigation: typed SQL via Drizzle
  is simpler and we can always drop down to raw queries.
