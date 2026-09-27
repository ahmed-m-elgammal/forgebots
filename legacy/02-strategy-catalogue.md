# 02 — Strategy catalogue

What the published tournament results and the authors' own commentary
reveal about what actually wins in this genre. Described as **decision
logic**, not as code. Our own synthesis.

**Why this document exists:** the results pages contain no code, but
they contain something better — seven years of someone repeatedly
asking "why did that side win?" and writing the answer down. Those
answers are requirements for our own balance work, and most of them
are not obvious.

---

## 1. The behavioural taxonomy

The 2007 tournament added a "Position" column classifying each side by
how it moved. The categories are worth keeping, because they are a
clean partition of the strategy space and they map directly onto the
bot archetypes in our `19-STARTER-BOTS-AND-LIBRARY.md`.

| Archetype | Behaviour | Where it wins | Where it fails |
|---|---|---|---|
| **Stationary colony** | Sit in one place, build, defend | Vs weak or passive opponents; unbeatable head-on once large | Cannot be caught, but cannot reach anything either. Starves if its patch is contested |
| **Wandering gatherer** | One robot sweeps the map collecting | High variance: big wins when it finds a rich empty region, near-starvation otherwise | No force concentration. Loses fights it should win, because it arrives in ones |
| **Mobile group** | A cluster that moves together | Concentrating force is worth more than individual strength | **Friendly fire.** Grouping means splash and stray shots hit your own |
| **Corner-hider** | Retreat to a perimeter corner and fortify | Best late-game survival of any archetype, by a wide margin | Catastrophic early game. You are a sitting target while small |
| **Hiding / fleeing** | Break contact, never commit | Survives aggressive opponents | Never wins anything. Score is safety, not dominance |
| **Fancy group** | A coordinated group with role specialisation | Best ceiling of all archetypes | Hardest to write. Most attempts fail |

**Design requirement for us:** our parts catalog and starter bots must
make all six reachable. Today `19` teaches gatherer, hunter,
constructor and defender. It has no mobile group and no hider. That is
a gap — see § 5.

---

## 2. The dominance of quantity over quality

The single most repeated and most counter-intuitive finding:

> Spending energy on one large, capable robot performed worse than
> spending it on several small ones. One author's experiment with a
> large "helper" unit was described as "a waste of energy", and
> replacing it with more ordinary robots "greatly improves it".

**Why:** the game's economy is throughput, not efficiency. A
Constructor's cost scales with the *mass* of what it builds, so a big
child eats the food supply that would have fed three small ones. A
small robot is also a smaller target and does not block a corridor.

**Requirement for us:** this is the single most important balance
constraint, and it inverts a naive reading of "hardware budget = you
get what you pay for". It is also why our parts catalog must let a
50 kg chassis be a *bad* choice, and the builder must make that
legible (`13 § 4` net-power hint, and mass should be shown against
throughput, not only against caps).

---

## 3. Mobility beat position, then coordination beat mobility

Reading the winning sides in date order, the meta moves in a clear
sequence over roughly eight years.

| Period | What tops the table |
|---|---|
| 2005–2006 | **Stationary colonies.** Stay put, build, defend |
| 2007 | **Wandering gatherers** and a **corner-hiding** meta appears |
| 2008 | **Well-armed gatherers** — territory, growth, weapons |
| 2012 | **Active dodgers.** Move in response to incoming fire |
| 2013 | **Coordinated evasive group** — dodging *and* massing together |

Each shift was driven by a counter being discovered for the previous
dominant strategy. That is the whole game.

### 3.1 Active dodging — the biggest single innovation

Instead of running away from a shot, **move perpendicular to the
incoming line of fire** so it misses. The published analysis is
blunt: a weapon that hits reliably from long range "can attack with
impunity" *only* because "there are none that dodge well enough to
avoid dying before they get there".

**Why it matters for us:** passive stats do not decide this game. The
dominant technique is a *movement pattern*, which means the winning
skill is programming, not shopping. That is exactly the property we
want in a programming game, and it is a strong argument for keeping
the 2D top-down arena and fast, cheap movement.

**Passive dodging also works.** The authors note that simply
"zigzagging slightly" while chasing gets most of the benefit. A gentle
weave should therefore be a viable beginner strategy — that is a
teaching win, and it maps onto `17-ONBOARDING.md` Mission 2.

### 3.2 The corner-hiding trap

The most instructive failure in the archive. A side that hides in a
corner got *the best late-game survival rate in the tournament* while
surrounded by aggressors. On that evidence hiding looked dominant. It
was not:

- Early-game death rate was terrible, and getting worse as more sides
  adopted the strategy.
- The authors explicitly asked the community to solve it: *"Can
  anyone fix this?"*
- The partial answer that emerged: hide, but only **after** growing a
  large army first — which requires a fast early game that hiding
  prevents.

**Requirement for us:** any strategy that is strictly safe must have a
mandatory cost that prevents it from being dominant. Our 25 s match
length partly does this. Beyond that, a match that ends on a biomass
tiebreak at the tick cap (`04 § 6`) is exactly the anti-stall pressure
this needs — a hider with no food cannot win a tick cap.

---

## 4. Economy, cooperation, and the measurement trap

### 4.1 Food sharing was the highest-leverage upgrade

The authors noted that the leading gatherers all improved *because*
they had gained food sharing, and predicted that the meta would shift
again once the laggards caught up.

**Requirement for us:** we have `say(channel, value)` and an `ally()`
sensor, and **nothing in the spec uses them**. Cooperation between
your own robots is mechanically possible and strategically unused. That
is a design hole, and it is the highest-value one on this list — it is
the difference between six robots and a swarm.

### 4.2 Partitioning beats fighting over resources

