# 21 — Localization & Push Notifications

> **Owner:** product + client engineer.
> **Scope:** string extraction pipeline, translation workflow, RTL
> support (Arabic + English launch), push notification strategy with
> frequency caps and per-channel opt-in.
>
> **Cross-references:** `05-TECH-STACK.md` (Godot), `06-ARCHITECTURE.md`
> (client/server split), `13-UI-UX-WIREFRAMES.md` (UI screen inventory),
> `14-MONETIZATION.md` (in-app pricing by region),
> `17-ONBOARDING.md` (tooltips that must be translated),
> `18-LIVE-OPS-AND-TELEMETRY.md` (KPI § "engagement", GDPR consent
> for notifications).

---

## Part 1 — Localization

### 1.1 Goals

- Launch with **English + Arabic** at MVP (targeting EU + MENA).
- Expand to ES, FR, DE, PT-BR, JP, ZH-Hans, ZH-Hant, RU, TR by month 12.
- Adding a new locale costs < 1 engineer-week once the pipeline is set up.
- Zero hardcoded user-facing strings in the codebase. None.
- Full RTL mirroring for Arabic; mixed LTR/RTL runs correctly.
- Plural forms, gender forms, and date/number formatting follow each
  locale's CLDR rules.

### 1.2 Why Arabic + English first

- **Arabic** — major gap in the indie game market. Programming games
  with proper Arabic support are rare; we can be the first real option
  for the MENA audience. Also: founder can validate end-to-end.
- **English** — required for non-Arabic markets and as our canonical
  source of truth. Every other locale translates FROM English.

### 1.3 Architecture: source-of-truth + per-locale overlays

```
┌─────────────────────────────────────────────┐
│  en.arb (canonical)                         │
│  - all keys, English source                 │
│  - context comments per key                 │
│  - plural variants defined                  │
└─────────────────────────────────────────────┘
                  │
        (translator or service)
                  │
   ┌──────────────┼──────────────┐
   ▼              ▼              ▼
ar.arb       es.arb (later)  ja.arb (later)
```

Godot 4 uses **.csv** translation files by default but supports
**.po** (gettext). We standardise on **ARB-style JSON** for our
internal source-of-truth, exported to **.po** for Godot import. ARB
is the standard Flutter format and tooling-agnostic; .po is what
Godot natively consumes.

### 1.4 String extraction

#### 1.4.1 Rule: zero inline user-facing strings

Every user-facing string lives in `client/i18n/en.arb` and is fetched
via a typed wrapper:

```typescript
// client/i18n/t.ts
export const t = (key: string, vars?: Record<string, string|number>): string => {
  // delegates to Godot TranslationServer at runtime
  return TranslationServer.translate(key, vars);
};
```

**Disallowed:**
- ❌ `"Save"` in a Godot Label.
- ❌ `await Alert("Bot saved")` in any script.
- ❌ Tooltip text in `.tscn` files.

**Required:**
- ✅ `t("common.save")` → "Save" / "حفظ" depending on locale.
- ✅ `t("dashboard.welcome", { name: user.handle })` → "Welcome, Alice"
   / "مرحبا، أليس".

#### 1.4.2 CI lint catches violations

A regex-based lint (alongside the determinism lint from `01-Foundation`):

```
\b(Label\(|Alert\(|TooltipText\s*=\s*")\s*"[^"]+"
```

If any code or `.tscn` file ships with a literal string in those
positions, CI fails. False positives are easy to whitelist (`// i18n-ignore`).

#### 1.4.3 Key naming

Convention: `<area>.<screen>.<element>.<state?>`.

```
common.save
common.cancel
common.loading
dashboard.title
dashboard.welcome        (with placeholder {name})
dashboard.quick_play
bot_builder.empty_slot
bot_builder.tooltip.engine
replay.event.shot        (with placeholders {source}, {target}, {damage})
```

#### 1.4.4 Plural forms

