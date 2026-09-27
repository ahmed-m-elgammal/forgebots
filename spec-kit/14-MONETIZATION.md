# 14 — Monetization

## 1. Principles

1. **Never sell power.** Bots that pay are stronger bots ruin the game.
2. **Cosmetics only.** Skins, animations, themes.
3. **Convenience unlocks.** Extra bot slots, faster iteration.
4. **No ads.** Ever. (This game isn't a billboard.)

## 2. MVP pricing tiers

### 2.1 Free tier (default)

- 3 bot slots
- All hardware parts (no paywalled sensors)
- All game modes *(MVP ships one mode, Eliminator — `04 § 6`)*
- Async PvP (ghost fallback is instant; human matchmaking may take
  longer)
- Replays: own + bookmarks, forever
- All 8 starter bots, including the 3 tutorial missions
- **Not** included: public share links

### 2.2 "Forge Pass" (one-time IAP, $4.99)

- +9 bot slots (12 total)
- "Save unlimited previous versions" of each bot
- **Replay share links** (public-read, 30 days) — `08 § 4`
- All current cosmetics (skins, animations, themes)
- All cosmetics released **while the pass is held** — since the pass is
  a one-time purchase, "while active" was meaningless; it now means
  "everything released up to 12 months after purchase", which is what
  the store listing says

### 2.3 Cosmetic packs (per item, $0.99–$2.99)

- Chassis skins: "Carbon", "Bronze", "Holo", "Pixel".
- Victory animations.
- Arena themes: "Desert Forge", "Ocean Floor", "Glacier".

### 2.4 Slot packs (per pack, $1.99)

- +3 bot slots, up to a **hard cap of 30**.
- Forge Pass takes you to 12; slot packs extend 12 → 30.
- The 30 cap is enforced by a `check` constraint on
  `users.bot_slot_limit` (`07-DATA-MODEL.md § 2.1`), not by convention.
- 30 is MVP. It is not "up to 12" — an earlier draft of `04 § 8`
  claimed 12 and was itself wrong about what the earlier draft said;
  both are now 30 with a Forge Pass step at 12.

## 3. Revenue projections (order-of-magnitude)

Assumptions:
- 100k downloads in year 1.
- 8% conversion to Forge Pass (matches the KPI target in
  `18-LIVE-OPS-AND-TELEMETRY.md` § 3.3).
- $2 average ARPU on cosmetics (year 1).

```
Forge Pass: 8,000 × $4.99 = $39,920
Cosmetics:  20,000 × $2.00 = $40,000
Total MVP year-1: ~$80k
```

This is enough to fund a small team but not life-changing. The plan is
to scale downloads via:
- TikTok / YouTube short-form content showing weird bot strategies.
- Cross-promotion with adjacent games (Gladiabots players, Screeps
  players, Zachtronics fans).
- Steam release in v1.0 to add a larger paying audience.

## 4. Pricing in different markets

- Localised prices via App Store / Play localised pricing.
- India / SEA: 50–70% of USD price.
- Brazil: 60%.
- Western markets: full price.

## 5. Anti-patterns we will avoid

| Anti-pattern | Why not |
|---|---|
| Gacha / random paid rolls | Ethically questionable and banned in some markets. There are no "cosmetic drops" either — everything is bought directly (`03 § 2.7`). |
| Energy system | No, this is not a match-3 |
| Battle pass with FOMO | Optional cosmetics only, no "exclusive" timed gates |
| Premium currency | Direct USD pricing is clearer and conversion-friendly |
| Pay-to-skip queue | Async is already instant against a ghost; humans may wait, and that wait is not for sale |
| Ads | Game is not a billboard |

## 6. Receipt validation

- iOS: validate receipt against Apple App Store Server API (shared
  secret). Cache result in `purchases.verified_at`.
- Android: validate via Google Play Developer API.
- Server is the source of truth: the client tells the server "I just
  bought X"; the server re-validates before granting.

## 7. Refunds

- App Store / Play handle refunds natively; server only sees
  `purchase.revoked` webhooks.
- We honour the platform's refund → revoke cosmetic immediately.