A noted trick: stop competing for the same food by having each
gatherer claim a different region of the map.

**Requirement for us:** this is a real emergent strategy our geometry
should permit. It needs (a) robots that can be told *where* to go, and
(b) biomass patches that are spatially coherent rather than uniformly
mixed. Our 400 cells are currently specified as "a deterministic
pseudo-random free cell" on respawn (`04 § 5`), which makes
partitioning nearly pointless. **Recommendation: respawn biomass in
region-sized clusters, not uniformly.**

### 4.3 Weaknesses can be inflicted on the enemy

One notable entry drained the *enemy's* food stores to weaken it
before committing. Using a shield as a food scoop rather than a
defensive wall is another reported trick.

**Requirement for us:** neither is available. There is no way to steal
biomass, and shields absorb damage only. Both are cheap to add and both
open strategy space. Flagged, not decided — see § 5.

### 4.4 Provoking beats ignoring

A measured result: a side whose deliberate tactic was provoking early
enemies out-scored an otherwise identical side that ignored them, in
the early game. It did not hold up later.

**Requirement for us:** this is about round structure. Our 25 s
matches have one phase. A short opening with different incentives
would let an aggressive opener and a turtle both have a win path.

---

## 5. The measurement trap: the sterile case

**This is the most important thing in the document.**

The tournaments tracked *survival*, and the organisers discovered that
survival was a **broken metric**: a side that never met an enemy was
counted as having survived, perfectly. The fix was to publish
**non-sterile survival** alongside raw survival.

The other measurement findings:

- **Late-game death rate predicted tournament score better than any
  other single statistic.** Early performance was nearly noise.
- **Errors — programs that crashed — ran 1 % to 5 % per side** in
  early tournaments, and fell as the language got better.

**What this means for us, concretely:**

1. **Our Elo is computed on every match, but our telemetry needs the
   same sterile/non-sterile split.** `18 § 3.2` has a `match_request`
   event with an Elo band; it has nothing recording *whether the match
   was a real contest*. A bot that farms easy ghost matches will look
   better in the data than it is. This is a live gap in
   `18-LIVE-OPS-AND-TELEMETRY.md`, and it is the same gap the
   predecessor found in 2005.

2. **Our KPI targets are all about retention, none about contest
   quality.** `18 § 3.3` measures matches per user and Elo gain.
   Neither distinguishes a real fight from a walkover. Recommend adding
   a **contest rate** KPI: fraction of matches where both sides
   engaged.

3. **Design the late game to decide matches.** If late death is the
   best predictor of outcome, then the moment where both players'
   forces finally meet should be the moment that matters. Our
   25-second cap with 400 biomass cells and 6 robots per side may reach
   that moment too rarely. **This is the strongest argument yet for
   shrinking the arena or the cell count**, and it should be tested
   with the simulator as soon as Phase 12 lands.

4. **A crash is a competitive loss, not a technicality.** 1–5 % of
   sides were erroring out and it was measured. Our `vm_yield` and
   `verify` rejection paths (`09 § 5`, `22-DECISIONS.md D4`) exist, but
   nothing tracks *how often* a player's bot is rejected or yields. That
   number is a player-experience metric, not just a QA one.

---

## 6. Design requirements this catalogue produces

Consolidated, for the balance and content backlog. **None of these are
decided.** Each needs a call in `15-RISKS.md § 10` or a new decision in
`22-DECISIONS.md`.

| # | Requirement | Rationale | Effort |
|---|---|---|---|
| 1 | Publish contest rate; split telemetry by sterile vs non-sterile | The predecessor's single worst measurement error | Small — one field, one KPI |
| 2 | Test whether the late game actually decides matches | Best single predictor of final score | Simulation work, no new code |
| 3 | Make cooperation between your own robots viable | Food sharing was the highest-leverage upgrade in the archive | **Medium** — needs a colony/role concept, currently blocked on the DSL gap in `19 § 6` |
| 4 | Cluster biomass respawns regionally | Enables resource partitioning | Small — one change in `arena/biomass.ts` |
| 5 | Make mass *throughput* visible in the builder | Quantity beats quality; players must see it | Small — a second derived stat on `13 § 4` |
| 6 | Add the missing starter archetypes (mobile group, hider) | Six archetypes are reachable there; we teach four | Small — two `.fb` files |
| 7 | Decide on biomass theft and shield-as-scoop | Reported effective; currently impossible | Medium — new actuator, new balance surface |
| 8 | Track verifier rejections and VM yields per player | A rejected bot is a lost match, silently | Small — telemetry events |
| 9 | Consider a short distinct opening phase | Provocation and turtling need different incentives | Large — new mechanic, defer |
| 10 | Define friendly fire | Grouping is the strongest late-game strategy and it costs splash hits | **Small and blocking** — see below |

### On friendly fire (10)

The archive is unambiguous that massing your robots together is the
strongest late-game play *and* that it causes "significant friendly
fire". Our spec never says whether a blaster shot or a grenade splash
damages your own robots. `04 § 3.2` gives grenades a splash radius and
`11-REPLAY-FORMAT.md § 4` has no team field on `damage`.

This is a one-line decision with large consequences. My
recommendation: **friendly fire on for splash, off for aimed shots**,
because aimed shots are precise and splash is area denial, and that
split makes grouping a genuine trade-off rather than a pure upgrade.

---

## 7. What we did not conclude

- **No specific side was copied, ranked or studied as code.** Only the
  published results and commentary were read. See `README.md` in this
  folder.
- **No conclusion about the hardware numbers.** The per-part reference
  page was not available, and our own catalog in `04 § 3.2` is the
  source of truth regardless.
- **The lineage of sides across versions is not a strategy.** A side
  appearing in eight tournaments is a measure of the authors'
  persistence, not of a technique.
