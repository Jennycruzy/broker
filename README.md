# BROKER

> **An AI agent that buys insurance for itself.**

Autonomous agents are taking on World Cup exposure — positions, predictions, prize promotions — with no way to hedge it. Every other agent service sells them *information*. BROKER sells them *risk transfer*: an agent pays a premium over x402 and walks away with collateralized coverage, no human in the loop.

BROKER is the **desk** on Injective. The **capital** sits in an underwriting vault on Solana. That split is deliberate — it is how every insurance market on earth already works. Brokers sell where the customers are, capital sits where it is efficient, and money wires between the two: Lloyd's in London, reinsurance capital in Bermuda. **Here that wire is USDC over CCTP, which is why CCTP does real work in this build instead of being a logo on a slide.**

The project sits on three of Injective's own listed directions: **prediction markets**, **live sports oracles**, and **cross-chain payments**.

**Receipts (no cloning required):**

| What | Proof |
|---|---|
| Real x402 payment settled on Injective testnet | [`0xd1901dd3…04fa6a`](https://testnet.blockscout.injective.network/tx/0xd1901dd31772ce78d1f43962d0fb28792df3d54479e96270825340361504fa6a) |
| Premium crossed Injective → Solana by CCTP | burn + mint tx — see [RECEIPTS.md](./RECEIPTS.md#cctp-transfer) |
| Live policy bound with cryptographically validated odds | [`4Uq5aW2v…MW3NM`](https://explorer.solana.com/tx/4Uq5aW2vsWyv43vZfy3wEi9kd1ivGgnUvJDJuUdyEV3ST6owgutFVuDtfHSucM791V9drPcPFk6RLcghdc8MW3NM?cluster=devnet) — policy `9APDuVP895jBhj6u3iZbdr65difkiCW6vDtfMrAfx58L`, 5.000000 USDC coverage, 4.241692 USDC premium, priced from 51.18% (France) |
| Repeatable non-destructive checks | `make verify`; one-time transaction receipts are listed separately in [RECEIPTS.md](./RECEIPTS.md) |

---

## How the Injective technologies are used

### x402 — how the agent pays
The bind endpoint is gated by `@injectivelabs/x402` middleware against a facilitator on Injective testnet. `quote_coverage` is free, so agents can shop. `bind_coverage` returns a real HTTP 402 challenge; the agent signs a payment authorization and USDC settles on Injective. The response is a payment receipt, not a policy. A policy exists only after a configured bind job reaches `policy_bound`.

The recorded x402 payment transaction proves that the desk accepted a real x402
payment. It does not by itself prove that the payer received an issued policy.

- Settled payment: [`0xd1901dd3…04fa6a`](https://testnet.blockscout.injective.network/tx/0xd1901dd31772ce78d1f43962d0fb28792df3d54479e96270825340361504fa6a)
- Negative tests: unpaid → 402; wrong amount (9,999 vs 10,000 units) → 402 `payment_amount_mismatch`, no settlement; zero coverage → 400 before payment.

### USDC CCTP — how the money reaches the capital
The premium is paid on Injective. The vault that must collateralize the payout lives on Solana. CCTP burn-and-mint carries the funds between them: **Injective testnet (domain 29) → Solana devnet (domain 5)**, verified live against Circle's attestation service. Remove CCTP and BROKER cannot function — there is no other path from the buyer to the capital.

- Route, burn tx, attestation, and mint tx: [RECEIPTS.md — CCTP transfer](./RECEIPTS.md#cctp-transfer)

### MCP Server — how the agent has hands
BROKER exposes four tools shaped around what an agent actually asks, not endpoint parity: `quote_coverage`, `bind_coverage`, `policy_status`, `vault_solvency`.

The demo agent **composes Injective's own MCP server** (33 tools — market data, trading, transfers, bridging) with BROKER's. It opens a World Cup-correlated position through Injective's tools, reads its own exposure, and hedges that exposure through ours — using Injective's flagship as a component rather than imitating its category.

| tool | arguments | costs money? |
|---|---|---|
| `quote_coverage` | `fixture`, `outcome`, `coverage_amount` | no — shop freely |
| `bind_coverage` | + optional `payment_header` | yes — x402 premium |
| `policy_status` | `policy` | no — reads Solana |
| `vault_solvency` | `vault?` | no — reads Solana |

Two tools talk to the desk; two read the chain directly. `bind_coverage`
returns the 402 challenge until a payment authorization is supplied.

Configuration and client JSON are documented in [mcp/README.md](./mcp/README.md).
`node scripts/verify-mcp.mjs` checks the stdio transport, tool responses, desk
responses and independent chain reads.

### Agent Skills — how any agent gets this
A self-contained skill in markdown format teaches an agent when and how to
evaluate World Cup exposure: [skills/broker/SKILL.md](./skills/broker/SKILL.md).
The skill covers exposure selection, solvency checks, payment and policy status.

---

## How Injective is integrated

**The obvious question first: why is there a second chain?**

Because CCTP burns USDC on a source domain and mints it on a destination
domain. BROKER uses Injective testnet as the payment side and Solana devnet as
the underwriting side.

The Solana side holds capital, locks escrow, and verifies the Merkle proof that
releases a payout.

Note what is Injective-native: three of the four technologies — **x402, MCP Server, Agent Skills** — run entirely on Injective, and they are the whole product surface. The desk, the agent's hands, the payment, the skill. What lives on Solana is a settlement primitive BROKER calls, the way any fintech calls a ledger it did not write.

**On Injective (testnet):** the desk. The x402-gated quote/bind API, the facilitator payment, the MCP server the agent talks to, and the premium's burn leg.

**On Solana (devnet):** the capital. An underwriting vault holds USDC and locks full coverage into a per-policy escrow PDA at issuance, so the payout provably exists from the moment the policy binds. Settlement is a cross-program invocation into the sports-data validator: the payout releases only if a Merkle proof of the real match result verifies in the same transaction.

**Why the split exists:** insurance always separates distribution from capital. The desk goes where the customers are — Injective, where the agents and the agent-payment rail live. The capital goes where the settlement primitive is. CCTP is the wire between them, exactly as it is between London and Bermuda.

**Who built what:** **BROKER** is the agent-facing desk, MCP tool surface, x402
payment flow, CCTP routing, and lifecycle orchestration in this repository.
**SURETY** is the integrated on-chain underwriting ledger on Solana: it holds
capital, locks escrow, checks policy terms, and enforces settlement. **TxLINE**
is the integrated data layer supplying signed odds and Merkle-anchored match
results. In one line: *SURETY is the underwriting ledger; BROKER is the broker,
payment rail, and agent workflow built on top of it.*

**Networks, stated plainly:** Injective **testnet** for x402 and the CCTP burn. Solana **devnet** for the vault, the mint, and settlement. No mainnet claims anywhere in this repo.

---

## What it does

**The problem.** An autonomous agent with money at risk on a World Cup outcome has two options today: eat the loss, or don't take the position. No counterparty will sell it protection, because insurance requires a human broker, a human underwriter, and days of paperwork. Every business running a "refund if we win" promotion has the same problem at human scale — the specialty market that covers it (prize indemnity) is slow, opaque, and closed.

**What this build proves.** BROKER demonstrates each devnet leg with real
transactions: x402 payment, CCTP burn/mint, odds-validated policy issuance, and
proof-gated settlement. Those receipts are from separate runs; one policy did
not travel through all four legs as a single continuous request.

The running desk currently quotes an explicitly configured demonstration rate.
After payment it reports `payment_settled` and starts a durable bind job only
when bridge and issuance adapters are configured. Payment alone is never called
a bound policy. Odds-validated issuance additionally requires a currently
served TxLINE packet inside SURETY's freshness window. The recorded World Cup
packets remain useful for proof verification and the historical dashboard, but
cannot issue a new policy now that the tournament has ended.

**How you interact with it — 60 seconds:**

```bash
# 1. Install dependencies and configure the desk
npm ci
cp .env.example .env
# Export the values from .env after supplying facilitator credentials.
# At minimum: PREMIUM_RATE_BPS and one of the documented facilitator modes.
npm run server

# 2. Ask for a quote (free)
curl -X POST "$BROKER/quote" \
  -H 'content-type: application/json' \
  -d '{"fixture":"18257865","outcome":"WIN_HOME","coverage_amount":"5000000"}'

# 3. Bind coverage (x402: returns 402, pay, retry with the payment header)
curl -X POST "$BROKER/bind" \
  -H 'content-type: application/json' \
  -d '{"fixture":"18257865","outcome":"WIN_HOME","coverage_amount":"5000000"}'
```

Or, from an agent: install the skill, connect the MCP server, and say *"I'm exposed to France losing — hedge it."*

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

This diagram is the target orchestration and the separately proven transaction
path. It is not evidence that one historical policy traversed every arrow.

## Verification

```bash
make verify
```

Prints PASS/FAIL per claim in plain English. What it re-runs live, every time:

- the x402 402 challenge is real and issues no authorization without payment
- the MCP tools agree with the desk's own HTTP answers and with Solana devnet
- **settlement rejects a tampered proof** — a flipped bit and a forged scoreline are both rejected on-chain, with different errors than an authentic proof
- the recorded settlement still reconciles against live chain state
- the pricing math is byte-exact against SURETY's Rust test vector

What it does **not** re-run, because these are one-time on-chain events that cannot be repeated on demand: the CCTP burn/mint route (CCTP transfer), and the odds-validated policy bind (odds-validated issuance, which needs a signed odds packet under 15 minutes old — so it needs a match in progress). Those are evidenced by transaction hashes you can check yourself in [RECEIPTS.md](./RECEIPTS.md), not by this command.

Transaction links and repeatable checks are listed in
[RECEIPTS.md](./RECEIPTS.md).

## Dashboard

The dashboard lives in `web/` and runs on `127.0.0.1:8787` by default:

```bash
npm run dashboard
curl --fail http://127.0.0.1:8787/healthz
```

It is a Node service because `/api/live` performs server-side chain and feed
reads. Host it on a VPS behind Nginx or Caddy rather than uploading
`web/public/` to static hosting. See [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md).
For a fast public demo, the checked-in `render.yaml` deploys both the dashboard
and `/api/live` as one Render Web Service.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2FJennycruzy%2Fbroker)

The `onrender.com` URL is created only after approving this deployment in a
Render account. When the service becomes **Live**, copy the URL displayed under
the `broker-dashboard` service name.

## Roadmap

Mainnet after legal review; probability models for unquoted props; period-scoped predicates (halftime settlement mid-match); tiered severity payouts; reinsurance tranches.
