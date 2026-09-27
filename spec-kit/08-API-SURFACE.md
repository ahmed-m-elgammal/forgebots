# 08 — API Surface (REST + WebSocket)

## 1. Conventions

- **Base URL:** `https://api.forgebots.app/v1`
- **Auth:** Bearer JWT in `Authorization` header. Issued by `/auth/login`
  or OAuth callback.
- **Format:** JSON for request and response bodies.
- **Errors:** standard problem+json-ish:
  ```json
  { "error": "validation_error", "details": [{ "path": "name", "msg": "too long" }] }
  ```
- **Idempotency:** mutating endpoints accept `Idempotency-Key` header.
- **Rate limits:** 60 req/min per user for reads, 30 req/min for writes.

## 2. Auth

### `POST /auth/register`

```jsonc
// request
{ "handle": "forgewright", "email": "x@y.com", "password": "..." }
// response 201
{ "user": { ... }, "token": "eyJhbGc..." }
```

### `POST /auth/login`

```jsonc
{ "handle": "forgewright", "password": "..." }
→ 200 { "user", "token" }
```

### `POST /auth/oauth/{provider}` (apple | google)

```jsonc
{ "id_token": "..." } → 200 { "user", "token" }
```

### `POST /auth/refresh`

```jsonc
{ "refresh_token": "..." } → 200 { "token" }
```

## 3. Bots

### `GET /bots` — list user's own bots

Response:
```json
{
  "bots": [
    {
      "id": "...", "name": "Slasher",
      "elo": 1247, "wins": 12, "losses": 4, "draws": 1,
      "updated_at": "2026-09-27T00:00:00Z"
    }
  ]
}
```

### `POST /bots` — create

```jsonc
{
  "name": "Slasher",
  "chassis": {
    "types": [
      {
        "name": "scout",
        "hardware": [
          { "slot": "mobility", "part": "mk2_engine" },
          { "slot": "sensor",   "part": "long_radar" },
          { "slot": "weapon",   "part": "blaster" },
          { "slot": "energy",   "part": "solar" }
        ],
        "code": { "ir": "..." }    // text DSL source OR IR JSON
      }
    ]
  }
}
→ 201 { "bot": {...} }
```

### `GET /bots/{id}` — fetch one

```jsonc
{
  "id": "...",
  "chassis": { ... },          // full chassis + code
  "elo": 1247,
  ...
}
```

### `PATCH /bots/{id}` — update chassis or code

Same body shape as `POST /bots` (partial). Bumps `code_version`.

### `DELETE /bots/{id}` — delete

### `POST /bots/{id}/validate`

Runs the IR through the compiler and verifier without saving. Returns
errors and cycle estimate.

```jsonc
// request
{ "code": { "ir": "..." } }
// response
{ "ok": true, "cycles_per_tick": 230, "warnings": [] }
// or
{ "ok": false, "errors": [{ "line": 4, "msg": "unknown opcode 'blip'" }] }
```

### `POST /bots/{id}/simulate` — local quick-match

Runs the bot against the built-in **Drifter** AI on the server and
returns a short replay (≤ 600 ticks) within ~2 s. Used for live
preview before submitting.

```jsonc
{ "opponent": "drifter" }
→ 200 { "match_id": "...", "replay_id": "..." }
```

### `POST /bots/{id}/publish`

Toggles `is_public`. Visible on the public ladder.

## 4. Matches

### `POST /matches` — async PvP submit

```jsonc
{ "bot_id": "..." }
→ 202 {
  "match_id": "...",
  "opponent": { "bot_id": "...", "owner_handle": "rival42", "elo": 1180 },
  "eta_seconds": 6
}
```

The server matches on Elo ± 100 with a quick scan. If no human is
available, it falls back to a "ghost" bot from the community archive.

### `GET /matches?status=done&limit=20`

List recent matches for the user.

### `GET /matches/{id}`

```jsonc
{
  "id": "...",
  "status": "done",
  "winner": "...",
  "duration_ticks": 1180,
  "p1": { ... }, "p2": { ... },
  "elo_delta_p1": 12, "elo_delta_p2": -12
}
```

### `GET /matches/{id}/replay`

Streams the full replay JSON. For large replays, supports
`Range: bytes=` and is gzipped.

### `GET /matches/{id}/events?since=400`

Light endpoint for the spectator UI to subscribe-style poll. Returns
events from tick `since` onwards.

## 5. Ladder

### `GET /ladder?limit=50`

Top public bots.

```jsonc
{
  "entries": [
    { "rank": 1, "bot_id": "...", "name": "Replicator", "elo": 1842,
      "owner_handle": "kira", "wins": 230, "losses": 41 }
  ]
}
```

### `GET /ladder/me`

Current user's bot on the ladder.

## 6. Seasons

### `GET /seasons/current`

```jsonc
{ "id": 1, "name": "S1 — Genesis", "balance": {...}, "started_at": "..." }
```

## 7. Cosmetics (placeholder for IAP)

### `GET /cosmetics/catalog`

```jsonc
{ "items": [{ "sku": "skin_neon", "kind": "skin", "price_cents": 499, "currency": "USD" }] }
```

### `POST /cosmetics/purchase`

```jsonc
{ "sku": "skin_neon", "receipt": "..." }
→ 200 { "ok": true }
```

(MVP: store front is visible but purchases go through native App Store /
Play flows; the server just stores receipts.)

## 8. Health

### `GET /health`

```jsonc
{ "ok": true, "sim_version": "0.1.0", "db": "ok", "replay_hash": "abc..." }
```

`replay_hash` is the SHA-256 of a known-input deterministic test match.
If it ever changes without a deliberate sim bump, alarm.

## 9. WebSocket (preview-only in MVP)

```
wss://api.forgebots.app/v1/preview
```

Bi-directional JSON messages:

```
client → server: { "type": "subscribe", "bot_id": "..." }
server → client: { "type": "frame", "tick": 12, "state": {...} }
client → server: { "type": "stop" }
```

Used by the editor's "Run preview" button for a live 5-second preview
without committing to a real match.

## 10. Versioning & breaking changes

- Versioned URL (`/v1`).
- New optional fields: non-breaking.
- Renames: deprecate for 90 days, then bump to `/v2`.

## 11. OpenAPI

The full API is auto-generated from route Zod schemas into
`server/openapi.yaml`. The marketing site and SDK use this single
source of truth.
