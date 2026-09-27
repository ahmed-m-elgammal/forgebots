# 10 — Determinism Strategy

## 1. Why determinism matters

1. **Replay fidelity.** A replay must look the same to everyone on every
   device. Without determinism, the second viewer's bot decisions could
   differ from the first viewer's.
2. **Bug repro.** A bug in the simulator must be reproducible from a
   stored match seed + replay.
3. **Anti-cheat.** If the server and a client both run the same
   deterministic sim with the same inputs, the client can preview locally
   and the server can verify.

## 2. The three rules

### 2.1 Fixed tick

- Every match runs at **exactly 60 Hz**. No time-scaling, no
  interpolation-based variable-rate physics.
- `dt = 1/60 s` is a hard constant.
- The tick loop:
  ```
  for tick in 0..TICK_LIMIT:
    rng.advance(seed + tick)
    for each bot (in spawn order):
      bot.vm.step(state, env)   # returns actuators
    apply actuators in fixed order
    emit events
    check win condition
  ```

### 2.2 Integer / fixed-point arithmetic

- All positions, velocities, angles, masses are stored as **int** with a
  fixed-point scale. Q16.16 is the default for world units (mm
  precision); angles use Q15 (so 2π = 65535).
- Trigonometry (`sin`, `cos`, `atan2`) is implemented with a **fixed
  lookup table** (4096 entries per quadrant) — no IEEE rounding surprises
  between platforms.
- Floating-point is **only allowed** in:
  - internal accumulator overflow checks (then converted back),
  - editor UI rendering (display only).

### 2.3 Seeded RNG

- One seed per match (`seed: bigint` in `matches`).
- All bots share the match seed for "global" events (biomass respawn).
- Each bot has a per-bot seed derived from the match seed and bot id.
- **Mulberry32** for fast non-crypto RNG. **xoshiro256\*\*** for higher
  quality when needed.
- RNG is **never** used for gameplay-affecting decisions we can't afford
  to be flaky. (For example, biomass respawn position is RNG-driven;
  this is part of the deterministic match seed.)

## 3. What we forbid (CI lint)

The simulator directory is linted for:

| Pattern | Forbidden? | Allowed exception |
|---|---|---|
| `Math.random` | ❌ | none |
| `Date.now`, `performance.now` | ❌ | none |
| `new Date()` | ❌ | none |
| `Math.sin`/`cos`/`tan`/`atan2` etc. | ❌ | only via `math.ts` wrapper |
| `Promise`, `setTimeout`, `setInterval` | ❌ | none |
| `fetch`, `http`, `fs` | ❌ | none |
| `console.log` | ⚠️ warn | allowed only in tests |
| `Number.isNaN`, `Number.isFinite` | ✅ | allowed |

A simple `eslint-plugin-local` rule (custom) enforces this. CI fails if
any forbidden pattern appears in `simulator/src/**`.

## 4. Handling nondeterminism by category

| Source | Mitigation |
|---|---|
| IEEE-754 rounding | Fixed-point everywhere |
| Iteration order of `Map`/`Set` | Use sorted arrays internally for all entity lists |
| Array sort without comparator | Always provide comparator |
| Async I/O | Simulator has no async |
| Wall-clock time | None; only tick counts |
| Multi-thread races | Single-threaded simulator |
| Physics solver drift | Use semi-implicit Euler with dt = 1/60 s — stable enough for our simple bodies |
| Lookup tables | Precomputed at startup; identical bit-for-bit |

## 5. Replay hash

After each match, the simulator computes:

```
output_sha256 = sha256(
  concat(
    seed_bytes,
    final_state_bytes,        // canonical JSON of final state
    events_bytes              // canonical JSON of event list
  )
)
```

Stored in `replays.output_sha256`. CI runs a golden match (Drifter vs
Drifter, fixed seed) every commit and asserts the hash matches.

## 6. Cross-platform proof

We test on:
- Linux x86_64 (server)
- macOS arm64 (developer)
- Windows x86_64 (developer)
- Android arm64 (Pixel 6)
- iOS arm64 (iPhone 14)

All five produce byte-identical replays for a fixed seed. CI matrix
runs this on PRs.

## 7. When determinism fails

If a player reports a divergence, the support tool is:

1. Pull the match row + replay.
2. Re-run the simulator with the same seed on the reference platform.
3. Compare the new output_sha256.
4. If it differs → bug. File, fix, ship.
5. If it matches → user error / stale cache. Explain.

## 8. Why not lockstep multiplayer?

Lockstep (every client simulates every bot) would let us avoid running
the sim on the server. But:

- Player code runs on players' machines → anti-cheat nightmare.
- Async PvP doesn't need lockstep — there is no shared session.
- Mobile devices vary too much for guaranteed-deterministic parallel
  execution.

So we go with **server-authoritative + replay**. The replay is the
shared truth.
