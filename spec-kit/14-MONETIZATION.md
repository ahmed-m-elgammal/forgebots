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
- All game modes
- Async PvP (with 30 s matchmaking budget)
- Replays (own only)
- 3 AI opponents

### 2.2 "Forge Pass" (one-time IAP, $4.99)

- +9 bot slots (12 total)
- "Save unlimited previous versions" of each bot
- Replay share links (public-read)
- All current cosmetics (skins, animations, themes)
- Future cosmetics included while pass is active

### 2.3 Cosmetic packs (per item, $0.99–$2.99)

- Chassis skins: "Carbon", "Bronze", "Holo", "Pixel".
- Victory animations.
- Arena themes: "Desert Forge", "Ocean Floor", "Glacier".

### 2.4 Slot packs (per pack, $1.99)

- +3 bot slots, up to a hard cap of 30.

## 3. Revenue projections (order-of-magnitude)

Assumptions:
- 100k downloads in year 1.
- 10% conversion to Forge Pass.
- $2 average ARPU on cosmetics (year 1).

```
Forge Pass: 10,000 × $4.99 = $49,900
Cosmetics:  20,000 × $2.00 = $40,000
Total MVP year-1: ~$90k
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
| Gacha | Random paid rolls are ethically questionable and banned in some markets |
| Energy system | No, this is not a match-3 |
| Battle pass with FOMO | Optional cosmetics only, no "exclusive" timed gates |
| Premium currency | Direct USD pricing is clearer and conversion-friendly |
| Pay-to-skip queue | Async is already instant for normal Elo |
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
