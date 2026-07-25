# BROKER demo script

## The one-sentence explanation

BROKER is an agent-facing insurance desk: an agent requests coverage through
MCP, pays over x402 on Injective, BROKER routes the premium through CCTP, and a
Solana policy releases collateral only when a TxLINE result proof verifies.

## What SURETY is

SURETY is not BROKER and it is not the user-facing product. It is the integrated
on-chain underwriting ledger on Solana. It holds capital, locks policy escrow,
checks the verified terms, and enforces settlement.

Use this analogy:

> SURETY is the underwriting ledger. BROKER is the broker, payment rail, and
> agent workflow built on top of it.

TxLINE is the data layer: it supplies signed odds and match-result proofs.

## Suggested 90-second recording

1. **Open the dashboard.** Point to the architecture strip. Say the one-sentence
   explanation above.
2. **Show the World Cup cards.** Explain that the tournament ended, so the UI
   honestly labels the signed capture `replay` and `not bindable`. It never
   presents stale odds as live.
3. **Show the BROKER quote.** The displayed historical price uses the signed
   odds plus current on-chain underwriting state.
4. **Show the policy receipt.** Point out the x402 payment, CCTP mint, issuance,
   and policy explorer links. State explicitly that these are real devnet
   receipts from separately verified legs, not one continuous historical run.
5. **Show settlement.** The policy status and escrow are read from chain. The
   result proof was verified by TxLINE through SURETY before payout.
6. **Finish on the distinction.** “Agents interact with BROKER. BROKER uses
   SURETY for underwriting enforcement and TxLINE for cryptographic sports
   facts.”

## Do not say

- Do not call replayed World Cup odds live.
- Do not say the historical policy traversed every leg in one request.
- Do not say payment alone creates a policy.
- Do not present SURETY as something BROKER authored.
