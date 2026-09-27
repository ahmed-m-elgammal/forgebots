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

```gdscript
# client/src/i18n/i18n.gd — GDScript wrapper.
# The C# equivalent is client/src/i18n/I18n.cs; both delegate to the
# same TranslationServer call, so there is ONE behaviour, not two.
func t(key: StringName, vars: Dictionary = {}) -> String:
    return tr(key)
```

> The earlier version of this snippet was
> `TranslationServer.translate(key, vars).format(vars)`, which is not a
> real API: `TranslationServer.translate()` takes a message name only
> and returns the raw pattern, so `.format()` would have been applied
> to a pattern with `{placeholders}` intact and no plural handling. The
> correct path is `tr()` with plural and interpolation handled by the
> imported catalogue.
>
> **Do not maintain two wrappers.** With C# as the client language
> (`05-TECH-STACK.md` § 4) and GDScript for scene glue, the C# wrapper is
> the implementation and the GDScript one is a thin delegate. If a
> string ever needs a third path, that is a signal to drop GDScript.

**Disallowed:**
- ❌ `"Save"` in a Godot Label.
- ❌ `await Alert("Bot saved")` in any script.
- ❌ Tooltip text in `.tscn` files.

**Required:**
- ✅ `t("common.save")` → "Save" / "حفظ" depending on locale.
- ✅ `t("dashboard.welcome", { name = user.handle })` → "Welcome, Alice"
   / "مرحبا، أليس".

The key namespace must cover the whole UI inventory, including the
Settings sub-screens this doc adds: `settings.audio.*`,
`settings.notifications.*`, `settings.accessibility.*`, and the
onboarding beats `onboarding.*` (`13-UI-UX-WIREFRAMES.md` § 2,
`16-JUICE-AND-AUDIO.md` § 3.5, `17-ONBOARDING.md` § 2.1).

#### 1.4.2 CI lint catches violations

A regex-based lint (alongside the determinism lint from
`10-DETERMINISM.md` § 3) flags string literals in UI positions:

```
\b(Label\(|Alert\(|TooltipText\s*=\s*")\s*"[^"]+"
```

If any code or `.tscn` file ships with a literal string in those
positions, CI fails. False positives are easy to whitelist
(`// i18n-ignore`).

> This referenced a document called **`01-Foundation`, which does not
> exist** — doc 01 is the research note. The determinism lint lives in
> `10-DETERMINISM.md` § 3 and its rule file is
> `tools/eslint-plugin-forge/determinism.js`.

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
| Engineering setup (one-time) | Weeks 5–8 of `12-MVP-ROADMAP.md`; string extraction runs from Phase 01 so there is no end-of-project extraction spike |
| **Total one-time cash** | **~$2,900** |

An earlier version of this table said engineering setup was "part of
phase 01-13" of the implementation plan. Doc 20 has **14** phases, all
of which are engine phases, and none of which is localisation. The
localisation work is client work scheduled in `12` § 1, not a phase in
`20`.

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
| **`match_ready`** | ON | "Your match vs Reaper is ready — watch now" | 1/day |
| **`season_event`** | ON | "Season 2 launches in 24h — your bot is ready" | 1/week |
| **`patch_notes`** | ON | "Patch 0.2.3 is live — see what's new" | 1/week |
| **`tournament`** | ON | "Weekly tournament starts in 1h" | 1/week |
| **`reengagement`** | ON | "Your bot hasn't fought in a while — top of ladder misses you" | 1/60 days (see § 2.6) |
| **`friend_activity`** | OFF | "Alice improved her bot — challenge her?" | 2/week |
| **`marketing`** | OFF | "Forge Pass 50% off this weekend" | 1/month |

Three notes:

- **`match_ready` is disableable.** The previous version of this table
  marked it "ON, not disableable" while § 2.8 promised a per-channel
  Settings screen. A channel the user cannot turn off is a consent
  violation on both platforms, and the system prompt shown at
  permission time must describe what the user can actually control. It
  is ON by default and exempt from the weekly cap (§ 2.4) — that is
  what makes it important, not that it is mandatory.
- **`friend_activity` has no data source in MVP.** Clans and the
  friends list are out of scope (`00-OVERVIEW.md` § 6), so the channel
  ships disabled with no producer and is removed in v0.2 rather than
  left as a permanently-empty feature.
- **`tournament` ships ON but has no producer until v0.2**, for the
  same reason (`18-LIVE-OPS-AND-TELEMETRY.md` § 6).

