# 11 — Replay Format

## 1. Goals

- **Compact** — store 1500 ticks in <100 KB on average.
- **Streamable** — viewer can request `?since=N` and resume.
- **Self-contained** — match meta + balance snapshot + bot IRs in one
  document.
- **Lossless** — perfect re-simulation from a replay + seed.

## 2. Top-level shape

```jsonc
{
  "version": 1,
  "match_id": "uuid",
  "sim_version": "0.1.0",
  "seed": "0xC0FFEE...",
  "balance_sha256": "...",        // hash of balance.json used
  "tick_count": 1500,
  "duration_ms": 25000,
  "winner": "p1" | "p2" | "draw",
  "players": [
    {
      "user_id": "uuid",
      "handle": "forgewright",
      "bot_id": "uuid",
      "bot_snapshot": { "name": "Slasher", "types": [...] },
      "elo_before": 1000,
      "elo_after": 1012
    }
  ],
  "events": [
    /* tick-grouped, see §3 */
  ],
  "final_state": {
    /* canonical JSON of entity positions, hp, energy at tick T */
  },
  "output_sha256": "..."
}
```

## 3. Event structure

Events are grouped by tick. Each tick is an array of zero or more events.

```jsonc
"events": [
  [],                                  // tick 0
  [],                                  // tick 1
  [
    { "t": 2, "kind": "shot",
      "bot": "p1.scout.0",
      "x": 1234, "y": 5678,            // mm
      "target": "p2.tank.1",
      "damage": 12
    },
    { "t": 2, "kind": "biomass_taken",
      "bot": "p2.tank.1",
      "amount": 1
    }
  ],
  ...
]
```

`"t"` is the tick index (redundant with array index for fast seek but
kept for streaming).

## 4. Event kinds (MVP)

| Kind | Required fields | Optional |
|---|---|---|
| `shot` | bot, x, y, target, damage | weapon |
| `damage` | target, amount, source | crit |
| `death` | bot, cause | — |
| `birth` | bot, parent, type | — |
| `biomass_spawn` | x, y | — |
| `biomass_taken` | bot, amount | — |
| `biomass_depleted` | x, y | — |
| `build_start` | bot, type | — |
| `build_done` | bot, child | — |
| `fire` | bot, weapon | success |
| `move` | bot, vx, vy | — |
| `aim` | bot, angle | — |
| `say` | bot, channel, payload | — |
| `eat` | bot, amount | — |
| `vm_yield` | bot, cycles_used, reason | — |
| `match_end` | winner | — |

## 5. Streaming

The viewer polls `GET /matches/{id}/events?since=420`. Server returns
events for ticks 420..end, plus a `cursor` so we can resume mid-replay.

For an even snappier experience, the server supports `?until=600` to
limit response size. The viewer then re-requests with the new `since`.

## 6. Storage

- MVP: one row per match in `replays.events_json`. Postgres TOAST
  handles compression automatically.
- v0.3: gzip+store in object storage; DB row keeps just the metadata
  + object key.

## 7. Replay viewer UI

```
┌───────────────────────────────────────────────────────────────┐
│ [⏵ Play] [⏸ Pause] [⏮ Restart]   Speed: 1x [2x] [4x] [0.25x] │
│                                                               │
│             [Arena: 200×200, scale: 2 m/gridline]             │
│                                                               │
│  Timeline:                                                    │
│  ├────────●─────●──────●────●────●────────►                   │
│  0        200   400     600   800  1000  tick                 │
│                                                               │
│  Event log (selected tick):                                   │
│   • scout.0 fired blaster at enemy.tank.1 (12 dmg)            │
│   • enemy.tank.1 biomass taken +1                             │
└───────────────────────────────────────────────────────────────┘
```

- Drag the timeline dot to scrub.
- Tap a robot to follow it.
- Tap an event in the log to jump to that tick.

## 8. Export / share

A user can:
- Copy a share link (server stores the replay for 30 days, public-read).
- Download a `.fb-replay` JSON file (gzipped) for offline analysis.

## 9. Versioning

- `version: 1` for MVP.
- Bumping `version` is allowed only with a migration that converts old
  replays forward (lossy or lossless). We commit to keeping `version: 1`
  for at least 18 months.
