# 23 - Web Client Plan (v1)

**Status:** proposed. Nothing in `00`-`22` is modified by this document.

## 0. Scope

**v1, not MVP.** This plan builds every screen in `13-UI-UX-WIREFRAMES.md`
§ 2 including the four Settings sub-screens, the full onboarding arc
from `17-ONBOARDING.md`, the monetization surface from
`14-MONETIZATION.md`, and localisation in English **and Arabic with RTL at
launch** — because `13` § 11 and `21` § 1.2 both make Arabic a launch
requirement, not a follow-up.

It also builds the whole server surface in `08`, not two endpoints.
`13` § 13's navigation map does not work with three of the seventeen
screens missing, and a Dashboard with a dead Ladder tab is not v1.

**Deferred to after v1:** nothing is dropped. The cut list in `12` § 3 is
respected — GIF export is the one item explicitly scheduled last.

---

## 1. Four web-specific problems in the spec

These are not implementation details. Each one is a decision, and each
one changes the plan.

### 1.1 The monetization spec is native-only

`14` § 2 sells through the App Store and Play. `07` § 2.9 stores
`(platform, receipt)` and validates against the platform. **A browser
has no native IAP and no receipt to send.**

Three ways out:

| Option | Consequence |
|---|---|
| **Stripe/web checkout on web** | Real revenue on web. Needs a `stripe_payments` path beside the Apple/Google one in `07` § 2.9, a webhook, and entitlement granted server-side rather than by receipt replay. `08` gains a checkout + webhook pair. |
| **No purchases on web** | Free tier only. `13` § 14.4's Forge Pass share link and `13`'s Cosmetics screen both become dead, because `14` § 2.2 is the thing being sold. |
| **Desktop build only, mobile later** | Purchases need the native shell. Defers all of `14` past the web launch. |

This plan assumes **Stripe on web**, and adds a decision to
`22-DECISIONS.md`. If the answer is "no purchases on web", delete Phase
16 and the `13` § 14.4 share paywall with it.

### 1.2 Three Godot APIs in the spec have no web equivalent as written

| Spec | Godot | Web equivalent |
|---|---|---|
| `21` § 1.6 RTL | `Control.set_layout_direction(LAYOUT_RTL_R)`, anchors mirror automatically | `dir="rtl"` on `<html>`, and **CSS logical properties** — `margin-inline-start`, not `margin-left`. Using physical properties means the RTL pass becomes a rewrite instead of a flip. |
| `13` § 10 animation | "Tween via Godot's `Tween` node — no manual lerping" | CSS transitions / Web Animations API, driven by tokens from `web/src/theme/`. The *rule* survives — no per-frame JS lerping — even though the mechanism does not. |
| `13` § 11 screen readers | `Control.accessibility_name` | ARIA `aria-label` / visually-hidden text. Same intent, different vocabulary. |

None of these are hard. All three are cheap now and expensive later,
because each one is a property of every component rather than a fix to
one screen.

### 1.3 Push notifications on web are a different product

`21` § 2.9 assumes APNs and FCM. Web Push needs a service worker, VAPID
keys, a permission prompt browsers gate hard, and it is **desktop-only
in practice** — iOS Safari does not support it.

So `13` § 13.1's live-state pill carrying `● Replay ready` and `21`
§ 2.5's match-ready flow both still work (in-app), but the *push* half
degrades. `21` § 2.9 needs a web branch, and `21` § 2.10's metrics need
to stop counting web users the same way.

### 1.4 The visual editor must not be a second language

`13` § 5 is emphatic: the block editor **must not be able to emit** a
program that branches directly on an `Option`, which is a compile error
per `09` § 2.3. And the flow block is labelled `step()` because
`(every-tick …)` takes a function name, not an inline form.

So the visual editor is **not** a separate graph format with its own
compiler. It is a front end over the same AST the text editor produces.
Blocks map to AST nodes; a block that cannot be expressed is not
offered. One grammar, two surfaces. This is the single biggest
architectural decision in the web build and it belongs in
`22-DECISIONS.md`.

---

## 2. Architecture

```
simulator/src/     the product. Q16.16, DSL, VM, match, telemetry.
                   No floats. No framework. Permanent.
server/src/        Fastify + Postgres. domain/ has ports; db/ implements.
web/               the client. TypeScript. Vite.
```

**The dependency rule (`AGENTS.md` § 6) holds with one addition:** the web
client is a *consumer of the API*, exactly as the Godot client would be.
There is no code path from `web/` to `simulator/`, same as `client/`.
`22-DECISIONS.md` D3 is untouched: the browser never simulates. It
renders replays the server produced.

