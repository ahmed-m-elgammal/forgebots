# client/ — Godot 4 Project

> Placeholder scaffold — **no implementation code yet** (`.gitkeep` files
> only). `project.godot` and the first scenes land in Week 5 of
> [`spec-kit/12-MVP-ROADMAP.md`](../spec-kit/12-MVP-ROADMAP.md) (Godot
> client skeleton).

Godot 4.7.x + C# (.NET 10), GDScript for small bits
([`05-TECH-STACK.md`](../spec-kit/05-TECH-STACK.md) § 2). One export
covers Android, iOS, Windows, macOS, Linux. The client only submits
*intent* (bot IR + match request); the server is authoritative.

## Planned layout (`06-ARCHITECTURE.md` § 2, extended by `16` § 5 and `21` § 3)

| Path | Purpose |
|---|---|
| `project.godot` | Godot project root (Week 5) |
| `scenes/` | Scene tree |
| `ui/` | Steady-state screens ([`13-UI-UX-WIREFRAMES.md`](../spec-kit/13-UI-UX-WIREFRAMES.md)) |
| `net/` | Typed HTTP + WebSocket wrappers ([`08-API-SURFACE.md`](../spec-kit/08-API-SURFACE.md) § 9) |
| `editor/` | Visual (Blockly) + text DSL editor, 1:1 form mapping ([`09-AI-DSL.md`](../spec-kit/09-AI-DSL.md) § 7) |
| `sim/` | Local preview simulator wrapper |
| `assets/` | Art, SFX, music (catalog in [`16-JUICE-AND-AUDIO.md`](../spec-kit/16-JUICE-AND-AUDIO.md) § 3 — 23 files, ~3 MB budget) |
| `src/juice/` | Declarative FX table (`fx-table.ts`: event kind → VFX/SFX/hit-stop, [`16-JUICE-AND-AUDIO.md`](../spec-kit/16-JUICE-AND-AUDIO.md) § 5) |
| `i18n/` | `en.arb` (canonical source of truth), `ar.arb`, `glossary.json`, `export/` → generated `.po` files for Godot ([`21-LOCALIZATION-AND-NOTIFICATIONS.md`](../spec-kit/21-LOCALIZATION-AND-NOTIFICATIONS.md) § 1.3, § 3) |
| `src/i18n/` | `i18n.gd` (`t()` wrapper around TranslationServer), `locale.gd` (detection + fallback) ([`21-LOCALIZATION-AND-NOTIFICATIONS.md`](../spec-kit/21-LOCALIZATION-AND-NOTIFICATIONS.md) § 3) |

## Hard rules

- Zero hardcoded user-facing strings — everything via `t("key")` from
  `i18n/` ARB files (`21-LOCALIZATION-AND-NOTIFICATIONS.md` § 1.4).
- Performance budgets in [`05-TECH-STACK.md`](../spec-kit/05-TECH-STACK.md)
  § 9 (60 fps, ≤ 80 draw calls, ≤ 50 MB textures on iPhone 12 / Pixel 5).

## Current contents

Empty by design (`.gitkeep` placeholders only).
