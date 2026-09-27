# 09 — The ForgeBots AI DSL & Sandbox

> Canonical decisions for the VM execution model, cycle over-run, RNG
> streams and DSL units live in
> [`22-DECISIONS.md`](22-DECISIONS.md). This doc follows them.

## 1. Design goals

1. **Safe** — no raw user code on the server.
2. **Deterministic** — same input → same output on every run.
3. **Bounded** — hard cycle/memory caps so a bot can't DoS the simulation.
4. **Expressive** — enough power to write interesting bots.
5. **Two surfaces** — visual blocks and text, compiling to the **same IR**.
6. **Verifiable** — server validates IR before saving; rejects invalid bots.

## 2. The language (text surface)

### 2.1 Syntax (Lisp-like, deliberately simple)

```
;; comments start with semicolon

(defn scout []
  (let [target (radar)]
    (if (some? target)
        (do (aim (atan2 (- (hit-y target) (self.y))
                        (- (hit-x target) (self.x))))
            (fire))
        (move 65536 0))))

(every-tick scout)
```

Why Lisp-like (not Forth-like Grobots)? It composes better, parses
unambiguously, and is the most-taught non-mainstream syntax — students
pick it up in a weekend. Grobots' Forth was delightful but niche.

### 2.2 Reserved forms

Brackets and parentheses are interchangeable everywhere, so `let`
accepts both `(let [x 5] body)` and the Scheme-style `(let ((x 5)) body)`
used by the starter bots (`19-STARTER-BOTS-AND-LIBRARY.md § 2`). One
parser, one AST ([`22-DECISIONS.md` D21](22-DECISIONS.md)).

| Form | Purpose |
|---|---|
| `(let [name expr]* body)` | Bind locals (one or many bindings) |
| `(if cond then else?)` | Branch. `else` may be omitted. |
| `(do expr*)` | Sequence |
| `(while cond max-iters body)` | Loop with a **required** literal iteration bound (§ 5, rule 2) |
| `(loop n body)` | Bounded loop, exactly `n` iterations |
| `(defn name [args] body)` | Define function |
| `(call fn args*)` | Call a user fn |
| `(every-tick fn)` | Program entry point. **`fn` must be a function name** — an inline form is a compile error. |
| `(cond [test expr]* [else expr])` | Multi-way branch. `else` is required. |
| `when`, `not`, `and`, `or` | Booleans |
| `+`, `-`, `*`, `/`, `mod`, `abs`, `min`, `max` | Math |
| `<`, `<=`, `>`, `>=`, `==`, `!=` | Compare |
| `some?` | `Option` test — the **only** way to branch on a sensor result (§ 2.3) |
| `radar`, `(scan angle)`, `(food)`, `(ally)`, `(enemy)` | Sensors |
| `(self.x)`, `(self.y)`, `(self.hp)`, `(self.shield)`, `(self.energy)`, `(self.biomass)`, `(self.alive)` | Self state, in **integer millimetres** |
| `(move vx vy)`, `(move-at tx ty)`, `(aim angle)`, `(fire)`, `(eat)`, `(build design)`, `(say ch v)` | Actuators |
| `(time)` | Current match tick |
| `(rng-int n)` | Uniform int in `[0, n)` from **this robot's own** RNG stream |
| `(dist x1 y1 x2 y2)` | Fixed-point distance between two points, in mm |
| `(food-x f)`, `(food-y f)` | Coordinates of a `food` result |
| `(hit-x h)`, `(hit-y h)` | Coordinates of a `radar`/`scan`/`ally`/`enemy` hit |
| `(sin a)`, `(cos a)`, `(atan2 dy dx)` | Fixed-point trig (lookup tables — `10-DETERMINISM.md` § 2.2) |

**Unit cheat-sheet** (full table in [`22-DECISIONS.md` D8](22-DECISIONS.md)):