**What is shared between web and any future client** — the artifacts that
survive a client change, and the only reason a web-first build is not
waste:

- `spec-kit/examples/*.fb` — starter bot sources
- `spec-kit/examples/golden-seeds.json` — golden match definitions
- the ARB files in `web/i18n/` — `t()` keys and strings
- the parts catalog JSON the builder and the server both read
- the replay JSON schema
- `server/openapi.yaml` — generated from the route schemas

**What is not shared:** presentation and client-side logic. If Godot
happens later, screens get written twice. That is the accepted cost, and
`13`'s screens are specified as wireframes, not as Godot scenes, so the
spec does not prejudge it.

**Layers inside `web/`,** mirroring the Godot client's `ui/ logic/ net/`
so the two are recognisably the same architecture:

| Layer | Contents | Rule |
|---|---|---|
| `web/src/logic/` | pure TypeScript: replay decode, chassis math, ladder formatting, block→AST | no DOM, no `fetch`, no React. Unit-testable without a browser. |
| `web/src/net/` | the only place `fetch` and the WebSocket appear | one function per endpoint |
| `web/src/ui/` | components and screens | no business rules; renders `logic/` output |
| `web/src/theme/` | **the only place a hex literal may appear** | `AGENTS.md` rule 1 |
| `web/src/i18n/` | `t()` and the ARB loader | `AGENTS.md` rule 3 |

---

## 3. Phase 0 - Foundations

**Goal:** a repo that lints, typechecks and tests, so every later phase
lands green.

### Tasks

- **0.1 Workspace** — `pnpm-workspace.yaml` over `simulator`, `server`,
  `web`; root `package.json` with `lint`, `typecheck`, `test`,
  `test:coverage`; `tsconfig.base.json` with per-package extends.
- **0.2 Lint (D22 — flat config, no `.eslintrc`)**
  - `eslint.config.js` + `tools/eslint-plugin-forge/determinism.js`.
  - `no-float-literals` over `simulator/src/**` — rule 13 and
    `10-DETERMINISM.md` § 2.2, zero exceptions. Enforced by plugin, not
    review, because it is the rule most likely to be broken by accident.
  - `no-ambient-clock` — no `Date.now()` outside the composition root
    (G35).
  - `no-restricted-imports` — a `simulator/src/<context>/` module imports
    only `math/` and its own directory. Cheapest now, expensive later.
  - `no-hex-colour` outside `web/src/theme/`. **Note:** `AGENTS.md` rule 1
    currently names only `client/theme/` — that must be amended to
    include `web/src/theme/` (§ 12, item 7).
  - `no-inline-ui-string` — a string literal in a JSX text position. This
    is what makes rule 3 mechanical instead of aspirational.
- **0.3 Tests** — `vitest` + v8 coverage; 90 % lines/branches unit, 80 %
  touched paths integration (`AGENTS.md` § 4). Tag scheme so the
  pre-commit hook runs unit only and CI runs golden.
- **0.4 Repo** — move `commune-10.gb` and `isi-33.gb` **out** of the tree;
  they are study material and `02-LICENSING.md` § 4.1 wants them outside
  the repo, not merely ignored.

**Done when** `pnpm lint && pnpm typecheck && pnpm test` passes on an
empty `simulator/src`, and a float-containing file fails lint.

---

## 4. Phase 1 - `math/` — Q16.16 fixed point

Per D1: Q16.16 internally in **metres**; DSL, replay and API in integer
**millimetres**. Conversion at the boundary and nowhere else (G33).

- **1.1 `fixed.ts`** — branded `Fixed` (G26: not a `number` alias);
  conversions; `add`/`sub`/`mul`/`div` with explicit saturation on
  overflow, matching the predecessor's saturating division
  (`legacy/01` § 2); `cmp`/`min`/`max`/`clamp`; `floor`/`ceiling`/`round`
  each tested at the exact halfway point — the `floor(power / 60)` bug
  that made every sub-60 W part free lives here (T6, `AGENTS.md` § 3).
- **1.2 `angle.ts`** — `wrapToPi` (the `reorient` idea, `legacy/01`
  § 4.3), `angleBetween`, `angleDiff` as the *shortest signed* path so a
  robot turning 179°→-179° turns 2°, not 358°.
- **1.3 `vec2.ts`** — add/sub/scale/length/normalize/dot/cross,
  `distance` **between two points** (the `(dist 0 0 dx dy)` origin bug
  shipped in two starter bots; this signature makes it hard to write),
  `angleOf`, `inRange` as a named predicate (G28).
