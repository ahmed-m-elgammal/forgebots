# 13 — UI / UX Wireframes

> Wireframes are described textually here. A visual page mock lives at
> `spec-kit/wireframes/` (reserved directory in this repo) once we
> generate the screenshots (HTML mockups).
>
> **For onboarding flow (first 60 seconds, mission ladder, bounce-back),
> see `17-ONBOARDING.md`.** This doc covers the steady-state screens
> only; the onboarding doc covers what players see on day 1.

## 1. Design principles

1. **Thumb-first.** All primary actions reachable from a thumb at the
   bottom of the screen on phones.
2. **One big idea per screen.** No stacked modal dialogs.
3. **You always know what your bot is doing.** A persistent "live state"
   pill in the corner of every screen.
4. **Replay as the reward.** The first thing you see after a match is
   *not* a victory banner — it's the replay, scrubbable.

## 2. Screen inventory

| # | Screen | Primary action |
|---|---|---|
| 1 | Splash | "Log in" / "Sign up" |
| 2 | Login | Continue |
| 3 | Dashboard | "Build bot" |
| 4 | Bot list | "Edit" / "Submit match" |
| 5 | Bot builder (chassis) | "Edit code" / "Save" |
| 6 | AI editor (visual) | "Run preview" |
| 7 | AI editor (text) | "Run preview" |
| 8 | Matchmaking | "Wait…" → opponent card |
| 9 | Replay viewer | "Submit again" |
| 10 | Match result | "Replay" / "Back" |
| 11 | Ladder | "Pick opponent" |
| 12 | Cosmetics | "Equip" |
| 13 | Settings | "Log out" |
| 13a | Settings → Audio | Mute / SFX / music toggles (`16 § 3.5`) |
| 13b | Settings → Notifications | Per-channel switches + quiet hours (`21 § 2.3`, `§ 2.8`) |
| 13c | Settings → Accessibility | Reduce motion, colourblind palette, screen-reader hints (`§ 11`) |
| 13d | Settings → Account | Handle, language, timezone, export data, delete account (`08 § 9`) |

Screens 13a–13d exist because `16` and `21` both specify settings that
no screen in the inventory held. They are all two taps from the
dashboard, per the `§ 15` rule that settings are never more than two
taps away.

## 3. Dashboard

```
┌─────────────────────────┐
│ ☰  ForgeBots     👤 me  │
├─────────────────────────┤
│ Elo: 1247   Rank: 42    │
│ Bot slots: 2/3 used     │
│                         │
│ ┌─────────────────────┐ │
│ │   + Build a new bot │ │  (big primary CTA)
│ └─────────────────────┘ │
│                         │
│ Your bots               │
│  • Slasher      1180 E  │
│  • Harvester    1020 E  │
│                         │
│ Quick play →            │
└─────────────────────────┘
```

`Bot slots: 2/3 used` — the numbers come from
`GET /bots` (`bot_slot_limit`, `bot_slot_used`), which is why that
endpoint returns them. The earlier wireframe said "3/3 used" while
listing two bots.

## 4. Bot builder (chassis)

```
┌─────────────────────────────┐
│ ← Back     Slasher    Save  │
├─────────────────────────────┤
│ Part slots                  │
│  1 [Engine  ]   4 kg / 5 W  │
│  2 [Sensor  ]   2 kg / 1 W  │
│  3 [Weapon  ]   4 kg / 6 W  │
│  4 [ empty  ]               │
│  5 [ empty  ]               │
│  6 [ empty  ]               │
│  7 [ empty  ]               │
│  8 [ empty  ]               │
│                             │
│ Totals: 10 kg / 12 W        │
│         (40 kg / 68 W left) │
│                             │
│ Preview  [show chassis]     │
│ HP: 15  Shield: 0  Speed: 2.5 m/s │
│ Draw 12 W · Generate 5 W · Net +7 W │
└─────────────────────────────┘

Tap an empty slot → bottom sheet of part picker.
Tap a filled slot → "Replace" / "Remove".
```

- The header says **Part slots**, not "Slots", so it can never be
  confused with the dashboard's "Bot slots" (`22-DECISIONS.md D12`).
