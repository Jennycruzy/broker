# Friction log

Append-only observations captured while they occurred.

## 2026-07-17T19:55Z — repository search utility unavailable

- Environment: `/workspaces/broker`, bash, Node `v24.14.0`, npm `11.9.0`.
- Reproduction: `rg --files`.
- Actual: `rg: command not found`.
- Adaptation: used read-only `find`; no product impact.

## 2026-07-17T20:00Z — sandbox DNS blocked primary-source probes

- Reproduction: `curl -fsSL https://api.github.com/repos/InjectiveLabs/mcp-server/commits/main`.
- Actual: `Could not resolve host: api.github.com` inside the default sandbox.
- Adaptation: repeated the same read-only call with operator-approved network
  access. It returned commit `daa98388cdf6c472c93211b1e9059725d72bc42e`.

## 2026-07-17T20:04Z — Injective agent-skills default branch is not `main`

- Reproduction: GitHub API request for `InjectiveLabs/agent-skills/commits/main`.
- Actual: HTTP 422. Repository metadata reports default branch `master`.
- Adaptation: queried `commits/master`, obtaining
  `6d68c2c3b9192e52795c8701e9ba94c53a2f67e9`.

## 2026-07-17T20:10Z — hosted Injective x402 facilitator hostname unresolved

- Source: published `@injectivelabs/x402@0.0.1` README names
  `x402.injective.network` as the hosted facilitator operator.
- Reproduction: `curl https://x402.injective.network/` with approved network
  access.
- Actual: `Could not resolve host: x402.injective.network`.
- Impact: hosted facilitator is unverified. The published reference facilitator
  remains a real on-chain option, provided it has a funded gas payer.

## 2026-07-17T20:13Z — supplied “vault” address is a program

- Reproduction: Solana devnet `getAccountInfo` for
  `3e5rBR2J9uHPHHn6tP8HF6mPbEJsJWtzQEyicv6v8qVW`.
- Actual: executable account owned by the upgradeable BPF loader; 34 data bytes.
- Additional probe: `getProgramAccounts` found 261 program-owned accounts.
- Impact: the intended vault PDA cannot be selected honestly without the deployed
  IDL/configuration.

## 2026-07-17T20:14Z — required public npm package is absent

- Reproduction: `GET https://registry.npmjs.org/@surety%2Ftxline-verify/latest`.
- Actual: HTTP 404.
- Additional reproduction: npm registry search for `txline-verify`; no required
  package returned.
- Impact: frozen requirement to import `@surety/txline-verify` from public npm and
  the Gate 7 registry-install check cannot be met. Build stopped under the blocker
  protocol.

## 2026-07-17 — package-name blocker resolved from SURETY source

- Operator supplied <https://github.com/Jennycruzy/surety>.
- Inspected commit: `a2f205c9efe90543bb5a867422c105f9f1832ed4`.
- Finding: `packages/txline-verify/package.json` names the published package
  `@surety-tx/txline-verify@0.1.0`; the original `@surety` scope was incorrect.
- Reproduction: clean install from `https://registry.npmjs.org`, with scripts
  disabled, followed by a direct import of the installed artifact.
- Actual: install passed; `validateOddsOnDevnet` and
  `suretyOddsValidationInput` were exported functions.
- Resolution: pin the real public package name, version, and integrity. No local
  path, Git dependency, or verifier reimplementation is needed.

## 2026-07-17 — program/vault ambiguity resolved

- Source: pinned SURETY `DEPLOY.md` and `target/idl/surety_core.json`.
- Program: `3e5rBR2J9uHPHHn6tP8HF6mPbEJsJWtzQEyicv6v8qVW`.
- Showcase vault: `CDyQxhDHsaWYNBvjJgGPVFZdsBD3mC28VEX5DkCZkqEC`.
- FRA–ENG formula-v2 vault:
  `9npibs7NyjhgWrG5muCFbLRCDoVxMiWWEfp2yMXhUNyF`.
- Live check: both vault accounts are non-executable and owned by the SURETY
  program. BROKER will target the formula-v2 vault for validated issuance.

## 2026-07-17T20:48Z — documented Injective faucet endpoint returns 404