ICU MessageFormat is the standard. Example:

```json
// en.arb
{
  "replay.tickCount": "{count, plural, =0 {no ticks} =1 {1 tick} other {# ticks}}",
  "_replay.tickCount": {
    "description": "Displayed under replay timeline. {count} is the tick number."
  }
}
```

```json
// ar.arb — Arabic has 6 plural categories
{
  "replay.tickCount": "{count, plural, zero {لا توجد خطوات} one {خطوة واحدة} two {خطوتان} few {# خطوات} many {# خطوة} other {# خطوة}}"
}
```

### 1.5 Translation workflow

#### 1.5.1 Initial translation (EN + AR launch)

- **English:** founder writes canonical strings in `en.arb`.
- **Arabic:** founder drafts, then **paid professional review** by an
  Arabic-native translator with gaming/tech background. Budget:
  ~$0.10/word × ~3,000 strings × 8 words avg = ~$2,400 one-time.
  Alternative: a community volunteer from Discord, with the same
  budget reserved as incentive.

#### 1.5.2 Adding a new locale later

Recommended managed service: **Lokalise** or **POEditor**.
- Both have free tiers for small projects.
- Both support ARB / JSON / .po.
- Both provide a translator-friendly web UI.
- Both support plural variants, context notes, glossary.

Self-hosted alternative: **Weblate** (free, open-source, runs on a
small VPS). Good if we don't want vendor lock-in.

#### 1.5.3 Process per release

```
1. Dev adds new key in en.arb (with description + placeholders).
2. CI fails if any non-English .arb file is missing that key.
3. Translator (or service) fills the missing keys.
4. Review by a second native speaker.
5. PR merges; CI exports .po; Godot picks it up.
```

#### 1.5.4 Glossary

A `client/i18n/glossary.json` file pins translations of recurring terms:

```json
{
  "bot": { "ar": "روبوت", "es": "robot", "_note": "the player's robot" },
  "biomass": { "ar": "كتلة حيوية", "_note": "the resource" },
  "chassis": { "ar": "هيكل", "_note": "robot body" },
  "constructor": { "ar": "مُركِّب", "_note": "builds children" },
  "Elo": { "_do_not_translate": true, "_note": "proper noun; keep as Elo" },
  "ForgeBots": { "_do_not_translate": true }
}
```

#### 1.5.5 Pseudolocale for testing

We ship a `xx-pseudo` locale that:
- Wraps every string in `[!!! ... !!!]`.
- Doubles string length (`Heeelllloo Woooorrlldd`).
- Forces RTL layout flag.

Used in CI to catch any untranslated or non-mirroring UI before
release.

### 1.6 RTL layout

#### 1.6.1 Godot 4 support

Godot 4 has first-class RTL support:
- `Control.set_layout_direction(LAYOUT_RTL_R)` flips layout.
- Anchors + containers mirror automatically.
- `TranslationServer` exposes locale-aware shaping.
- `Label` auto-applies BiDi algorithm for mixed Arabic+English text.

We enable RTL globally when `OS.get_locale()` starts with `ar` (or
any RTL locale). The user can override in Settings.

#### 1.6.2 What mirrors automatically

- ✅ Text alignment (right-aligned paragraphs by default).
- ✅ Container layout direction (VBoxContainer mirrors).
- ✅ Most icons (with `flip_on_rtl` export flag).
- ✅ Tab orders (focus moves in mirrored direction).

#### 1.6.3 What needs manual handling

- ❌ Asymmetric icons (arrow pointing right → arrow pointing left).
- ❌ Logos with text baked in.
- ❌ Particle directions.
- ❌ Camera direction in arena (camera doesn't mirror; bots still
   move "naturally" relative to world).
- ❌ Tutorial overlay positioning (e.g. "tap here →" pointers).
- ❌ Match timeline (timeline is universal, but tick numbers stay LTR).

