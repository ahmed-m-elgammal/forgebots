# 16 — Juice & Audio

> **Owner:** game-feel lead + audio designer.
> **Status:** brief only — actual implementation lives in the client.
> **Cross-references:** aligns with `04-GAME-DESIGN.md` (events), `13-UI-UX-WIREFRAMES.md` (motion language).

This is the document that turns ForgeBots from "a working sim" into "a
game people want to play for 30 minutes". Everything below is a
**directive**, not a discussion topic — once shipped, motion/audio is
treated as a contract the rest of the game must respect.

## 1. The juice philosophy

### 1.1 The four laws

1. **Every player action must produce a visible + audible response within
   one frame.** If a button does something, the world notices immediately.
2. **Every game-world event is celebrated.** A biomass pickup, a build,
   a kill, a near-miss — all must feel like *something happened*. A
   silent match feels broken.
3. **Camera and screen react before the player expects them to.** Hit-stop
   on a kill; recoil on a shot; shake on an explosion. Anticipation > reaction.
4. **Audio is the primary emotional channel.** A mediocre match with great
   audio feels better than a great match with silence.

### 1.2 What "juice" is *not*

- Not particle spam. Density should match intensity; calm moments get
  calm visuals.
- Not gratuitous screen shake. Shake is reserved for big moments (your
  bot dying, your bot winning, a near-miss explosion).
- Not random music. Music is adaptive — one track per arena theme,
  with intensity layers that scale with match tempo.

## 2. Motion language

### 2.1 Camera

| Trigger | Behaviour | Duration |
|---|---|---|
| Match start | Camera dolly from logo → arena overview → bot spawn | 800 ms |
| Your bot dies | Slow-mo to 0.25× for 600 ms, then snap to winner | 600 ms |
| You win | Camera orbits your winning bot at 0.5× then snaps to results | 1.2 s |
| Big hit on enemy | 100 ms shake (1 px amplitude) | 100 ms |
| Player idle > 5 s during pause | Subtle zoom-in pulse | loop |