- Official source:
  <https://docs.injective.network/developers-defi/testnet-faucet-integration>,
  last modified 2026-05-07.
- Reproduction: POST `{"address":"inj1yep2...un9udu"}` to the documented
  `https://jsbqfdd4yk.execute-api.us-east-1.amazonaws.com/v1/faucet` endpoint.
- Actual: HTTP 404, body `{"message":"Not Found"}`.
- Live balance confirmation: facilitator INJ balance is zero; payer testnet-USDC
  balance is zero.
- Impact: the real x402 settlement cannot execute until the two public addresses
  are funded through the interactive Injective and Circle faucets.

## 2026-07-17 — Injective public RPC omitted a mined x402 receipt

- Package: `@injectivelabs/x402@0.0.1`; viem `2.55.2`.
- Submitted transaction:
  `0x1df3a43e3b0e8bb92efe05083ebcd2b4c70047e68c7b697a3eefd26dde04ba9c`.
- Actual: `waitForTransactionReceipt` reported the hash could not be found and
  middleware returned HTTP 402. Direct JSON-RPC transaction and receipt queries
  also returned `null`.
- Contradicting chain evidence: payer USDC fell by 10,000 units, facilitator USDC
  rose by 10,000 units, and Injective's Blockscout API returned status 1, successful
  transfer logs, block `133858194`, and the complete transaction.
- Impact: payer was charged but received no bind authorization.
- Adaptation: a remote facilitator wrapper reconciles only this mined-transaction
  failure through the official explorer API and compares successful status, hash,
  facilitator sender, asset destination, and exact EIP-3009 calldata. Corrupt and
  failed transaction tests reject reconciliation.
- Follow-up: file a reproducible upstream issue during the required contribution
  phase, linking the transaction.

## 2026-07-17 — no deployed SURETY vault accepts native CCTP USDC

- CCTP destination asset: Circle native Solana-devnet USDC
  `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`.
- Enumerated all live SURETY `Vault` accounts using the Anchor discriminator
  against program `3e5rBR2J9uHPHHn6tP8HF6mPbEJsJWtzQEyicv6v8qVW`.
- Actual: 19 vaults; none has the Circle USDC mint.
- FRA–ENG vault `9npibs7NyjhgWrG5muCFbLRCDoVxMiWWEfp2yMXhUNyF`
  records asset mint `FiJfrnLoc2vZmjixZqCEBuWd8A5EuDaF9MZZhd96bpck` and reserve
  `C4Nz89GHiQGK1kETtAKADBQpq9KsVhFdBYmqwcJdAhps`.
- Independent reserve-account decode confirmed the reserve is a 165-byte SPL token
  account whose mint is `FiJfrn...bpck` and whose token owner is the FRA–ENG vault.
- Impact: CCTP cannot mint native USDC into this reserve. Burning now would either
  fail at destination or put premium into a separate token account that cannot
  capitalize policy issuance.
- Action: stopped before any CCTP burn under the blocker protocol.

## 2026-07-17 — native-USDC SURETY vault created

- Operator authorized creating a compatible vault under the existing program.
- Initialization transaction:
  `3hi9pvNKv835wPnRG7NkPUynZbhMNWpV7KwPY3CaiPuZcaLpKRVNMWojb1ahgAR3rhKaE6b6Nt9Qy4Tj3yoaGc5B`.
- Vault: `6BaUXkDZAEmdwGHf1B8KNRUqqYvpTbKmzLdKCrH4eGrp`.
- Reserve: `EgwE41BznuyVGtboQb5uBHsPdbabBzjzhyWYr3VRYC5J`.
- Verified: formula version 2 arguments were submitted; parsed reserve account uses
  native Solana-devnet USDC and is owned by the vault PDA.

## 2026-07-17 — Circle V2 on-chain IDLs unavailable

- Reproduction: Anchor `Program.fetchIdl` for both documented Circle V2 Solana
  programs returned null.
- Impact: the first mint attempt stopped before constructing or signing a
  transaction; the attested burn remained pending and replayable.
- Adaptation: load the IDLs from Circle's official
  `circle-cctp-crosschain-transfer` repository pinned at commit
  `84f8a717a3a6164f12586804d96c3fac2f5432e7`, enforcing SHA-256
  `52f1c03b...79e8e1` and `434730e9...9f40d` before use.

