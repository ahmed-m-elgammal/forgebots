# 03 — From predecessor language to ForgeBots

The bridge document. Takes what we learned from studying the
predecessor game and states, requirement-first, what ForgeBots does
about each thing.

**This is the file that makes the study clean-room-compatible.** Every
decision below is argued from a requirement, not from "the original
does it this way". Where we reject something, there is a reason we
could give without the original in the room.

---

## 1. The postfix decision

**Requirement.** The audience is children learning to program, and
adults learning a game. The language must be readable at a glance by
someone who has never seen a stack.

**What the predecessor does.** Postfix notation over an invisible
stack of unnamed numbers. The operator follows its operands. You must
maintain a mental picture of the pile, and almost everything
interesting requires juggling words like `rot`, `tuck` and `-rot`.

**What we do.** Prefix notation over *named* values, in a Lisp-like
sibling syntax: `(move 65536 0)`, `(if (some? (radar)) (fire) (move 0 0))`.

**Why.**

1. The predecessor's own difficulty curve is the evidence. Its
   material is learnable in an afternoon up to vectors; the
   stack-manipulation tricks are where people stop. We want the
   stopping point to be *strategy*, not *notation*.
2. Named locals via `let` replace the fixed scratch area that
   `store`/`load` provide. A beginner cannot silently corrupt memory
   they cannot see.
3. `if` reads as a sentence. A child can guess what
   `(if <this> <that> <otherwise>)` means without being taught.

**What we keep.** The *consequences* of a stack machine that are
genuinely good:

| Predecessor idea | Where it lives in ForgeBots |
|---|---|
| Vectors as a first-class value — `dist`, `angle`, `unitize` | `(dist …)`, `(move-at x y)`, `atan2` — see `22-DECISIONS.md D8` |
| Angles are wrapped quantities, and wrapping is an operation | `angle.ts: wrap`, 65536 = 2π |
| You can query your own stack depth to defend against overflow | `(self.energy)` and the static cycle estimator, which is strictly better: the bound is known before the program runs |
| `sync` — "finish the frame's hardware work, then continue" | The match driver's two-phase tick: actuate, then resolve. `06-ARCHITECTURE.md § 4.1` |

**What we reject.** Postfix. Implicit unnamed temporaries. Compile-time
macros as the *only* way to get an `if`/`else`. The middle-of-loop
test. `ife` as an expression — conditional value selection is the
single least readable construct in the predecessor language.

---

## 2. Factual corrections to our own research

Studying the actual language reference turned up two things
`01-RESEARCH.md` got wrong. Both are corrections of fact, not
opinion.

### 2.1 Grobocode **did** support recursion

`01-RESEARCH.md § 1.2` states: *"No recursion (Forth-style), no dynamic
allocation."*

The published language reference demonstrates a recursive word
directly. Recursion is supported.

**Does this change our design?** No — and it should not. Our verifier
rejects recursion (`09 § 5` rule 1) because a cycle-budgeted sandbox
has no good reason to permit a call graph that can revisit a node, and
"all calls form a DAG" is a rule we can actually verify. But the
*claim about the predecessor* was wrong, and it was being used to
support the decision. A decision supported by a false premise is not a
decision, so the premise had to go.

**Action:** fix the sentence in `01-RESEARCH.md`, and re-justify the
verifier rule on its own merits rather than on tradition.

### 2.2 Grobocode's numeric format

32-bit fixed-point, 12 fractional bits: range about ±524,288, precision
1/4096. So the original had roughly **19 integer bits of range** — more
absolute range than our Q16.16, and less precision.

**Does this change our design?** No. Their arena was large enough to
need the range; ours is 200 m and Q16.16 gives ±32,767 m, which is
160× headroom (`22-DECISIONS.md D1`). The lesson is the opposite of
"copy their split" — it is that **the split must be chosen against
your own world bounds**, and the predecessor's bound is why theirs
differs from ours. Worth recording so nobody "corrects" our format to
match theirs later.

### 2.3 Their hardware words are on a different page

The language reference explicitly defers parts to a hardware page we
did not read. We do not need it: our catalog in `04-GAME-DESIGN.md
§ 3.2` is our own design and is not derived from theirs. Noted here so
the omission is deliberate and recorded rather than a gap.

---

## 3. Concept-by-concept

