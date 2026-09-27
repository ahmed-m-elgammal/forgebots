# 07 — Database (Postgres) Data Model

## 1. Schema overview

All tables are in the schema `forgebots`. IDs are UUID v7 (sortable by time).
Timestamps are `timestamptz`. Money/cost values are `int` (cents-style).

## 2. Tables

### 2.1 `users`

```sql
create table forgebots.users (
  id              uuid primary key,
  handle          text unique not null check (length(handle) between 3 and 24),
  email           text unique,
  password_hash   text,                       -- null for OAuth-only
  oauth_provider  text,                       -- 'apple' | 'google' | null
  oauth_subject   text,
  elo             int  not null default 1000,
  bot_slot_limit  int  not null default 3,
  created_at      timestamptz not null default now(),
  last_login_at   timestamptz
);

create unique index users_oauth_uq on forgebots.users (oauth_provider, oauth_subject)
  where oauth_provider is not null;
```

### 2.2 `seasons`

```sql
create table forgebots.seasons (
  id              int primary key,            -- monotonic
  name            text not null,
  started_at      timestamptz not null,
  ended_at        timestamptz,
  balance_json    jsonb not null              -- hardware catalog + arena layout
);
```

The `balance_json` is the single source of truth for the simulation
constants in a given season. Updates ship as new rows; old replays stay
valid against the row they were run under.

### 2.3 `bots`

```sql
create table forgebots.bots (
  id              uuid primary key,
  owner_id        uuid not null references forgebots.users(id) on delete cascade,
  name            text not null check (length(name) between 1 and 32),
  chassis_json    jsonb not null,             -- { types: [{ hardware: [...], code_ir: {...} }] }
  code_ir         jsonb not null,             -- top-level IR (one per bot)
  code_version    int  not null default 1,
  elo             int  not null default 1000,
  wins            int  not null default 0,
  losses          int  not null default 0,
  draws           int  not null default 0,
  is_public       boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index bots_owner_idx on forgebots.bots (owner_id);
create index bots_elo_idx   on forgebots.bots (elo desc) where is_public;
```

`chassis_json` and `code_ir` are validated server-side before insert. A
bot has up to 3 robot types in MVP, each with a hardware list and a
compiled IR program.

### 2.4 `matches`

```sql
create table forgebots.matches (
  id              uuid primary key,
  season_id       int not null references forgebots.seasons(id),
  status          text not null check (status in ('queued','running','done','failed','draw')),
  p1_id           uuid not null references forgebots.users(id),
  p1_bot_id       uuid not null references forgebots.bots(id),
  p2_id           uuid not null references forgebots.users(id),
  p2_bot_id       uuid not null references forgebots.bots(id),
  -- snapshot of balance so we can re-validate replays
  balance_id      int not null references forgebots.seasons(id),
  seed            bigint not null,            -- RNG seed for the match
  winner          uuid references forgebots.users(id),
  duration_ticks  int,
  elo_delta_p1    int,
  elo_delta_p2    int,
  started_at      timestamptz,
  finished_at     timestamptz,
  replay_id       uuid references forgebots.replays(id)
);

create index matches_status_idx   on forgebots.matches (status, created_at);
create index matches_player_idx   on forgebots.matches (p1_id, created_at desc);
create index matches_player2_idx  on forgebots.matches (p2_id, created_at desc);
```

### 2.5 `replays`

Replays can be **huge** (1500 ticks × dozens of events). MVP stores them
as JSONB; if size becomes a problem we move to gzip-bytea.

```sql
create table forgebots.replays (
  id              uuid primary key,
  match_id        uuid not null references forgebots.matches(id),
  sim_version     text not null,              -- semver of the simulator
  tick_count      int  not null,
  -- Compact event stream; see 11-REPLAY-FORMAT.md for schema
  events_json     jsonb not null,
  -- Hash of the deterministic output for integrity checks
  output_sha256   text not null,
  created_at      timestamptz not null default now()
);

create unique index replays_match_uq on forgebots.replays (match_id);
```

### 2.6 `elo_history`

```sql
create table forgebots.elo_history (
  id              bigserial primary key,
  bot_id          uuid not null references forgebots.bots(id) on delete cascade,
  match_id        uuid not null references forgebots.matches(id),
  elo_before      int not null,
  elo_after       int not null,
  delta           int not null,
  created_at      timestamptz not null default now()
);

create index elo_history_bot_idx on forgebots.elo_history (bot_id, created_at desc);
```

### 2.7 `cosmetics`

```sql
create table forgebots.cosmetics (
  id              uuid primary key,
  owner_id        uuid not null references forgebots.users(id) on delete cascade,
  kind            text not null check (kind in ('skin','animation','arena_theme','slot_pack')),
  sku             text not null,
  acquired_at     timestamptz not null default now()
);

create index cosmetics_owner_idx on forgebots.cosmetics (owner_id);
```

### 2.8 `purchases`

For IAP receipts from App Store / Play. Out of scope for MVP code but
schema is here.

```sql
create table forgebots.purchases (
  id              uuid primary key,
  user_id         uuid not null references forgebots.users(id) on delete cascade,
  sku             text not null,
  platform        text not null check (platform in ('apple','google','web')),
  receipt         text not null,
  verified_at     timestamptz,
  created_at      timestamptz not null default now()
);
```

### 2.9 `audit_log`

```sql
create table forgebots.audit_log (
  id              bigserial primary key,
  user_id         uuid,
  action          text not null,
  payload         jsonb,
  created_at      timestamptz not null default now()
);

create index audit_user_idx on forgebots.audit_log (user_id, created_at desc);
```

## 3. Row-Level Security (RLS)

```sql
alter table forgebots.bots       enable row level security;
alter table forgebots.cosmetics  enable row level security;
alter table forgebots.purchases  enable row level security;

-- Owner can read/write own rows
create policy bots_owner_rw on forgebots.bots
  using (owner_id = current_setting('app.user_id')::uuid)
  with check (owner_id = current_setting('app.user_id')::uuid);

-- Public bots readable by anyone
create policy bots_public_r on forgebots.bots
  for select using (is_public = true);
```

The API sets `app.user_id` per request via `SET LOCAL` in a transaction.

## 4. Indices quick-reference

| Table | Index | Reason |
|---|---|---|
| users | unique(handle), unique(email) | login lookups |
| bots | (owner_id), (elo desc) where is_public | listing, ladder |
| matches | (status, created_at), (p1_id, created_at desc), (p2_id, created_at desc) | queue scan, history |
| replays | unique(match_id) | 1-to-1 with match |
| elo_history | (bot_id, created_at desc) | bot stats page |

## 5. Migration policy

- Every migration is a forward-only SQL file in
  `server/migrations/NNNN_name.sql`.
- Naming: `0001_users.sql`, `0002_bots.sql`, etc.
- Run on startup via a small migrator (custom 50-line script using
  `pg`).
- Down migrations are forbidden. If a destructive change is needed,
  ship a forward migration that does the right thing.

## 6. Backup & retention

- **Daily logical dump** via `pg_dump`. Stored in object storage for
  30 days.
- **Replays older than 90 days** can be pruned (config). User-exported
  replays are kept forever in the user archive bucket.
- **PII** (email) is hashed at rest if user requests account deletion
  via a "soft delete" flag; hard-delete is GDPR-friendly.
