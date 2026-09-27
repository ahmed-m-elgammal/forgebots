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
no `Math.random`, no `Math.*`. It runs on the **server only**. The
client renders replays; it never simulates
([`22-DECISIONS.md` D3](22-DECISIONS.md)).

## 2. Module layout

Directories are **bounded contexts**, not folders for tidiness. The
boundary is physical — it is what a lint rule can check, and what makes
`AGENT.md § 6` enforceable by something other than review.

```
simulator/src/
├── math/            ← shared value types; not a context of its own
│   ├── rng.ts           Mulberry32, xoshiro256**, deriveSeed, the two streams
│   ├── fixed.ts         Q16.16 helpers, trig tables, mm <-> fixed
│   ├── vec.ts           Vector ops
│   └── angle.ts         Angle wrap / lerp / diff (65536 = 2π)
│
├── arena/           ← context: arena
│   ├── geometry.ts      Arena, walls, pillars, clampToArena
│   └── biomass.ts       BiomassField: spawn, deplete, respawn
│
├── robot/           ← context: robot
│   ├── design.ts        Design, Chassis, ChassisStats, CHASSIS_LIMITS
│   ├── parts.ts         PARTS catalog, aggregate, validateChassis
│   └── robot.ts         Robot state, spawnBot, snapshot, tickBot
│
├── program/         ← context: program (DSL front-end + IR)
│   ├── tokenizer.ts     tokenize(src) -> Token[] with line/col
│   ├── errors.ts        CompileError + factories
│   ├── ast.ts           AST node types (types only)
│   ├── parser.ts        recursive-descent Parser
│   ├── ir.ts            IrNode / IrProgram (JSON-serialisable)
│   ├── lower.ts         AST -> IR
│   ├── verify.ts        the nine verifier rules
│   ├── cycleEstimate.ts static worst-case cycle cost
│   ├── builtins.ts      math / compare / boolean / trig builtins
│   └── compiler.ts      compile(src, meta) — the only public entry point
│
├── execution/       ← context: execution (the sandbox)
│   ├── frame.ts         value stack + locals; the 64 / 32 caps
│   ├── interpreter.ts   the tree walk
│   ├── builtins.ts      IR-node dispatch table
│   └── vm.ts            runVm(env, ir): budget, abandon-tick, events
│
├── perception/      ← context: perception
│   ├── types.ts         WorldView, BotEnv, EntityHit
│   ├── sensors.ts       radar, scan, food, ally, enemy
│   └── selfState.ts     self.*, time, rng-int
│
├── actuation/       ← context: actuation
│   ├── types.ts         the Actuator union
│   └── throttle.ts      move / move-at -> m/s, clamped to top speed
│
├── combat/          ← context: combat
│   ├── weapons.ts       hitscan raycast + grenade ballistics + cooldowns
│   └── damage.ts        shield-first damage, death, biomass bounty
│
├── vitality/        ← context: vitality
│   ├── energy.ts        milliwatt accumulator, starvation conversion
│   └── shields.ts       shield pool, regen, damage suppression
│
├── match/           ← context: match
│   ├── match.ts         runMatch: the tick loop
│   └── winCondition.ts  elimination, biomass tiebreak, draw
│
├── telemetry/       ← context: telemetry
│   ├── eventLog.ts      per-tick buckets, change-only move/aim
│   ├── replay.ts        the replay document (11-REPLAY-FORMAT.md)
│   └── hash.ts          outputSha256
│
└── index.ts
```

**Split rationale.** Only two units of work were ever going to breach
the 300-line cap, and both are now split by responsibility rather than
by size: the DSL front-end (`09-AI-DSL.md § 3`) and the VM
(`09-AI-DSL.md § 6`). Every other file is small enough as written.

**The VM does not know what a sensor is.** `execution/builtins.ts`
dispatches a `radar` node to `perception/sensors.ts` and a `move` node
to `actuation/throttle.ts`. It never imports a part, a weapon, or a
biomass cell. That is the point of the split: a base type must not
know which children exist (`AGENT.md` G7), and neither does the
interpreter.

