# 01 — The predecessor language, described

A plain-English reference to **Grobocode**, the stack language the
original Grobots robots were written in. Written from scratch as
teaching material. Nothing here is quoted from the original
documentation.

Read this if you want to understand *why* ForgeBots' language looks
the way it does, and what a stack language costs you.

---

## 1. The one idea everything follows from

**There is one pile of numbers. Words take numbers off the top of the
pile and put results back.**

You push values, then you say what to do with them. The operator comes
**after** its inputs. This is called *postfix* notation.

The normal way you'd write a compound-interest calculation:

```
total = principal * (1 + rate / 100) ^ years
```

The same thing in a stack language — read left to right, each word
acting on whatever is on top. With `principal = 1000`, `rate = 5`,
`years = 3`:

```
1000        push 1000
5           push the value of rate
100         push 100
/           pop 100, pop 5, push 5/100        → 0.05
1           push 1
+           pop 1, pop 0.05, push their sum  → 1.05
3           push the value of years
exponent    pop 3, pop 1.05, push 1.05^3     → 1.157625
*           pop that, pop 1000, push product  → 1157.625
total!      pop it, store in the variable called total
```

**Read that again and notice something.** In the conventional form you
had to hold three nested parentheses in your head. In the stack form
you never nest anything — the structure is implied by the order the
words arrive in, and there is nothing to keep balanced. That is the
language's real argument, and it is a good argument.

**Why a beginner finds this strange:** you have to keep a running
mental picture of the pile. There is no punctuation and there are no
brackets. After a few lines of tracing, it stops being strange and
starts being fast — there is no parsing, no variable-lookup machinery,
and it maps almost one-to-one onto what the machine actually does.

**Why we did not keep it:** see `03-forgebots-design-translation.md`
§ 1. Short version: for a game whose audience is children learning to
program, an invisible pile of unnamed numbers is the single most
hostile thing you can put in front of someone.

---

## 2. How the machine works

**Two stacks.**

- The **data stack** holds working values. This is the one you think
  about.
- The **return stack** holds only where-to-jump-when-a-function-ends.
  You rarely touch it directly.

**One number type.** There is no text, no list, no object. Every value
is a **32-bit fixed-point number with 12 fractional bits**:

| Property | Value |
|---|---|
| Range | about ±524,288 |
| Precision | 1/4096 ≈ 0.00024 |

Two consequences worth internalising:

- **You cannot tell an integer from a small fraction.** `5` and
  `5.000244` are the same value at this precision. There is no type
  error for mixing them, because there is only one type.
- **Division has a defined failure.** Dividing by zero saturates
  rather than exploding.

**Hardware words are separate.** The words that read sensors and drive
parts live on a different page of the original documentation. We have
not reproduced them, and we do not need to: our own hardware catalog
in `04-GAME-DESIGN.md § 3.2` is the source of truth for ForgeBots.

---

## 3. Syntax in one table

Whitespace separates words. A few suffixes change what a word means.

| Suffix | Meaning |
|---|---|
| *(none)* | Call this primitive, or read this variable |
| `!` | **Write** to this variable |
| `&` | Read a label's memory address |
| `^` | Call the code at a label |
| `label:` | Declare a label |

A semicolon starts a comment that runs to the end of the line.

Variables, vectors and constants are declared **outside the language**
using reader tags at the top of the file — `#var`, `#vector`,
`#const`. This is a real wart: the language proper has no `let`, so
all state must be known before the program starts.

---

## 4. The words, grouped

### 4.1 Pile manipulation

The "pile" is the data stack. These words move things around on it.

| Word | Plain English |
|---|---|
| `drop` | Throw away the top value |
| `2drop` | Throw away the top two |
| `nip` | Throw away the second-from-top |
| `dup` | Copy the top value so there are two |
| `2dup` | Copy the top two |
| `over` | Copy the second-from-top to the top |
| `2over` | Copy the second pair to the top |
| `tuck` | Copy the top underneath the second |
| `swap` | Exchange the top two |
| `2swap` | Exchange the top two pairs |
| `rot` | Rotate the top three |
| `-rot` | Rotate the top three the other way |
| `pick` | Copy the *n*th value to the top |
| `stack` | How many values are on the pile right now |
| `stack-limit` | The most that will ever fit |