| Predecessor concept | ForgeBots | Status |
|---|---|---|
| Postfix over a data stack | Prefix over named values | **Rejected** — § 1 |
| One fixed-point type, 12 fractional bits | Q16.16 metres internally; integer millimetres at every surface | **Adopted, different** — `22 D1` |
| Hardware words on a separate page | 16 parts in one catalog, one sign convention | **Redesigned** — `04 § 3.2` |
| Sensors gated by fitted parts | Same, plus `food()` needing no part | **Kept, refined** — `22 D16` |
| `sync` for hardware timing | Two-phase tick: actuate, then resolve | **Kept in spirit** |
| Local memory via `store`/`load` | `let` bindings, 32 per frame | **Replaced** |
| Recursion | Forbidden by the verifier | **Rejected, now justified on its own merits** — § 2.1 |
| Randomness not obviously seedable | Two named streams, seed in the match row, per-robot derivation | **Improved** — `22 D5` |
| Shields as pure absorption | Shield pool drained before hull | **Kept, made legible** — `22 D7` |
| No sandbox cycle budget in the language | Static estimate + runtime abandon-the-tick | **New** — `22 D4` |
| `print`/`beep` debug words | Replay events, `vm_yield`, server-side verifier errors | **Replaced** — better for async play, where nobody is watching |

---

## 4. Things the predecessor has that we do not

Stated plainly, because a study that only finds things to copy has not
been done honestly.

| Missing from ForgeBots | Why it matters | Status |
|---|---|---|
| **Cooperation** — `say`, `ally()` exist; nothing uses them | Food sharing was the highest-leverage upgrade in the whole archive | **Open, high value.** Blocked on the language gap in `19 § 6` — a child inherits the parent's program, so children cannot have roles |
| **Friendly fire undefined** | Grouping is the strongest late-game play and it costs splash hits | **Open, blocking.** Recommendation in `02 § 6` |
| **Role-specialised children** | Swarm-with-roles is the strongest archetype and we cannot express it | **Open.** A DSL change: `build` needs to take a program reference, not a design index |
| **Biomass theft** | A reported effective attack | Open, medium |
| **Shields as a food scoop** | A reported effective utility | Open, small |
| **Forced short matches** | Their events were 2–5 minutes; ours are 25 s | Under review — see `02 § 5` on late-game importance |
| **Multiple sides in one arena** (up to ten) | Their tournaments were ten-way | **Deliberately out of scope.** `04 § 6` is 1v1 for MVP balance and match duration. A 10-way tournament is a v0.2 mode with a data model we have not specced (`22 D18`) |

That last one is the biggest gap between the two games and it is a
deliberate product decision, not an oversight: their ten-sided matches
are the reason their tournaments are interesting to *watch*, and they
are also why their sides are enormously more complex than anything
sensible for a 25-second mobile match.

---

## 5. The single most important open question this study raised

Not a language question. A **match-shape** question.

The archive's clearest measured finding is that **late-game death rate
predicted tournament score better than any other statistic**, and that
players repeatedly discovered counters to whatever was winning. Both
facts depend on matches lasting long enough for a late game to exist.

Our matches are 1500 ticks — 25 seconds — with 400 biomass cells and up
to 6 robots per side. **It is entirely possible that most of our
matches never reach a late game at all**, in which case the entire
meta that the predecessor spent seven years developing does not exist
in our game, and the strategic depth we are selling does not either.

This is cheap to test and should be the first thing measured once
`arena/` and `match/` exist. See `02-strategy-catalogue.md § 5`,
requirement 2.

If it comes out that way, the fix is in geometry, not in the language:
fewer biomass cells, or a smaller arena, or a shorter tick cap. All
three are `balance_versions` edits, which is why the schema work in
`07-DATA-MODEL.md § 2.3` matters more than it looks.

---

## 6. How to keep using this folder

1. **Do not paste from the original sources into this repo.** See
   `README.md` here for the reasoning and the authority.
2. **When you add a strategy requirement, add it to
   `02-strategy-catalogue.md § 6`** so the backlog stays in one place.
3. **When you make a language decision, cite the requirement, not the
   predecessor.** If the only justification is "Grobots did it", the
   decision is not clean-room-safe and should be re-argued.
4. **When you change a number in `04` or `09`, check whether this
   study suggests a consequence you have not carried through.** § 5 is
   the live example.