| Value | Unit |
|---|---|
| `self.x/y`, `food-x/y`, `hit-x/y`, `dist`, all ranges | integer **millimetres** |
| `aim`, `scan`, `atan2` | angle unit, **65536 = 2π** (not radians) |
| `sin`, `cos` | Q16.16, **65536 = 1.0** (deliberately *not* the angle unit) |
| `move` | Q16.16 throttle, **65536 = 100 % of top speed**, clamped to ±65536 |

> **Naming rules:** identifiers may end in `?` (`some?`,
> `within-range?`). `.` is valid **only** inside the reserved `self.*`
> namespace — user identifiers may not contain `.`.

### 2.3 Types

There are exactly three types: `int`, `bool`, and `Option<T>`.

- All numbers are **integers**. `sin`/`cos`/`move` are Q16.16
  (65536 = 1.0); everything else is a plain integer.
- `Option<T>` occupies two stack slots: a tag (`0` = none, `1` = some),
  followed by the payload when the tag is `1`.
- **An `Option` is not a `bool`.** `(if (radar) …)` is a **compile
  error** — write `(if (some? (radar)) …)`. The verifier enforces this.
- The verifier inserts a bounds check before every `hit-x`/`hit-y`/
  `food-x`/`food-y` call, so payload access on `none` is unreachable.

### 2.4 Examples

**Gatherer:**
```
(defn step []
  (let [f (food)]
    (if (some? f)
        (move-at (food-x f) (food-y f))
        (move 0 0))))

(every-tick step)
```

**Hunter:**
```
(defn step []
  (let [e (radar)]
    (if (some? e)
        (do (aim (atan2 (- (hit-y e) (self.y))
                        (- (hit-x e) (self.x))))
            (if (< (dist (self.x) (self.y) (hit-x e) (hit-y e)) 30000)
                (fire)))
        (move-at 100000 100000))))

(every-tick step)
```

**Breeder:**
```
(defn step []
  (let [f (food)]
    (if (some? f)
        (move-at (food-x f) (food-y f))
        (do (eat)
            (if (>= (self.biomass) 5)
                (build 0))))))

(every-tick step)
```

> `move-at` replaced the old `(/ (- (food-x f) (self.x)) 60)` idiom,
> which had no defined units (`22-DECISIONS.md` D8). `(move 1 0)` still
> parses — `1` is Q16.16, i.e. 0.0015 % throttle, so the bot barely
> moves. That is a common beginner bug, so the editor warns when a
> `move` argument's magnitude is below 1000.

## 3. The compiler

```
text DSL ──┐
           ├──►  IR (JSON tree)  ──►  Verifier  ──►  Tree-walking VM
blocks ────┘
```

- **Lexer/parser** written by hand. Split across `program/` so no file
  breaches the 300-line cap in `AGENT.md § 5`:
  | File | Responsibility | Size |
  |---|---|---|
  | `program/tokenizer.ts` | `tokenize(src) → Token[]` with line/col | ~120 |
  | `program/errors.ts` | `CompileError` and its factories | ~40 |
  | `program/ast.ts` | AST node types (types only) | ~60 |
  | `program/parser.ts` | recursive-descent `Parser` | ~250 |
  | `program/lower.ts` | AST → IR (Phase 05) | ~150 |
  | `program/compiler.ts` | `compile(src, meta)` entry point | ~30 |
- **IR is JSON-serialisable.** Every form is an object:
  ```json
  { "op": "call", "fn": "move", "args": [ {"op":"num","v":65536}, {"op":"num","v":0} ] }
  ```
- The IR is the canonical "compiled" form. We can re-target it to
  different VMs without touching the front-end.
- **There is no bytecode stage.** The VM walks the IR tree directly
  ([`22-DECISIONS.md` D2](22-DECISIONS.md)), so the cost table in § 4 is
  a **per-IR-node** table, not an instruction table. This is what
  `20-IMPLEMENTATION-PLAN.md` Phase 06 builds, and no phase in that
  plan emits a bytecode compiler.

## 4. IR node cost table