- **1.4 `rng.ts`** — `matchRng` and one `botRng` per robot, named as D5
  specifies. Integer PRNG, explicit seed, no `Math.random()`.

**Tests:** each rounding halfway point; `wrapToPi` at ±π and 0;
saturating division at 0; `normalize` of a zero vector; same seed → same
sequence.

---

## 5. Phase 2 - `program/` — the compiler

**One file.** `program/compiler.ts` holds tokenize, parse, lower, verify
and error formatting. This overrides the 300-line target deliberately:
`AGENTS.md` rule 14 and § 9 resolution 2 — the four-file split existed
*only* to satisfy the line count. Source → verified IR is one
responsibility.

- **2.1 Tokenizer** — the `09-AI-DSL.md` surface grammar. Every token
  carries line and column, because the editor's error gutter and the
  text editor's squiggles both depend on it and retrofitting positions is
  miserable.
- **2.2 Parser → AST** — `defn`, `let`, `set`, `if`, `while`, `repeat`,
  `return`, the builtin forms, the two bracket styles per D21.
  Recursion in `defn` is legal (Grobocode allows it, `legacy/01` § 5) so
  the **verifier** must catch unbounded recursion, not the runtime.
- **2.3 Lowering → IR** — a tree the VM walks. D2: tree-walking, no
  bytecode, no bytecode version tag.
- **2.4 Verifier** — the 1000-cycle budget (`09` § 5 rule 3; G4 says the
  cap is a contract, never widened to make a test pass); the static cycle
  estimate the editor shows live; unknown symbol; arity; type-domain
  errors including the `Option` branch that `13` § 5 says the block editor
  must not be able to emit. Messages come from the i18n layer.
- **2.5 Golden compile** — all 8 `spec-kit/examples/*.fb` compile clean,
  and the IR is byte-stable for a given source. A nondeterministic
  compiler poisons every later phase.

**Tests:** 8 bots compile; 1000 cycles passes / 1001 rejected; one T6
regression test per known starter-bot bug.

---

## 6. Phase 3 - `execution/` — the VM

**One file**, same reasoning as Phase 2 (`AGENTS.md` § 9 resolution 1
reverted the `frame.ts`/`interpreter.ts`/`builtins.ts` split for
precisely this reason).

- **3.1** 64-slot stack; overflow and underflow behaviour are contracts
  (G4); locals for `let`/`set`.
- **3.2** Tree-walking evaluator with a per-node cycle count.
- **3.3** Actuators return *intent*: `move`, `move-at`, `aim`, `fire`,
  `eat`, `build`, `say`. Nothing moves. The name must not lie —
  `runVmAndCollectActuators`, not `runVm`.
- **3.4** D4's single yield behaviour: over-budget abandons the tick
  **whole** (G2 — not half-run, not "run what fits"). Traps yield too,
  and emit `vm_yield` with `reason: budget | trap`.

**Tests:** exact budget edge both directions; stack overflow yields
rather than throws; same IR + state → byte-identical actuators over 100
runs.

---

## 7. Phase 4 — The world

Four contexts, one vocabulary each, importing only `math/` and
themselves.

- **7.1 `arena/`** — geometry, walls, pillars, spawn points, biomass.
  **Biomass respawns in region-sized clusters, not uniformly** —
  requirement 4 in `legacy/02` § 6, because partitioning (each gatherer
  claims a region) is a real strategy and uniform respawn makes it
  pointless. Greenfield, so it is one file now and annoying later.
- **7.2 `robot/`** — state, `Design`, `Chassis`, parts catalog,
  `aggregate`. Chassis limits 50 kg / 80 W are contracts (G4). `aggregate`
  in milliwatts (D6), with the **5 W draw is non-zero** regression test.
  Part IDs a `const` map in the catalog module (rule 4, tier 2).
- **7.3 `combat/`** — hitscan, grenades, shield-first (D7), death, bounty.
  **Decide friendly fire first** — `legacy/02` § 6 calls it small and
  blocking and recommends on for splash, off for aimed. Retrofitting a
  team check into a damage function that never had one is how you get a
  permanent `if (source is ally)`.
- **7.4 `vitality/`** — energy pool, milliwatt drain, shield regen,
  starvation.

**Tests:** shield-before-hull at the exact boundary; the 5 W regression;
50 kg and 80 W at 50.1 / 80.1.

---

## 8. Phase 5 — `match/` and `telemetry/`

The phase that makes everything else possible.

