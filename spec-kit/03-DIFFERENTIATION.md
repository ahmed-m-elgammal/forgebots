# 03 — Differentiation Strategy

## 1. The positioning

```
              + Real programming needed
              |
              |   Screeps: World
              |              Screeps: Arena
              |
   Programming|
    depth     |                ForgeBots ★ (target)
              |
              |   Gladiabots         Robocode
              |   (visual blocks)    (Java, desktop)
              |
              +-----------------------------------
              Low                                 High
              Mobile / casual quality            Desktop / niche quality
```

We want to be the **highest-mobile-quality** title in the autonomous-programming
genre, with **enough programming depth** to attract power users.

## 2. The 7 differentiators

### 2.1 Hardware construction (Grobots DNA, modern UI)

Gladiabots and Screeps give you *code* and a *team*. We give you a
**chassis** with a real mass budget and 8 part slots. Putting a bigger
engine means slower turns. Putting a shield means less room for weapons.
This is Grobots' signature mechanic and we modernise the UI around it.

### 2.2 Reproduction + ecosystem

No competitor has both *reproduction* and *async PvP*. Gladiabots has
neither. Screeps has neither (single creep per type per match). When a
ForgeBots side wins, it often wins because it out-reproduced the enemy.
This is the single biggest design differentiator.

### 2.3 Dual-mode editor (visual ↔ text)

| Mode | Audience | Compiles to |
|---|---|---|
| Visual blocks | Casual mobile players | ForgeBots IR |
| Text DSL | Power users, students | ForgeBots IR |

Both modes share a *single IR*, so a power user can build a structure in
blocks, then tweak it as text. Gladiabots is visual-only; Screeps is
text-only. We are the first to make both first-class.

### 2.4 Native mobile-first

Gladiabots is mobile-first but its editor is cramped on phones.
ForgeBots is built in **Godot 4** with touch-first ergonomics:
thumb-reachable tool palette, gesture-friendly zoom, large hit-targets.

### 2.5 True determinism + replay fidelity

All our physics is integer/fixed-point and the simulator has exactly
one implementation, running server-side
([`22-DECISIONS.md` D3](22-DECISIONS.md)). Every replay is identical
for every viewer, because there is only one replay. We support
**scrubbing, jumping to event, slow-mo (0.25×), bookmarks**.

### 2.6 Server-authoritative sandbox

Player code never executes on a third-party machine in source form.
It is compiled to **ForgeBots IR**, verified, then run by a
cycle-budgeted tree-walking VM. Each robot gets a hard
1000 cycles/tick limit and a 64-slot data stack.

### 2.7 Progression with cosmetics, no pay-to-win

We sell **chassis skins**, **arena themes**, and **bot slots** (a
capacity purchase, never a strength purchase). We do not sell power.
Elo rank + ladder + seasonal cosmetic unlocks drive retention.

Note "unlocks", not "drops": there is no gacha and no random paid roll
(`14-MONETIZATION.md § 5`).

## 3. The "anti-features" (deliberately not done)

| Anti-feature | Reason |
|---|---|
| Live real-time PvP | Infra cost, latency fairness, async is enough |
| User-uploaded custom art | Legal & moderation nightmare |
| Open-source simulator | Lock-in via data moat; closed lets us protect IP |
| Server-side scripting for devs | Not safe, not necessary |

## 4. Competitive response plan

If Gladiabots adds hardware: their mobile UI is too small for it;
our editor is the moat.
If Screeps adds mobile: their JS ecosystem is too heavy for our
audience; our DSL is the moat.
If a new entrant copies us: we have 12 months of polish on the
simulation, the editor, and the replay viewer.