Camera follows the bot the player has selected (default: their own
side's "leader" — most biomass / most kills). Tap a robot to follow it.

### 2.2 Hit-stop & time control

- **Hit-stop on kill:** 80 ms freeze when any bot dies. Universal,
  non-negotiable. Implemented by pausing the simulation for 1–2 frames
  in the *client* renderer (server sim is unaffected — replays stay clean).
- **Hit-stop on big hit:** 40 ms when a single shot deals ≥ 25% of target HP.
- **Slow-mo on clutch:** last 5 seconds of a match play at 0.5× to let
  the player savour the finish.

### 2.3 Particles (VFX)

| Event | Particle | Density | Lifetime |
|---|---|---|---|
| Blaster fire | 3–5 muzzle sparks, blue-white | low | 200 ms |
| Heavy blaster fire | 8 muzzle sparks + brief flash | medium | 300 ms |
| Grenade explosion | 30-particle radial burst + smoke ring | high | 800 ms |
| Biomass pickup | 6 yellow sparkles absorbed into bot | low | 400 ms |
| Bot death | 40-particle explosion in bot's team color + smoke | high | 1.2 s |
| Build complete | 12 sparkles outward from child | low | 500 ms |
| Hit on shielded | Cyan ripple expanding from impact | low | 300 ms |

All particles are GPU-instanced sprites (Godot `Particles2D`/`GPUParticles2D`).
Target: ≤ 200 particles on screen at once during normal play, ≤ 600
during a multi-kill.

### 2.4 Animation principles

- **Ease-out for arrivals.** Camera arriving, bot spawning, UI popping in.
- **Ease-in for departures.** Bot dying, panel closing, menu back.
- **Spring for snap-back.** Energy bar refill, HP regen — small overshoot.
- **No linear easings.** Anywhere. Always pick ease-in-out or ease-out
  with a slight overshoot.
- **Duration budget:** most UI animations ≤ 250 ms. In-arena animations
  (death, build, explosion) ≤ 1.5 s.

### 2.5 UI transitions

Every screen transition uses the same vocabulary:

| Direction | Effect | Duration |
|---|---|---|
| Forward (deeper into a flow) | Slide-in from right + fade-in | 250 ms |
| Back (pop a level) | Slide-out to right + fade-out | 200 ms |
| Modal (dialog) | Scale-up from 0.95 + fade-in | 200 ms |
| Replace (e.g. submission → result) | Crossfade | 300 ms |

No screen-change should take longer than 350 ms — the player must
always feel in control of navigation.

## 3. Audio design

### 3.1 SFX catalog

Each row is **one shipped WAV/OGG asset**. All assets are original or
licensed under CC0/CC-BY; see `02-LICENSING.md`.

| Category | Event | Sound design notes | Duration |
|---|---|---|---|
| UI | button_press | short wood click, slight reverb | 80 ms |
| UI | button_release | softer companion to press | 60 ms |
| UI | toggle_on | bright pluck | 100 ms |
| UI | toggle_off | dull thud | 80 ms |
| UI | panel_open | ascending pad | 200 ms |
| UI | panel_close | descending pad | 180 ms |
| UI | error | low buzzer, two notes | 250 ms |
| UI | success | three-note rising arpeggio | 350 ms |
| Combat | blaster_fire | sharp pew + tail | 200 ms |
| Combat | blaster_hit | thud + sparks | 180 ms |
| Combat | heavy_blaster_fire | deeper pew + sub-bass | 300 ms |
| Combat | grenade_explode | boom + crunch + reverb tail | 1.0 s |
| Combat | shield_hit | metallic ring | 250 ms |
| Combat | death | descending crunch + puff | 700 ms |
| Combat | build_complete | ascending chime | 500 ms |
| World | biomass_pickup | soft clink | 200 ms |
| World | biomass_spawn | subtle pop | 150 ms |
| World | radar_ping | sonar sweep | 400 ms |
| Replay | scrub | light tick | 60 ms |
| Replay | speed_change | whoosh | 200 ms |
| Replay | event_appear | soft chime | 150 ms |

### 3.2 Music

- **Per-arena theme.** 2–3 minute loop, instrumental, low-energy during
  early match, ramps to higher-intensity layers as match progresses.
- **Three layers per track:** base (always), tension (plays when both
  sides have biomass > 50), climax (plays in last 200 ticks).
- **Adaptive crossfade** between layers, 4 s blend time. No abrupt cuts.
- **No lyrics.** Music needs to feel ambient so it doesn't compete
  with the player's focus.
- **First match silence rule:** the very first match a player runs
  plays without music (only SFX) to keep the experience uncluttered.
  Music unlocks after their first win.

### 3.3 Mixing

- Master volume: 0 dB (full).
- Music ducking: −6 dB whenever a combat SFX plays, 200 ms fade back.
- SFX priority: combat sounds override UI; UI overrides ambient world
  sounds; ambient world sounds always at the bottom.
- All SFX play at sample-accurate timing; reverb tail off to ~250 ms
  in default arena theme.

### 3.4 First-launch audio budget

| Category | Count |
|---|---|
| UI SFX | 12 |
| Combat SFX | 8 |
| World SFX | 4 |
| Replay SFX | 3 |
| Arena themes (music) | 2 in MVP |
| **Total files** | **29** |
| **Total size** | **~3 MB (OGG, q5)** |

### 3.5 Localization & accessibility

- All spoken content is *avoided*. If voice is ever added (post-MVP),
  we ship EN, JP, ES, DE, FR, PT-BR first.
- Mute button always accessible from any screen via a persistent header
  icon.
- "Reduce SFX" toggle reduces combat SFX by 12 dB but keeps UI feedback.
- "Music only" toggle keeps music + UI, no combat/world SFX.

## 4. Cross-cutting "must-not"s

- ❌ Camera shake on UI interactions (jarring, kills menu flow).
- ❌ Music during onboarding (focus).
- ❌ Same explosion SFX for blaster and grenade (would feel dishonest).
- ❌ Particles that linger more than 1.5 s (performance + visual noise).
- ❌ VFX that obscures gameplay (always < 50% screen opacity, only at
  the event point).

## 5. Implementation hooks

The server emits events (see `11-REPLAY-FORMAT.md`) with kind + position.
The client maps kinds → VFX/SFX via a single declarative table:

```typescript
// client/src/juice/fx-table.ts
export const FX_TABLE: Record<EventKind, FxSpec> = {
  shot:        { vfx: 'muzzle_sparks', sfx: 'blaster_fire' },
  death:       { vfx: 'explosion',     sfx: 'death', hitStopMs: 80 },
  biomass_taken: { vfx: 'sparkles',    sfx: 'biomass_pickup' },
  // ...
};
```

This keeps the juice layer consistent across the editor preview, the
replay viewer, and the live match — one source of truth for "what
happens when X fires".

## 6. Performance budgets (juice-specific)

- All particle systems combined: ≤ 200 sprites @ 60 fps on iPhone 12.
- SFX pool size: ≤ 24 simultaneous voices (one slot per SFX).
- Music: single stream, decoded once, layered.
- Total memory for juice assets: ≤ 8 MB resident.
- Hit-stop only affects the *renderer*; the sim keeps ticking — so
  hit-stop costs zero CPU on the simulation side.