- **8.1 `match/`** — tick loop with **explicit total ordering**:
  actuators → physics → hitscan → damage → deaths → biomass → events.
  G31: the order lives in one place and is asserted, not implied.
  Win conditions per D9 and `04` § 6 including the tick cap and biomass
  tiebreak that stops hiding from being dominant (`legacy/02` § 3.2).
  Death by `combat` and by `starvation`, both first-class.
- **8.2 `telemetry/`** — `EventLog`, replay document, `outputSha256`. The
  17 event kinds from `11` § 4; `snapshot` every 30 ticks plus tick 1;
  `move`/`aim` **only on change** (D10, which is what keeps replays
  small). Kinds owned by one enum. A test that fails if a kind has no fx
  entry, per `11` § 4.
- **8.3 Golden test** — fixed seed → fixed `output_sha256` over 1500
  ticks, all seeds from `golden-seeds.json`, **on Linux, macOS and
  Windows**. Integer maths is supposed to make this portable; this is
  the test that proves it instead of assuming it.

**Done when** three platforms agree on the hash. The most important gate
in the plan.

---

## 9. Phase 6 — The server (full surface)

Not two endpoints. The whole of `08`, because `13` § 13's nav map needs
all of it.

- **9.1 Infrastructure** — Fastify, Drizzle, Postgres, migrations. `main.ts`
  is the only composition root and the only reader of `process.env`
  (G35). `domain/` declares ports; `db/` implements.
- **9.2 Auth** — register, login, Apple/Google OAuth, refresh. Passwords
  hashed with a memory-hard KDF. Email stored hashed or encrypted
  (`07` § 2.1). `refresh_tokens` and `idempotency_keys` per `07` § 2.10.
  Logout and token revocation.