- **Draw, Generate and Net are three separate numbers.** For this
  chassis: 5 + 1 + 6 = 12 W drawn, 5 W generated, **net +7 W**, so it
  drains and needs `eat()` to survive. `04 § 3.2` lists parts with a
  signed power column precisely so this is computable; a single
  "12 W" total hides the sign and is how players build bots that
  mysteriously starve.
- A net ≤ 0 chassis shows a green "sustains" hint instead of a warning.
- 10 kg → `floor(10 × 1.5)` = 15 hull HP, 0 shield. The preview must
  use the same formula as `04 § 3.1`.

## 5. AI editor (visual)

```
┌─────────────────────────────┐
│ ← Back   [Visual|Text]      │
├─────────────────────────────┤
│ Categories                 │
│  ▸ Sensors                 │
│  ▸ Actuators               │
│  ▸ Logic                   │
│  ▸ Math                    │
│  ▸ Functions               │
├─────────────────────────────┤
│ Workspace                  │
│  ┌─Every tick─ step()──┐   │
│  │  ┌If─┐              │   │
│  │  │Radar some? │     │   │
│  │  │ → Aim    │     │   │
│  │  │ → Fire   │     │   │
│  │  └────┘           │   │
│  │  [Else]           │   │
│  │  → Move-at x, y   │   │
│  └───────────────────┘   │
│                            │
│ Cycles/tick: 230 / 1000    │
│                            │
│ [Run preview]  [Save]      │
└─────────────────────────────┘
```

- The flow block is labelled `step()` because `(every-tick …)` takes a
  **function name**, not an inline form (`09 § 2.2`).
- The sensor block is `Radar some?` rather than a bare `Radar` on the
  branch, because branching directly on an `Option` is a compile error
  (`09 § 2.3`). The block editor must not be able to emit it.
- **Cycles/tick** is the static estimate from the verifier
  (`09-AI-DSL.md` § 5, rule 3), shown live so players learn the budget.
  The editor blocks Save above 1000.

Bottom toolbar: drag-to-rearrange, undo/redo, "?" help.

## 6. Replay viewer

> The full control spec, camera modes, stats overlay and sharing live in
> **§ 14**, which is authoritative. This section is the short summary
> the nav map refers to. The two were previously near-duplicates that
> had already drifted apart (different speed-chip order, different arena
> label), so § 6 is now explicitly the abbreviated form.

```
┌────────────────────────────────────────────┐
│ Slasher vs Replicator · tick 612 / 1500    │
├────────────────────────────────────────────┤
│                                            │
│   [200 m × 200 m arena, top-down]          │
│                                            │
│      . s . . . . r .                       │
│      . . . . . . . r                       │
│      . . . . . . . .                       │
│                                            │
│   blue = your side, red = enemy            │
│   biomass cells as green dots              │
├────────────────────────────────────────────┤
│ ▶ ⏸ ⏮ ⏭    speed: 0.25x  1x  2x  4x       │
│                                            │
│ timeline ▬▬▬▬●▬▬▬▬▬▬▬▬▬▬▬                 │
│           612                              │
│                                            │
│ Event log (this tick):                     │
│  • scout.0 fired blaster → tank.1 (12)    │
│  • tank.1 biomass taken +1                 │
└────────────────────────────────────────────┘
```

## 7. Ladder

```
┌──────────────────────────┐
│ ← Ladder          S1     │
├──────────────────────────┤
│ Rank  Bot          Elo   │
│ 1     Replicator   1842  │
│ 2     Doomcrawler  1810  │
│ 3     YourBot      1247  │
│ 4     ...                │
│                          │
│ Tap a bot to challenge   │
└──────────────────────────┘
```

## 8. Color & typography

- **Palette**
  - Background: `#0E0F13` (near-black)
  - Surface: `#1A1C24`
  - Accent: `#FFB347` (warm orange — "forge" feel)
  - Success: `#4ADE80`
  - Danger: `#F87171`
  - Muted text: `#9CA3AF`