## 2026-07-17 — pinned Solana stack has unresolved advisories

- Exact versions match SURETY: `@anchor-lang/core@1.0.2`,
  `@solana/web3.js@1.98.4`, `@solana/spl-token@0.4.14`.
- `npm audit` reports 10 transitive findings: 7 moderate, 3 high. The suggested
  automatic replacements are older/incompatible major versions, including
  `web3.js@0.0.3` and `spl-token@0.1.8`.
- No forced downgrade was applied. Runtime inputs remain bounded and authenticated;
  dependency remediation is **unverified** pending compatible upstream releases.

## 2026-07-17T22:00Z — Gate 3 issuance requires fresh live odds behind a TxLINE token

- On-chain constraint: `programs/surety_core/src/lib.rs` sets
  `MAX_ODDS_AGE_MS = 15 * 60 * 1000`. `validate_verified_quote` requires
  `validated_odds.odds_timestamp_ms` to be within 15 minutes (plus 30s skew) of
  the on-chain issuance clock, or it fails with `StaleOddsProof`.
- Consequence: SURETY's committed recordings in `data/recordings/` (captured
  2026-07-16, >24h ago) can be re-verified but **cannot back a live issuance**.
  A fresh odds packet must be fetched at issue time.
- Source of fresh odds: SURETY's `services/odds-validation/src/live.ts`
  (`createTxlineSession` → `fetchLatestFullMatchOdds` / `fetchOddsProof`) fetches
  the packet and its server-side merkle proof from the TxLINE API at
  `https://txline-dev.txodds.com`.
- Reproduction: `POST https://txline-dev.txodds.com/auth/guest/start` returns a
  guest JWT (HTTP 200). But `GET /api/fixtures/snapshot` with only that JWT
  returns **HTTP 403 `Missing API token`**. The data API also requires the
  `X-Api-Token` secret loaded by `services/feed-ingest/src/auth.ts` from
  `TXLINE_API_TOKEN` or `.secrets/txline-devnet.json` (`{ "apiToken": ... }`).
- Actual: neither `TXLINE_API_TOKEN` nor `.secrets/txline-devnet.json` is present
  in this environment. The live fresh-odds fetch is therefore blocked.
- Verified-ready around the blocker: the deployed TxLINE validator is posting
  daily merkle roots on devnet through **today** (epoch-day 20651, oddsRoot
  `6X3icYs69wH3XyyLANDUsmsQMTPLRfDiwzfNqiUmwxsX`, EXISTS, owned by the TxLINE
  program). So once fresh odds are fetchable, `record_validated_odds` /
  `record_validated_fixture` / `issue_policy_with_validated_odds` will find a
  current root to verify against.
- Action: stopped before issuance under the blocker protocol; escalated to the
  operator for the TxLINE API token. No stale or synthesized proof was
  substituted.

## 2026-07-17T22:05Z — package fixture tamper helper is a no-op on single-update proofs

- `@surety-tx/txline-verify` `validateFixtureOnDevnet(provider, proof,
  { tamperFirstProofBit: true })` only flips `subTreeProof[0]`.
- The recorded FRA–ENG fixture proof
  `txline-18257865-1784149200000-fixture-proof.raw.json` has an **empty**
  `subTreeProof` (a single-update fixture), so the helper is a no-op and the
  validator still returns `true`.
- Adaptation for an honest negative test: corrupt `mainTreeProof[0]` directly.
  The devnet validator then rejects with error 6004 `InvalidMainTreeProof`.
- The odds tamper helper works as intended (subTreeProof length 5) and is
  rejected with error 6003 `InvalidSubTreeProof`.
- Follow-up: candidate upstream issue — document that `tamperFirstProofBit` is
  ineffective on empty-sub-tree fixture proofs.

## 2026-07-17T22:35Z — TxLINE token supplied; live pipeline unblocked

- Operator supplied the TxLINE API token; written to `.secrets/txline-devnet.json`
  (gitignored). `POST /auth/guest/start` + `X-Api-Token` now returns HTTP 200.
