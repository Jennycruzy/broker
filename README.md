# BROKER

> **An AI agent that buys insurance for itself.**

Autonomous agents are taking on World Cup exposure — positions, predictions, prize promotions — with no way to hedge it. Every other agent service sells them *information*. BROKER sells them *risk transfer*: an agent pays a premium over x402 and walks away with collateralized coverage, no human in the loop.

BROKER is the **desk** on Injective. The **capital** sits in an underwriting vault on Solana. That split is deliberate — it is how every insurance market on earth already works. Brokers sell where the customers are, capital sits where it is efficient, and money wires between the two: Lloyd's in London, reinsurance capital in Bermuda. **Here that wire is USDC over CCTP, which is why CCTP does real work in this build instead of being a logo on a slide.**

The project sits on three of Injective's own listed directions: **prediction markets**, **live sports oracles**, and **cross-chain payments**.

**Receipts (no cloning required):**

| What | Proof |
|---|---|
| Real x402 payment settled on Injective testnet | [`0xd1901dd3…04fa6a`](https://testnet.blockscout.injective.network/tx/0xd1901dd31772ce78d1f43962d0fb28792df3d54479e96270825340361504fa6a) |
| Premium crossed Injective → Solana by CCTP | burn + mint tx — see [EVIDENCE.md](./EVIDENCE.md#gate-2--cctp-premium-route-pass) |
| Live policy bound with cryptographically validated odds | [`4Uq5aW2v…MW3NM`](https://explorer.solana.com/tx/4Uq5aW2vsWyv43vZfy3wEi9kd1ivGgnUvJDJuUdyEV3ST6owgutFVuDtfHSucM791V9drPcPFk6RLcghdc8MW3NM?cluster=devnet) — policy `9APDuVP895jBhj6u3iZbdr65difkiCW6vDtfMrAfx58L`, 5.000000 USDC coverage, 4.241692 USDC premium, priced from 51.18% (France) |
| Every claim reproducible | `make verify` — full output in [EVIDENCE.md](./EVIDENCE.md) |

---

## How the Injective technologies are used

### x402 — how the agent pays
The bind endpoint is gated by `@injectivelabs/x402` middleware against a live facilitator on Injective testnet. `quote_coverage` is free, so agents can shop. `bind_coverage` returns a real HTTP 402 challenge; the agent signs a payment authorization, USDC settles on Injective, and the bind authorization is issued only after on-chain settlement.

As far as we know, this is **the first insurance product purchasable over x402.** Most x402 endpoints in this hackathon sell a sentence. This one sells a liability someone else now owns.

- Settled payment: [`0xd1901dd3…04fa6a`](https://testnet.blockscout.injective.network/tx/0xd1901dd31772ce78d1f43962d0fb28792df3d54479e96270825340361504fa6a)
- Negative tests: unpaid → 402; wrong amount (9,999 vs 10,000 units) → 402 `payment_amount_mismatch`, no settlement; zero coverage → 400 before payment.

### USDC CCTP — how the money reaches the capital
The premium is paid on Injective. The vault that must collateralize the payout lives on Solana. CCTP burn-and-mint carries the funds between them: **Injective testnet (domain 29) → Solana devnet (domain 5)**, verified live against Circle's attestation service. Remove CCTP and BROKER cannot function — there is no other path from the buyer to the capital.

- Route, burn tx, attestation, and mint tx: [EVIDENCE.md — Gate 2](./EVIDENCE.md#gate-2--cctp-premium-route-pass)

### MCP Server — how the agent has hands
BROKER exposes four tools shaped around what an agent actually asks, not endpoint parity: `quote_coverage`, `bind_coverage`, `policy_status`, `vault_solvency`.

The demo agent **composes Injective's own MCP server** (33 tools — market data, trading, transfers, bridging) with BROKER's. It opens a World Cup-correlated position through Injective's tools, reads its own exposure, and hedges that exposure through ours — using Injective's flagship as a component rather than imitating its category.

<!-- TODO (Gate 4/5): tool list with signatures, connection instructions, and the agent run log.
     Do not write a word of this section until the gate evidence exists. -->

### Agent Skills — how any agent gets this
A self-contained skill in the standard markdown format (loads in Claude Code, Codex, Cursor, and Gemini CLI) that teaches an agent when and how to hedge World Cup exposure.

<!-- TODO (Gate 4): 3-line install, and the link to the upstream PR against Injective's agent-skills repo. -->

---

## How Injective is integrated

**The obvious question first: why is there a second chain?**

Because CCTP is a two-chain protocol. It burns USDC on a source domain and mints it on a destination domain — a single-chain CCTP integration does not exist. Injective put CCTP on the technology list, so *every* honest entry has a second chain. The only real question is whether that second chain does anything. In most integrations it is a faucet: USDC comes from somewhere so it can arrive, and the far side is inert.

Here the far side is the balance sheet. It holds the capital, locks the escrow, and verifies the Merkle proof that releases the payout. **BROKER is the only build where removing the far side doesn't remove a funding step — it removes the product.**

Note what is Injective-native: three of the four technologies — **x402, MCP Server, Agent Skills** — run entirely on Injective, and they are the whole product surface. The desk, the agent's hands, the payment, the skill. What lives on Solana is a settlement primitive BROKER calls, the way any fintech calls a ledger it did not write.

**On Injective (testnet):** the desk. The x402-gated quote/bind API, the facilitator payment, the MCP server the agent talks to, and the premium's burn leg.

**On Solana (devnet):** the capital. An underwriting vault holds USDC and locks full coverage into a per-policy escrow PDA at issuance, so the payout provably exists from the moment the policy binds. Settlement is a cross-program invocation into the sports-data validator: the payout releases only if a Merkle proof of the real match result verifies in the same transaction.

**Why the split exists:** insurance always separates distribution from capital. The desk goes where the customers are — Injective, where the agents and the agent-payment rail live. The capital goes where the settlement primitive is. CCTP is the wire between them, exactly as it is between London and Bermuda.

**Named components, for the curious:** the vault and settlement program is **SURETY** (Solana devnet, vault `9npibs7NyjhgWrG5muCFbLRCDoVxMiWWEfp2yMXhUNyF`). The World Cup data is **TxLINE** — cryptographically signed, Merkle-anchored match and odds feeds. BROKER consumes its verification layer as a public package, `@surety-tx/txline-verify@0.1.0`, installed from the npm registry like any other dependency.

**Networks, stated plainly:** Injective **testnet** for x402 and the CCTP burn. Solana **devnet** for the vault, the mint, and settlement. No mainnet claims anywhere in this repo.

---

## What it does

**The problem.** An autonomous agent with money at risk on a World Cup outcome has two options today: eat the loss, or don't take the position. No counterparty will sell it protection, because insurance requires a human broker, a human underwriter, and days of paperwork. Every business running a "refund if we win" promotion has the same problem at human scale — the specialty market that covers it (prize indemnity) is slow, opaque, and closed.

**What BROKER does.** Turns that into one HTTP call. An agent (or a person) describes the outcome it wants covered, gets a premium quoted deterministically from live signed odds, pays over x402, and holds a policy whose payout is collateralized on-chain from minute one. When the match ends, a Merkle proof of the result releases the payout automatically. Nobody is trusted — not us, not a keeper, not an oracle committee.

**How you interact with it — 60 seconds:**

```bash
# 1. Install dependencies and start the desk
npm install && npm run server

# 2. Ask for a quote (free)
curl -X POST "$BROKER/quote" \
  -H 'content-type: application/json' \
  -d '{"fixture":18257865,"outcome":"WIN_HOME","coverage":5000000}'

# 3. Bind coverage (x402: returns 402, pay, retry with the payment header)
curl -X POST "$BROKER/bind" \
  -H 'content-type: application/json' \
  -d '{"fixture":18257865,"outcome":"WIN_HOME","coverage":5000000}'
```

Or, from an agent: install the skill, connect the MCP server, and say *"I'm exposed to France losing — hedge it."*

<!-- TODO (Gate 4): replace the curl block above with the verified clean-profile install once Gate 4 passes. -->

---

## Architecture

```
[Injective MCP Server]  agent opens a World Cup-correlated position (33 tools)
        ↓  agent reads its own exposure
[BROKER MCP Server]     quote_coverage → bind_coverage
        ↓  HTTP 402 — pay premium in USDC on Injective
[x402 facilitator]      real settlement, Injective testnet
        ↓  the capital lives on Solana
[CCTP]                  burn (domain 29) → attestation → mint (domain 5)
        ↓
[Underwriting vault]    coverage locked in a per-policy escrow PDA,
                        premium re-derived on-chain from validated odds
        ↓  at full time
[Merkle proof CPI]      proof verified → payout released, same transaction
```

Pull any one link and the chain breaks. That is the design.

## Verification

```bash
make verify
```

Prints PASS/FAIL per claim in plain English: the 402 challenge is real, the CCTP route executes, the policy binds with validated odds, the MCP tools hit live endpoints, the skill installs clean, the verification package resolves from the public registry, and **settlement rejects a tampered proof.**

Full gate-by-gate evidence — including every self-audit and every unverified item — is in [EVIDENCE.md](./EVIDENCE.md). Integration friction is logged as we hit it in [docs/FRICTION_LOG.md](./docs/FRICTION_LOG.md), with the upstream issues we filed linked there.

## Roadmap

Mainnet after legal review; probability models for unquoted props; period-scoped predicates (halftime settlement mid-match); tiered severity payouts; reinsurance tranches.