- **Type**
  - Headlines: Inter Bold, 24–32 pt
  - Body: Inter Regular, 14–16 pt
  - Code/IR: JetBrains Mono, 13 pt

## 9. Iconography

- Stroke 1.5 px, rounded caps.
- Each hardware part has a dedicated icon (the sprite sheet ships with
  the MVP build, not "v0.1" — the product version is v1.0 at launch;
  see `22-DECISIONS.md D22`).
- Energy → lightning bolt. Biomass → leaf. Shield → hexagon. Weapon →
  crosshair. Sensor → concentric arcs. Engine → chevron.
- Every asset carries a `flip_on_rtl` metadata flag
  (`21 § 1.6.3`).

## 10. Animation budget

- ≤ 16 ms per frame on iPhone 12.
- Tween via Godot's `Tween` node — no manual lerping.
- All animations ≤ 250 ms; never block input.

## 11. Accessibility

- All tap targets ≥ **44 pt / 44 dp** — the same number, expressed in
  each platform's unit. Saying "44 pt" and shipping Android is a
  silent 1.3× miss.
- All text has WCAG AA contrast vs background. (WCAG is a web
  specification; it is a useful *contrast* target here, but the
  conformance claim that matters on iOS/Android is the platform
  accessibility guideline, not WCAG conformance.)
- Every icon has a screen-reader label. Godot exposes these through
  `Control.accessibility_name`; "Voice-over" is the iOS name for the
  feature and does not exist on Android.
- Color-blind palette variant for the arena (red/blue robots keep shape
  cues) — shape cues are mandatory, not optional, since red/green is
  the most common deficiency and the arena is green biomass on a dark
  field.
- "Reduce motion" toggle: disables camera shake and slow-mo.
- **RTL:** this doc's wireframes are drawn LTR. Arabic mirrors the
  bottom tab bar, the back button moves to the top-right, and the
  asymmetric icons flip. The full mirroring list is `21 § 1.6`, and
  Arabic ships **at launch**, not later — so the RTL pass is part of
  building these screens, not a follow-up.

## 12. Empty states

Every screen has a designed empty state with a one-line CTA. Examples:

- Bot list empty → "Forge your first bot"
- Ladder empty → "Be the first to reach the top"
- Match history empty → "Submit a bot to start your record"

## 13. Navigation map

The full screen-to-screen graph for steady-state use (not onboarding):

```
                    ┌────────────┐
                    │   Splash   │
                    └─────┬──────┘
                          │
                  ┌───────┴────────┐
                  ▼                ▼
            ┌──────────┐     ┌──────────┐
            │  Login   │     │  Signup  │
            └────┬─────┘     └────┬─────┘
                 └────────┬───────┘
                          ▼
                   ┌────────────┐
                   │ Dashboard  │◄────────────┐
                   └──┬─────┬───┘             │
              ┌───────┘     └──────┐          │
              ▼                    ▼          │
       ┌─────────────┐       ┌─────────────┐  │
       │  Bot list   │       │ Ladder tab  │  │
       └────┬────────┘       └──────┬──────┘  │
            │                       │         │
            ▼                       ▼         │
       ┌─────────────┐       ┌─────────────┐  │
       │ Bot builder │──────►│ AI editor   │  │
       │ (chassis)   │       │ (visual/    │  │
       └──────┬──────┘       │  text)      │  │
              │              └──────┬──────┘  │
              ▼                     │         │
       ┌─────────────┐              ▼         │
       │ Save dialog │       ┌─────────────┐  │
       └──────┬──────┘       │ Preview run │──┘
              ▼              └─────────────┘
       ┌─────────────┐
       │ Matchmaking │
       └──────┬──────┘
              ▼
       ┌─────────────┐
       │ Replay      │
       │ viewer      │──► Share / Back to dashboard
       └──────┬──────┘
              ▼
       ┌─────────────┐
       │ Result +    │
       │ advice card │
       └─────────────┘
```

### 13.1 Persistent UI elements

Present on **every** screen after login:

- **Top-left:** back button (or logo if no parent). In RTL this moves
  to the top-right.
