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

The arena is **2D top-down**. "Camera" therefore means a 2D view
transform (pan + zoom), not an orbit. The earlier wording ("dolly",
"orbit", "free orbit") described a 3D camera that the renderer does not
have and that a top-down tactics view does not want.

| Trigger | Behaviour | Duration |
|---|---|---|
| Match start | Zoom out from the replay title card to the arena overview, then pan to your side's spawn | 800 ms |
| Your robot dies | Slow-mo to 0.25× for 600 ms, then cut to the winner | 600 ms |
| You win | Slow zoom onto your winning robot, then crossfade to results | 1.2 s |
| Big hit on enemy | 100 ms shake (1 px amplitude) | 100 ms |
| Player idle > 5 s during pause | Subtle zoom-in pulse | loop |

The view follows the robot the player has selected (default: their own
side's "leader" — most biomass, tie-broken by most kills). Tap a robot
to follow it. The `replay.json` carries the leader's id per tick so both
sides of a match agree on who is leading.

### 2.2 Hit-stop & time control

- **Hit-stop on kill:** 80 ms freeze when any bot dies. Universal,
  non-negotiable. Implemented by pausing the **client renderer** for
  1–2 frames. The server sim is unaffected — replays stay clean.
- **Hit-stop on big hit:** 40 ms when a single shot deals ≥ 25 % of the
  target's max HP.
- **Slow-mo on clutch:** the last 5 s of a match play at 0.5× so the
  player can savour the finish.

Because the simulator records *simulation* time only, every one of
these is a display-time transform with no effect on the replay's
`tick_count` or hash. That is what makes them safe.

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

- **Per-arena theme.** 90-second loop, instrumental, low-energy during
  the early match, ramping to higher-intensity layers as the match
  progresses.
- **Three layers per track:** base (always), tension (plays when both
  sides hold > 50 biomass), climax (plays in the last 200 ticks).
  - The tension condition is computable by the client from
    `biomass_taken` / `kill bounty` events, but only from tick 1 — a
    robot's *initial* biomass is 0, so no back-fill is needed. State
    this rather than relying on an event that does not exist.
- **Adaptive crossfade** between layers, 4 s blend time. No abrupt cuts.
- **No lyrics.** Music needs to feel ambient so it doesn't compete
  with the player's focus.
- **Music unlock rule:** the first match a player runs — including the
  onboarding previews in `17 § 2.1` — plays **SFX only**. Music fades
  in from their first PvP match onward. (The earlier rule, "unlocks
  after their first win", meant a player who lost their first five
  matches never heard music at all.)

### 3.3 Mixing

- Master volume: 0 dB (full).
- Music ducking: −6 dB whenever a combat SFX plays, 200 ms fade back.
- SFX priority: combat sounds override UI; UI overrides ambient world
  sounds; ambient world sounds always at the bottom.
- All SFX play at sample-accurate timing; reverb tail off to ~250 ms
  in the default arena theme.

### 3.4 First-launch audio budget

Counts match the § 3.1 catalog exactly.

| Category | Count | Budget |
|---|---|---|
| UI SFX | 8 | ~0.2 MB |
| Combat SFX | 7 | ~0.6 MB |
| World SFX | 3 | ~0.2 MB |
| Replay SFX | 3 | ~0.1 MB |
| **SFX subtotal** | **21** | **~1.1 MB** |
| Arena theme music (1 arena in MVP) | 1 | ~2.5 MB |
| **Total files** | **22** | **~3.6 MB** |

Two corrections to the previous table:

- It counted **2** arena themes in MVP while `18 § 1.2` says a themed
  arena ships **per 12-week season**. Season 1 has one arena, so one
  music track. The second theme ships in season 2.
- A 2–3 minute music loop cannot fit in a "~3 MB total" budget
  alongside 21 SFX. The budget above is per-category and adds up. It
  also fits inside `05 § 9`'s 50 MB texture-memory and app-size caps
  and `§ 6`'s 8 MB resident target.

### 3.5 Localization & accessibility

- All spoken content is *avoided*. If voice is ever added (post-MVP),
  we ship EN, AR, JP, ES, DE, FR, PT-BR first — AR is in the launch
  set, not post-MVP (`21 § 1.1`).
- Mute button always accessible from any screen via a persistent header
  icon.
- "Reduce SFX" toggle reduces combat SFX by 12 dB but keeps UI feedback.
- "Music only" toggle keeps music + UI, no combat/world SFX.

Both toggles live on the **Settings** screen (`13 § 2`, screen 13) and
are localised keys under `settings.audio.*` (`21 § 1.4.3`).

## 4. Cross-cutting "must-not"s

- ❌ Camera shake on UI interactions (jarring, kills menu flow).
- ❌ Music during onboarding (focus).
- ❌ Same explosion SFX for blaster and grenade (would feel dishonest).
- ❌ Particles that linger more than 1.5 s (performance + visual noise).
- ❌ VFX that obscures gameplay (always < 50% screen opacity, only at
  the event point).

## 5. Implementation hooks

The server emits events (see `11-REPLAY-FORMAT.md`) with kind + position.
The client maps kinds → VFX/SFX through a **single declarative data
table**, `client/src/juice/fx-table.json`:

```jsonc
// client/src/juice/fx-table.json
{
  "shot":         { "vfx": "muzzle_sparks",  "sfx": "blaster_fire" },
  "death":        { "vfx": "explosion",      "sfx": "death", "hitStopMs": 80 },
  "biomass_taken":{ "vfx": "sparkles",       "sfx": "biomass_pickup" }
}
```

It is **JSON, not a TypeScript module**. The client is Godot with C# and
GDScript (`05 § 2`); a `.ts` file in `client/src/juice/` could not be
loaded by either, and three languages in one client is one too many.
JSON loads from C# and from GDScript alike, and a data table diffs
cleanly in review.

This one table drives the editor preview, the replay viewer, and the
mission viewer, so "what happens when X fires" has exactly one answer.
A missing kind is a **build-time error**, not a silent no-op — the
golden-match test asserts every `11 § 4` kind has an entry.

## 6. Performance budgets (juice-specific)

- All particle systems combined: ≤ 200 sprites @ 60 fps on iPhone 12.
- SFX pool size: ≤ 24 simultaneous voices (one slot per SFX).
- Music: single stream, decoded once, layered.
- Total resident audio + VFX assets: ≤ **8 MB** (see the per-category
  budget in § 3.4).
- Hit-stop only affects the *renderer*; the sim keeps ticking — so
  hit-stop costs zero CPU on the simulation side.
