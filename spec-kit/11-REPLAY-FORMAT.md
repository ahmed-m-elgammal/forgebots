# 11 — Replay Format

> Size budget and hash scope are fixed in
> [`22-DECISIONS.md` D10](22-DECISIONS.md). This doc follows them.

## 1. Goals

- **Compact** — 1500 ticks in **< 150 KB at p50**, 3 MB hard cap. This
  is a *measured budget with a CI alert*, not a design promise. It is
  only reachable because `move` and `aim` are change-only (§ 4) and a
  `snapshot` is emitted every 30 ticks.
- **Streamable** — the viewer can request `?since=N` and resume.
- **Self-contained** — match meta, balance reference, bot programs and
  the final state in one document.
- **Lossless** — a replay plus its seed and balance version is enough
  to re-simulate the match exactly.

All coordinates are **integer millimetres**; all angles are in the
65536 = 2π unit ([`22-DECISIONS.md` D1](22-DECISIONS.md)).

## 2. Top-level shape

```jsonc
{
  "version": 1,
  "match_id": "uuid",
  "sim_version": "0.1.0",
  "seed": "0xC0FFEE...",
  "balance_version_id": 42,
  "balance_sha256": "...",        // hash of the balance_json used
  "tick_count": 1500,
  "duration_ms": 25000,
  "winner": "p1" | "p2" | "draw",
  "reason": "elimination" | "tick_cap_biomass" | "draw_tick" | "draw_tie",
  "players": [
    {
      "user_id": "uuid",
      "handle": "forgewright",
      "bot_id": "uuid",
      "bot_snapshot": { "name": "Slasher", "designs": [ /* … */ ] },
      "elo_before": 1000,
      "elo_after": 1012,
      "is_ghost": false
    }
  ],
  "events": [
    /* tick-grouped, see § 3 */
  ],
  "final_state": {
    /* canonical JSON of robot positions, hp, energy at tick T */
  },
  "output_sha256": "..."          // EXCLUDED from the hash input — see § 2.1
}
```

- `bot_snapshot.designs[]` is the exact program + chassis of every
  design each side fielded, so the replay is re-simulable without the
  `bots` table.
- `reason` explains *why* the match ended, so the viewer's result card
  does not have to infer it.

### 2.1 What the hash covers

```
output_sha256 = sha256(
  seed ‖ balance_sha256 ‖ canonical(final_state) ‖ canonical(events)
)
```

The `output_sha256` field **inside this document is not part of its own
hash input** — that is the only exclusion. It is stored canonically in
`replays.output_sha256` and mirrors the copy here
([`10-DETERMINISM.md` § 5](10-DETERMINISM.md)).

## 3. Event structure

Events are grouped by tick. Each tick is an array of zero or more events.

```jsonc
"events": [
  [],                                  // tick 0
  [                                   // tick 1 — first snapshot
    { "t": 1, "kind": "snapshot",
      "robots": [ { "id": "p1.scout.0", "x": 1234, "y": 5678,
                    "hp": 15, "shield": 0, "energy": 500, "biomass": 0 } ] }
  ],
  [
    { "t": 2, "kind": "shot",
      "bot": "p1.scout.0",
      "x": 1234, "y": 5678,            // mm
      "target": "p2.tank.1",
      "weapon": "blaster",
      "damage": 12,
      "to_shield": 12
    },
    { "t": 2, "kind": "biomass_taken",
      "bot": "p2.tank.1",
      "amount": 1
    }
  ],
  ...
]
```

`"t"` is the tick index. It duplicates the array index so a client can
validate that a chunked stream arrived in order.

Robot ids are stable for the life of a match: `p1.<design>.<index>`,
e.g. `p1.scout.0`.

## 4. Event kinds (MVP)

