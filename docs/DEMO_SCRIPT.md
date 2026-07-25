# BROKER recording runbook

This is a literal recording plan: what to prepare, what to click, and what to
say. Target length: 3–4 minutes.

## Before recording

### 1. Get the public URL

There is no Render URL until you create the service in your Render account.

1. Sign in at <https://dashboard.render.com>.
2. Click **New → Blueprint**.
3. Connect GitHub if prompted.
4. Select `Jennycruzy/broker`.
5. Choose branch `main`.
6. Render detects the root `render.yaml`. Click **Apply**.
7. Wait until the `broker-dashboard` service says **Live** and `/healthz`
   passes.
8. Open the service. Copy the URL shown under its name. It will look like
   `https://broker-dashboard-xxxx.onrender.com`.

That exact service URL is the URL to submit and record.

### 2. Prepare the browser

Open the public dashboard at 100% zoom. Do not begin with a terminal.

The dashboard contains all transaction links needed during the recording:

- BROKER x402 payment
- BROKER CCTP route
- SURETY issuance transaction
- On-chain policy
- Settlement transaction
- Triggered policy

Allow pop-ups/new tabs for the site. Test every link before recording.

### 3. Prepare the terminal

In a separate terminal, run this before recording:

```bash
cd /opt/broker
make verify
```

Leave the final green summary visible. Do not make the audience wait through the
full command unless the submission specifically requires a live test run.

## Exact recording

### 0:00–0:25 — Establish the product

**Screen:** Dashboard header and the “What BROKER built” architecture strip.

**Say:**

> “BROKER is an agent-native insurance desk. An autonomous agent asks for
> coverage through MCP, pays the premium over x402 on Injective, and BROKER
> routes that premium through CCTP to an on-chain policy on Solana.”

Move the cursor across `AI AGENT → BROKER → CCTP → SURETY`, then point to
TxLINE.

**Say:**

> “These are the component boundaries. BROKER is the broker, payment rail, and
> agent workflow that I built. SURETY is the integrated underwriting ledger:
> it holds collateral, locks escrow, and enforces payout. TxLINE supplies the
> signed sports facts.”

Do not say that BROKER created SURETY or TxLINE.

### 0:25–0:55 — Explain the completed fixtures

**Screen:** Scroll to the France–England card. Point at `FULL TIME`, the score,
and the amber replay label.

**Say:**

> “The World Cup fixtures have completed, which lets this demo show the whole
> policy lifecycle rather than only a quote. During the matches, the service
> recorded the exact TxLINE-signed packets and Merkle proofs. The live feed no
> longer serves completed fixtures, so the dashboard labels these packets
> replay and not bindable. It re-verifies the recorded proof on every request
> and never presents historical odds as live.”

This is not an apology. Completion is why a result proof and payout can be
demonstrated. The important honesty point is that stale recordings cannot issue
a new policy because SURETY enforces a 15-minute odds window.

### 0:55–1:20 — Show the coverage product

**Screen:** Point to the probability bar and BROKER coverage quote.

**Say:**

> “BROKER turns the signed 1X2 market into a coverage price, combines it with
> the underwriter’s current utilization, and expresses both premium and
> coverage in USDC. Because this is a completed fixture, the quote is explicitly
> indicative. A new purchase requires a currently fresh signed packet.”

Point to `not bindable`. Do not imply the button or historical quote can create
a new policy today.

### 1:20–2:10 — Show the real payment and issued policy

**Screen:** Scroll to `BROKER policy receipt`.

**Say:**

> “This panel is not locally typed demo state. The policy, five-USDC escrow,
> premium, liabilities, and reserves are refetched from Solana devnet.”

Point to the open-state explanation.

**Say:**

> “This policy insured a France home win. France lost four–six, so the payout
> predicate is false. SURETY correctly leaves the five USDC locked until the
> policy reaches its expiry path. Open here means the program refused an
> invalid payout; it does not mean the build forgot to settle it.”

Open these links in order, spending only a few seconds on each:

1. **BROKER x402 payment**
2. **BROKER CCTP route**
3. **SURETY issuance tx**
4. **On-chain policy**

While moving through the tabs, say:

> “Here is the settled x402 payment on Injective, the CCTP mint on Solana, the
> odds-validated issuance transaction, and the resulting policy account. These
> are real devnet receipts.”

Then say this disclosure exactly once:

> “These receipts prove each real integration leg. They are separate historical
> runs, not one policy that traversed every leg in a single request.”

### 2:10–2:40 — Show successful proof-gated payout

**Screen:** Return to the dashboard and scroll to `PROOF-GATED PAYOUT`.

**Say:**

> “This second receipt shows the other settlement branch. For this policy, the
> insured predicate was true. SURETY called the TxLINE validator in the same
> transaction, the Merkle proof verified, the policy became Triggered, and the
> two-USDC escrow was drained to the payout account.”

Open **Settlement transaction** and briefly point to the successful Solana
transaction. Return to the dashboard.

**Say:**

> “A forged score or one flipped proof bit is rejected on-chain before payout.”

### 2:40–3:10 — Show the agent surface

**Screen:** Show the header chips, then switch to the prepared terminal with the
green `make verify` summary.

**Say:**

> “Agents use four MCP tools: quote coverage, bind coverage, policy status, and
> vault solvency. The paid MCP path forwards the signed x402 authorization and
> tracks a durable job through payment, bridging, issuance, and policy bound.
> Retries are idempotent, so the same payment cannot bridge or issue twice.”

Point to the verification summary.

**Say:**

> “The repeatable suite checks sixteen local and MCP cases, reads live devnet
> state, proves authentic and tampered results receive different on-chain
> verdicts, and reconciles the recorded payout from current chain state.”

### 3:10–3:25 — Close

**Screen:** Return to the architecture strip.

**Say:**

> “BROKER gives autonomous agents something information services do not:
> collateralized risk transfer. Injective provides the agent and payment
> surface, CCTP moves the premium, and SURETY plus TxLINE make the policy
> enforceable without trusting the broker.”

Stop recording.

## Claims to avoid

- Do not call replayed World Cup packets live.
- Do not say a new World Cup policy can be issued from the recording.
- Do not say one historical policy traversed all four integration legs.
- Do not say payment alone creates a policy.
- Do not imply BROKER authored SURETY or TxLINE.
- Do not call testnet or devnet activity mainnet.