`stack` and `stack-limit` exist so a program can defend itself before
it overflows. Overflow is one of the two classic beginner failures.

### 4.2 Jumping around

| Word | Plain English |
|---|---|
| `jump` | Continue from here |
| `call` | Remember where I was, continue from here |
| `return` | Go back to where I was called from |
| `if` | If the top value is non-zero, jump here |
| `nif` | If the top value is zero, jump here |
| `ife` | Choose between two places depending on the top value |
| `ifc` / `nifc` | The same, but remembering where to come back to |
| `ifr` / `nifr` | Return early, or don't |

Note that `if` **consumes** the flag it tests. If you want to use the
value afterwards you must `dup` it first. This is the single most
common source of confusion for newcomers.

### 4.3 Arithmetic

| Word | Plain English |
|---|---|
| `+` `-` `*` `/` | The usual four |
| `negate` | Flip the sign |
| `reciprocal` | One divided by it |
| `mod` | Remainder |
| `rem` | Remainder, signed to match the inputs |
| `square` `sqrt` | Squared, square root |
| `exponent` | Raise to a power |
| `floor` `ceiling` `round` | The obvious three |
| `min` `max` | Smaller, larger |
| `abs` `signum` | Magnitude; and −1 / 0 / 1 |
| `sin` `cos` `tan` | Trig, in radians |
| `arcsin` `arccos` `arctan` | Inverse trig |
| `arctan2` | Angle of a vector, given two components |
| `reorient` | Normalise any angle into (−π, π] |

`reorient` is a genuinely good idea that we kept in spirit: angles are
a wrapped quantity, and wrapping them is a real operation rather than
something you handle inline.

### 4.4 Working with pairs as points

This is where the language gets pleasant. Instead of writing `x1 x2
- y1 y2 - dist`, you can treat two stacked numbers as a **vector** and
use a named operation.

| Word | Plain English |
|---|---|
| `v+` `v-` | Add, subtract two points |
| `vnegate` | Reverse a direction |
| `vs*` `vs/` | Scale a point by a number |
| `norm` | Length of a point |
| `angle` | Direction of a point |
| `dist` | Distance between two points |
| `in-range` | Are these two points closer than *r*? |
| `unitize` | Same direction, length exactly 1 |
| `dot` | Dot product of two vectors |
| `cross` | The 2D cross product (roughly "which way is B from A") |
| `project` | Where does the first vector land if you flatten it onto the second |
| `rect-to-polar` / `polar-to-rect` | Convert between (x, y) and (length, angle) |

**This is the strongest idea in the predecessor language** and we
copied the *concept* directly. `dist`, `in-range` and `unitize` are
exactly what a robot programmer reaches for constantly, and having
them be single words rather than four-token incantations is a large
usability win.

### 4.5 Comparing and combining yes/no answers

| Word | Plain English |
|---|---|
| `=` `<>` `<` `>` `<=` `>=` | The six comparisons, yielding 1 or 0 |
| `not` | Flip a true/false |
| `and` `or` `xor` | Combine two true/false values |
| `nand` `nor` | The negations |
| `ife` | **Value** conditional: return one value or the other |

`ife` deserves a note: it is an expression, not a jump. `flag a b ife`
leaves either `a` or `b` on the pile. That is the idiom behind most
compact code in the language, and it is genuinely hard to read.

### 4.6 Randomness

| Word | Plain English |
|---|---|
| `random` | A random number between two bounds |
| `random-int` | A random whole number between two bounds |
| `random-angle` | A random direction |
| `random-bool` | True with a given probability |

Note that randomness here is **not obviously seeded** from a player's
control. For a competitive async game that is a problem, and it is one
of the reasons our design makes the seed explicit and per-robot
(`22-DECISIONS.md D5`).

### 4.7 Scratch space and debugging

