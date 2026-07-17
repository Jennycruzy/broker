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