- **Top-right:** account avatar → opens Settings. In RTL, top-left.
- **Bottom (mobile):** tab bar with `Dashboard / Bots / Ladder / Cosmetics / Settings`.
  Mirrored in RTL.
- **Corner:** persistent "live state" pill showing your top bot's
  status (e.g. `● Idle • Elo 1247`). Tapping it jumps to the bot.
  When a match finishes while the app is open, the same pill becomes
  `● Replay ready` — which is why the match-ready push (§ `21 § 2.5`)
  is only sent to players who are *not* in the app.

### 13.2 Modal rules

- **One modal at a time.** No stacked dialogs.
- **Tap outside or back gesture dismisses** unless the modal is a
  blocking confirmation (e.g. "Delete bot?").
- **Loading states are not modals** — use inline skeletons.

### 13.3 First 60 seconds reference

For the onboarding beat sheet (cinematic timings, pre-filled bots,
tooltip placement, audio silence rule), see `17-ONBOARDING.md § 2.1`.
That doc owns the day-1 experience; this doc owns everything after.

## 14. Replay viewer (detailed)

The viewer is the most screen-time surface in the game. Worth detailing.

### 14.1 Controls

```
┌────────────────────────────────────────────┐
│ Slasher vs Replicator · tick 612 / 1500    │
├────────────────────────────────────────────┤
│                                            │
│   [200 m × 200 m arena, top-down]          │
│                                            │
│      . s . . . . r .                       │
│      . . . . . . . r                       │
│      . . . . . . . .                       │
│                                            │
│   blue = your side, red = enemy            │
│   biomass cells as green dots              │
│   shots as fading yellow streaks           │
├────────────────────────────────────────────┤
│ ▶ ⏸ ⏮ ⏭    speed: 0.25x  1x  2x  4x       │
│                                            │
│ timeline ▬▬▬▬●▬▬▬▬▬▬▬▬▬▬▬                 │
│           612                              │
│                                            │
│ Event log (this tick):                     │
│  • scout.0 fired blaster → tank.1 (12)    │
│  • tank.1 biomass taken +1                 │
│                                            │
│ [Share] [Bookmark] [GIF export]            │
└────────────────────────────────────────────┘
```

### 14.2 Camera modes

The arena is 2D top-down, so "camera" is a 2D pan + zoom
(`16-JUICE-AND-AUDIO.md § 2.1`).

- **Default:** auto-frame, biased toward whichever side is active.
- **Follow robot:** tap a robot to follow it. Tap empty arena to release.
- **Locked top-down:** fit the whole arena, for tactical analysis.
- **Free orbit is not available** and never will be — there is no third
  dimension to orbit in.

### 14.3 Stats overlay (toggle)

A small panel that shows, in real time as the match plays:

- Hull HP and shield HP per robot (two bars, not one — see `04 § 3.1`)
- Energy per robot
- Biomass held
- Damage dealt
- Biomass collected

Stats overlay is **off by default** for new players, **on by default**
for players above 50 matches.

### 14.4 Sharing

- **Share link (Forge Pass only):** `POST /matches/{id}/share` returns a
  public URL backed by a `replay_shares` row valid for **30 days**
  (`08 § 4`). Free players tapping Share get a store prompt, not a
  silent failure. The previous version of this doc offered sharing to
  everyone while `14 § 2.2` sold it — the paywall is real and the UI
  says so.
- **Bookmark (free):** `POST /replays/{id}/bookmark`. Adds to "My
  Replays", kept forever, and exempt from the 90-day prune
  (`07-DATA-MODEL.md § 6`).
- **GIF export:** client-side rendering of the replay to a 5–10 s GIF,
  capped at 5 MB. This is the first thing on the `12 § 3` cut list —
  it is the most expensive thing on this screen per unit of player
  value.

## 15. Anti-patterns we reject

- ❌ Auto-playing music on first launch.
- ❌ Forced tutorials blocking the menu.
- ❌ Pop-up modals mid-match.
- ❌ Confirmation dialogs for reversible actions.
- ❌ Two CTAs competing on the same screen.
- ❌ Settings hidden more than two taps away.