### 2.4 Frequency caps (global)

- Max **3 notifications per user per week** across all channels.
- `match_ready` is exempt from the cap (PvP latency matters).
- Marketing channel is exempt from the global cap (1/month is its own cap).
- Quiet hours: **22:00–09:00 local time**. Configurable per user.

### 2.5 Match-ready flow

```
Match is created and simulated on the server (typically < 30 s).
  ↓
The server checks whether the player is still in the app.
  ↓
Notification is scheduled 10 minutes after creation, and fires ONLY IF:
  - user has the match_ready channel ON
  - user has not opened the app in the last 10 minutes
  - it is not quiet hours
  - the user has not already viewed this match's replay
  ↓
Notification text (localised):
  EN: "Your match vs {{opponent_name}} is ready to watch."
  AR: "مباراتك ضد {{opponent_name}} جاهزة للمشاهدة."
  + deep link: forgebots://replay/{match_id}
```

**Why a 10-minute delay for a match that finishes in 30 seconds.** The
match is ready almost immediately; the delay is deliberate, so that a
player who submitted and put the phone down is not notified while the
replay is still warm, and a player who submitted by accident has time
to notice before the notification lands. The extra condition "has not
already viewed this replay" is what stops a push for something the
player has already seen — without it, a 10-minute-old match is the
single most likely thing to have been viewed already, and the
notification becomes an annoyance on the happy path.

If the player is still in the app at fire time, no push is sent and the
replay is simply there when they look — the app's own "your match is
ready" pill (`13-UI-UX-WIREFRAMES.md` § 13.1) covers it.

### 2.6 Re-engagement flow

Trigger: user hasn't opened app in N days, where N varies by lifetime
activity:

| Last activity | Re-engage after | Message variant |
|---|---|---|
| Heavy (5+ matches/wk) | 5 days | "Your bot hasn't fought in a while — top of ladder misses you" |
| Medium (1-4/wk) | 7 days | "A new bot just dethroned you" |
| Light (<1/wk) | 14 days | "We added new missions. Try them?" |
| New (<3 days) | never | too early, let them settle |

Frequency: **at most once per 60 days** per user. Tracked in
`notifications.last_reengagement_at` (`07-DATA-MODEL.md` § 2.14).

- The **"New (<3 days): never"** row is a hard floor, and it is why
  `17-ONBOARDING.md` § 5's 24-hour "your bot is waiting" push was
  removed: a day-1 player is inside this window, so that push could
  never have fired under this rule. Re-engagement is for players the
  game has already lost, not players it is still onboarding.
- A user who has **never completed a mission** is excluded from
  re-engagement entirely, regardless of last-activity bucket. Being
  nagged about a bot they never finished building is the worst possible
  re-engagement message.

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

Owned by `07-DATA-MODEL.md` § 2.14; reproduced here for reference. The
earlier version of this doc claimed these tables were "already in 07"
when they were not, which is the kind of claim that survives review
only if nobody greps.

```sql
create table forgebots.push_tokens (
  id           uuid primary key default uuidv7(),
  user_id      uuid not null references forgebots.users(id) on delete cascade,
  platform     text not null check (platform in ('ios','android','web')),
  token        text not null,
  locale       text not null,             -- last known locale
  created_at   timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);
create unique index push_tokens_token_uq on forgebots.push_tokens (token);

create table forgebots.notification_prefs (
  user_id      uuid primary key references forgebots.users(id) on delete cascade,
  -- JSON: { channels: { match_ready: bool, season_event: bool,
  --         patch_notes: bool, tournament: bool, reengagement: bool,
  --         friend_activity: bool, marketing: bool },
  --         quiet_start: 'HH:MM', quiet_end: 'HH:MM', timezone: 'Area/City' }
  prefs_json   jsonb not null,
  updated_at   timestamptz not null default now()
);

create table forgebots.notifications (
  id              uuid primary key default uuidv7(),
  user_id         uuid not null references forgebots.users(id) on delete cascade,
  channel         text not null,
  scheduled_for   timestamptz not null,
  status          text not null check (status in ('pending','sent','failed','cancelled')),
  payload_json    jsonb not null,
  last_reengagement_at timestamptz,      -- see § 2.6
  sent_at         timestamptz,
  error           text
);
create index notifications_due_idx on forgebots.notifications (scheduled_for)
  where status = 'pending';
create index notifications_user_channel_idx
  on forgebots.notifications (user_id, channel, sent_at desc);
```

