# 07 — Database (Postgres) Data Model

> Additions and removals made to reconcile this doc with the rest of the
> spec kit are recorded in [`22-DECISIONS.md` D17](22-DECISIONS.md).

## 1. Schema overview

All tables are in the schema `forgebots`. **All primary keys are UUID
v7** (sortable by time) — including the two tables that previously used
`bigserial`. Timestamps are `timestamptz`. Money values are `int`
(cents-style).

**Generated columns:** every table uses
`id uuid primary key default gen_random_uuid()` — Postgres 18 provides
UUIDv7 via `uuidv7()`; migrations set the default explicitly per column
rather than relying on a server-level setting.

## 2. Tables

### 2.1 `users`

```sql
create table forgebots.users (
  id              uuid primary key default uuidv7(),
  handle          text unique not null check (length(handle) between 3 and 24),
  email_hash      text unique,   -- sha256(email + pepper); never store the address itself
  email_encrypted  text,            -- AES-GCM, for sending a password-reset mail
  password_hash   text,                       -- null for OAuth-only
  oauth_provider  text,                       -- 'apple' | 'google' | null
  oauth_subject   text,
  elo             int  not null default 1000,  -- cached display value only
  bot_slot_limit  int  not null default 3 check (bot_slot_limit <= 30),
  timezone        text not null default 'UTC',-- for push quiet hours
  created_at      timestamptz not null default now(),
  last_login_at   timestamptz,
  deleted_at      timestamptz                 -- soft delete (GDPR)
);

create unique index users_oauth_uq on forgebots.users (oauth_provider, oauth_subject)
  where oauth_provider is not null;
```

- `users.elo` is **not** used for matchmaking — `bots.elo` is
  authoritative. It is a cached "best of my bots" value recomputed
  after every match ([`22-DECISIONS.md` D14](22-DECISIONS.md)).
- `bot_slot_limit` is 3 free, 12 with Forge Pass, up to 30 with slot
  packs. The `check` constraint makes 30 a real ceiling rather than an
  application convention.
- `deleted_at` is what `18-LIVE-OPS-AND-TELEMETRY.md § 3.6` and
  `15-RISKS.md § 3` refer to; it did not exist as a column before.

### 2.2 `seasons`

```sql
create table forgebots.seasons (
  id                      int primary key,     -- monotonic
  name                    text not null,
  started_at              timestamptz not null,
  ended_at                timestamptz,
  current_balance_version_id uuid references forgebots.balance_versions(id)
);
```

A season is a **12-week window** (`18 § 1.1`). The balance payload no
longer lives here — see 2.3.

### 2.3 `balance_versions`

```sql
create table forgebots.balance_versions (
  id              uuid primary key default uuidv7(),
  season_id       int not null references forgebots.seasons(id),
  version         int  not null,               -- monotonic within a season
  balance_json    jsonb not null,              -- full hardware catalog + arena layout
  sha256          text not null,
  created_at      timestamptz not null default now(),
  unique (season_id, version)
);

create index balance_versions_season_idx
  on forgebots.balance_versions (season_id, version desc);
```

**Why this table exists.** `18 § 2.3` promises a balance patch every
4 weeks inside a 12-week season, and `04 § 10` says tuning ships
without an app update. With balance stored as one `seasons.balance_json`
document there was nowhere for a mid-season patch to live, and the old
`matches.balance_id` column was a second foreign key to `seasons` that
pointed at the same row as `season_id`. Now:

- a season has many balance versions,
- `matches.balance_version_id` pins the exact one a match ran under,
- `sha256` is what `replays` and the replay document record, so a replay
  stays verifiable even if a version is later edited (it is not — rows
  are immutable once a match references them).

### 2.4 `bots`

```sql
create table forgebots.bots (
  id              uuid primary key default uuidv7(),
  owner_id        uuid not null references forgebots.users(id) on delete cascade,
  name            text not null check (length(name) between 1 and 32),
  chassis_json    jsonb not null,   -- { designs: [ { name, parts: [...], code: {...} } ] }
  code_version    int  not null default 1,
  elo             int  not null default 1000,
  games_played    int  not null default 0,   -- drives the K-factor switch
  wins            int  not null default 0,
  losses          int  not null default 0,
  draws           int  not null default 0,
  is_public       boolean not null default false,
  is_ghost        boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index bots_owner_idx on forgebots.bots (owner_id);
create index bots_elo_idx   on forgebots.bots (elo desc) where is_public;
```