Cycles charged per IR node — used both by the static estimator
(§ 5, rule 3) and at runtime. There is no opcode stream, so
"instruction" and "node" mean the same thing here and the word used
throughout is **node**.

| Node | Cost (cycles) |
|---|---|
| `num`, `var` (read), `bool` | 1 |
| `store` (write local) | 2 |
| `self.*` | 3 |
| `+`, `-`, `*`, `abs`, `min`, `max`, comparisons, `and`/`or`/`not` | 1–2 |
| `/`, `mod` | 3 |
| `if` | 2 (plus branches) |
| `while`, `loop` | 4 (plus body × iterations) |
| `call` user fn | 4 + nargs |
| `some?` | 3 |
| `dist`, `sin`, `cos`, `atan2` | 6 |
| `hit-x`, `hit-y`, `food-x`, `food-y` | 3 |
| `time` / `rng-int` | 1 / 4 |
| `radar` | 25 |
| `scan` | 20 |
| `food` | 18 |
| `ally`, `enemy` | 25 |
| `move`, `move-at` | 30 |
| `aim` | 20 |
| `fire` | 40 |
| `eat` | 25 |
| `build` | 50 |
| `say` | 10 |

Weapon hitscan and grenade ballistics are resolved by the match driver
(`20-IMPLEMENTATION-PLAN.md` Phase 11), not by the VM, so they carry no
DSL cost.

## 5. The verifier

Before any IR is executed, it is verified. Failures are reported to the
editor inline and the editor refuses to save (§ 10).

1. **No recursion.** All calls form a DAG. (Forth had no recursion
   either.) A test bot containing `(defn f [] (call f))` is rejected.
2. **No unbounded loops.** `while` takes a **literal** `max-iters`
   argument: `(while cond 64 body)`. A missing or non-literal bound is
   a **compile error** — there is no "declared up-front elsewhere"
   syntax and no runtime discovery path. `(loop n body)` needs a
   literal `n` for the same reason.
3. **Static cycle estimate** must be ≤ **1000** cycles/tick. The
   estimator multiplies each loop body by its literal bound and takes
   the worst branch of every `if`/`cond`.
4. **Stack depth** ≤ **64** at every program point; locals ≤ 32 per frame.
5. **Type check.** Sensor results are `Option` and must be tested with
   `some?` before their payload is read. `if`/`cond` directly on an
   `Option` is an error, not a coercion.
6. **Identifier resolution.** Every `call` resolves to a user `defn` or
   a builtin. Unknown names are compile errors, not runtime traps.
7. **Payload bounds.** `hit-x`/`hit-y`/`food-x`/`food-y` are only
   reachable on a `some?`-true branch.
8. **Exactly one entry point.** Exactly one `(every-tick name)` per
   program, and `name` must resolve to a `defn` taking zero arguments.
9. **Part preconditions** are *warnings*, not errors: `fire` without a
   weapon, `build` without a Constructor, `build` of a design the robot
   has no Constructor for. A bot is validated independently of the
   chassis it will run on, so these cannot be hard errors.

## 6. The VM (the actual sandbox)

The VM is a **pure TypeScript state machine** with NO outside
dependencies. It is split so that each piece is independently testable
and no file breaches the 300-line cap (`AGENT.md § 5`):

| File | Responsibility | Size |
|---|---|---|
| `execution/frame.ts` | value stack + locals, the 64 / 32 caps | ~120 |
| `execution/interpreter.ts` | the tree walk; charges the § 4 costs | ~200 |
| `execution/builtins.ts` | the IR-node dispatch table | ~150 |
| `execution/vm.ts` | `runVm(env, ir)`: budget, abandon-the-tick, events | ~120 |

**The builtins are not in `execution/`.** A sensor builtin is the
public surface of the `perception` context and an actuator builtin is
the public surface of `actuation`; `execution/builtins.ts` only
*dispatches* to them. That is what keeps the VM ignorant of what a
`radar` or a `move` means (`AGENT.md § 6`, G7). The context tree is
in `06-ARCHITECTURE.md § 2`.

