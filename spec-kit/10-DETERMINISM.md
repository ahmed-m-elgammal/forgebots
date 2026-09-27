# 10 — Determinism Strategy

> Canonical decisions for the fixed-point format, RNG streams, the
> server-only simulator and the replay hash are in
> [`22-DECISIONS.md`](22-DECISIONS.md). This doc follows them.

## 1. Why determinism matters

1. **Replay fidelity.** A replay must look the same to everyone who
   views it. Without determinism, two viewers could see different
   outcomes from the same match row.
2. **Bug repro.** A bug in the simulator must be reproducible from a
   stored match seed + balance version + replay.
3. **Integrity.** The replay hash lets us prove a replay is the one the
   server actually produced, and lets CI catch drift between commits.

Determinism is a property of **one** simulator running on **one**
platform class. The Godot client never runs the simulator, so there is
no cross-device determinism claim to make
([`22-DECISIONS.md` D3](22-DECISIONS.md)).

## 2. The three rules

### 2.1 Fixed tick

- Every match runs at **exactly 60 Hz**. No time-scaling, no
  interpolation-based variable-rate physics.
- `dt = 1/60 s` is a hard constant.
- The tick loop:
  ```
  for tick in 0..TICK_LIMIT:
    matchRng.advance()          # world events only; never DSL-visible
    worldSnapshot = snapshot(world)
    for each alive bot (in spawn order):
      bot.vm.step(state, env)   # returns actuators; botRng is per-bot
    apply actuators in fixed order
    run physics (combat, energy, biomass, construction)
    emit events
    check win condition
  ```

### 2.2 Integer / fixed-point arithmetic

| Quantity | Representation |
|---|---|
| Position, velocity, mass | **Q16.16, 1 world unit = 1 metre** (±32 767 m) |
| Angles | **16-bit circular, 65536 = 2π** (π = 32768) |
| `sin`/`cos` results | **Q16.16, 65536 = 1.0** — deliberately a different scale from the angle unit |
| DSL lengths, replay/API coordinates | **integer millimetres** |
| Energy | integer pool; power held as integer **milliwatts** and divided by 60 with the remainder carried |

- Trigonometry (`sin`, `cos`, `atan2`) is a **fixed lookup table**
  (4096 entries per quadrant) — no IEEE rounding differences between
  platforms. Matching `20-IMPLEMENTATION-PLAN.md` § 4.3.
- Floating-point is **forbidden** in `simulator/src/**`, with no
  exceptions. The previous "internal accumulator overflow checks, then
  converted back" allowance was a determinism hole with no test that
  could close it, and it contradicted the integer-floor rule in
  Phase 13. If you need more precision, widen the fixed-point format.
- `20-IMPLEMENTATION-PLAN.md` § 4.3 tests assert `fsin(π/2) ≈ 65536`
  (Q16.16 full scale) and `fatan2(0, −1) ≈ 32768` (angle unit = π).
  Those two numbers being close is a coincidence, not a shared scale.

### 2.3 Seeded RNG — two named streams

| Stream | Seed | Advanced by | DSL-visible |
|---|---|---|---|
| `matchRng` | `matches.seed` (bigint) | once per tick, **before** any bot steps | **No** |
| `botRng[i]` | `deriveSeed(seed, side, designIndex, robotIndex)` | only by that robot's own `rng-int` | **Yes** |

- `matchRng` drives **world events only**: biomass spawn and respawn
  placement, spawn-point jitter, any arena roll. Nothing a player writes
  can perturb it, and nothing it does can perturb a bot's stream.
- `botRng` is the **only** stream `rng-int` reads. A bot's random
  sequence is therefore independent of how many other robots exist and
  in what order they ran — which the previous "advance(seed + tick)"
  loop did not guarantee.
- **Mulberry32** for fast non-crypto RNG; **xoshiro256\*\*** where
  higher quality is wanted. Both are integer-only.
- Every RNG draw is part of the replay hash input, so a
  nondeterministic draw is a hash mismatch, not a subtle drift.

## 3. What we forbid (CI lint)

The simulator directory is linted for:

| Pattern | Forbidden? | Allowed exception |
|---|---|---|
| `Math.random` | ❌ | none |
| `Date.now`, `performance.now` | ❌ | none |
| `new Date()` | ❌ | none |
| `Math.sin`/`cos`/`tan`/`atan2` etc. | ❌ | only via `math.ts` |
| Any `Math.*` in `simulator/src/**` | ❌ | only via `math.ts` |
| `Promise`, `setTimeout`, `setInterval` | ❌ | none |
| `fetch`, `http`, `fs` | ❌ | none |
| `console.log` | ⚠️ warn | allowed only in tests |
| `Number.isNaN`, `Number.isFinite` | ✅ | allowed |

Enforcement: **ESLint flat config `eslint.config.js` at the repo root**
plus one local plugin file, `tools/eslint-plugin-forge/determinism.js`.
There is no `.eslintrc.*` and no separate `eslint-plugin-local`
package — the earlier spec named three different mechanisms.

CI fails if any forbidden pattern appears in `simulator/src/**`. The
rule also runs as a unit test so a local `pnpm lint` gives the same
answer as CI.

## 4. Handling nondeterminism by category

| Source | Mitigation |
|---|---|
| IEEE-754 rounding | Fixed-point everywhere; no `Math.*` outside `math.ts` |
| Iteration order of `Map`/`Set` | Use sorted arrays internally for all entity lists |
| Array sort without comparator | Always provide comparator |
| Async I/O | Simulator has no async |
| Wall-clock time | None; only tick counts |
| Multi-thread races | Single-threaded simulator |
| Physics solver drift | Semi-implicit Euler with `dt = 1/60 s`, all state in Q16.16 metres |
| Lookup tables | Precomputed at module load; identical bit-for-bit |
| Shared RNG interference | Two separated streams (§ 2.3) |
| Energy rounding | Integer milliwatts with a carried remainder (`20` Phase 13) |

## 5. Replay hash

After each match, the simulator computes:

```
output_sha256 = sha256(
  concat(
    seed_bytes,               // bigint, big-endian
    balance_version_sha256,
    final_state_bytes,        // canonical JSON of final state
    events_bytes              // canonical JSON of event list
  )
)
```

Stored in `replays.output_sha256`, **not** in the replay document. The
copy embedded in the replay JSON for convenience is explicitly
**excluded from the hash input** — otherwise the hash would cover
itself.

CI runs the golden matches every commit and asserts the hashes match.
The matchups and their seeds live in
`spec-kit/examples/golden-seeds.json`:

| Matchup | Purpose |
|---|---|
| `pebble` vs `drifter` | bare minimum: idle vs foraging |
| `drifter` vs `breeder` | two collectors, no weapons |
| `swarm-mind` vs `reaper` | construction + combat, the heaviest path |

## 6. Platform coverage

The simulator is TypeScript running in Node, so the platforms that
matter are the ones the **server** ships on:

- Linux x86_64 (production)
- macOS arm64 (developer + CI)
- Windows x86_64 (developer)

CI runs the golden-hash test on all three for every PR.

**Not claimed:** iOS, Android, or any client platform. The previous
version of this doc required byte-identical replays on five platforms
including two mobile ones, which is only meaningful if the simulator
runs on the client — and it does not
([`22-DECISIONS.md` D3](22-DECISIONS.md)). Cross-platform *parity for
players* is delivered differently: there is one replay, served from
Postgres, and every client renders the same bytes.

## 7. When determinism fails

If a player reports a divergence:

1. Pull the match row, its `balance_version_id`, and the replay.
2. Re-run the simulator with the same seed and balance version on the
   reference platform.
3. Compare the new `output_sha256`.
4. If it differs → bug in the simulator. File it, fix it, ship it.
5. If it matches → the divergence was in the *client's* rendering or a
   stale cache, not the simulation. Fix the client.

Because the client never simulates, step 5 is the common case and it is
cheap to prove.

## 8. Why not lockstep multiplayer?

Lockstep (every client simulates every bot) would let us avoid running
the sim on the server. But:

- Player code runs on players' machines → anti-cheat nightmare.
- Async PvP doesn't need lockstep — there is no shared session.
- Mobile devices vary too much for guaranteed-deterministic parallel
  execution.

So we go with **server-authoritative + replay**. The replay is the
shared truth.

This is also why the client has no local preview simulator. A
client-side sim would be either a second implementation of the
simulator (a second determinism surface) or a lockstep client (the
first bullet above). Both are worse than streaming 300 ticks from the
server, which costs ~1 s
([`22-DECISIONS.md` D3, D9](22-DECISIONS.md)).