- Live verify: France v England (fixture 18257865, kickoff 2026-07-18 21:00 UTC)
  is present in the authenticated snapshot; a fresh full-match 1X2 packet and its
  fixture proof were fetched and both verified on-chain by the TxLINE validator
  (`scripts/gate3-verify-live-proof.mjs`).
- Pricing de-risk: `server/pricing.mjs` reproduces the on-chain quote math and is
  byte-exact against SURETY's Rust vector `verified_quote_hash_matches_the_typescript_vector`
  (`server/pricing.test.mjs`, 4/4).

## 2026-07-17T23:05Z — TxLINE demo feed emits 1X2 packets intermittently

- After funding, the latest canonical full-match 1X2 packet for every fixture in
  the snapshot was stale: France v England 36.8 min, Spain v Argentina 68.3 min,
  Vietnam v Myanmar 39.2 min — all beyond the on-chain 15-minute window.
- Earlier in the session the France v England 1X2 line refreshed roughly every
  ~12 minutes (22:18 → 22:30 UTC), then paused. The demo feed is intermittent
  this far ahead of kickoff.
- Impact: issuance cannot run until a packet lands inside the freshness window.
  `scripts/gate3-issue-policy.mjs` was given a `GATE3_WAIT_MINUTES` poll loop
  that fires issuance the moment a sub-10-minute packet appears. Not a defect —
  an external feed-cadence constraint, disclosed.

## 2026-07-25T16:35Z — `@surety-tx/txline-verify@0.1.0` is unimportable as shipped

- Reproduction (fresh `npm install`, Node 18, 20, or 22 — all identical): any
  ESM `import` from `@surety-tx/txline-verify` throws
  `SyntaxError: Named export 'BN' not found. The requested module
  '@anchor-lang/core' is a CommonJS module`.
- Root cause: `@surety-tx/txline-verify` is `type: module` and its
  `dist/txline.js` does `import { BN, Program } from "@anchor-lang/core"`, but
  `@anchor-lang/core@1.0.2` has no `exports` map and its `main` field resolves
  to CJS. Node's ESM loader cannot statically extract named exports from a CJS
  module without an `exports` map, so the import throws before any code runs.
- Impact: every BROKER script that touches TxLINE on-chain
  (`gate3-verify-live-proof.mjs`, `gate3-issue-policy.mjs`,
  `gate3-verify-policy.mjs`, new `gate6-*`) is broken on a clean install. Gate
  3 evidence stands (those transactions are on-chain and independently
  refetchable), but the verification scripts as of today do not run.
- Local fix: `patches/@surety-tx+txline-verify+0.1.0.patch` (via
  `patch-package`) rewrites the one offending import to the CJS-safe
  `import anchorLang from "@anchor-lang/core"; const { BN, Program } =
  anchorLang;`. `npm install` re-applies the patch via a `postinstall` hook.
- Upstream fix owed: publish `@surety-tx/txline-verify@0.1.1` from
  `Jennycruzy/surety` with the same one-line change to
  `packages/txline-verify/src/txline.ts`. Then remove the local patch and
  pin `^0.1.1`. Filed as followup — not blocking.

## 2026-07-25T16:45Z — TxLINE dev still serves scores for fixture 18257865

- Reproduction: `node scripts/gate6-probe-scores.mjs` (read-only; no chain
  writes, no keypair required).
- Result: PASS end-to-end. TxLINE snapshot returned 39 rows including a
  `game_finalised` action at Seq 1195. Daily-scores-root PDA
  `C9vY83pzub2a4d3Qve5NuR4cuXc8Yq68fKRRad4xR4bi` is present on devnet, owned
  by TxLINE program `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J`, with
  9232 bytes of data.
- Corrected below: the first version of this probe used statKeys 3001/3002
  and reported "P1 4, P2 2" — those keys/periods are **not** what
  `settle_policy` verifies against. See next entry.

## 2026-07-25T18:15Z — WIN_HOME/DRAW/WIN_AWAY predicates require stat keys 1 and 2 at period 100

- On-chain source: `Jennycruzy/surety` `programs/surety_core/src/lib.rs`
  `strategy_for_policy` clause type 2 calls `require_leaf(payload, 0, 1)`
  and `require_leaf(payload, 1, 2)`; `require_leaf` asserts
  `leaf.stat.period == txline::FINAL_PERIOD`. `crates/txline-cpi/src/lib.rs`
  pins `pub const FINAL_PERIOD: i32 = 100`.
