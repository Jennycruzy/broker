# Evidence

## Gate 0 — Ground truth: PASS

Verified: Circle recognizes the Injective-testnet (domain 29) to Solana-devnet
(domain 5) CCTP route — the live sandbox fee endpoint returned HTTP 200 with two
valid finality tiers.

Verified: Circle's documented CCTP contracts/programs are deployed — Injective
testnet returned 4,350 bytes of code for TokenMessengerV2, and Solana devnet
reported MessageTransmitterV2 executable.

Verified: the current Injective MCP repository exposes 33 tools at pinned commit
`daa98388cdf6c472c93211b1e9059725d72bc42e`, not the 22 stated in the input spec.

Verified: `@injectivelabs/x402@0.0.1` is downloadable from public npm with recorded
integrity, and its published middleware performs facilitator verification and
on-chain settlement rather than returning a canned success.

Verified: the supplied SURETY address is an executable Solana devnet program, not
a vault account — live `getAccountInfo` response.

Verified: the input spec used the wrong npm scope. The pinned SURETY repository
defines `@surety-tx/txline-verify@0.1.0`; a clean public-registry install passed and
the installed artifact exports `validateOddsOnDevnet` and
`suretyOddsValidationInput`.

Verified: the pinned SURETY IDL defines `issue_policy_with_validated_odds`, and live
Solana responses confirm the showcase and FRA–ENG formula-v2 vaults are owned by
the deployed SURETY program.

Unverified: a live x402 hosted facilitator — `x402.injective.network` did not
resolve. No payment was attempted in Gate 0.

Unverified: an actual CCTP burn, attestation, and Solana mint — requires funded
wallets and belongs to Gate 2.

Verified target: Gate 3 will use FRA–ENG formula-v2 vault
`9npibs7NyjhgWrG5muCFbLRCDoVxMiWWEfp2yMXhUNyF`, not the SURETY program ID.

Self-audit:

1. Network cut: live probes fail closed; there is no application flow or fallback.
2. Corrupt input: no verification path has been implemented in Gate 0.
3. Escape-hatch grep: repository contains documentation only; no mock, fallback,
   demo flag, hardcoded outcome, or swallowing catch was introduced.
4. Claim-to-evidence pass: each claim above maps to a cited primary source or a
   recorded live response summarized in `docs/GROUND_TRUTH.md`.
5. Fresh clone: documentation files have no environment dependency; product
   execution is not claimed.

Gate 1 has not started and requires operator authorization.

## Gate 1 — x402 bind: PASS

Verified locally: the bind endpoint uses `@injectivelabs/x402@0.0.1` middleware,
derives the premium from validated coverage and an explicit rate, and returns a
real x402 v2 HTTP 402 challenge when unpaid. It does not contact the settlement
RPC on the unpaid path.

Verified negative input: zero coverage is rejected with HTTP 400 before payment.

Verified dependency audit: public npm install completed and `npm audit` reports
zero vulnerabilities after updating `viem` within x402's declared compatible
range.

Verified funding: facilitator received 1 testnet INJ and payer received 20
Injective-testnet USDC through the interactive faucets.

Verified wrong amount: a valid signed authorization for 9,999 units against a
10,000-unit premium returned HTTP 402 with `payment_amount_mismatch` and did not
settle.

Verified exact payment: a valid authorization for 10,000 units returned HTTP 200
and a bind authorization. Transaction:
<https://testnet.blockscout.injective.network/tx/0xd1901dd31772ce78d1f43962d0fb28792df3d54479e96270825340361504fa6a>.

Verified receipt reconciliation: tests accept an exact successful explorer
transaction and reject corrupted calldata and failed transaction status. Eight
Gate 1 tests pass.

Disclosed failure: the preceding transaction
`0x1df3a43e3b0e8bb92efe05083ebcd2b4c70047e68c7b697a3eefd26dde04ba9c`
transferred 10,000 units but the RPC receipt waiter returned not-found, so the
endpoint denied authorization after charging. The exact reconciliation guard was
added before the passing run; this transaction is not represented as a successful
bind.

Self-audit:

1. Network cut: unpaid challenges still work; paid verification/settlement fails
   closed and cannot produce authorization without chain/explorer confirmation.
2. Corrupt input: zero coverage, underpayment, corrupted transaction calldata, and
   failed explorer status are rejected.
3. Escape-hatch grep: no fallback canned success, demo flag, swallowing catch, or
   hardcoded outcome was introduced. Scenario values live in the explicit run
   environment and transcript.
4. Claim-to-code: `server/app.mjs` gates bind through x402;
   `server/facilitator.mjs` performs exact reconciliation; the transaction links
   prove settlement.
5. Fresh state: dependencies install from the public registry; tests pass with an
   ephemeral localhost server. A live rerun requires documented funded testnet
   wallets and intentionally creates a new payment.

Gate 2 has not started and requires operator authorization.