`timezone` also exists on `users` (`07-DATA-MODEL.md` § 2.1) so quiet
hours can be evaluated before the user has ever opened the notification
Settings screen.

#### 2.9.3 Scheduling rules (server-side enforcement)

```ts
async function canSend(userId: string, channel: Channel): Promise<boolean> {
  const prefs = loadPrefs(userId);
  if (!prefs.channels[channel]) return false;

  const now = currentTimeInUserTimezone(userId, prefs.timezone);
  if (isInQuietHours(now, prefs.quiet_start, prefs.quiet_end)) return false;

  const sentThisWeek = countNotificationsSent(userId, { since: startOfWeek(now) });
  if (sentThisWeek >= 3 && channel !== 'match_ready' && channel !== 'marketing') {
    return false;
  }

  if (channel === 'match_ready' && sentToday(userId, channel) >= 1) return false;
  if (channel === 'marketing' && sentThisMonth(userId, channel) >= 1) return false;

  if (channel === 'reengagement') {
    const last = lastReengagementAt(userId);        // notifications.last_reengagement_at
    if (last && daysBetween(last, now) < 60) return false;
    if (daysSinceLastActivity(userId) < 3) return false;
    if (!hasCompletedMission(userId)) return false;
  }

  return true;
}
```

Two bugs in the earlier version of this function, both fixed above:

1. **Inverted re-engagement condition.** It read
   `if channel == 'reengagement' and lastReengagement < 60 days ago:
   return false` — which blocks the notification precisely when it
   *should* fire (recently re-engaged) and allows it when it should not
   (60+ days since the last one). The correct test is "if a
   re-engagement was sent **less than** 60 days ago, block".
2. **`lastReengagement` had nowhere to live.** The column was named in
   § 2.6 but absent from the table. It is now on `notifications`
   (`07-DATA-MODEL.md` § 2.14).

Also added: a per-channel daily cap for `match_ready`, the
not-already-viewed condition from § 2.5, and the mission floor.

### 2.10 Metrics

| KPI | Target | Source |
|---|---|---|
| Opt-in rate (after first win) | 65% | `notification_prefs.prefs_json` |
| Opt-in per channel (default-ON channels) | > 80% | telemetry `notification_opened` |
| Open rate per channel | match_ready > 70%, season_event > 25%, marketing > 8% | telemetry |
| Re-engagement conversion (open → match in 24h) | > 15% | funnel |
| Uninstall correlation (notif → uninstall < 24h) | < 2% | Sentry + push dispatch correlation |
| Weekly per-user notification volume | < 1.5 avg | `notifications` table |
| **Re-engagement fires on a never-completed-mission user** | **0** | hard guard, § 2.9.3 |

Every one of these is answerable from the events defined in
`18-LIVE-OPS-AND-TELEMETRY.md` § 3.2. The previous version of this
table set open-rate targets with no delivery-tracking events anywhere
in the spec, so none of them were measurable.

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
        ├── i18n.gd         ← t() wrapper around TranslationServer (GDScript)
        └── locale.gd       ← detection + fallback logic

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

## 4. Relationship to the rest of the spec kit

This doc depends on: `05-TECH-STACK.md` (Godot), `06-ARCHITECTURE.md`
(client/server split), `07-DATA-MODEL.md` (the three push tables),
`13-UI-UX-WIREFRAMES.md` (UI screen inventory and the Settings screen),
`14-MONETIZATION.md` (regional pricing), `16-JUICE-AND-AUDIO.md` (audio
toggles live on Settings), `17-ONBOARDING.md` (copy to translate),
`18-LIVE-OPS-AND-TELEMETRY.md` (consent, KPI, push telemetry).

It adds:

- One folder tree (`client/i18n/`, `server/src/notifications/`).
- Three tables in `07-DATA-MODEL.md` § 2.14 (`push_tokens`,
  `notification_prefs`, `notifications`) — now actually present there.
- Four Settings sub-screens in `13-UI-UX-WIREFRAMES.md` § 2 (audio,
  notifications, accessibility, account).
- Two telemetry events in `18` § 3.2 (`notification_sent`,
  `notification_opened`).
- A `last_reengagement_at` column and a corrected `canSend` (§ 2.9.3).

It does **not** change: the DSL, the replay format, the simulator, the
balance model, or the Elo formula. The previous version of this section
claimed "no conflict with docs 00–20", which was not verifiable and was
wrong — it added Settings sub-screens and telemetry events that no
other document listed. Those are now listed.
