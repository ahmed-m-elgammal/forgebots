# 09 — The ForgeBots AI DSL & Sandbox

## 1. Design goals

1. **Safe** — no raw user code on the server.
2. **Deterministic** — same input → same output on every platform.
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
    (if target
        (do (aim (atan2 (- (hit-y target) (self.y))
                        (- (hit-x target) (self.x))))
            (fire))
        (move 1 0))))

(every-tick scout)
```

Why Lisp-like (not Forth-like Grobots)? It composes better, parses
unambiguously, and is the most-taught non-mainstream syntax — students
pick it up in a weekend. Grobots' Forth was delightful but niche.

### 2.2 Reserved forms

| Form | Purpose |
|---|---|
| `(let [name expr]* body)` | Bind locals |
| `(if cond then else?)` | Branch |
| `(do expr*)` | Sequence |
| `(while cond body)` | Loop with cycle budget (verifier requires a declared max-iteration count — see § 5) |
| `(loop n body)` | Bounded loop |
| `(defn name [args] body)` | Define function |
| `(call fn args*)` | Call user fn |
| `(every-tick fn)` | Program entry point; calls `fn` once per tick |
| `cond`, `when`, `not`, `and`, `or` | Booleans |
| `+`, `-`, `*`, `/`, `mod`, `abs`, `min`, `max` | Math |
| `<`, `<=`, `>`, `>=`, `==`, `!=` | Compare |
| `radar`, `scan angle`, `food`, `ally`, `enemy` | Sensors |
| `self.x`, `self.y`, `self.hp`, `self.energy`, `self.biomass`, `self.alive` | Self state |
| `move vx vy`, `aim angle`, `fire`, `eat`, `build type`, `say ch v` | Actuators |
| `time`, `tick`, `rng-int n` | Time & RNG |
| `some? opt` | True if an Option sensor result is present |
| `dist x1 y1 x2 y2` | Fixed-point distance between two points |
| `food-x f`, `food-y f` | Coordinates of a `food` result |
| `hit-x h`, `hit-y h` | Coordinates of a `radar`/`scan`/`ally`/`enemy` hit |
| `sin a`, `cos a`, `atan2 dy dx` | Fixed-point trig (lookup tables — see `10-DETERMINISM.md` § 2.2) |

> **Parser note:** brackets and parentheses are interchangeable, so
> `let` accepts both `(let [x 5] body)` and the wrapping-paren style
> `(let ((x 5)) body)` used by the starter bots (`19-STARTER-BOTS-AND-LIBRARY.md`
> § 2).

### 2.3 Examples

**Gatherer:**
```
(defn step []
  (let [f (food)]
    (if f
        (move (/ (- (food-x f) (self.x)) 60)
              (/ (- (food-y f) (self.y)) 60))
        (move 0 0)))
(every-tick step)
```

**Hunter:**
```
(defn step []
  (let [e (enemy)]
    (if e
        (do (aim (atan2 (- (hit-y e) (self.y))
                        (- (hit-x e) (self.x))))
            (if (< (dist (self.x) (self.y) (hit-x e) (hit-y e)) 30000)
                (fire)))
        (move 1 0)))
(every-tick step)
```

**Breeder:**
```
(defn step []
  (let [f (food)]
    (if f
        (move (/ (- (food-x f) (self.x)) 60)
              (/ (- (food-y f) (self.y)) 60))
        (do (eat)
            (if (>= (self.biomass) 5) (build 0)))))
(every-tick step)
```

## 3. The compiler

```
text DSL ──┐
           ├──►  IR (JSON tree)  ──►  Verifier  ──►  Bytecode  ──►  VM
blocks ────┘
```

- **Lexer/parser** written by hand. ~300 LOC.
- **IR is JSON-serialisable.** Every form is an object:
  ```json
  { "op": "call", "fn": "move", "args": [ {"op":"num","v":0.5}, {"op":"num","v":0} ] }
  ```
- The IR is the canonical "compiled" form. We can re-target it to
  different VMs without touching the front-end.

## 4. The bytecode

A small stack-based bytecode (32 instructions in MVP). Example ops:

| Opcode | Stack effect | Cost (cycles) |
|---|---|---|
| `PUSH_NUM n` | -- n | 1 |
| `PUSH_VAR n` | -- v | 2 |
| `STORE_VAR n` | v -- | 2 |
| `ADD` | a b -- (a+b) | 1 |
| `SUB`, `MUL`, `DIV`, `MOD` | a b -- r | 1–3 |
| `JMP_IF_FALSE off` | c -- | 2 |
| `CALL nargs` | args... -- ret | 4 + nargs |
| `RET` | -- | 2 |
| `SELF hp` | -- hp | 3 |
| `SELF x` | -- x | 3 |
| `RADAR` | -- ?hit | 25 |
| `SCAN a` | a -- ?hit | 20 |
| `FOOD` | -- ?pos | 18 |
| `MOVE vx vy` | vx vy -- | 30 |
| `AIM a` | a -- | 20 |
| `FIRE` | -- bool | 40 |
| `EAT` | -- bool | 25 |
| `BUILD t` | t -- bool | 50 |
| `SAY c v` | c v -- | 10 |
| `TIME` | -- t | 1 |
| `RNG n` | n -- r | 4 |
| `HALT` | -- | 0 |

## 5. The verifier

Before any IR is executed, it is verified:

1. **No recursion.** All calls form a DAG. (Forth had no recursion either.)
2. **No unbounded loops.** `while` requires a max-iteration count
   declared up-front; we reject programs without one.
3. **Cycle budget check.** Static estimate of worst-case cycles/tick
   must be ≤ 1000. If higher, reject.
4. **Stack depth.** Max stack depth ≤ 64.
5. **Type check.** All `radar`/`food`/`enemy` results are `Option`;
   must be unwrapped before use.
6. **Identifier resolution.** All `call`s resolve to user fn or built-in.

## 6. The VM (the actual sandbox)

The VM is a **pure TypeScript state machine**, ~400 LOC, with NO
outside dependencies. It is:

- **Cycle-counted:** every instruction costs cycles; the VM decrements
  a budget each tick. If the budget hits 0 mid-instruction, the VM
  suspends for that tick (yielded state is discarded).
- **Memory-bounded:** the data stack is capped at 64 entries.
- **Deterministic:** floats are converted to int (fixed-point Q16.16)
  for all arithmetic in user-visible state. RNG is the seed-per-bot.
- **Pure:** the VM is a function `(state, ir, env) -> {state', events}`.
  No I/O. No `Date.now`. No `Math.random`.

## 7. The visual editor

Built with **Blockly** (Google's MIT-licensed block library). Each
Blockly block has a 1:1 mapping to a DSL form. The DSL source view is
generated *from* blocks and vice versa — power users can switch modes
without losing work.

```
┌──────────────────┬───────────────────────────────┐
│  Block palette   │   Workspace (drag blocks)     │
│  ─ Sensors       │                               │
│  ─ Actuators     │   [Every tick]                │
│  ─ Logic         │     [If] [Radar → ?]          │
│  ─ Math          │         [Aim] [Fire]          │
│  ─ Functions     │     [Else]                    │
│                  │         [Move 1 0]            │
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
| **Our DSL → IR → bytecode** | Tiny, fast (1 ms per tick per bot), auditable, portable. |

## 9. Performance budget

- **Per bot per tick:** ≤ 1000 cycles.
- **Per bot cycle cost:** ≈ 1 µs in our VM.
- **Worst case:** 12 bots (6 per side — see `04-GAME-DESIGN.md` § 6)
  × 1000 cycles × 1500 ticks = 18 M cycles total.
- At ~1 µs each, that's **~18 s per match** on a single core — within
  our 30 s match SLA (`12-MVP-ROADMAP.md` § 4), though worst-case
  matches will cross the >5 s autoscale threshold in `05-TECH-STACK.md` § 5.

## 10. The "rejected bot" UX

If your bot fails verification, the editor shows the error inline
("line 7: 'radar' returns Option, must check before use") and refuses
to save. Friendly, immediate feedback. No silent failures.
