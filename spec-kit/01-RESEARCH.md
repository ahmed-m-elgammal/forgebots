# 01 — Research: Original Grobots & the Field

## 1. The original Grobots

**Source:** https://sourceforge.net/projects/grobots/
**Authors:** Devon Schudy (1996 first version), Warren Schudy. Java port by
Mike Anderson (2014).
**License:** GNU GPL v2 (later versions may be v2+; redistribution requires
source availability — see `02-LICENSING.md`).
**Engine:** C++ with Cocoa on macOS, Win32 on Windows; a Java port exists.
**Language:** Custom Forth dialect ("Grobocode") running on a two-stack VM.

### 1.1 Gameplay loop

A **side** (one player) contains 1..N **types** (recipes). Each type
describes a robot chassis with:

- **Hardware** (mass budget):
  - **Processor** — runs the program, executes one word per cycle.
  - **Engine** — moves the robot; max speed depends on engine power, mass,
    and friction.
  - **Constructor** — builds child robots from biomass + energy.
  - **Sensors** — radar, scanner (range, fidelity, field-of-view), proximity.
  - **Weapons** — blasters (instant hitscan), grenades (arcing), force-fields.
  - **Shields** — soak damage; can be toggled.
  - **Solar panels / engines** — passive energy.
- **Software** — a Grobocode program stored per type.

> **What ForgeBots does not carry over.** There is **no Processor
> part** in the ForgeBots catalog (`04-GAME-DESIGN.md § 3.2`): the
> compute budget is a per-robot *cycle allowance* (1000/tick) that
> every robot has equally, rather than a part you can buy. This was a
> deliberate simplification — a purchasable processor part would make
> "whoever spends more wins" the dominant strategy.
>
> ForgeBots also **drops the shield toggle** (shields are always-on
> damage buffers in MVP) and **drops map solar cells** (energy comes
> from Solar Panel / Reactor parts). See `22-DECISIONS.md` D7.

Robots gather **biomass** (organic cells scattered on the map) and **energy**
(from solar cells or by eating fallen enemies). They reproduce when full,
die when energy hits zero or HP runs out. Battles run as continuous-time
real-time simulations until one side is extinct or the round limit hits.

### 1.2 Language reference highlights

- **Two-stack machine** (data + return), postfix (RPN) syntax.
- Words include `dup drop swap rot`, arithmetic, control flow
  (`if else then`, `do loop`), sensor queries (`radar`, `scan`, `food`),
  actions (`fire`, `eats`, `build`, `move`).
- **Recursion IS supported.** The published language reference
  demonstrates a recursive word. An earlier version of this doc claimed
  "no recursion (Forth-style)" — that was wrong, and the claim was
  being used to justify our own verifier rule. The rule stands on its
  own merits (a cycle-budgeted sandbox has no reason to permit a call
  graph that can revisit a node, and "all calls form a DAG" is
  checkable); it does not stand on tradition. See
  `09-AI-DSL.md § 5` rule 1 and
  `legacy/03-forgebots-design-translation.md § 2.1`.
- **Numbers:** one 32-bit fixed-point type, 12 fractional bits — range
  about ±524,288, precision 1/4096. Note they had roughly 19 integer
  bits of range, more than our Q16.16, because their world needed it.
  The lesson is that the split must be chosen against *your* world
  bounds, not copied. See `22-DECISIONS.md D1`.
- Programs are deterministic *in principle* but the simulator is
  float-based, so micro-differences are possible between platforms.
  A worked teaching reference of the language, written from scratch,
  is in `legacy/01-grobocode-language-reference.md`.

### 1.3 What we take from Grobots

| Idea | Why it works |
|---|---|
| Hardware-budgeted chassis | Forces interesting trade-offs; emergent strategies |
| Two-stack program model | Easier to sandbox than full scripting |
| Continuous arena with resources | Maps well to mobile-friendly short matches |
| Reproduction + ecosystem | Higher skill ceiling than team-shooter mode |
| Side vs side (no real-time input) | Enables async PvP cleanly |
| Determinism-friendly model | Easy to replay |

### 1.4 What we leave behind

- **Forth syntax** — niche and intimidating.
- **No mobile** — Grobots has zero touch support, no export for iOS/Android.
- **Float-based physics** — makes cross-platform replay fragile.
- **Forced simultaneous rounds** — fun for tournaments, awkward for async.
- **GPL copyleft** — incompatible with closed-source mobile publishing.
- **The Processor part** — replaced by a flat cycle allowance.
- **The shield toggle** — always-on damage buffers instead.
- **Map solar cells** — a resource with no player-facing API.

## 2. Modern competitive landscape

### 2.1 Gladiabots — *AI Combat Arena* (GFX47, 2019)

- **Platforms:** Android, iOS, Windows, Mac (Steam).
- **Mechanic:** visual block-based AI, no code. 3v3 squads, no reproduction,
  no ecosystem.
- **Async PvP:** yes — opponents' AIs play while they sleep.
- **Modes:** elimination, domination, collection.
- **Differentiator vs us:** Gladiabots is *purely* AI-programming with
  fixed team size. We add *hardware construction*, *reproduction*, and
  *biomass ecosystems*. Also Gladiabots has no text editor; we offer visual
  ↔ text parity for power users.

### 2.2 Screeps: World & Screeps: Arena

- **Platforms:** Web (Steam).
- **Mechanic:** real JavaScript, persistent MMO (World) or 1v1 arena (Arena).
- **Differentiator vs us:** Screeps is JS-in-the-large; we offer a much
  smaller, safer DSL. Screeps is sandboxed via V8 isolates; we use a custom
  VM for stronger guarantees and tick-budget enforcement. Screeps is
  web-only; we ship native mobile.

### 2.3 Robocode

- **Platforms:** Java/.NET, desktop.
- **Mechanic:** Java code, real-time, 1v1 tanks.
- **Differentiator vs us:** Robocode is desktop-only and float-based.
  No ecosystem, no async. We are mobile-first.

### 2.4 Bot Land / Clank-Robotics / CODING ROBO

- Various indie titles, all mobile-leaning, all visual-block AI.
- None have built real ecosystems or hardware-bounded construction.

### 2.5 SpaceChem / SHENZHEN I/O / Opus Magnum (Zachtronics)

- Programming *puzzles*, not PvP. We are not in the same niche; but Zachtronics
  shows the audience for "real programming in a game" exists and is willing
  to pay.

### 2.6 Screeps, Robocode, Grobots → same family

All three share the DNA: **you write code, the code runs autonomously,
the result is judged in a simulation**. ForgeBots inherits this DNA with
modern production values.

## 3. Gaps in the market (where ForgeBots wins)

| Gap | What we do |
|---|---|
| No mobile-native hardware-builder programming game | Godot client, touch-friendly builder |
| Async PvP + ecosystems never combined | Server sim, determinism, biomass reproduction |
| Visual-only editors lock out power users | Visual ↔ text parity, both compile to same IR |
| GPL projects cannot ship proprietary mobile | Clean-room reimplementation |

## 4. Sources

- grobots.sourceforge.net (overview, history, downloads)
- grobots.fandom.com (hardware, language reference)
- en.wikipedia.org/wiki/Grobots
- store.steampowered.com/app/871930 (Gladiabots)
- screeps.com (Screeps)
- robocode.sourceforge.net (Robocode)
- github.com/readyready15728/awesome-programming-games
- gnu.org/licenses/gpl-faq.html (license scope)