The VM as a whole is:

- **Tree-walking** over the IR, charging the per-node cycle cost from § 4.
- **Cycle-counted:** the budget starts at 1000 each tick. Hitting 0
  mid-node **abandons the tick** — every actuator this robot queued is
  discarded, the robot does nothing, and a `vm_yield` event with
  `reason: "budget"` is emitted. There is no partial carry-over and no
  auto-throttle ([`22-DECISIONS.md` D4](22-DECISIONS.md)). Because § 5,
  rule 3 rejects anything over budget statically, a runtime yield means
  the static estimator has a gap: log it and file it.
- **Memory-bounded:** the data stack is capped at 64 entries.
- **Deterministic:** no floating point. World state is Q16.16 metres,
  DSL lengths are integer millimetres, angles are 65536 = 2π
  ([`22-DECISIONS.md` D1](22-DECISIONS.md)).
- **Pure:** the VM is a function
  `(state, ir, env) -> { state', actuators, events }`. No I/O.
  No `Date.now`. No `Math.random`.
- **RNG-scoped:** `rng-int` reads only that robot's own stream, which is
  advanced only by that robot's instructions. A bot's random sequence
  cannot be perturbed by other robots or by world events
  ([`22-DECISIONS.md` D5](22-DECISIONS.md)).

## 7. The visual editor

Built with **Blockly** (Google's MIT-licensed block library). Each
Blockly block maps 1:1 to an IR node. Text and blocks are two views of
one IR:

- **blocks → IR** is a structural walk and is lossless.
- **IR → blocks** is defined for every node the block set covers.
- **text → IR → blocks → IR** must be byte-identical, and is a CI test
  run over every file in `spec-kit/examples/`.
- Anything the block set cannot represent (e.g. a hand-written `while`
  with an unusual bound) is **read-only in blocks** and shows a banner
  saying so. The editor never silently rewrites a program.

```
┌──────────────────┬───────────────────────────────┐
│  Block palette   │   Workspace (drag blocks)     │
│  ─ Sensors       │                               │
│  ─ Actuators     │   [Every tick]                │
│  ─ Logic         │     [If] [Radar → ?some?]      │
│  ─ Math          │         [Aim] [Fire]          │
│  ─ Functions     │     [Else]                    │
│                  │         [Move-at x y]         │
└──────────────────┴───────────────────────────────┘
```

The "Text" tab shows the DSL source live.

## 8. Why not just allow JavaScript / Lua / Python?

| Option | Why not |
|---|---|
| JavaScript (V8 isolate) | Floating-point determinism is hard; isolates still cost 10–30 MB each. |
| Lua (LuaJIT) | Faster, but exploits in sandboxed Lua are known. |
| Python | Slow startup, harder to enforce cycle budgets. |
| WebAssembly | Heavyweight; too low-level for an audience of non-CS players. |
| **Our DSL → IR → tree-walking VM** | Tiny, fast (≈ 1 µs per cycle per bot), auditable, portable. |

## 9. Performance budget

- **Per robot per tick:** ≤ 1000 cycles.
- **Per cycle:** ≈ 1 µs in our VM.
- **Worst case:** 12 robots (6 per side — `04-GAME-DESIGN.md` § 6)
  × 1000 cycles × 1500 ticks = 18 M cycles.
- At ~1 µs each that is **≈ 18 s per match on a single core**. That is
  the **ceiling**, not the expectation: typical bots run 200–400
  cycles/tick, which puts a real match at **3–6 s**.
- **SLA:** replay ready within 30 s (p95). Editor preview (300 ticks)
  within 3 s.
- The canonical table of every timing number in the spec kit is
  [`22-DECISIONS.md` D9](22-DECISIONS.md). No other doc may state one.

## 10. The "rejected bot" UX

If your bot fails verification, the editor shows the error inline
(`line 7: 'radar' returns Option — test it with some? first`) and
refuses to save. Friendly, immediate feedback. No silent failures, and
no silent downgrade to a "simpler" program.