- Consequence: the on-chain-verifiable full-match goal leaves are
  `{ key: 1, period: 100 }` and `{ key: 2, period: 100 }`. The snapshot
  row's `Stats["3001"]/["3002"]` fields are a different, human-facing
  aggregation that TxLINE never hashes into the merkle tree that
  `validate_stat_v2` verifies. Submitting them would revert with
  `SettlementPredicateMismatch`.
- Reproduction: `GET /api/scores/stat-validation?fixtureId=18257865&seq=1195&statKeys=1,2`
  against `https://txline-dev.txodds.com` returns
  `statsToProve: [{key:1,value:4,period:100},{key:2,value:6,period:100}]`.
- Canonical full-time result for fixture 18257865: **P1 4, P2 6**
  (`goals_home 4, goals_away 6` in SURETY's naming). Since `4 > 6` is
  false, `WIN_HOME` evaluates to false → the existing WIN_HOME policy
  `9APDuVP895jBhj6u3iZbdr65difkiCW6vDtfMrAfx58L` will settle to the
  expire branch (escrow returns to reserve, no payout). A `WIN_AWAY`
  policy on the same fixture would settle to the payout branch.
- Fix applied: `bridge/txline_scores.mjs` now exports
  `FINAL_PERIOD = 100`, `STAT_KEY_FULL_MATCH_P1_GOALS = 1`,
  `STAT_KEY_FULL_MATCH_P2_GOALS = 2`, and its shape assertion enforces
  `stat.period === FINAL_PERIOD`. Probe re-run PASSES with correct keys.

## 2026-07-25T18:20Z — Node 18 blocks the pinned Solana stack

- Reproduction: any BROKER script that imports `@solana/web3.js@1.98.4`
  under Node 18 throws
  `Error [ERR_REQUIRE_ESM]: require() of ES Module .../rpc-websockets/node_modules/uuid/dist-node/index.js from .../rpc-websockets/dist/index.cjs`.
- Root cause: `rpc-websockets` (transitive dep of `@solana/web3.js`)
  ships CJS that `require()`s `uuid@11`, which is ESM-only.
- Adaptation: installed Node 24.18.0 (current LTS) via nvm. `package.json`
  already declares `"engines": { "node": ">=20" }` — the constraint was
  correct; the local shell default (`v18.20.8`) was wrong. All Gate 6
  scripts now run cleanly under Node 24.

## 2026-07-25T18:25Z — `settle_policy` only needs a funded caller signer

- On-chain source: `programs/surety_core/src/lib.rs` `SettlePolicy` accounts
  struct — `caller` is the only `Signer`. `payout_account` is constrained
  by Anchor to `token::authority = policy.payout_authority`, so payout
  always lands in the policy holder's ATA regardless of who submits.
- Consequence: any funded devnet keypair can settle the existing open
  policy `9APDuVP895jBhj6u3iZbdr65difkiCW6vDtfMrAfx58L` (5 USDC coverage
  on vault `CrnjZE2DXMPLtRXJ6MPHaKifEi13qp1vAFn9ohXBpqZu`). We do not
  need the original policy-holder key to complete Gate 6.
- Applied: this laptop's default Solana keypair `~/.config/solana/id.json`
  (`JBe17qhF2zge69dYBDfQfbjcpRUYci5XjjPWoaRosxaz`, 9.87 SOL) is the
  Gate 6 caller. No new secret file needed for the settle path.

## 2026-07-25T18:30Z — Circle devnet USDC faucet is not programmatically callable

- Reproduction: `POST https://faucet.circle.com/api/faucet` with a JSON
  body returned HTTP 404 (Next.js `_not-found` page). The public faucet
  is a Next.js UI behind Google reCAPTCHA v3 (site key
  `6LcNs_0pAAAAAJuAAa-VQryi8XsocHubBk-YlUy2`).
- Impact: automating a "fresh keypair → bind fresh policy → settle" flow
  needs an out-of-band manual USDC top-up step. The Gate 6 settle path
  itself does not require the caller to hold USDC (see prior entry), so
  the read-only settle branch is fully automatable; only the bind branch
  needs manual funding.
