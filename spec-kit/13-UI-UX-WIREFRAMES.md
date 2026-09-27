# 13 — UI / UX Wireframes

> Wireframes are described textually here. A visual page mock lives at
> `/workspace/forgebots/spec-kit/wireframes/` once we generate the
> screenshots (HTML mockups).

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
│ HP: 35   Speed: 2.5 m/s     │
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