- **9.3 Bots** — CRUD, `/validate`, `/simulate`, `/publish`. `botSlot`
  accounting from `08` § 3 (the Dashboard's `2/3 used` depends on it).
- **9.4 Matches and replays** — submit, list, fetch, replay with `Range`
  and gzip, `/events?since=`, replay **bookmarks** and **shares** (`07`
  § 2.13). Share links valid 30 days per `13` § 14.4.
- **9.5 Matchmaking and ladder** — Elo ± 100, ghost fallback from the
  seeded starters (D11, `08` § 4). `GET /ladder`, `/ladder/me`. D14 Elo.
- **9.6 Seasons** — `GET /seasons/current`, `balance_versions` per season.
- **9.7 Cosmetics and purchases** — catalog, entitlement, receipts. Plus
  the **Stripe path from § 1.1** if that decision goes this way, with a
  webhook that grants entitlement server-side. Unique `(platform,
  receipt)` is the replay guard (`07` § 2.9).
- **9.8 Missions, achievements, replay library** — `07` § 2.11, 2.12,
  2.13. Mission progress is server state, because a client-side mission
  tracker is a mission tracker a player can edit.
- **9.9 RLS** — deny-all on cosmetics, purchases and bot versions; shares
  readable by anonymous via `current_setting('app.user_id', true)`
  (`07` § 3). Unauthenticated share reads are the one hole, and it is
  deliberate.
- **9.10 `audit_log`** — `07` § 2.15.
- **9.11 OpenAPI** — generated from the route schemas into
  `server/openapi.yaml` (D22, `08` § 11). Single source of truth for the
  web client's `net/` layer.
- **9.12 Contested telemetry** — `18` § 3.2's `match_request` needs a
  *did the match actually contest* field, and `18` § 3.3 needs a
  **contest rate** KPI. Without it, a bot farming easy ghost matches
  looks better in the data than it is — the exact mistake the
  predecessor made in 2005 and had to invent "non-sterile survival" to
  fix (`legacy/02` § 5).

---

## 10. Phase 7 — `web/` shell, design system, i18n, a11y

Everything every screen depends on. Built **before** any screen, because
retrofitting RTL or a11y across seventeen screens is a rewrite.

- **10.1 Theme** — `web/src/theme/` is the only place a hex literal may
  appear. CSS custom properties. The `13` § 8 palette becomes tokens:
  background, surface, accent, success, danger, muted. Plus a
  **colourblind variant** (`13` § 11) — mandatory, not optional, because
  the arena is green biomass on a dark field and red/green is the most
  common deficiency. Robots must keep **shape cues** under it.
  Typography per `13` § 8: Inter for UI, JetBrains Mono for DSL and IR.
- **10.2 RTL from the first component** — `dir` attribute plus **CSS
  logical properties** everywhere. No `margin-left`, no `left`, no
  physical properties anywhere in `web/src/`. A lint rule. Arabic ships
  at launch (`13` § 11, `21` § 1.2), so this is not a later pass.
- **10.3 i18n** — `web/i18n/en.arb` and `ar.arb`. `t()` helper, ARB as
  source of truth with per-locale overlays (`21` § 1.3). String extraction
  in CI (`21` § 1.4) so a literal in a JSX text position fails. Logical
  properties plus the `21` § 1.6 mirroring list: tab bar mirrors, back
  button moves top-right, asymmetric icons flip, `flip_on_rtl` per
  `13` § 9. Locale detection and fallback (`21` § 1.7), fonts (`21`
  § 1.8).
- **10.4 A11y primitives** — every interactive element ≥ 44 dp (one
  number, not "44 pt" — `13` § 11 calls out that saying pt and shipping
  Android is a silent 1.3× miss); AA contrast on all text; ARIA labels on
  every icon; a `prefers-reduced-motion` path that kills camera shake
  and slow-mo. Built in, not added later.
- **10.5 App shell** — routing for all 17 screens; the persistent
  elements of `13` § 13.1 (back button top-left, avatar top-right,
  bottom tab bar `Dashboard / Bots / Ladder / Cosmetics / Settings`, and
  the **live-state pill** carrying `● Idle • Elo 1247` and flipping to
  `● Replay ready`); the one-modal-at-a-time rule (`13` § 13.2); inline
  skeletons rather than loading modals.
- **10.6 Empty-state component** — `13` § 12 requires a designed empty
  state with a one-line CTA on *every* screen. Built as a component so
  none is missed.
- **10.7 Verification harness** — Playwright drives the app and
  screenshots it. "A parse check is not a run": a screenshot is the
  evidence a test is not. This is the main reason the web loop is fast.

---

## 11. Phases 8-19 — The screens

Each phase lists the screen, what it must do, and what proves it done.

### Phase 8 — Auth and onboarding

- **8.1 Splash** (`13` § 2 #1) — "Log in" / "Sign up". No auto-playing
  music (`13` § 15).
- **8.2 Login / Signup** (#2) — handle, email, password; Apple and Google
  OAuth buttons.
- **8.3 Onboarding phase 1, Hook** (`17` § 2, 0-60 s) — the beat sheet,
  pre-filled bot, tooltip placement, the audio-silence rule.
- **8.4 Mission 1 — Gather** (vs Drifter) — "Collect 10 biomass before
  Drifter does." Scaffolding that disappears after first clear.
- **8.5 Mission 2 — Fight** (vs Pouncer) — "Destroy Pouncer." Teaches
  the **passive weave**, which `legacy/02` § 3.1 says gets most of the
  benefit of dodging and is therefore a legitimate beginner strategy.
- **8.6 Mission 3 — Breed** (vs Breeder) — "Build 3 children before tick
  900."
- **8.7 Bounce-back rule** (`17` § 3.3) — the return path after a loss,
  and the `17` § 4.2 first-loss UX.
- **8.8 Phase 3, Convert** (`17` § 4) — ladder unlock, first PvP.

**Done when** a new account reaches its first real match unaided, and
onboarding metrics (`17` § 6) are emitted.

### Phase 9 — Dashboard and bot list

- **9.1 Dashboard** (#3) — Elo, rank, `Bot slots: 2/3 used` from
  `GET /bots`, "Build a new bot" as the single big CTA, bot list,
  quick play. One CTA per screen (`13` § 15).
- **9.2 Bot list** (#4) — per-bot Elo, wins/losses/draws, edit, submit
  match. Empty state: "Forge your first bot".
- **9.3 Bot detail** — chassis summary, last replay, publish toggle.

### Phase 10 — Bot builder (chassis)

`13` § 4, and the screen with the most spec detail per pixel.

- **10.1** Eight part slots, labelled **"Part slots"** so they can never
  be confused with the Dashboard's "Bot slots" (D12).
- **10.2** Part picker bottom sheet on empty slot; Replace / Remove on a
  filled one.
- **10.3** **Draw / Generate / Net as three separate numbers.** For the
  spec's example: 5 + 1 + 6 = 12 W drawn, 5 W generated, **net +7 W**.
  A single total hides the sign and is exactly how players build bots
  that mysteriously starve. Net ≤ 0 shows a green "sustains" hint
  instead of a warning.
- **10.4** Chassis preview — HP, shield, speed, using the **same formula
  as `04` § 3.1**. 10 kg → `floor(10 × 1.5)` = 15 hull, 0 shield. The
  builder must not reimplement this; it reads the server's aggregate.
- **10.5** Live limit feedback against 50 kg / 80 W.
- **10.6 Save dialog** — bumps `code_version` (`08` § 3).

### Phase 11 — DSL editor, text mode

- **11.1** Editor surface: line numbers, the two bracket styles per D21,
  monospace per `13` § 8.
- **11.2** Syntax highlighting from the same token definitions the
  compiler uses — not a second, separately-maintained highlighter.
- **11.3** Error gutter: line, column, i18n message. Positions come free
  from Phase 2.1's tokenizer.
- **11.4** **Live cycle estimate** — `Cycles/tick: 230 / 1000` from the
  verifier, updating as you type. Save is blocked above 1000 (`13` § 5).
- **11.5** Run preview — the WebSocket frame stream (`08` § 9), rendered
  by the Phase 14 renderer.
- **11.6** Toolbar: drag-to-rearrange, undo/redo, help (`13` § 5).
- **11.7** The starter-bot library as insertable examples, from
  `spec-kit/examples/*.fb` (D22).

### Phase 12 — DSL editor, visual (block) mode

The largest single piece of work in the plan, and the one where § 1.4
decides the architecture.

- **12.1** Block palette by category — Sensors, Actuators, Logic, Math,
  Functions (`13` § 5).
- **12.2** Blocks compile **to the same AST the text editor produces.**
  One grammar, two surfaces. Not a graph format with its own compiler.
- **12.3** The flow block is labelled `step()` because `(every-tick …)`
  takes a **function name**, not an inline form (`09` § 2.2).
- **12.4** The sensor block is `Radar some?`, never a bare `Radar` on a
  branch, because branching on an `Option` is a compile error
  (`09` § 2.3). **The editor must make that unrepresentable** — the
  block simply does not exist in that position.
- **12.5** Round-trip: blocks → text and text → blocks, losslessly. A
  player must not lose work by switching modes.
- **12.6** Visual/Text toggle in the header, per `13` § 5, with unsaved
  state preserved across the switch.

### Phase 13 — Matchmaking, preview and result

- **13.1 Matchmaking** (#8) — "Wait…" → opponent card, with the Elo band
  shown. The ghost fallback (D11) must be **labelled as a ghost** when it
  happens, or the player learns nothing from a walkover.
- **13.2 Match result** (#10) — outcome, Elo delta, and per `13` § 1.4
  the **replay is the reward**: the first thing after a match is a
  scrubbable replay, not a victory banner. Replay / Back.
- **13.3 "Submit again"** — the replay viewer's primary action (#9).

### Phase 14 — Replay viewer

`13` § 14 is authoritative and is the most screen-time surface in the
game. Full detail, not the abbreviated `13` § 6.

- **14.1 Decode** (`web/src/logic/replay/decode.ts`) — replay JSON →
  timeline. Snapshots every 30 ticks, **interpolated between**; `move`
  and `aim` only on change, so without interpolation robots teleport.
  Millimetres in, canvas units out, converted at this edge only (G33).
  A pure function, so it unit-tests without a browser.
- **14.2 Render** (`web/src/logic/replay/render.ts`) — arena bounds,
  biomass, robots with heading ticks, shots as fading streaks, walls and
  pillars. Takes a timeline and a playhead, holds **no game state**.
- **14.3 Controls** (`13` § 14.1) — play, pause, step back, step forward,
  scrub timeline, speeds `0.25× 1× 2× 4×`, and the per-tick **event log**
  rendered from the `11` § 4 kinds.
- **14.4 Three camera modes** (`13` § 14.2) — auto-frame biased to the
  active side; follow-robot (tap a robot, tap empty arena to release);
  locked top-down. **Free orbit does not exist** and never will; there is
  no third dimension.
- **14.5 Stats overlay** (`13` § 14.3) — hull HP and shield HP as **two
  bars, not one** (`04` § 3.1), energy, biomass held, damage dealt,
  biomass collected. **Off by default** for new players, **on by default**
  above 50 matches.
- **14.6 Sharing** (`13` § 14.4) — share link for Forge Pass only, backed
  by a `replay_shares` row valid 30 days; free players get a store
  prompt, **not a silent failure**; bookmark (free, kept forever, exempt
  from the 90-day prune per `07` § 6).
- **14.7 GIF export** — client-side canvas encoding, 5-10 s, capped at
  5 MB. **Built last**: `12` § 3 names it the most expensive thing on
  this screen per unit of player value.
- **14.8 Colourblind palette** and shape cues, from 10.1.

### Phase 15 — Ladder

`13` § 7: rank, bot, Elo, season badge (D19), tap to challenge. Your
own row highlighted. Empty state: "Be the first to reach the top".

### Phase 16 — Cosmetics and monetization

Conditional on the § 1.1 decision.

- **16.1 Cosmetics screen** (#12) — catalog by kind, equip, owned state.
  Free/Forge Pass/cosmetic pack/slot pack boundaries from `14` § 2.
- **16.2 Forge Pass upsell** — `14` § 2.2. This is the thing that makes
  `13` § 14.4's share paywall coherent, so the two ship together.
- **16.3 Checkout** — Stripe on web, or the native path on a future
  mobile shell. Entitlement granted **server-side**; the client never
  decides what the player owns.
- **16.4** `14` § 5 anti-patterns: no fake scarcity, no consumable
  gameplay advantage, no energy timers on a game that is played in
  25-second matches.

### Phase 17 — Settings and its four sub-screens

All two taps from the dashboard (`13` § 13, `15`).

- **17.1 Settings root** (#13) — "Log out".
- **17.2 Settings → Audio** (13a) — mute, SFX, music per `16` § 3.5.
- **17.3 Settings → Notifications** (13b) — per-channel switches and
  quiet hours per `21` § 2.3 and § 2.8. Quiet hours must actually
  suppress sends, and the suppression must be visible in the UI.
- **17.4 Settings → Accessibility** (13c) — reduce motion, colourblind
  palette, screen-reader hints.
- **17.5 Settings → Account** (13d) — handle, language, timezone,
  **export data**, **delete account** per `08` § 9. Export and delete are
  the two that need real server endpoints and a real confirmation flow;
  they are also the two a privacy review will ask about first.

### Phase 18 — Juice and audio

`16` is a whole doc and it is client work.

- **18.1** The four laws of `16` § 1.1, and § 1.2's list of what juice is
  **not**.
- **18.2** Camera (`16` § 2.1) — 2D pan and zoom, matching the replay
  viewer's three modes.
- **18.3** Hit-stop and time control (§ 2.2), particles (§ 2.3),
  animation principles (§ 2.4), UI transitions (§ 2.5). All ≤ 250 ms,
  never blocking input, and driven by theme tokens rather than
  per-component values.
- **18.4** SFX catalog (§ 3.1), music (§ 3.2), mixing (§ 3.3), and the
  **first-launch audio budget** (§ 3.4) — which `13` § 15 also forbids
  violating by autoplay.
- **18.5** Performance: `16` § 6 budgets, and `13` § 10's ≤ 16 ms/frame
  target measured on a throttled CPU, not assumed.

### Phase 19 — Localisation and RTL conformance

Not a translation pass at the end. EN and AR both complete, RTL correct.

- **19.1** Every string in `en.arb` and `ar.arb`; the `21` § 1.5 workflow.
- **19.2** RTL correctness for all 17 screens using logical properties.
- **19.3** `21` § 1.9's pre-launch checklist, run per locale.
- **19.4** Push on web (§ 1.3): service worker, VAPID, permission flow,
  and the honest degradation for browsers without it.

---

## 12. Phase 20 — Validation and the launch gate

**Goal:** prove it, then find out what the process cost.

- **20.1 Core** — golden hashes match on three platforms; 8 bots compile
  and finish; no unintended `vm_yield`.
- **20.2 Design** — measured against the open questions:
  - **Does 25 s let forces meet?** Tick of first engagement across a
    batch of seeded matches. `legacy/02` § 5 argued the late game decides
    matches and that 400 cells over 25 s may reach it too rarely.
  - **Contest rate** — matches where both sides engaged. Without it,
    survival metrics are the broken metric `legacy/02` § 5 describes.
  - **Quantity vs quality** — Breeder vs Reaper.
  - **Starter Elo bands** — Pebble 800 → Swarm-Mind 1650.
- **20.3 Process** — wall-clock per phase against the estimate; how much
  friction was spec versus tooling; what an agent did unattended versus
  what needed a human.
- **20.4 Launch gate** — `12` § 2's Definition of Done, `12` § 4's
  quality bar per system, `21` § 1.9 per locale, and `13` § 11's
  accessibility conformance.
- **20.5 Write it down** — findings into `15-RISKS.md` and the owning
  docs' open-questions sections. A measurement nobody records did not
  happen. Then decide mobile: web as shipping client, or Godot.

---

## 13. Coverage matrix

Every screen, where it is built, and what proves it.

| # | Screen | Phase | Proof |
|---|---|---|---|
| 1 | Splash | 8.1 | Playwright screenshot, no autoplay assertion |
| 2 | Login / Signup | 8.2 | integration: register → token → `GET /bots` 200 |
| 3 | Dashboard | 9.1 | renders Elo, rank, `2/3 used` from a fixture response |
| 4 | Bot list | 9.2 | empty state + populated state, both screenshotted |
| 5 | Bot builder | 10 | net-power unit test: 12 drawn, 5 gen, **+7 net** |
| 6 | Editor, visual | 12 | no `Radar`-on-branch block exists; round-trip test |
| 7 | Editor, text | 11 | cycle estimate blocks Save at 1001 |
| 8 | Matchmaking | 13.1 | ghost fallback labelled as such |
| 9 | Replay viewer | 14 | Playwright: robot drawn at tick N, screenshot |
| 10 | Match result | 13.2 | replay offered first, not a victory banner |
| 11 | Ladder | 15 | challenge flow reaches matchmaking |
| 12 | Cosmetics | 16.1 | entitlement is server-decided, not client |
| 13 | Settings | 17.1 | two taps from dashboard |
| 13a | Audio | 17.2 | toggles persist |
| 13b | Notifications | 17.3 | quiet hours suppress; suppression visible |
| 13c | Accessibility | 17.4 | reduced-motion and colourblind apply |
| 13d | Account | 17.5 | export and delete both work end to end |
| — | Missions 1-3 | 8.4-8.6 | each clearable; scaffolding disappears after |
| — | EN + AR RTL | 19 | `21` § 1.9 checklist per locale |

---

## 14. Order, and the one thing not to cut

```
0 Foundations      ─┐
1 math/             │
2 program/          │  the product. TypeScript, permanent.
3 execution/        │  cut here and there is nothing to look at.
4 world contexts    │
5 match/telemetry  ─┘  ── three-platform golden hash ──►
6 server (full)
7 web shell + i18n + RTL + a11y   ── the expensive-to-retrofit part ──►
8 auth + onboarding
9 dashboard + bots
10 builder          ─┐
11 editor (text)    │  the two largest pieces
12 editor (visual)  ─┘
13 matchmaking      ─┐
14 replay viewer    │  the game
15 ladder           │
16 cosmetics  (conditional on §1.1)
17 settings
18 juice + audio
19 EN + AR + RTL
20 validation + launch gate
```

**The gate that matters most is not the last one.** It is the
three-platform golden hash in Phase 5. Every later phase assumes the
simulator is deterministic; if that is wrong, the replay viewer is
rendering fiction and the whole v1 is built on sand.

Second most important: Phase 7. RTL, i18n and accessibility are
properties of *every* component. Built at the end they are a rewrite;
built here they are a checkbox.

---

## 15. Spec edits this implies, for approval

Nothing below is applied. Per `AGENTS.md` the spec is upstream of code,
and these are spec changes, so they are the owner's call.

| # | Doc | Change needed |
|---|---|---|
| 1 | `22-DECISIONS.md` | Web is the primary client; Godot deferred pending Phase 20 evidence. |
| 2 | `22-DECISIONS.md` | The visual editor emits the same AST as the text editor — one grammar, two surfaces (§ 1.4). |
| 3 | `22-DECISIONS.md` | Friendly fire: splash on, aimed off — the `legacy/02` § 6 recommendation, decided before Phase 7.3. |
| 4 | `22-DECISIONS.md` | Purchases on web: Stripe path, or no purchases on web (§ 1.1). |
| 5 | `14-MONETIZATION.md` | A web payment path beside the Apple/Google one, or an explicit statement that web is free-tier only. |
| 6 | `21` § 1.6, § 2.9 | RTL via CSS logical properties, not `set_layout_direction`; push becomes Web Push with honest degradation. |
| 7 | `13` § 10, § 11 | Tween and `Control.accessibility_name` replaced with their web equivalents (§ 1.2). |
| 8 | `08` | Add checkout + webhook endpoints if § 1.1 resolves to Stripe. |
| 9 | `web/README.md` | It describes a Flutter-web **marketing site** deferred to weeks 9-10. This plan builds a game client. The marketing site is a separate, still-deferred work stream. |
| 10 | `05` § 1, `06` § 2 | Engine verdict needs a web-first clause; `web/` needs a place in the architecture tree. |
| 11 | `AGENTS.md` rule 1 | Currently names only `client/theme/`. Must read `web/src/theme/` too — otherwise the lint rule forbids colour throughout a directory about to be full of it. |
| 12 | `spec-kit/README.md` | Index this document. |

Item 11 is a live bug in `AGENTS.md` as it stands, independent of
everything else in this document.
