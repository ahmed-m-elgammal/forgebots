# 06 — Architecture

## 1. Top-level principle

```
                 UI
                  │
                  ▼
           Game Logic (bots, builder, AI editor)
                  │
                  ▼
             Simulation (deterministic core)
                  │
                  ▼
            Networking (HTTP, sync, async PvP)
                  │
                  ▼
            Database (users, bots, matches)
```

Strict downward dependency: **UI never imports Simulation directly**,
**Game Logic never imports Networking**, **Simulation never imports
anything above it**.

The *shared* module is the **simulation core** (`/simulator/`). It is
written in pure TypeScript with zero I/O — no `fetch`, no `Date.now`,
no `Math.random`. It runs identically on server and (optionally) on
client for previews.

## 2. Module layout

```
forgebots/
├── simulator/                    ← Pure deterministic core (TS)
│   └── src/
│       ├── rng.ts                ← Seeded RNG (mulberry32 + xoshiro256**)
│       ├── fixed.ts              ← Fixed-point math helpers
│       ├── math.ts               ← Vector + angle ops (vec.ts / angle.ts in Phase 02 of 20)
│       ├── arena.ts              ← Map, walls, resources
│       ├── parts.ts              ← Hardware catalog
│       ├── bot.ts                ← Bot state + per-bot cycle VM
│       ├── vm.ts                 ← The sandboxed VM (cycle-budgeted)
│       ├── ir.ts                 ← Bot program IR (JSON-serialisable)
│       ├── compiler.ts           ← DSL → IR
│       ├── match.ts              ← Match driver (tick loop)
│       ├── events.ts             ← Event log (replay)
│       └── index.ts
│
├── server/                       ← Node.js Fastify API + workers
│   └── src/
│       ├── main.ts               ← Boot
│       ├── http/
│       │   ├── routes/
│       │   │   ├── auth.ts
│       │   │   ├── bots.ts
│       │   │   ├── matches.ts
│       │   │   └── seasons.ts
│       │   └── server.ts
│       ├── db/
│       │   ├── schema.ts         ← Drizzle schema
│       │   ├── client.ts
│       │   └── repo/
│       ├── domain/
│       │   ├── matchmaking.ts
│       │   ├── elo.ts
│       │   └── progression.ts
│       ├── sim/
│       │   ├── runner.ts         ← Spawns simulator, writes to DB
│       │   └── preview.ts        ← Live preview simulator (WebSocket)
│       ├── auth/
│       ├── seasons/
│       └── index.ts
│
├── client/                       ← Godot 4 project
│   └── project.godot
│       scenes/
│       ui/
│       net/
│       editor/                   ← Visual + text DSL editor
│       sim/                      ← Local simulator wrapper
│       assets/
│
├── web/                          ← Marketing site (optional, Flutter web)
│
└── spec-kit/                     ← This folder
```

## 3. The request lifecycle

### 3.1 Player submits a match

```
[Client]                   [API]                   [SimWorker]            [DB]
   │                          │                          │                   │
   │ POST /matches {bot_id}  │                          │                   │
   ├─────────────────────────►                          │                   │
   │                          │ 1. Validate bot         │                   │
   │                          │ 2. Find opponent        │                   │
   │                          │    (Elo ±100; ghost-    │                   │
   │                          │    bot fallback)        │                   │
   │                          │ 3. Insert match row     │                   │
   │                          ├───────────────────────────────────────────► │
   │                          │                          │                   │
   │                          │ Enqueue sim job         │                   │
   │                          ├─────────────────────────►                   │
   │                          │                          │ 4. Load bot IRs   │
   │                          │                          │◄─────────────────►│
   │                          │                          │ 5. Simulate 1500  │
   │                          │                          │   ticks           │
   │                          │                          │ 6. Emit replay    │
   │                          │                          │ 7. Update Elo     │
   │                          │                          │──────────────────►│
   │ 202 {match_id}           │                          │                   │
   │◄─────────────────────────│                          │                   │
   │                          │                          │                   │
   │ GET /matches/{id}/replay │                          │                   │
   ├─────────────────────────►                          │                   │
   │                          │ 8. Stream replay        │                   │
   │◄─────────────────────────│                          │                   │
```

### 3.2 Why server-authoritative

- **Anti-cheat:** clients only submit *intent* (bot IR + match request).
  The server runs the only ground truth.
- **Replay fidelity:** the replay is the result of the server's run. Anyone
  who sees the replay sees what actually happened.
- **Cross-platform parity:** if a player's mobile device is slightly different
  in float handling, doesn't matter — server decides.

## 4. Concurrency & data flow

### 4.1 In the simulator

- **Single-threaded tick loop.** The simulation runs all robots
  sequentially within a tick (cheap; robots are tiny). This makes
  determinism trivial.
- **Cycle budgets per bot per tick.** If a bot's VM exceeds 1000 cycles,
  the tick aborts for that bot (with a flag). Other bots continue.

### 4.2 In the server

- **API is stateless.** All state in Postgres or Redis.
- **Sim jobs run in worker pool** (Node.js cluster in MVP; add pg-boss
  or BullMQ only once Redis is introduced — see `05-TECH-STACK.md`
  § 3.4).
- **Match queue** is a Postgres table with `FOR UPDATE SKIP LOCKED`
  for atomic claiming. No external broker needed for MVP.

### 4.3 In the client

- **Godot main thread** does UI + render + local preview sim.
- **Background thread** does HTTP (Godot's `HTTPRequest`).
- **Replay viewer** streams replay JSON in chunks and incrementally
  renders frames.

## 5. Module dependency rules

The dependency graph is acyclic:

```
   ui (Godot scenes)
    │ depends on
    ▼
   game-logic (bot builder, AI editor, replay viewer)
    │ depends on
    ▼
   sim (deterministic core)
    │
    ▼
   shared types (DSL IR, hardware catalog, events)
```

The simulator MUST NOT depend on:
- HTTP, sockets, file system (no I/O)
- `Date.now`, `performance.now`, `Math.random` outside seeded RNG
- `console.log` in production paths

A CI lint rule enforces this with a simple grep.

## 6. Failure modes & recovery

| Failure | Detection | Recovery |
|---|---|---|
| Sim worker crashes mid-match | `match.status = 'failed'`, last_replay null | Mark match invalid, refund Elo, alert ops |
| Client crashes during replay view | Stateless — replay is just data | Restart, replay again |
| Bot IR is invalid | Compiled `vm.ts` validates before saving | Return 400 with error JSON |
| Bot runs hot (>10× CPU budget avg) | Per-bot stats in events | Auto-throttle to 0.5× cycles next tick |
| Postgres down | Health check fails | API returns 503; sim queue drains on restart |

## 7. Testing strategy

| Layer | Test type |
|---|---|
| `sim/` | Unit + golden replay comparison |
| `server/domain/` | Unit + property-based (fast-check) |
| `server/http/` | Integration (supertest + test DB) |
| `client/` | GUT (Godot unit test) + smoke scenes |
| End-to-end | Playwright (web admin) + Godot integration test |

## 8. Observability

- **Server:** pino JSON logs → Loki (deferred) or simple file rotation.
- **Metrics:** Prometheus endpoint (deferred).
- **Replay hash:** every match stores a SHA-256 of its deterministic
  output, exposed via `/health/sim`. If two replays diverge for the same
  input, CI catches it.