Full repo tree:

```
forgebots/
├── simulator/                    ← Pure deterministic core (TS, Node only)
│   │                               (src/ is the context tree above)
│   └── test/fixtures/            ← golden match hashes
│
├── server/                       ← Node.js Fastify API + workers
│   └── src/
│       ├── main.ts               ← Boot. The COMPOSITION ROOT: the only
│       │                            place that reads env or config (G35)
│       ├── http/
│       │   ├── routes/
│       │   │   ├── auth.ts
│       │   │   ├── bots.ts
│       │   │   ├── matches.ts
│       │   │   ├── replays.ts
│       │   │   ├── missions.ts
│       │   │   ├── account.ts
│       │   │   ├── notifications.ts
│       │   │   └── seasons.ts
│       │   └── server.ts
│       ├── domain/               ← application + domain. NO framework.
│       │   ├── accounts/           register, login, delete, export
│       │   ├── roster/             bots, designs, versions, bot slots
│       │   ├── scheduling/         matchmaking, elo
│       │   ├── seasons/            seasons, balance versions
│       │   ├── engagement/         missions, achievements
│       │   ├── replayLibrary/      bookmarks, share links
│       │   ├── notifications/      prefs, tokens, frequency caps
│       │   └── commerce/           catalog, purchases, cosmetics
│       ├── db/                   ← infrastructure; implements domain ports
│       │   ├── schema.ts         ← Drizzle schema (07-DATA-MODEL.md)
│       │   ├── client.ts
│       │   └── repo/
│       ├── sim/
│       │   ├── runner.ts         ← Claims match jobs, writes replay
│       │   └── preview.ts        ← Server-side preview stream (WebSocket)
│       ├── auth/                 ← port implementations (JWT, OAuth)
│       ├── providers/            ← FCM / APNs / Postgres adapters
│       └── index.ts
│
├── client/                       ← Godot 4 project
│   ├── project.godot
│   ├── ui/                       ← scenes; no logic (AGENT.md § 6)
│   ├── logic/                    ← pure; no Node access, no HTTP
│   ├── net/                      ← HTTP + WebSocket adapters
│   ├── editor/                   ← Visual + text DSL editor
│   ├── replay/                   ← Replay renderer (NO simulator)
│   ├── i18n/                     ← en.arb, ar.arb, glossary.json (doc 21)
│   ├── theme/                    ← the ONLY place colours live (AGENT.md § 0)
│   ├── src/i18n/                 ← t() wrapper
│   ├── src/juice/                ← fx-table.json (data, not code — doc 16 § 5)
│   └── assets/
│
├── web/                          ← Marketing site, optional (Flutter web)
│
└── spec-kit/                     ← This folder
```

Notes on the layout:

- Directories are bounded contexts. `06 § 5` states the dependency rule
  that keeps them honest; `AGENT.md § 6` states why.
- The previous flat list was missing `env.ts`, `chassis.ts`,
  `actuators.ts`, `verify.ts`, `combat.ts`, `vec.ts`, `angle.ts` and
  `replay.ts`, all of which `20-IMPLEMENTATION-PLAN.md` mandates, so an
  implementer reading only this doc would not have created them.
- The DSL front-end and the VM are the only two units that breach the
  300-line cap, and both are now split by responsibility. Every other
  file is small as written.
- `telemetry/eventLog.ts` is created in Phase 14, not earlier. The
  previous claim that it "already exists" by then was wrong.
- The client has **no `sim/` directory.** It has `replay/`.
  `client/sim/.gitkeep` is a leftover from the old layout and should be
  deleted the first time the client tree is touched.

## 3. The request lifecycle

### 3.1 Player submits a match

