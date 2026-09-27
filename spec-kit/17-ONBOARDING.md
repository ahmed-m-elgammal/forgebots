# 17 — Onboarding & Teaching Arc

> **Owner:** game designer.
> **Cross-references:** `04-GAME-DESIGN.md` (mechanics), `12-MVP-ROADMAP.md`
> (week 8 mission target), `13-UI-UX-WIREFRAMES.md` (first-60-second beat
> sheet, added in this revision).

Onboarding is the single most important surface in a mobile game. The
difference between D1 retention of 35% and 50% is almost entirely
onboarding design. This document is the contract for how ForgeBots
turns a new install into a player who *wants to come back*.

## 1. The three phases

| Phase | Duration | Goal |
|---|---|---|
| **Hook** | 0:00 – 0:60 | Player sees the game is interesting |
| **Teach** | 0:60 – 5:00 | Player builds and runs their first bot |
| **Convert** | 5:00 – 15:00 | Player submits their first PvP match |

We optimise each phase independently. Phase 1 determines install → login.
Phase 2 determines login → "I made something". Phase 3 determines "I
made something" → "I'm going to do this again tomorrow".

## 2. Phase 1 — Hook (0–60 seconds)

### 2.1 Beat sheet (60 seconds)

```
0s   App opens → splash → "Tap to continue"
3s   Brief cinematic (2s): two bots facing off, fast cuts
5s   "Forge your first bot" CTA on a clean dashboard
     [Background: tiny procedural arena loop]
8s   Player taps → robot builder
     [HARD CUT — no animated transition on first launch]
10s  Builder loads with a *pre-filled* starter chassis:
     Mk-1 Engine + Long Radar + Blaster + Solar.
     Player sees 4 filled slots, 4 empty.
12s  Tooltip #1 (auto-dismiss after 4s): "Engines move you.
     Sensors find targets. Weapons fire. Energy powers you."
18s  Tooltip #2 (auto-dismiss): "Tap a slot to change parts.
     Tap Save when you're ready."
24s  Player taps Save (even with no changes) → "Now let's program it."
28s  AI editor opens. Pre-filled program:
     (every-tick (move 1 0))
     "Your bot already has a brain — let's watch it run."
32s  Big button: "Run preview"
34s  Preview runs: 10-second clip of bot running against Drifter.
     Inline timer, replay controls disabled.
     (SFX: blaster fire + footsteps. NO music yet.)
44s  Preview ends. Result: "Your bot survived — but it didn't collect
     any food. Let's teach it to gather."
     CTA: "Open editor"
50s  Editor pre-fills:
     (every-tick (if (food) (move ...)))
     One line highlighted, blinking cursor on the
     missing argument.
55s  Player taps the suggested completion → preview runs again.
60s  Result: "Now your bot collects food. Ready for PvP?"
```

### 2.2 Why this works

- **No empty states.** The player always sees a working game, not a blank canvas.
- **Pre-filled content with one thing to change.** The cognitive load
  is "fill in one piece", not "build a robot from scratch".
- **No text walls.** Tooltips are 8–10 words each, auto-dismissing.
- **No long cinematics.** Mobile players skip them.
- **No music yet.** Reduce sensory load until the player is hooked.

## 3. Phase 2 — Teach (1–15 minutes)

### 3.1 Mission ladder (3 scripted missions)

Each mission is a guided 1v1 against a specific AI opponent, with
in-editor scaffolding that disappears after the first clear.

#### Mission 1 — Gather (vs Drifter)

**Goal:** "Collect 10 biomass before Drifter does."

**Scaffolding in editor:**
```
;;  (every-tick (move 1 0))
```
Pre-filled. Tooltip: "Watch where the food is. Now change the numbers
in `move` so your bot moves toward the food."

**Win condition check:** if your bot's biomass > Drifter's at tick 600
or 10 biomass carried, you win.

#### Mission 2 — Fight (vs Pouncer)

**Goal:** "Destroy Pouncer."