Strategy: every visual asset has a metadata flag `flip_on_rtl: bool`.
At runtime, the asset loader flips the texture if needed.

#### 1.6.4 Arabic-specific notes

- **Letter shaping:** Godot's text rendering handles this via system
  fonts (Noto Sans Arabic recommended).
- **Numerals:** we ship BOTH Western (0123456789) and Arabic-Indic
  (٠١٢٣٤٥٦٧٨٩). Default to Western in game (player count, Elo);
  default to Arabic-Indic in tutorial copy. Player can override.
- **Plural categories:** six forms (zero, one, two, few, many, other).
  ICU handles this; we just supply all 6 forms.
- **Bidirectional text:** Arabic + English mixed strings (e.g. "Build
  3 من Constructor") render correctly via Unicode BiDi algorithm.
- **Weekend:** Friday-Saturday in most MENA countries. Calendar widget
  (post-MVP) respects this for events.

#### 1.6.5 Cultural review pass

Before Arabic launch, an Arabic-native reviewer checks:
- Color symbolism (red/green have different connotations).
- Iconography (skulls, alcohol, certain hand gestures to avoid).
- Imagery (gender representation in marketing art).
- Tone (formal vs casual; "يا" forms vs "إنت" forms).

Budget: $500 for an Arabic cultural consultant review before launch.

### 1.7 Locale detection & fallback

```
Device locale (e.g. ar-EG, ar-SA, en-US)
  ↓ strip region
ar  → use ar.arb
en  → use en.arb
*   → fallback to en.arb

If a key is missing in ar.arb, fall back to en.arb (NOT to a key
literal). CI lint prevents missing keys at build time.
```

### 1.8 Fonts

- **Latin (English + European):** Inter (Google Fonts, OFL).
- **Arabic:** Noto Sans Arabic (Google Fonts, OFL).
- **Code (DSL editor):** JetBrains Mono (OFL), Latin-only.
- All three are bundled with the app; no runtime download needed.

### 1.9 Testing checklist (pre-launch for each new locale)

- [ ] All keys present in locale's .arb.
- [ ] No string truncation at longest expected length (German
      averages 30% longer than English; Arabic can be 20% shorter).
- [ ] RTL layout: every screen mirrored correctly.
- [ ] Asymmetric icons flipped.
- [ ] Plural forms render correctly at all 6 categories (Arabic).
- [ ] Bidirectional mixed strings render correctly.
- [ ] Dates and numbers formatted per locale (Hijri vs Gregorian,
      Western vs Arabic-Indic numerals).
- [ ] Cultural review pass complete.
- [ ] Pseudolocale smoke test passes.

### 1.10 Costs (initial launch, EN + AR)

| Item | Cost |
|---|---|
| Professional Arabic translation (one-time) | $2,400 |
| Cultural review (Arabic, one-time) | $500 |
| Lokalise free tier | $0 |
| Fonts (3 OFL fonts) | $0 |
| Engineering setup (one-time, part of phase 01-13) | 0 incremental |
| **Total one-time** | **~$2,900** |

Adding a new locale later: ~$1,500 per locale (translation) +
~1 engineer-day for review.

---

## Part 2 — Push Notifications

### 2.1 Goals

- Bring back churned players (re-engagement).
- Notify when PvP match is ready.
- Announce season launches, tournaments, patches.
- **Never** spam — uninstall > install ratio is our enemy.

### 2.2 Why this needs a real strategy

Mobile push is the most-abused channel in games. Studies show:

- > 2 push per week → 30%+ opt-out rate within a month.
- Generic "Come back!" messages have < 2% open rate.
- Personalised + timed messages have 8–12% open rate.

We design for **low volume, high relevance**.

### 2.3 Channels

Every notification belongs to exactly one channel. Users can toggle
each channel independently.

| Channel | Default | Examples | Cap |
|---|---|---|---|
| **`match_ready`** | ON, not disableable | "Your match vs Reaper is ready — watch now" | 1/day |
| **`season_event`** | ON | "Season 2 launches in 24h — your bot is ready" | 1/week |
| **`patch_notes`** | ON | "Patch 0.2.3 is live — see what's new" | 1/week |
| **`tournament`** | ON | "Weekly tournament starts in 1h" | 1/week |
| **`friend_activity`** | OFF | "Alice improved her bot — challenge her?" | 2/week |
| **`marketing`** | OFF | "Forge Pass 50% off this weekend" | 1/month |

### 2.4 Frequency caps (global)

- Max **3 notifications per user per week** across all channels.
- `match_ready` is exempt from the cap (PvP latency matters).
- Marketing channel is exempt from the global cap (1/month is its own cap).
- Quiet hours: **22:00–09:00 local time**. Configurable per user.

### 2.5 Match-ready flow

```
Match is created in server.
  ↓
Server schedules a notification at match_creation + 10 minutes
  (gives player time to be on a wifi network / not driving).
  ↓
Notification fires ONLY IF:
  - user has match_ready channel ON
  - user has not opened the app in the last 10 minutes
  - it's not quiet hours
  ↓
Notification text (localised):
  EN: "Your match vs {{opponent_name}} is ready to watch."
  AR: "مباراتك ضد {{opponent_name}} جاهزة للمشاهدة."
  + deep link: forgebots://replay/{match_id}
```

### 2.6 Re-engagement flow

Trigger: user hasn't opened app in N days, where N varies by lifetime
activity:

| Last activity | Re-engage after | Message variant |
|---|---|---|
| Heavy (5+ matches/wk) | 5 days | "Your bot hasn't fought in a while — top of ladder misses you" |
| Medium (1-4/wk) | 7 days | "A new bot just dethroned you" |
| Light (<1/wk) | 14 days | "We added new missions. Try them?" |
| New (<3 days) | never | too early, let them settle |

Frequency: **at most once per 60 days** per user. Track in
`notifications.last_reengagement_at`.

### 2.7 Personalisation

Personalised notifications have 4× the open rate. We use:

- Player's bot name ("Your 'Slasher' is lonely").
- Opponent's handle in match-ready.
- Elo change ("You just hit 1300 — congrats!").
- Season-specific copy ("Season 2 — your S1 bot's Elo carries over").

All placeholders localised. No English fallbacks in localised messages.

### 2.8 Opt-in / opt-out UX

- iOS: request permission **after the player's first win**, not on
  first launch. Pre-permission prompt screen explains the value.
- Android 13+: same timing — request `POST_NOTIFICATIONS` after first win.
- Channels configurable in **Settings → Notifications** (2 taps from dashboard).

### 2.9 Implementation

#### 2.9.1 Server stack

- **Abstraction:** `push.ts` in the server with two impls
  (`FCMProvider` for Android, `APNsProvider` for iOS).
- **User tokens:** stored in `users.push_tokens` (one-to-many, one
  per device).
- **Schedule table:** `notifications` table — `(id, user_id, channel,
  scheduled_for, payload, status)`.
- **Worker:** cron job runs every 5 minutes, scans `scheduled_for <= now
  AND status = 'pending'`, dispatches via the right provider.

#### 2.9.2 Tables

```sql
create table forgebots.push_tokens (
  id           uuid primary key,
  user_id      uuid not null references forgebots.users(id) on delete cascade,
  platform     text not null check (platform in ('ios','android','web')),
  token        text not null,
  locale       text not null,             -- last known locale
  created_at   timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);
create index push_tokens_user_idx on forgebots.push_tokens (user_id);

create table forgebots.notification_prefs (
  user_id      uuid primary key references forgebots.users(id) on delete cascade,
  -- JSON: { match_ready: bool, season_event: bool, patch_notes: bool, tournament: bool, friend_activity: bool, marketing: bool, quiet_start: 'HH:MM', quiet_end: 'HH:MM', timezone: 'Area/City' }
  prefs_json   jsonb not null,
  updated_at   timestamptz not null default now()
);

create table forgebots.notifications (
  id              uuid primary key,
  user_id         uuid not null references forgebots.users(id) on delete cascade,
  channel         text not null,
  scheduled_for   timestamptz not null,
  status          text not null check (status in ('pending','sent','failed','cancelled')),
  payload_json    jsonb not null,
  sent_at         timestamptz,
  error           text
);
create index notifications_due_idx on forgebots.notifications (scheduled_for) where status = 'pending';
```

#### 2.9.3 Scheduling rules (server-side enforcement)

```
async function canSend(userId, channel):
  prefs = load prefs_json
  if not prefs.channels[channel]: return false
  now = currentTimeInUserTimezone(userId)
  if now in quietHours: return false
  recent = countNotificationsSentThisWeek(userId)
  if recent >= 3 and channel != 'match_ready' and channel != 'marketing': return false
  if channel == 'marketing' and recent >= 1 this month: return false
  if channel == 'reengagement' and lastReengagement < 60 days ago: return false
  return true
```

### 2.10 Metrics

| KPI | Target | Source |
|---|---|---|
| Opt-in rate (after first win) | 65% | `notifications.prefs_json` |
| Opt-in per channel (default-ON channels) | > 80% | telemetry |
| Open rate per channel | match_ready > 70%, season_event > 25%, marketing > 8% | delivery tracking |
| Re-engagement conversion (open → match in 24h) | > 15% | funnel |
| Uninstall correlation (notif → uninstall < 24h) | < 2% | Sentry/crash + push dispatch correlation |
| Weekly per-user notification volume | < 1.5 avg | `notifications` table |

### 2.11 What we explicitly do NOT do

- ❌ Marketing pushes to users who opted out of that channel.
- ❌ Re-engagement pushes to new (<3 day) users.
- ❌ More than 1 push per day per user (except match_ready).
- ❌ Push during quiet hours.
- ❌ Localised push with English fallback for missing locale keys
   (CI lint prevents this — we ship only fully-translated push copy).
- ❌ Push to a user whose push token is invalid (provider returned
   `Unregistered`) — silently remove the token.

### 2.12 Open questions

- Use **OneSignal** (managed, multi-platform, free tier) or
  roll our own FCM+APNs? **Lean: roll our own** — it's ~200 lines of
  TS and we keep data control.
- Push for **web build**? (post-MVP, deferred — web is post-MVP anyway.)

---

## 3. Files this doc adds to the repo

When implementation starts:

```
client/
├── i18n/
│   ├── en.arb              ← canonical, English source
│   ├── ar.arb              ← Arabic
│   ├── glossary.json
│   └── export/             ← generated .po files for Godot
│       ├── messages.pot
│       └── locale/
│           ├── en.po
│           └── ar.po
└── src/
    └── i18n/
        ├── t.ts            ← typed wrapper around TranslationServer
        └── locale.ts       ← detection + fallback logic

server/
└── src/
    └── notifications/
        ├── push.ts         ← provider abstraction
        ├── fcm.ts          ← Android
        ├── apns.ts         ← iOS
        ├── scheduler.ts    ← cron job, frequency-cap enforcement
        └── templates/      ← localised push copy
            ├── match_ready.ar.json
            ├── match_ready.en.json
            └── ...
```

## 4. Conflict-free guarantees

This doc references only:
- Existing spec docs (04, 05, 06, 13, 14, 17, 18).
- Godot 4 built-in `TranslationServer` (already supported in MVP engine).
- Standard FCM + APNs APIs (no new infra).

It adds:
- One folder tree (`client/i18n/`, `server/src/notifications/`).
- Two new tables in `07-DATA-MODEL.md` schema (additive; no breaking change).
- CI lint rules (additive to existing 01-Foundation plan).

No conflict with docs 00–20.