```
[Client]                   [API]                   [SimWorker]            [DB]
   │                          │                          │                   │
   │ POST /matches {bot_id}  │                          │                   │
   ├─────────────────────────►                          │                   │
   │                          │ 1. Validate bot         │                   │
   │                          │ 2. Find opponent        │                   │
   │                          │    (bots.elo ±100, ±200  │                   │
   │                          │     for first 5; ghost- │                   │
   │                          │     bot fallback)       │                   │
   │                          │ 3. Insert match row     │
   │                          ├───────────────────────────────────────────► │
   │                          │                          │                   │
   │                          │ Enqueue sim job         │
   │                          ├─────────────────────────►                   │
   │                          │                          │ 4. Load programs  │
   │                          │                          │  + balance ver.  │
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

- **Anti-cheat:** clients only submit *intent* (bot source + match
  request). The server compiles, verifies and runs the only ground truth.
- **Replay fidelity:** the replay is the result of the server's run.
  Anyone who sees the replay sees what actually happened.
- **No client-side divergence to argue about:** the client never
  simulates, so "the replay looked different on my phone" is a
  rendering bug with a reproducible test, not a floating-point
  debate.

## 4. Concurrency & data flow

### 4.1 In the simulator

- **Single-threaded tick loop.** The simulation runs all robots
  sequentially within a tick (cheap; robots are tiny). This makes
  determinism trivial.
- **Cycle budgets per bot per tick.** If a bot's VM reaches 1000 cycles,
  the tick is **abandoned** for that bot: its queued actuators are
  discarded and a `vm_yield` event is emitted. There is exactly one
  over-run behaviour — see [`22-DECISIONS.md` D4](22-DECISIONS.md). The
  earlier version of this doc also specified a "throttle to 0.5×
  cycles next tick" recovery, which would have made a bot's fate depend
  on a moving average and therefore on how long it had been running.

### 4.2 In the server

- **API is stateless.** All state in Postgres or Redis.
- **Sim jobs run in worker pool** (Node.js cluster in MVP; add pg-boss
  or BullMQ only once Redis is introduced — see `05-TECH-STACK.md`
  § 3.4).
- **Match queue** is a Postgres table with `FOR UPDATE SKIP LOCKED`
  for atomic claiming. No external broker needed for MVP.

### 4.3 In the client

- **Godot main thread** does UI + render.
- **Background thread** does HTTP (Godot's `HTTPRequest`).
- **Replay viewer** streams replay JSON in chunks and incrementally
  renders frames, seeking backwards from the nearest preceding
  `snapshot` event (`11-REPLAY-FORMAT.md § 7`).
- **There is no local preview sim.** "Run preview" opens a WebSocket to
  the server (`08-API-SURFACE.md` § 11). This keeps the client free of
  any simulation code.

## 5. Module dependency rules

### 5.1 The layering

The dependency graph is acyclic, innermost at the top:

```
   client/ui        (Godot scenes, no logic)
    │ depends on
    ▼
   client/logic     (pure: builder, editor, replay renderer)
    │ depends on
    ▼
   replay schema    (DSL program shape, hardware catalog, event kinds)
    ▲
    │ read-only, at build time
    │
   simulator/src    (deterministic core, TypeScript, Node)
    │
    ▼
   math/            (shared value types: fixed-point, vectors, angles)
```

The client depends on the **replay schema**, never on the simulator
package. There is no code path from `client/` to `simulator/` — the
client has no simulation code at all
([`22-DECISIONS.md` D3](22-DECISIONS.md)).

### 5.2 The bounded-context rule

Inside `simulator/src/`, each directory may import from `math/` and
from **its own** directory. Nothing else.

```
   arena/     perception/   actuation/   combat/
   robot/     program/      vitality/    match/
   telemetry/ execution/
                    │
                    ▼ each may import ↓
                  math/
