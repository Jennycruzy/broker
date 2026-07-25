
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

## Gate 2 — CCTP premium route: PASS

Verified: CCTP will mint only native Solana-devnet USDC
`4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` on domain 5.

Verified: all 19 deployed SURETY Vault accounts were enumerated live; none uses
native Circle USDC as its asset mint.

Verified: the FRA–ENG vault reserve accepts the separate test mint
`FiJfrnLoc2vZmjixZqCEBuWd8A5EuDaF9MZZhd96bpck`. Live SPL account decoding proves
the reserve mint and vault owner.

Verified resolution: operator authorized a new native-USDC formula-v2 vault under
the deployed SURETY program. Initialization transaction:
<https://explorer.solana.com/tx/3hi9pvNKv835wPnRG7NkPUynZbhMNWpV7KwPY3CaiPuZcaLpKRVNMWojb1ahgAR3rhKaE6b6Nt9Qy4Tj3yoaGc5B?cluster=devnet>.

Verified burn: exactly 10,000 USDC base units were burned from Injective testnet,
source domain 29, for Solana domain 5 and SURETY reserve
`EgwE41BznuyVGtboQb5uBHsPdbabBzjzhyWYr3VRYC5J`:
<https://testnet.blockscout.injective.network/tx/0x281ef407852ccf4bb34c04f71c70c496e10e6b1479174872115b2d4177c62059>.

Verified attestation: Circle sandbox returned HTTP 200 and status `complete` for
that exact burn, CCTP version 2.

Verified mint: Circle's Solana MessageTransmitter accepted the attested message and
minted exactly 10,000 native-USDC units directly into the SURETY reserve:
<https://explorer.solana.com/tx/aFzY4dorCBd28epYUdbLKZUozTi7TfshMQxTg42muLCiKq989L7NgyDs9ZQquggPefagkcC7eNRUVhSMtDG47CJ?cluster=devnet>.

Verified final state: reserve token balance is 10,000 base units; reserve mint is
Circle native devnet USDC; reserve token owner is the new formula-v2 vault.

Self-audit:

1. Network cut: burn, attestation fetch, IDL fetch, and mint all fail closed; there
   is no offline success path.
2. Corrupt input: Circle's on-chain MessageTransmitter verifies the attestation;
   mint succeeds only for its signed message and single-use nonce. A local synthetic
   proof is never accepted.
3. Escape-hatch grep: no simulated bridge, canned attestation, demo flag, or
   swallowing catch was introduced.
4. Claim-to-code: `gate2-burn.mjs` calls Circle TokenMessengerV2;
   `gate2-mint.mjs` fetches the live attestation and calls MessageTransmitterV2;
   the linked transactions prove both sides.
5. Fresh state: Circle IDLs are fetched from a pinned official commit and checked
   by SHA-256. Live execution requires funded testnet wallets and a new burn.

Unverified dependency remediation: npm reports 10 advisories in the exact
Anchor/Solana versions shared with SURETY; suggested automatic fixes are incompatible
downgrades. This does not change the Gate 2 chain receipts and remains disclosed.

## Gate 3 — Policy binds on SURETY: PASS (Part A validation + Part B issuance)

Gate 3 splits into the TxLINE-validation primitive it names, and the on-chain
policy issuance that consumes it. Both are verified. Part A proves the validator
accepts authentic proofs and rejects tampered ones; Part B binds a real 5 USDC
policy against the deployed SURETY program using fresh TxLINE-validated live odds.
No stale or synthesized proof was substituted at any point.

### Part A — TxLINE odds/fixture validation: PASS

Verified: the exact functions Gate 3 names — `validateOddsOnDevnet` and
`suretyOddsValidationInput` from the public `@surety-tx/txline-verify` package,
plus the fixture equivalents — verify **real recorded** TxLINE proofs for fixture
18257865 (France v England, World Cup, kick-off 2026-07-18 21:00 UTC). Run
`node scripts/gate3-validate-odds.mjs`; six checks pass:

