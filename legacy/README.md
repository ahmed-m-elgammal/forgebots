# `legacy/` — reference notes on the predecessor game

This folder is **research notes written from scratch**, not scraped
material. Nothing here is copied from Grobots.

## What this folder is for

ForgeBots is a new DSL, a new hardware catalog and a new simulation.
Before designing them, somebody has to understand what the predecessor
game's language could and could not do, and what strategies actually
win. That understanding is the input to our design. This folder is
where it lives.

| File | Contents |
|---|---|
| `01-grobocode-language-reference.md` | Every word and form of the predecessor language, explained in plain English, in a teaching order that works for a beginner. Our own prose. |
| `02-strategy-catalogue.md` | The competitive archetypes, mined from published tournament results and the authors' own commentary. Described as decision logic, not code. |
| `03-forgebots-design-translation.md` | The bridge: what each predecessor concept became in ForgeBots, what we rejected, and why. This is the file that matters most. |

## Licensing position

**Grobots is GPL.** The language reference, the tutorials, the example
sides and the tournament pages all ship with it.

| Action | Status | Authority |
|---|---|---|
| Reading the public documentation to learn mechanics | **Allowed** | `02-LICENSING.md § 3` — "Gameplay mechanics… are not copyrightable" |
| Learning that a sensor has a range and a refresh rate | **Allowed** | same |
| Learning which strategies won tournaments | **Allowed** | facts and ideas |
| Copying the reference text into this repo | **Refused** | GPL expression, `02 § 4.1` |
| Copying tournament `.gb` sides into this repo | **Refused** | `02 § 4.1` names this case explicitly |
| Writing our own description of a language's behaviour | **Allowed** | documenting an interface is not copying an implementation |

**Clean-room discipline.** The rule this repo follows, from
`02 § 5`, is that the implementation team does not work from the
original's expression. That is why these notes are written as
*descriptions of behaviour* with no sample programs from the original
in them, and why every design choice in `03` is argued from
requirements rather than from the predecessor's code.

**If you want to study the originals directly, do it outside this
working tree.** Clone or download into a scratch directory elsewhere
on your machine. Keep it out of the repository, keep it out of your
editor's workspace for this project, and do not paste from it. What
you learn about *mechanics* belongs in `01` and `02` — in your own
words.

## Source material consulted

- `https://grobots.sourceforge.net/docs/language.html` — the language
  reference
- `https://grobots.sourceforge.net/tournaments.html` — tournament
  results and commentary

Only these two pages were read. The hardware reference page, which
lists the per-part words, was not available and is **not** covered
here; the parts we care about are already in our own
`04-GAME-DESIGN.md § 3.2`.

## A note on the tournament data

`02-strategy-catalogue.md` describes strategies, not rankings. The
specific scores, side names and authors are the tournament organisers'
published results — we do not reproduce those tables, because the
value is in the *patterns*, and the patterns are what we design
against.