```

Concretely, and this is the point of the split:

| Allowed | Forbidden |
|---|---|
| `execution/` → `perception/sensors.ts` (via its published entry point) | `execution/` → `robot/parts.ts` |
| `execution/` → `math/fixed.ts` | `execution/` → `arena/biomass.ts` |
| `program/` → `math/` | `execution/` → `program/parser.ts` |
| `match/` → every context, because the tick loop legitimately orchestrates all of them | any context → `match/` |

`match/` is the one context allowed to know all the others, because
running a match is its job. It still may not import `server/`, Fastify,
Drizzle, or anything with I/O.

**The test for "knows about":** if a file would need to change when a
new part, weapon or sensor is added, it is coupled too tightly. Adding
a part must not touch `execution/`.

### 5.3 Server layering and ports

```
   server/http        routes, request parsing, Zod schemas
    │ depends on
    ▼
   server/domain      application + domain. NO framework.
    │ depends on
    ▼
   (ports — interfaces declared here, implemented outside)
    ▲
    │ implemented by
    │
   server/db          Drizzle repositories
   server/auth        JWT, OAuth
   server/providers   FCM, APNs
   server/sim         match runner, preview stream
```

- `server/domain/**` must not import `db/`, `http/`, Fastify, or
  Drizzle. It declares the ports it needs and the composition root
  (`main.ts`) wires the implementations in
  ([`AGENT.md` § 6, G35](AGENT.md)).
- Contexts in `server/domain/`: `accounts`, `roster`, `scheduling`,
  `seasons`, `engagement`, `replayLibrary`, `notifications`,
  `commerce`. A context never reaches into another context's internals;
  it takes a port or a value.

### 5.4 What the simulator may not import

The simulator MUST NOT depend on:
- HTTP, sockets, file system (no I/O)
- `Date.now`, `performance.now`, `new Date()`
- `Math.random` or any other `Math.*` outside `math.ts`
- `console.log` in production paths

Enforcement is one ESLint flat-config rule,
`tools/eslint-plugin-forge/determinism.js` (`10-DETERMINISM.md § 3`),
plus a unit test asserting the same list. Not "a simple grep".

## 6. Failure modes & recovery

| Failure | Detection | Recovery |
|---|---|---|
| Sim worker crashes mid-match | `match.status = 'failed'` | Mark match invalid, no Elo written, alert ops. (Elo is only written on a completed match, so there is nothing to refund — the earlier "refund Elo" step had nothing to act on.) |
| Client crashes during replay view | Stateless — replay is just data | Restart, replay again |
| Bot source is invalid | `program/verify.ts` rejects it before `bots.chassis_json` is written | Return 400 with `line`/`col` and a message |
| Bot loops hot (>10× CPU budget avg) | Per-bot stats in events | The tick is abandoned and `vm_yield` is emitted. Reject at save time on the static estimate. **No runtime auto-throttle** (`22-DECISIONS.md D4`). |
| Postgres down | Health check fails | API returns 503; the match job table drains on restart |

## 7. Testing strategy

| Layer | Test type |
|---|---|
| `simulator/` | Unit + golden replay hash comparison |
| `server/domain/` | Unit + property-based (fast-check) |
| `server/http/` | Integration (supertest + test DB) |
| `client/` | C# unit tests (xUnit / NUnit) + headless Godot smoke scenes |
| End-to-end | Godot integration scene against a local API |

Two corrections here:

- **GUT is a GDScript testing framework.** With C# chosen as the
  client language (`05 § 4`), GUT would mean testing the wrong half of
  the client. The C# runner is the one to use.
- **There is no web admin in MVP**, so the Playwright row was testing a
  screen that does not exist. The marketing site (`web/`) is not part
  of the MVP test matrix.

## 8. Observability

- **Server:** pino JSON logs → file rotation in MVP; Loki from v0.3.
- **Errors:** Sentry, server and client (`05 § 4`).
- **Product analytics:** PostHog (`18 § 3.1`).
- **Dashboards:** none in MVP. The four Grafana boards in `18 § 3.5`
  are a v0.2 deliverable — `15 § 5` ("no metrics dashboard") was
  correct and `18` was aspirational.
- **Replay hash:** every match stores a SHA-256 of its deterministic
  output, exposed via `GET /health` (cached 60 s). If two replays
  diverge for the same seed and balance version, CI catches it.