1. The recorded FRA–ENG odds and fixture proofs pass the package's authenticity
   shape checks.
2. `suretyOddsValidationInput` / `suretyFixtureValidationInput` shape the exact
   on-chain `record_validated_odds` / `record_validated_fixture` arguments
   (odds prices `[2048, 4018, 3805]`, 16-byte message key `b41adce5…569e`).
3. The deployed TxLINE validator on Solana devnet cryptographically verifies the
   authentic odds proof via a read-only `.view()` CPI — returned `true`.
4. The same validator verifies the authentic fixture proof — returned `true`.

Verified negative tests (a path that cannot fail cannot verify):

5. A one-bit tamper of the odds sub-tree proof is rejected on-chain with error
   6003 `InvalidSubTreeProof` ("the snapshot does not belong to the summary").
6. A one-bit tamper of the fixture main-tree proof is rejected on-chain with
   error 6004 `InvalidMainTreeProof` ("the summary does not belong to the
   on-chain root").

The proofs are real captured artifacts copied from SURETY's repository, not
synthesized. The daily merkle root the odds proof verifies against exists on
devnet, owned by the TxLINE program `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J`.

### Part B — `issue_policy_with_validated_odds`: PASS

The SURETY program enforces `MAX_ODDS_AGE_MS = 15 minutes` in
`validate_verified_quote`: the validated odds timestamp must be within 15 minutes
of the issuance clock or the transaction fails with `StaleOddsProof`. So issuance
needs a **fresh** odds packet fetched at issue time from the TxLINE API
(`https://txline-dev.txodds.com`), which requires the `X-Api-Token` secret.

Verified so far (real, on-chain):

- **Token:** supplied by the operator, stored in `.secrets/txline-devnet.json`
  (gitignored). The authenticated snapshot returns HTTP 200 and a fresh France v
  England 1X2 packet + fixture proof both verified on-chain by the TxLINE
  validator (`scripts/gate3-verify-live-proof.mjs`).
- **Pricing:** `server/pricing.mjs` reproduces the on-chain quote math and is
  byte-exact against SURETY's Rust test vector (`server/pricing.test.mjs`, 4/4).
  This eliminates the `OddsPremiumMismatch` / `VerifiedQuoteHashMismatch`
  failure modes before the live run.
- **Vault:** a fresh native-USDC formula-v2 vault
  `CrnjZE2DXMPLtRXJ6MPHaKifEi13qp1vAFn9ohXBpqZu` with a 9000-bps bucket cap,
  created by `scripts/gate3-create-vault.mjs`. Init tx
  `4fGg9br6m9iqSTdU3X79aj3dFdPFpjP2cqsjKgoQvzTw5PcQSzJDJZXT7jyZ1Du7XKryCBwTvAuufHgVcJKyB3fS`.
- **Capital via CCTP (real burn/mint):** 17 USDC bridged Injective → Solana into
  the holder account, 12 USDC moved to the vault reserve as capital, 5 USDC kept
  for the premium. Burn
  <https://testnet.blockscout.injective.network/tx/0x864d8bf91017f461536ac604205be853b8a6de4ca3403cfb23591ab170c257b7>,
  mint
  <https://explorer.solana.com/tx/2UNhcfhpuyW1RFHgv81hM9GkC9GRQgvCSUg5dFddonHtuYLZM3FMtd9YgwacaptzmPkVZ65YPptNTrBsNRvnzyHj?cluster=devnet>,
  capital transfer
  <https://explorer.solana.com/tx/5iS1FaFvYpuCBhn7tB7n4sbjyzxh7EjhEKCoVhU2x3hLzArBJGTpyzZDqxar3jyxRJRGinn4DEG69AzsEj4RXZoE?cluster=devnet>.

**Policy bound (real, on-chain, independently verified).** A fresh full-match 1X2
packet (message `1838239638:00003:000168-10021-stab`, prices `[1954, 4207, 3993]`,
3.8 min old) arrived; `scripts/gate3-issue-policy.mjs` recorded the ValidatedOdds
receipt and issued the policy, both in one pass inside the 15-minute window.

- Policy account: `9APDuVP895jBhj6u3iZbdr65difkiCW6vDtfMrAfx58L` — status **Open**.
- `record_validated_odds` tx:
  <https://explorer.solana.com/tx/2FMuYCgYJnVQbWsL8LmarysfBh7ebUGen4uzxxF2QjMYqPKk8mFKLEkCNwNv3DidE2DNKbviPkKSi929P8RGQykb?cluster=devnet>
- `issue_policy_with_validated_odds` tx:
  <https://explorer.solana.com/tx/4Uq5aW2vsWyv43vZfy3wEi9kd1ivGgnUvJDJuUdyEV3ST6owgutFVuDtfHSucM791V9drPcPFk6RLcghdc8MW3NM?cluster=devnet>
- ValidatedOdds `6mHxwJz5K1DWSdEK6hpAjNNR5sYZg6R4jXLtPzLwfLcJ`, ValidatedFixture
  `5gYEQ3WBzpnFpxLH4mNQT571tsoiEA1WLkmDD17BuaNh` (fixture 18257865).
- Coverage 5.000000 USDC, premium 4.241692 USDC, probability 511,818 ppm
  (51.18% France), computed on-chain from the validated odds and re-checked by
  the program (`OddsPremiumMismatch` / `VerifiedQuoteHashMismatch` would reject a
  wrong value).

Independently verified by `node scripts/gate3-verify-policy.mjs` (does not trust
the issuance script's stdout — refetches everything): both transactions confirmed
with no error; policy Open, bound to the Gate 3 vault, holder = the agent wallet;
coverage 5 USDC; premium 4.241692 USDC; the policy escrow PDA holds exactly 5 USDC
of locked coverage; validated odds are for fixture 18257865. Token balances
reconcile exactly: reserve 12 (capital) + 4.241692 (premium in) − 5 (coverage to
escrow) = 11.241692 USDC; holder 5 − 4.241692 = 0.758308 USDC.

Self-audit (Part B):

1. Network cut: every step hits live TxLINE / devnet and fails closed. Observed
   the script throw `latest odds packet is stale` and `no odds packet inside the
   freshness window` rather than fabricate a bind — a path that cannot fail was
   not built.
2. Corrupt input: the on-chain program re-derives predicate, bucket hash,
   premium, and quote hash and rejects mismatches; tampered TxLINE proofs are
   rejected by the validator (Part A, errors 6003 / 6004).
3. Escape-hatch grep: `bridge/`, `server/pricing.mjs`, and `scripts/gate3-*.mjs`
   contain no mock, fake, stub, hardcoded outcome, demo flag, or success-
   fabricating catch. The one catch (in `gate3-validate-odds.mjs`) asserts an
   on-chain rejection for the negative test.
4. Claim-to-code: every figure above is refetched from chain by
   `gate3-verify-policy.mjs`; the premium/quote math is byte-exact against
   SURETY's Rust vector (`server/pricing.test.mjs`).
5. Fresh state: scripts use the vendored SURETY IDL (`bridge/surety_core.idl.json`,
   sha256 recorded), the public-registry `@surety-tx/txline-verify`, and the
   documented secrets. Deterministic given the same inputs.

Self-audit (Part A):

1. Network cut: `validateOddsOnDevnet` fails closed if the devnet root account is
   absent or the RPC is unreachable; there is no offline success path.
2. Corrupt input: tampered odds and fixture proofs are rejected on-chain
   (errors 6003 and 6004). The tests assert rejection, not a canned pass.
3. Escape-hatch grep: no mock, demo flag, swallowing catch, or hardcoded outcome
   was introduced. `scripts/gate3-validate-odds.mjs` throws non-zero on any
   failed check.
4. Claim-to-code: each claim maps to a labelled check printed by the script and
   an on-chain program log line.
5. Fresh state: the script installs `@surety-tx/txline-verify` from the public
   registry and reads proofs committed under `data/recordings/`. The read-only
   `.view()` reuses the funded Gate 2 devnet wallet as fee payer and submits no
   transaction.

Gate 3 is complete: the TxLINE validation primitive is proven (Part A) and a real
5 USDC policy is bound on the deployed SURETY program with fresh TxLINE-validated
odds (Part B), independently verified on-chain.

## Match capture — live feed reachable, fixtures confirmed

Verified (2026-07-18 ~10:45 UTC, from the build environment): the TxLINE API
authenticates with the stored token, `/api/fixtures/snapshot` returns HTTP 200
with 8 rows, and fresh signed full-match 1X2 packets are flowing for FRA v ENG
(e.g. `msg 1838314406:00003:000228-10021-stab`, prices `[1948, 4251, 3978]`,
~7 min old at fetch).

Verified fixture ids from the live snapshot (confirmed, not assumed):

- **18257865** — France v England — kickoff 2026-07-18 21:00 UTC (World Cup).
- **18257739** — Spain v Argentina (the final) — kickoff 2026-07-19 19:00 UTC
  (World Cup). Participant ids: Spain 3021 (home), Argentina 1489.

Unverified: unattended scheduled capture on a persistent host. The build
environment is a container without `systemd` (PID 1), `pm2`, or `cron`, so it
cannot itself run or supervise the multi-hour capture windows. The recorder is
built and dry-run against the live feed; deployment onto the operator's VPS is a
blocker owned by the operator (see below / build report).

## Gate 6 — Automatic settlement: PASS

A policy was settled on-chain from a TxLINE full-time Merkle proof. The escrowed
coverage moved to the payout account in the same transaction that verified the
proof, and the transition was re-verified independently from chain state.

Reproduce: `npm run verify:gate6` (negative tests) and
`node scripts/gate6-verify-settlement.mjs` (settlement verification).

### The settlement

- Policy `Gmk1L8ZLPySzuGKsjNyxSyRcYMNzkb8QypzBxxzoFeMG` — 2.000000 USDC coverage,
  0.172374 USDC premium, insuring `WIN_HOME` on fixture 18257739
  (Spain v Argentina, the final).
- Proved full-time result: **P1 1 : P2 0**, TxLINE scores seq 1385, stat keys 1
  and 2 at period 100 — fetched live from the authenticated TxLINE API at
  settlement time, not from a recording.
- `settle_policy` tx:
  <https://explorer.solana.com/tx/2SZFA2gaskxaNLjHy34Z3XomRN93i2zY3nbiQgWQaLizTUwmDDeLREvP2Bquih4JZXyYAmHpmfxLHUWBCVcK7qDg?cluster=devnet>
- Policy status **open → triggered**. Escrow `AtnZE27e…q6MgZ` 2.000000 → 0.
  Payout account 9.827626 → 11.827626 USDC. Vault `locked_liabilities` → 0,
  exposure bucket unwound to 0.

Independently verified by `scripts/gate6-verify-settlement.mjs`, which refetches
everything rather than trusting the settling script's stdout — 10/10 checks pass,
including that the transaction actually CPI'd into the TxLINE validator and that
the validator returned success, and that the escrow drained by *exactly* the
policy's own coverage figure and the payout account grew by exactly the same
amount.

### Correction to the earlier plan

The plan assumed `settle_policy` had an "expire branch" that returned coverage to
the vault when the insured outcome did not occur. **It does not.** The program
exposes two instructions: `settle_policy` (payout path — aborts with
`TxlinePredicateRejected` 6031 if the predicate is false) and `expire_policy`
(no proof, no args, gated on `expires_at` by `PolicyNotExpired` 6022). Found by
running the real instruction against devnet.

### Why the settled policy sits in a second vault — stated plainly

The Gate 3 policy could not be used to demonstrate settlement, and no policy on
the Gate 3 vault could have been. That vault is `formula_version` 2, which
enforces `issue_policy_with_validated_odds` and rejects direct issuance with
`ValidatedOddsRequired` (6046). Odds-validated issuance requires a signed packet
less than 15 minutes old — so it can only bind against a match that has not been
played, and therefore has no result to settle against. Settlement requires the
opposite. Both cannot be true of one fixture at one moment.

So the settlement above ran on a separate `formula_version` 1 vault
`EP2fr7ThxUnvRxVmyXXi2c2xm9uu79JMWyTPWFznFFRV`, capitalised with 10 USDC
(<https://explorer.solana.com/tx/5agVgDptA65sbdnmm52ecqaK28kkmmhCAMapAn94yw4AddB6ABbUHHEW9GtJM7S7Ad19CM2kMmwFrSWHdbjCpWF8?cluster=devnet>),
policy issued at
<https://explorer.solana.com/tx/2YcPuHkjpsAZ1zMEZBzKRMNWGwYFcNTxH4YTJCEhmADp3FHU2ecdsDdhBPzb7Sai9rVQagM2R4E5Sptvmng7n9uK?cluster=devnet>.

**What that means for the claims, without spin:** Gate 3 proves odds-validated
issuance — a policy priced from a signed odds packet the chain re-verified.
Gate 6 proves proof-gated settlement — coverage released only against a verified
Merkle proof of the real result. Both are real capital in real escrow on devnet.
Neither is used to imply the other. The Gate 6 policy's premium is computed by
`server/pricing.mjs` from fixture 18257739's real recorded closing book
(message `1838539384:00003:000503-10021-stab`, prices `[17400, 1067, 180000]`,
57,458 ppm), so the figure is reproducible — but it is a broker-side price, not
one the chain re-derived from a validated odds receipt.

### Verified: the proof is genuinely verified, not rubber-stamped

`scripts/gate6-tamper-negative.mjs` — 8/8 against devnet. The test turns on the
rejections being *different*, because "it failed" alone cannot distinguish real
verification from a rubber stamp. Run against the original Gate 3 policy, whose
predicate (WIN_HOME on 18257865) is false because that match finished 4–6:

| payload | on-chain result |
|---|---|
| authentic proof | TxLINE CPI runs to completion and returns a verdict → SURETY reports `TxlinePredicateRejected` (6031). **Reaching 6031 at all proves the proof verified.** |
| one bit flipped in `mainTreeProof[0].hash` | rejected **inside** the TxLINE CPI with `InvalidMainTreeProof`, before any predicate was evaluated |
| proved stat value forged (England 6 → 0) | rejected with `InvalidStatProof` — a forged scoreline does not buy a payout |

This is also the disclosed negative result for the Gate 3 policy: it insures
`WIN_HOME` on a match that finished `WIN_AWAY`, so it correctly receives nothing.
It remains Open until `expire_policy` becomes callable at its `expires_at`,
**2026-08-16T23:15:54Z**; simulation confirms the only obstacle is the clock.

### Payload shape

`StatValidationInput` serialized correctly — 222,156 CU consumed reaching
predicate evaluation, impossible otherwise. Two field names differ from TxLINE's
JSON and would have failed silently: `payload.fixtureProof` is fed from the
proof's `subTreeProof`, and `summary.eventsSubTreeRoot` is TxLINE's
`eventStatsSubTreeRoot`.

### Self-audit

1. Network cut: every step hits live TxLINE and devnet and fails closed. Observed
   the settle script exit non-zero with a diagnosis on the false-predicate policy
   rather than fabricate a settlement.
2. Corrupt input: tampered tree proof and forged stat value are both rejected
   on-chain, with different errors than an authentic proof.
3. Escape-hatch grep: no mock, demo flag, hardcoded outcome, or success-
   fabricating catch. The catches in the negative test assert on-chain rejections
   and read the real error code rather than asserting "should have failed".
4. Claim-to-code: every figure is printed by a script that refetches from chain;
   `gate6-verify-settlement.mjs` does not trust the settling script's output.
5. Fresh state: both write-capable scripts simulate by default and require
   `GATE6_CONFIRM=yes`. The second vault and its policy are reproducible from
   `gate6-create-settlement-vault.mjs` and `gate6-issue-policy-direct.mjs`.