**Scaffolding:** pre-filled program already includes `(radar)` and
`(aim)`. Tooltip explains firing and scanner cone.

#### Mission 3 — Breed (vs Breeder)

**Goal:** "Build 3 children before tick 900."

**Scaffolding:** explains constructors, biomass conversion, and the
build actuator.

### 3.2 Mission complete UX

```
┌─────────────────────────────────────┐
│   ✓ Mission 1 cleared              │
│                                     │
│   "Your bot learned to gather."    │
│                                     │
│   Bot saved to your roster.        │
│   Next: Mission 2 — "Destroy"       │
│                                     │
│   [Replay]    [Continue]            │
└─────────────────────────────────────┘
```

Replay is optional but recommended (≤ 10% of players skip).

### 3.3 Bounce-back rule

**If the player loses Mission 1 twice, the editor pre-fills an even
more complete solution** and the third attempt is guaranteed to win.
This isn't a punishment — it's a guardrail so frustration doesn't
end the session.

## 4. Phase 3 — Convert (15 min → first PvP)

### 4.1 Ladder unlock

After Mission 3, the dashboard's "Quick play →" CTA becomes active.
Tap → server runs `POST /matches` against the player's bot and a
community ghost bot of similar Elo.

### 4.2 First-loss UX

```
┌─────────────────────────────────────┐
│   Match finished                    │
│                                     │
│   You lost — but here are 3         │
│   improvements:                     │
│                                     │
│   • Your bot never built a child    │
│     (Constructor was unused)        │
│   • Your bot ran out of energy at   │
│     tick 412 — more solar panels?   │
│   • Your bot's blaster fired only   │
│     twice — radar range too short?  │
│                                     │
│   [Watch replay]   [Edit bot]       │
└─────────────────────────────────────┘
```

The advice is **mechanical, generated from event log**, not platitudes.
Players learn by seeing what their bot did vs what it could have done.

## 5. Failure modes & recovery

| Failure | Detection | Recovery |
|---|---|---|
| Player quits during Phase 1 | dropped before Mission 1 | Push notification after 24h: "Your bot is waiting" |
| Player stuck on Mission 1 | 2 losses | Auto-scaffold next attempt |
| Player stuck on Mission 2/3 | 3 losses | Show "skip" button (with replay of AI beating them so they see the level) |
| Player wins first PvP | always celebrate | "Top 50% of players this week" relative framing |
| Player loses first 3 PvP | detected | Offer "vs Drifter" again as confidence-builder |

## 6. Onboarding metrics (KPIs)

| KPI | Target | Source |
|---|---|---|
| % completing Phase 1 (≥ 1 save) | 75% | telemetry |
| % completing all 3 missions | 60% | telemetry |
| % submitting first PvP within 30 min | 50% | telemetry |
| D1 retention | 45% | analytics |
| D7 retention | 22% | analytics |
| Mission 1 retry rate | 35% (sweet spot) | telemetry |

## 7. Anti-patterns we reject

- ❌ "Skip tutorial" button during Phase 1 (too tempting, kills learning).
- ❌ Forced watching of replays.
- ❌ Energy system gating ("wait 4 hours for HP").
- ❌ Pop-up tutorials mid-match.
- ❌ "Daily login rewards" before player has had a single win.

## 8. Accessibility on onboarding

- All tooltips have text equivalents and voice-over (iOS/Android native).
- Tutorial replays can be scrubbed at 0.25× / 1× / 2×.
- Skip allowed in Phase 2/3 only — Phase 1 has no skip by design.
- Pre-filled scaffolding respects "reduce motion": no animated
  tooltips, no camera shake.
- Voice-over tutorial track available from settings (EN only MVP).

## 9. Open questions

- Should the first PvP match be forced against a Drifter ghost, or
  straight into the ladder? (Lean: ladder, but with a wider Elo range
  for the first 5 matches so new players find peers.)
- Should we ship voice-over in MVP? (Lean: no, see § 3.5.)