| Word | Plain English |
|---|---|
| `store` / `load` | Save a value to, read it from, local memory |
| `vstore` / `vload` | The same for a pair |
| `print` / `vprint` | Pop and display a value |
| `beep` | Make a noise |
| `pause` | Freeze the simulation |
| `step` | Advance one frame |
| `stop` | Kill this brain permanently |
| `sync` | Wait for the next frame |
| `nop` | Do nothing — used as padding in jump tables |

`store`/`load` matter: the language has a fixed, small memory area, so
this is how a program holds state across ticks. Our DSL has named
locals via `let` instead, which is easier to read and harder to
accidentally corrupt.

`sync` is a subtle and important word. It says *"let the rest of this
frame's work happen, then carry on."* Without it, a robot that starts
an engine and immediately reads its speed reads a stale value. This is
the low-level equivalent of our actuator-then-physics ordering
(`06-ARCHITECTURE.md § 4.1`).

---

## 5. Control structures

The language has almost no control structure of its own — just `if`
and `call`/`return` — so **compile-time macros** build the rest. A
macro expands into jumps at load time. This is the Forth tradition
taken to its logical end.

| You write | You get |
|---|---|
| `test if body then` | Run `body` if `test` is true |
| `test if a else b then` | One branch or the other |
| `nif ...` | `if` with the sense reversed |
| `test1 if test2 and-if a else b then` | Chained conditionals without nesting `then`s |
| `test1 if a else test2 if b else test3 if c else d then` | if / else-if / else-if / else |
| `do body repeat` | Forever |
| `do test while body loop` | Loop while true; **the test is in the middle** |
| `do test until body loop` | Loop until true; test also in the middle |
| `do body test while-loop` | The same loop, one instruction cheaper |
| `do body test until-loop` | Likewise |

Two things to notice, because they are the interesting part:

**The test sits in the middle of the loop.** `do test while body loop`
expands to something like: run `test`; if true, jump to the end;
otherwise run `body` and go back. This is not an accident — it lets
the loop share one exit point and saves an instruction. It also means
the body cannot be the first thing you see when reading the loop, and
the *n*-th iteration evaluates the test before the *n*-th body. Both
surprise people.

**`while-loop` and `until-loop` exist purely as an optimisation** over
the plain forms. Two nearly identical constructs for the same thing is
a maintenance cost paid for a small instruction saving.

---

## 6. The two classic failures

Worth teaching up front, because they are the whole debugging experience
of a beginner here.

**Underflow.** You asked for a value that was not there. `2 +` will
usually do this — `+` needs two, there is one. You get an error and
the brain stops for that frame.

**Overflow.** You left values on the pile that nothing consumed. They
accumulate every tick until the interpreter gives up.

Both are silent-ish failures that happen *far* from the code that
caused them, which is why `stack` and `stack-limit` exist as ordinary
words you can query. It is a good design decision that the language
lets you ask.

---

## 7. What a beginner actually has to learn, in order

If you were writing a teaching curriculum from this language, this is
the order that works:

1. Push a number. Print it. (`1 2 print`)
2. Two numbers and an operator. Watch the pile. (`1 2 + print`)
3. `dup` and `swap`, because you cannot do anything without them.
4. Variables, and `!` to write them.
5. `if … then`, and the fact that the flag is consumed.
6. `defn` / `call` / `return` — naming a chunk.
7. Vectors: `dist`, `angle`, `unitize`. This is where it clicks.
8. Loops, and the middle-of-loop test.
9. Hardware words, on the page we did not read.
10. Only now: the stack tricks. `rot`, `tuck`, `-rot`, `ife`.

Steps 1–7 are learnable in an afternoon. Step 10 is where most people
quit. **That distribution is the single most important design lesson
we took from this language**, and it is written up in
`03-forgebots-design-translation.md` § 1.

---

## 8. What this reference deliberately omits

- **Per-part hardware words.** Different page; not needed, because
  ForgeBots has its own catalog.
- **Any sample program from the original documentation.** See
  `README.md` in this folder for why.
- **Performance characteristics.** The original does not publish them
  and we have no measurements, so we would be guessing.
