---
name: broker
description: Hedge exposure to a World Cup match outcome by buying collateralized insurance over x402. Use when the user or the agent holds a position, prediction, prize promotion, or payout obligation that loses money if a specific match result occurs — phrases like "hedge", "insure", "cover my downside", "prize indemnity", "what if France loses", "I'm exposed to". Also use to check an existing policy's status or whether an underwriting vault can actually pay.
---

# BROKER — buying insurance for yourself

BROKER sells risk transfer to agents. You describe an outcome you do not want to
happen, pay a premium in USDC over x402, and hold a policy whose payout is locked
in an on-chain escrow from the moment it binds. When the match ends, a Merkle
proof of the real result releases the payout. No human underwriter, no paperwork.

Networks: Injective **testnet** for payment, Solana **devnet** for the vault and
settlement. Nothing here touches mainnet.

## When to reach for this

Use BROKER when a loss is tied to a **specific match outcome**. Typical shapes:

- A position or prediction that pays out badly on one result.
- A promotion of the form "refund everyone if X wins" — the classic prize
  indemnity case.
- Any obligation where you would rather pay a known premium now than carry an
  unknown loss later.

Do **not** use it as a price oracle or a betting venue. It sells protection; it
does not take directional positions for you, and a quote is not a prediction.

## The four tools

| tool | what it does | costs money? |
|---|---|---|
| `quote_coverage` | prices protection for a fixture + outcome + coverage amount | no — shop freely |
| `bind_coverage` | buys it; returns an x402 payment challenge you must settle | yes — the premium |
| `policy_status` | reads a policy's live state from Solana | no |
| `vault_solvency` | checks the underwriter can actually pay | no |

All amounts are **USDC base units, 6 decimals**. 5 USDC is `"5000000"`. Outcomes
are `WIN_HOME`, `DRAW`, or `WIN_AWAY`, expressed from the home team's side.

## How to hedge, start to finish

**1. Work out what you are actually exposed to.** The outcome you insure is the
one that *hurts you*. If you profit when France wins, your exposure is France
failing to win, and the outcome to insure against is what causes that. Get this
backwards and you will buy protection against the case you were already happy in.

**2. Check the underwriter before you buy.** Call `vault_solvency`. Look at
`free_reserves_usdc` against the coverage you want, and at
`reserve_covers_free_reserves` — if that is false, do not buy. An unbacked policy
is worse than no policy, because you will stop hedging elsewhere.

**3. Quote it.** Call `quote_coverage` with the fixture id, the outcome, and the
coverage. Quoting is free, so quote a few sizes. Compare `premium_usdc` against
the loss you are avoiding: if the premium approaches the loss, the market is
telling you the outcome is likely and hedging may not be worth it.

**4. Bind it.** Call `bind_coverage` with the same arguments. The first call
returns `status: "payment_required"` and an x402 challenge — this is normal, not
an error. Sign the payment authorization and call `bind_coverage` again with it
as `payment_header`.

**Coverage is not bound until that payment settles on Injective.** If you do not
get a `bind_authorization` back, you are not covered. Never report to the user
that a hedge is in place based on the 402 alone.

**5. Confirm and record.** Call `policy_status` on the returned policy account.
You want `status: "Open"` and `escrow_locked_usdc` equal to your coverage — that
escrow is the money that pays you, sitting on-chain where you can see it. Save
the policy account address; it is how you check on the position later.

**6. After the match.** Settlement verifies a Merkle proof of the real result and
releases the payout in the same transaction. Re-check `policy_status`:

- `Triggered` — your outcome occurred, the coverage was paid to your payout
  account.
- `Expired` — it did not occur; the coverage returned to the vault. The premium
  is spent. That is what insurance costs when you do not need it.
- `Open` — not settled yet.

## Reporting policy state

- A quote is a price, not a forecast. Do not present the implied probability as
  BROKER's prediction of the match.
- Report the premium as a real cost. Hedging is not free, and a hedge that costs
  more than the exposure is a bad trade you should say is a bad trade.
- If a tool returns an error, say so plainly and stop. Do not retry a bind after
  an ambiguous failure without first calling `policy_status` to check whether one
  already exists — you could otherwise pay twice for the same protection.

## Setup

The MCP server needs one environment variable to find the desk:

```bash
BROKER_URL=http://127.0.0.1:8080          # the BROKER desk
BROKER_DEFAULT_VAULT=<vault pubkey>       # optional default for vault_solvency
SURETY_RPC_ENDPOINT=https://api.devnet.solana.com   # optional
```

See `mcp/README.md` for the three-line install.
