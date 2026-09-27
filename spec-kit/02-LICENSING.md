# 02 — Licensing Analysis

## 1. What is Grobots licensed under?

**Grobots** is **free software under the GNU General Public License, version 2
(or later at the authors' discretion)**. The SourceForge project page and
project homepage both say "free software licensed under the GPL".

The project ships:

- **C++ sources** for macOS, Windows, and Linux headless.
- **Java port** by Mike Anderson (2014), described as compatible with the
  C++ version.
- **Side example files** (`.gb` files) and **documentation**.

The original authors are **Devon Schudy** and **Warren Schudy**.

## 2. What the GPL actually requires

From the GNU GPL FAQ (gnu.org/licenses/gpl-faq.html):

- You may copy and distribute the source **verbatim**, but the copyright
  notice and the license must travel with it.
- You may modify and distribute **derivative works** *only if* the entire
  combined work is also distributed under the GPL.
- "**You cannot incorporate GPL-covered software in a proprietary system.**
  The goal of the GPL is to grant everyone the freedom to copy, redistribute,
  understand, and modify a program."
- If you distribute binaries, you must also distribute the corresponding
  source — there is no way around this when you give someone the binary.

The "**combined work**" rule is the trap: if we *link* Grobots code (even a
single file) into ForgeBots, our entire project becomes a derivative work
and must be GPL'd. That means **no proprietary mobile release on iOS or
Android**, no App Store exclusivity, no closed-source server.

## 3. What we *can* reuse without contamination

We can read, study, and discuss Grobots freely. Specifically we can:

| Asset | Status |
|---|---|
| **Reading the source for design ideas** | Allowed. Ideas (gameplay mechanics, hardware catalog, sensor behaviors) are not copyrightable. |
| **Side-file format (`.gb`) documentation** | Mechanics are not copyrightable. We use a different format (`.fb`). |
| **Game mechanics** (reproduction, biomass, sensors) | Not copyrightable — these are methods/systems. |
| **The word list ("radar", "scan", "fire", etc.)** | English words — not copyrightable. We use our own vocabulary anyway. |
| **The original code itself** | ❌ Cannot reuse without forcing GPL on the entire ForgeBots codebase. |
| **The original artwork / icons / fonts** | ❌ Cannot reuse; we ship our own. |
| **The name "Grobots"** | ❌ Trademark/copyright; we use ForgeBots. |
| **Tutorial side files (e.g. "I Wanderer", "ISI")** | These are *user-contributed* `.gb` files. Most are under GPL; we do not redistribute them. |

## 4. Clean-room strategy

To stay safe we follow a **clean-room** approach:

1. **No GPL code is checked into this repository.** This includes the
   Grobots C++ source, the Java port source, and any `.gb` example side
   files.
2. **Design notes in this spec kit** describe *what* the mechanics are, not
   *how* they are implemented in the original code. The implementation in
   `/simulator/` is written from scratch in TypeScript.
3. **The compiler/VM in our DSL is original.** It does not share data
   structures or bytecode with the original Forth VM.
4. **All art, sound, fonts are first-party.** We use placeholder art from
   CC0/CC-BY sources and the Godot default theme; final assets are made
   or commissioned.
5. **Documentation may paraphrase** gameplay explanations but does not copy
   text verbatim.

## 5. Why this is enough

- Gameplay mechanics (reproduction, sensors, hardware budgets) are
  unprotected *ideas*. We use them because they work, not because we copied.
- Programming language *concepts* (postfix, two-stack machine) are old and
  public domain. Our DSL is a fresh design — see `09-AI-DSL.md`.
- The original C++ code is the only thing that is *expression-copyrighted*,
  and we never look at it during implementation. Our team can refer to the
  public documentation for mechanics only.

## 6. Attribution

We will include the following text in our app's "About / Credits" screen and
in the README:

> ForgeBots is an independent work inspired by Grobots, a free software
> programming game by Devon Schudy and Warren Schudy (GPL). No code or
> assets from the original Grobots project are used in ForgeBots.

This is required for *good faith*, even though the GPL itself does not
require credit (it requires source availability for derivatives only).

## 7. Legal sanity checklist (run before each release)

- [ ] No file in `simulator/` is copied from a GPL source.
- [ ] No file in `server/` is copied from a GPL source.
- [ ] No file in `client/` is copied from a GPL source.
- [ ] All third-party assets are under permissive licenses (CC0, CC-BY,
      MIT, Apache-2.0).
- [ ] Credits screen lists all third-party dependencies and licenses.
- [ ] No use of the "Grobots" name, logo, or trademarks.
- [ ] No reverse-engineered code paths from the Java port.