| Kind | Required fields | Optional | Emitted |
|---|---|---|---|
| `snapshot` | `robots[]` (id, x, y, hp, shield, energy, biomass) | — | **every 30 ticks** + tick 1 |
| `shot` | bot, x, y, target, damage | weapon, to_shield | on hit |
| `damage` | target, amount, source, to_shield | — | on shield/hull damage not from a shot |
| `death` | bot, cause (`combat` \| `starvation`) | killer | on death |
| `birth` | bot, parent, design | — | on construction complete |
| `build_start` | bot, design, cost_kg | — | when construction begins |
| `build_done` | bot, child | — | when construction completes |
| `biomass_spawn` | x, y | — | on initial fill and respawn |
| `biomass_taken` | bot, amount | — | on pickup |
| `biomass_depleted` | x, y | — | when a cell is emptied |
| `fire` | bot, weapon | success | on a fire attempt (hit or miss) |
| `move` | bot, vx, vy | — | **only when throttle changes** |
| `aim` | bot, angle | — | **only when the angle changes** |
| `say` | bot, channel, payload | — | on broadcast |
| `eat` | bot, amount | reason (`player` \| `starvation`) | on conversion |
| `vm_yield` | bot, cycles_used, reason (`budget` \| `trap`) | — | on cycle-budget abandon |
| `match_end` | winner, reason | — | once |

**Change-only `move` and `aim`.** A bot that re-issues the same
`(move 65536 0)` every tick emits **one** `move` event, not 1500. This
is what makes the size budget reachable: the naive encoding was
12 robots × 1500 ticks × 2 events ≈ 400 KB before any other event
existed. The viewer holds the last value forward and the 30-tick
`snapshot` is the periodic correction / seek aid.

`death.cause`, `eat.reason` and `vm_yield.reason` were added because
the client and the telemetry layer were previously unable to tell
starvation from combat, or a player-issued `eat` from an emergency one.

## 5. Streaming

The viewer polls `GET /matches/{id}/events?since=420`. The server
returns events for ticks 420..end plus a `cursor`.

- `?until=600` caps the response size; the viewer re-requests with the
  new `since`.
- **There is no `Range: bytes=` support.** Byte ranges are meaningless
  over a JSONB-derived stream that is gzipped on the fly, and the tick
  cursor already does the job. (An earlier version of this spec
  offered both and they contradicted each other.)

## 6. Storage

- MVP: one row per match in `replays.events_json`. Postgres TOAST
  handles compression automatically.
- Retention: 90 days, except bookmarked replays
  (`07-DATA-MODEL.md § 6`). Public share links live 30 days from
  creation (`replay_shares.expires_at`).
- v0.3: gzip to object storage; the DB row keeps metadata + object key.
  Object storage is **not** an MVP dependency, so neither is the
  backup bucket it was previously assumed to provide
  ([`22-DECISIONS.md` D17](22-DECISIONS.md)).

## 7. Replay viewer UI

```
┌───────────────────────────────────────────────────────────────┐
│ [⏵ Play] [⏸ Pause] [⏮ Restart]   Speed: 0.25x [1x] [2x] [4x]    │
│                                                               │
│             [Arena: 200 m × 200 m, gridline = 2 m]            │
│                                                               │
│  Timeline:                                                    │
│  ├────────●─────●──────●────●────●────────►                   │
│  0        200   400     600   800  1000  tick                 │
│                                                               │
│  Event log (selected tick):                                   │
│   • scout.0 fired blaster at enemy.tank.1 (12 dmg → shield)   │
│   • enemy.tank.1 biomass taken +1                             │
└───────────────────────────────────────────────────────────────┘
```

- Drag the timeline dot to scrub.
- Tap a robot to follow it.
- Tap an event in the log to jump to that tick.
- Seeking backwards replays events from the nearest preceding
  `snapshot` — that is what the 30-tick cadence buys.
## 8. Export / share

A user can:

- **Share** — generate a public URL backed by a `replay_shares` row
  with a 30-day `expires_at`. The share link is a Forge Pass perk
  (`14-MONETIZATION.md § 2.2`); free players can still bookmark and
  export. The replay itself follows the 90-day retention policy, and
  bookmarked replays are exempt.
- **Bookmark** — adds to "My Replays", kept forever
  (`replay_bookmarks`).
- **Download** a `.fb-replay` JSON file (gzipped) for offline analysis.

## 9. Versioning

- `version: 1` for MVP.
- `version` (replay document shape) and `sim_version` (simulator
  semver) are independent. Bumping `sim_version` MAJOR requires a
  replay migration; bumping `version` requires a converter for old
  documents. The two were previously conflated into one promise.
- We commit to keeping `version: 1` for at least 18 months
  (`18-LIVE-OPS-AND-TELEMETRY.md § 1.3`).
