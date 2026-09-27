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

## 3. Dashboard

```
┌─────────────────────────┐
│ ☰  ForgeBots     👤 me  │
├─────────────────────────┤
│ Elo: 1247   Rank: 42    │
│ Bot slots: 3/3 used     │
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

## 4. Bot builder (chassis)

```
┌─────────────────────────────┐
│ ← Back     Slasher    Save  │
├─────────────────────────────┤
│ Slots                      │
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
│ HP: 15   Speed: 2.5 m/s     │
└─────────────────────────────┘

Tap an empty slot → bottom sheet of part picker.
Tap a filled slot → "Replace" / "Remove".
```

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
│  ┌─Every tick──┐           │
│  │  ┌If─┐      │           │
│  │  │Radar?   │ │           │
│  │  │ → Aim  │ │           │
│  │  │ → Fire │ │           │
│  │  └────┘   │           │
│  │  [Else]   │           │
│  │  → Move   │           │
│  └────────────┘           │
│                            │
│ Cycles/tick: 230 / 1000    │
│                            │
│ [Run preview]  [Save]      │
└────────────────────────────┘
```

Bottom toolbar: drag-to-rearrange, undo/redo, "?" help.

## 6. Replay viewer

```
┌────────────────────────────────────────────┐
│ Slasher vs Replicator · tick 612 / 1500    │
├────────────────────────────────────────────┤
│                                            │
│   [200×200 arena, top-down]                │
│                                            │
│      . s . . . . r .                       │
│      . . . . . . . r                       │
│      . . . . . . . .                       │
│                                            │
│   blue = your side, red = enemy            │
│   biomass cells as green dots              │
├────────────────────────────────────────────┤
│ ▶ ⏸ ⏮ ⏭    speed: 1x  2x  4x  0.25x     │
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
- Each hardware part has a dedicated icon (sprite sheet ships with v0.1).
- Energy → lightning bolt. Biomass → leaf. Shield → hexagon. Weapon →
  crosshair. Sensor → concentric arcs. Engine → chevron.

## 10. Animation budget

- ≤ 16 ms per frame on iPhone 12.
- Tween via Godot's `Tween` node — no manual lerping.
- All animations ≤ 250 ms; never block input.

## 11. Accessibility

- All tap targets ≥ 44 pt.
- All text has WCAG AA contrast vs background.
- Voice-over labels for all icons.
- Color-blind palette variant for the arena (red/blue robots keep shape
  cues).
- "Reduce motion" toggle: disables camera shake and slow-mo.

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

- **Top-left:** back button (or logo if no parent).
- **Top-right:** account avatar → opens Settings.
- **Bottom (mobile):** tab bar with `Dashboard / Bots / Ladder / Cosmetics / Settings`.
- **Corner:** persistent "live state" pill showing your top bot's
  status (e.g. `● Idle • Elo 1247`). Tapping it jumps to the bot.

### 13.2 Modal rules

- **One modal at a time.** No stacked dialogs.
- **Tap outside or back gesture dismisses** unless the modal is a
  blocking confirmation (e.g. "Delete bot?").
- **Loading states are not modals** — use inline skeletons.

### 13.3 First 60 seconds reference

For the onboarding beat sheet (cinematic timings, pre-filled bots,
tooltip placement, audio silence rule), see `17-ONBOARDING.md` § 2.1.
That doc owns the day-1 experience; this doc owns everything after.

## 14. Replay viewer (detailed)

The viewer is the most screen-time surface in the game. Worth detailing.

### 14.1 Controls

```
┌────────────────────────────────────────────┐
│ Slasher vs Replicator · tick 612 / 1500    │
├────────────────────────────────────────────┤
│                                            │
│   [200×200 arena, top-down]                │
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

- **Default:** free orbit around the centre of mass of the action
  (auto-pans to whichever side is active).
- **Follow bot:** tap a bot to follow it. Tap empty arena to release.
- **Top-down:** locked top-down view for tactical analysis.

### 14.3 Stats overlay (toggle)

A small panel that shows, in real time as the match plays:

- HP per bot
- Energy per bot
- Biomass held
- Damage dealt
- Biomass collected

Stats overlay is **off by default** for new players, **on by default**
for players above 50 matches.

### 14.4 Sharing

- **Share link:** generates a public URL, public-read for 30 days
  (replay retention per `07-DATA-MODEL.md` § 6: 90-day prune, bookmarks
  exempt).
- **Bookmark:** adds to "My Replays" list, kept forever.
- **GIF export:** client-side rendering of the replay to a 5–10s GIF,
  capped at 5 MB.

## 15. Anti-patterns we reject

- ❌ Auto-playing music on first launch.
- ❌ Forced tutorials blocking the menu.
- ❌ Pop-up modals mid-match.
- ❌ Confirmation dialogs for reversible actions.
- ❌ Two CTAs competing on the same screen.
- ❌ Settings hidden more than two taps away.
