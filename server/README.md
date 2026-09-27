# server/ — Node.js API & Simulation Workers

> Placeholder scaffold — **no implementation code yet** (`.gitkeep` files
> only). Server work is deliberately deferred until the 14 engine phases
> of [`spec-kit/20-IMPLEMENTATION-PLAN.md`](../spec-kit/20-IMPLEMENTATION-PLAN.md)
> are green (§ 18.3: "writing the server before Phase 14" is an
> anti-pattern — the replay format is the contract).

Node.js 22 LTS + TypeScript 5 + Fastify 4 + Postgres 16 + Drizzle ORM +
Zod ([`05-TECH-STACK.md`](../spec-kit/05-TECH-STACK.md) § 2, § 4).
Hosts the REST + WebSocket API, matchmaking/Elo domain logic, and the
sim workers that run the deterministic simulator headlessly and write
replays to Postgres.

## Planned layout (`06-ARCHITECTURE.md` § 2, extended by `07` § 5 and `21` § 3)

| Path | Purpose |
|---|---|
| `src/main.ts` | Boot |
| `src/http/server.ts` | Fastify instance + plugins |
| `src/http/routes/` | `auth.ts`, `bots.ts`, `matches.ts`, `seasons.ts` (contract in [`08-API-SURFACE.md`](../spec-kit/08-API-SURFACE.md)) |
| `src/db/schema.ts` | Drizzle schema (mirrors [`07-DATA-MODEL.md`](../spec-kit/07-DATA-MODEL.md)) |
| `src/db/client.ts` | Postgres client |
| `src/db/repo/` | Data-access repositories |
| `src/domain/` | `matchmaking.ts`, `elo.ts`, `progression.ts` |
| `src/sim/` | `runner.ts` (spawns simulator, writes to DB), `preview.ts` (WebSocket live preview) |
| `src/auth/` | JWT + OAuth (Apple / Google) flows |
| `src/seasons/` | Season lifecycle + `balance_json` patches |
| `src/notifications/` | `push.ts`, `fcm.ts`, `apns.ts`, `scheduler.ts` (frequency caps, quiet hours — [`21-LOCALIZATION-AND-NOTIFICATIONS.md`](../spec-kit/21-LOCALIZATION-AND-NOTIFICATIONS.md) § 2.9) |
| `src/notifications/templates/` | Localised push copy (`match_ready.en.json`, `match_ready.ar.json`, …) |
| `migrations/` | Forward-only SQL files `NNNN_name.sql` ([`07-DATA-MODEL.md`](../spec-kit/07-DATA-MODEL.md) § 5) |
| `openapi.yaml` | **Generated** from route Zod schemas at build time (`08-API-SURFACE.md` § 11) — not committed by hand |

## Conventions

- Match queue is a Postgres table claimed with `FOR UPDATE SKIP LOCKED`;
  no external broker in MVP (`06-ARCHITECTURE.md` § 4.2).
- Redis / pg-boss / BullMQ only after load grows (`05-TECH-STACK.md` § 3.4).
- pnpm workspace member (`workspaces: ["simulator", "server"]` —
  `20-IMPLEMENTATION-PLAN.md` § 3.3).

## Current contents

Empty by design (`.gitkeep` placeholders only).