`chassis_json` (including each design's compiled program) is validated
server-side before insert. A bot has **1–3 designs** in MVP, each with
a parts list and a compiled IR program. There is deliberately **no**
top-level `code_ir` column: the program lives per design inside
`chassis_json` (see `04-GAME-DESIGN.md § 6` and
[`22-DECISIONS.md` D12](22-DECISIONS.md) for the bot/design/robot
vocabulary).

- `is_ghost` marks the reserved system user's starter-bot rows. They
  are excluded from the public ladder by `is_public = false`, and they
  **do** carry a real, changing `elo` — the previous spec said both
  "ghost Elo is tracked" and "Elo-less ghosts"
  ([`22-DECISIONS.md` D11](22-DECISIONS.md)).
- `games_played` is what selects `K = 32` vs `K = 16`
  ([`22-DECISIONS.md` D14](22-DECISIONS.md)).

#### 2.4.1 `bot_versions`

Save-history for bots. Backs the "save unlimited previous versions"
Forge Pass perk (`14-MONETIZATION.md` § 2.2) and the `code_version`
counter bumped by `PATCH /bots/{id}` (`08-API-SURFACE.md` § 3).
Free-tier retention caps are enforced app-side, not in the schema.

```sql
create table forgebots.bot_versions (
  id            uuid primary key default uuidv7(),
  bot_id        uuid not null references forgebots.bots(id) on delete cascade,
  code_version  int  not null,
  chassis_json  jsonb not null,
  created_at    timestamptz not null default now()
);

create index bot_versions_bot_idx on forgebots.bot_versions (bot_id, code_version desc);
```

### 2.5 `matches`

```sql
create table forgebots.matches (
  id                uuid primary key default uuidv7(),
  season_id         int  not null references forgebots.seasons(id),
  balance_version_id uuid not null references forgebots.balance_versions(id),
  status            text not null check (status in ('queued','running','done','failed','draw')),
  kind              text not null default 'pvp'
                    check (kind in ('pvp','ghost','preview','mission')),
  p1_id             uuid not null references forgebots.users(id),
  p1_bot_id         uuid not null references forgebots.bots(id),
  p2_id             uuid not null references forgebots.users(id),
  p2_bot_id         uuid not null references forgebots.bots(id),
  seed              bigint not null,          -- matchRng seed
  winner            uuid references forgebots.users(id),
  win_reason        text check (win_reason in
                      ('elimination','tick_cap_biomass','draw_tick','draw_tie')),
  duration_ticks    int,
  elo_delta_p1      int,
  elo_delta_p2      int,
  created_at        timestamptz not null default now(),
  started_at        timestamptz,
  finished_at       timestamptz
);

create index matches_status_idx  on forgebots.matches (status, created_at);
create index matches_player_idx  on forgebots.matches (p1_id, created_at desc);
create index matches_player2_idx on forgebots.matches (p2_id, created_at desc);
```

Fixes made here:

- **`created_at` now exists.** Three indexes referenced it and the
  column was never defined, so this table could not have been created.
- **`replay_id` is removed.** `replays.match_id` (unique, 2.6) is the
  only join. The old pair of mutually-referencing foreign keys
  (`matches.replay_id` → `replays.id`, `replays.match_id` →
  `matches.id`) made row insertion order impossible.
- **`balance_id` is replaced by `balance_version_id`** — see 2.3.
- `kind` distinguishes ranked PvP from ghost, preview and mission
  matches, so Elo and telemetry can treat them differently without
  guessing.
- `win_reason` mirrors `11-REPLAY-FORMAT.md § 2`.

**Ghost opponents.** The matchmaking fallback (`08-API-SURFACE.md` § 4)
pits players against starter-bot ghosts (`19-STARTER-BOTS-AND-LIBRARY.md`
§ 5). Ghosts are `bots` rows owned by a reserved system user with
`is_ghost = true`, so `p2_id` / `p2_bot_id` stay NOT NULL and no
nullable-column branching is needed.

### 2.6 `replays`

```sql
create table forgebots.replays (
  id              uuid primary key default uuidv7(),
  match_id        uuid not null references forgebots.matches(id),
  sim_version     text not null,              -- semver of the simulator
  doc_version     int  not null default 1,    -- replay document shape
  tick_count      int  not null,
  events_json     jsonb not null,             -- see 11-REPLAY-FORMAT.md
  output_sha256   text not null,              -- see 10-DETERMINISM.md 5
  size_bytes      int  not null,              -- measured, for the size budget
  created_at      timestamptz not null default now()
);

create unique index replays_match_uq on forgebots.replays (match_id);
```

`size_bytes` is stored so the `< 150 KB p50 / 3 MB cap` budget from
`22-DECISIONS.md D10` can be *measured* in production rather than
guessed at.

### 2.7 `elo_history`

```sql
create table forgebots.elo_history (
  id          uuid primary key default uuidv7(),
  bot_id      uuid not null references forgebots.bots(id) on delete cascade,
  match_id    uuid not null references forgebots.matches(id),
  elo_before  int not null,
  elo_after   int not null,
  delta       int not null,
  created_at  timestamptz not null default now()
);

create index elo_history_bot_idx on forgebots.elo_history (bot_id, created_at desc);
```

### 2.8 `cosmetics`

```sql
create table forgebots.cosmetics (
  id          uuid primary key default uuidv7(),
  owner_id    uuid not null references forgebots.users(id) on delete cascade,
  kind        text not null check (kind in ('skin','animation','arena_theme','slot_pack')),
  sku         text not null,
  acquired_at timestamptz not null default now()
);

create index cosmetics_owner_idx on forgebots.cosmetics (owner_id);
```

`slot_pack` is a *functional* item, not a cosmetic, but it lives here
because it is granted the same way. It is excluded from the "never sell
power" rule by being a capacity purchase, not a strength purchase
(`14-MONETIZATION.md § 2.4`).

### 2.9 `purchases`

For IAP receipts from App Store / Play. Out of scope for MVP code but
schema is here.

```sql
create table forgebots.purchases (
  id            uuid primary key default uuidv7(),
  user_id       uuid not null references forgebots.users(id) on delete cascade,
  sku           text not null,
  platform      text not null check (platform in ('apple','google','web')),
  receipt       text not null,
  verified_at   timestamptz,
  created_at    timestamptz not null default now(),
  unique (platform, receipt)
);
```

`unique (platform, receipt)` is a security control, not tidiness. A
client can replay the same valid App Store or Play receipt as many times
as it likes; without this constraint every replay grants the item again.
The receipt, not the client, is the authority on what was bought, so it
is the column that must be idempotent.

### 2.10 `refresh_tokens` and `idempotency_keys`

`08-API-SURFACE.md § 1` promises `Idempotency-Key` on mutating
endpoints and § 2 promises rotatable, revocable refresh tokens. Both
need storage.

```sql
create table forgebots.refresh_tokens (
  id          uuid primary key default uuidv7(),
  user_id     uuid not null references forgebots.users(id) on delete cascade,
  token_hash  text not null unique,   -- sha256; the raw token is returned once
  device      text,
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index refresh_tokens_user_idx on forgebots.refresh_tokens (user_id)
  where revoked_at is null;

create table forgebots.idempotency_keys (
  user_id       uuid not null references forgebots.users(id) on delete cascade,
  key           text not null,
  endpoint      text not null,
  request_hash  text not null,     -- so a reused key with a different body 409s
  response_json jsonb,            -- the stored response, replayed verbatim
  status        int,
  created_at    timestamptz not null default now(),
  primary key (user_id, key, endpoint)
);
create index idempotency_keys_gc_idx on forgebots.idempotency_keys (created_at);
```

- Refresh tokens are **stored hashed**. A dump of this table must not be
  enough to impersonate anyone — the same reasoning as `email_hash`.
- `idempotency_keys` grows without bound; the index above supports
  deleting rows older than 24 h.
- Both tables are `on delete cascade` from `users`, so account deletion
  revokes sessions automatically (`07 § 6`).

### 2.11 `achievements` and `user_achievements`

Backs `04-GAME-DESIGN.md § 8` and the seasonal achievement cadence in
`18 § 1.2`.

```sql
create table forgebots.achievements (
  id          uuid primary key default uuidv7(),
  key         text unique not null,     -- 'first_win', 'win_no_weapons', …
  name_json   jsonb not null,           -- localised { en, ar } at read time
  criteria_json jsonb not null,         -- evaluated server-side from the match result
  is_seasonal boolean not null default false,
  season_id   int references forgebots.seasons(id),
  created_at  timestamptz not null default now()
);

create table forgebots.user_achievements (
  user_id        uuid not null references forgebots.users(id) on delete cascade,
  achievement_id uuid not null references forgebots.achievements(id) on delete cascade,
  unlocked_at    timestamptz not null default now(),
  primary key (user_id, achievement_id)
);
```

### 2.12 `missions` and `user_missions`

Backs the three-mission onboarding ladder in `17-ONBOARDING.md § 3.1`,
which needs server state because the win conditions are evaluated
**mid-match** ("biomass > Drifter's at tick 600").

```sql
create table forgebots.missions (
  id            int primary key,          -- 1, 2, 3
  name_json     jsonb not null,
  goal_json     jsonb not null,           -- { type, threshold, tick, opponent_design }
  opponent_design_json jsonb not null,   -- the AI chassis the mission runs against
  scaffold_fb   text not null,            -- pre-filled DSL source for the editor
  ordinal       int not null
);

create table forgebots.user_missions (
  user_id     uuid not null references forgebots.users(id) on delete cascade,
  mission_id  int  not null references forgebots.missions(id),
  attempts    int  not null default 0,
  cleared_at  timestamptz,
  last_match_id uuid references forgebots.matches(id),
  primary key (user_id, mission_id)
);
```

Mission matches are `matches.kind = 'mission'` (2.5) and never affect
Elo.

### 2.13 `replay_bookmarks` and `replay_shares`

These are the two things `07 § 6`, `11 § 8` and `13 § 14.4` promised
but had no table for. Without them, "bookmarked replays are exempt from
the 90-day prune" is unenforceable and a public share link has nothing
to authorise it.

```sql
create table forgebots.replay_bookmarks (
  user_id    uuid not null references forgebots.users(id) on delete cascade,
  replay_id  uuid not null references forgebots.replays(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, replay_id)
);

create table forgebots.replay_shares (
  id         uuid primary key default uuidv7(),
  replay_id  uuid not null references forgebots.replays(id) on delete cascade,
  created_by uuid not null references forgebots.users(id) on delete cascade,
  token      text unique not null,     -- 32 bytes, url-safe base64
  expires_at timestamptz not null,     -- created_at + 30 days
  created_at timestamptz not null default now()
);

create index replay_shares_replay_idx on forgebots.replay_shares (replay_id);
```

### 2.14 Push notification tables

Defined in full in `21-LOCALIZATION-AND-NOTIFICATIONS.md § 2.9.2` and
**owned by this doc** — that doc previously claimed these tables were
already in `07` when they were not.

```sql
create table forgebots.push_tokens (
  id           uuid primary key default uuidv7(),
  user_id      uuid not null references forgebots.users(id) on delete cascade,
  platform     text not null check (platform in ('ios','android','web')),
  token        text not null,
  locale       text not null,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);
create index push_tokens_user_idx on forgebots.push_tokens (user_id);
create unique index push_tokens_token_uq on forgebots.push_tokens (token);

create table forgebots.notification_prefs (
  user_id    uuid primary key references forgebots.users(id) on delete cascade,
  prefs_json jsonb not null,   -- per-channel booleans, quiet_start/end, timezone
  updated_at timestamptz not null default now()
);

create table forgebots.notifications (
  id                 uuid primary key default uuidv7(),
  user_id            uuid not null references forgebots.users(id) on delete cascade,
  channel            text not null,
  scheduled_for      timestamptz not null,
  status             text not null check (status in ('pending','sent','failed','cancelled')),
  payload_json       jsonb not null,
  last_reengagement_at timestamptz,   -- see 21 § 2.6
  sent_at            timestamptz,
  error              text
);
create index notifications_due_idx
  on forgebots.notifications (scheduled_for) where status = 'pending';
```

`last_reengagement_at` is on `notifications` because that is where
`21 § 2.6` reads it from. It is denormalised onto the user row by the
scheduler when a `reengagement` notification is sent.

### 2.15 `audit_log`

```sql
create table forgebots.audit_log (
  id          uuid primary key default uuidv7(),
  user_id     uuid,
  action      text not null,
  payload     jsonb,
  created_at  timestamptz not null default now()
);

create index audit_user_idx on forgebots.audit_log (user_id, created_at desc);
```

## 3. Row-Level Security (RLS)

```sql
alter table forgebots.bots       enable row level security;
alter table forgebots.cosmetics  enable row level security;
alter table forgebots.purchases  enable row level security;
alter table forgebots.replays    enable row level security;
alter table forgebots.bot_versions enable row level security;

-- Owner can read/write own rows
create policy bots_owner_rw on forgebots.bots
  using (owner_id = current_setting('app.user_id', true)::uuid)
  with check (owner_id = current_setting('app.user_id', true)::uuid);

-- Public bots readable by anyone
create policy bots_public_r on forgebots.bots
  for select using (is_public = true);

-- Replays: the owner of either side, or an unexpired share token
create policy replays_participant_r on forgebots.replays
  for select using (
    exists (
      select 1 from forgebots.matches m
      where m.id = replays.match_id
        and (m.p1_id = current_setting('app.user_id', true)::uuid
          or m.p2_id = current_setting('app.user_id', true)::uuid)
    )
  );

create policy replays_shared_r on forgebots.replays
  for select using (
    exists (
      select 1 from forgebots.replay_shares s
      where s.replay_id = replays.id
        and s.expires_at > now()
    )
  );

-- Owner-only tables. Enabling RLS with no policy DENIES ALL, so every
-- table below needs at least one policy or the API cannot read the
-- caller's own rows.
create policy cosmetics_owner_rw on forgebots.cosmetics
  using (owner_id = current_setting('app.user_id', true)::uuid)
  with check (owner_id = current_setting('app.user_id', true)::uuid);

create policy purchases_owner_r on forgebots.purchases
  for select using (user_id = current_setting('app.user_id', true)::uuid);

create policy bot_versions_owner_r on forgebots.bot_versions
  for select using (
    exists (
      select 1 from forgebots.bots b
      where b.id = bot_versions.bot_id
        and b.owner_id = current_setting('app.user_id', true)::uuid
    )
  );
```

Three corrections:

- **Every table with RLS enabled now has a policy.** The previous
  version enabled RLS on `cosmetics`, `purchases` and `bot_versions`
  and wrote policies only for `bots` and `replays`. Enabling RLS with no
  policy is *deny-all*: the API would have been unable to read a
  player's own cosmetics, their purchases, or — worst — their bot save
  history, which is the Forge Pass perk.
- **`current_setting('app.user_id', true)`, not `current_setting(...)`.**
  Without `missing_ok`, the setting raises an error when it is absent
  rather than returning NULL. The unauthenticated
  `GET /public/replays/{token}` path (`08 § 4`) sets no `app.user_id`, so
  every policy would have thrown on exactly the one route that must
  work without a login.
- `replay_bookmarks` and `replay_shares` are reachable only through
  the API with the user's id checked in the query, so they are left
  without RLS rather than given a policy that duplicates the API check.

- `replays` previously had **no** RLS policy while three documents
  described public share links. A public read path with no policy is an
  open path, so the share-token policy is part of the security model,
  not a nicety.
- Public replay reads go through a dedicated endpoint that sets
  `app.share_token` and checks `replay_shares` in the same transaction
  (`08-API-SURFACE.md` § 4).
- The API sets `app.user_id` per request via `SET LOCAL` in a
  transaction.

## 4. Indices quick-reference

| Table | Index | Reason |
|---|---|---|
| users | unique(handle), unique(email) | login lookups |
| bots | (owner_id), (elo desc) where is_public | listing, ladder |
| bots | — where is_ghost | ghost selection (filter, no index needed at 8 rows) |
| balance_versions | (season_id, version desc) | resolve a match's balance |
| matches | (status, created_at), (p1_id, created_at desc), (p2_id, created_at desc) | queue scan, history |
| replays | unique(match_id) | 1-to-1 with match |
| elo_history | (bot_id, created_at desc) | bot stats page |
| bot_versions | (bot_id, code_version desc) | save history |
| replay_shares | unique(token), (replay_id) | resolve a share URL |
| notifications | (scheduled_for) where status='pending' | the 5-minute push cron |
| push_tokens | unique(token) | de-dup a re-registered device |

## 5. Migration policy

- Every migration is a forward-only SQL file in
  `server/migrations/NNNN_name.sql`.
- Naming: `0001_users.sql`, `0002_seasons_balance.sql`, etc.
- Run on startup via a small migrator (custom 50-line script using
  `pg`).
- Down migrations are forbidden. If a destructive change is needed,
  ship a forward migration that does the right thing.
- A `balance_versions` row referenced by any `matches` row is
  **immutable**; corrections ship as a new version. This is what makes
  an old replay re-verifiable.

## 6. Backup & retention

- **Daily logical dump** via `pg_dump`, retained in the Postgres
  provider's own backup storage. Object storage is *not* an MVP
  dependency (`05-TECH-STACK.md` deferred it), so MVP relies on the
  managed-provider backups rather than on a bucket that does not exist
  yet.
- **Replays older than 90 days** are pruned, **except** rows present in
  `replay_bookmarks`. The prune query is
  `delete from replays r where r.created_at < now() - interval '90 days'
   and not exists (select 1 from replay_bookmarks b where b.replay_id = r.id)`.
- **Share links** expire on their own `replay_shares.expires_at`
  (30 days) and stop authorising reads then, independently of replay
  retention.
- **GDPR/CCPA:** account deletion sets `users.deleted_at` and hashes
  `email`; a nightly job hard-deletes the row and its cascade after a
  30-day grace window. `audit_log` and `notifications` are retained
  for 2 years per `18 § 7` with `user_id` retained but PII-free.
- **User data export** is `GET /users/me/export`
  (`08-API-SURFACE.md` § 9), which dumps every row for the caller.
