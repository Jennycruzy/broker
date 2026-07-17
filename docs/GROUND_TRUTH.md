# Gate 0 — Ground truth

Probe time: 2026-07-17T20:16:20Z. This document records only facts observed from
primary documentation, pinned upstream commits, public registries, or live RPC/API
responses during this build session.

## Verdict

**The architecture works as specified with one corrected dependency name and the
documented non-atomic watcher route.**

The Injective-testnet to Solana-devnet CCTP route exists and the non-atomic,
permissionless attestation-watcher design is supported. The required verifier is
public under the repository's actual package name,
`@surety-tx/txline-verify@0.1.0`; the input spec's `@surety/txline-verify` name does
not exist. The supplied `3e5rBR2J9uHPHHn6tP8HF6mPbEJsJWtzQEyicv6v8qVW`
address is the SURETY program ID. The repository identifies separate vault accounts.

No product code has been written.

## Injective x402

- The public npm registry served `@injectivelabs/x402@0.0.1` with integrity
  `sha512-uHxTHz/bsX3kvIYPLXC/x0pZ6jcluRqowGLbXsEuFlVeG7rDNUXimrbNScnhRqZcPkMfjEHtMwiRuCOP6Kau4A==`.
  Registry URL: <https://www.npmjs.com/package/@injectivelabs/x402>
- Its published README documents Express middleware, a local/reference facilitator,
  an x402 client, EIP-3009 settlement, Injective EVM mainnet chain 1776, testnet
  chain 1439, mainnet USDC `0xa00C59fF5a080D2b954d0c75e46E22a0c371235a`,
  and testnet USDC `0x0C382e685bbeeFE5d3d9C29e29E341fEE8E84C5d`.
- The middleware emits a real HTTP 402 when `PAYMENT-SIGNATURE` is absent, calls
  facilitator verification and settlement when it is present, and returns the
  settlement receipt in `PAYMENT-RESPONSE`. This is a code-reading result from the
  registry tarball, not yet a paid transaction.
- The published package says a hosted operator "at `x402.injective.network` should"
  consume the package. A live DNS request to that hostname failed with
  `Could not resolve host`; a hosted facilitator is therefore **unverified**.
- Later phases must use either a subsequently verified hosted facilitator or the
  package's real reference facilitator with an on-chain funded gas payer. A mock
  402 is not an option.
- Injective's official network page gives testnet chain ID 1439 and RPC
  `https://k8s.testnet.json-rpc.injective.network/`:
  <https://docs.injective.network/developers-evm/network-information>.
- Live RPC returned `eth_chainId = 0x59f` (1439).

## Injective MCP server

- Repository: <https://github.com/InjectiveLabs/mcp-server>
- Pinned commit observed from GitHub's API:
  [`daa98388cdf6c472c93211b1e9059725d72bc42e`](https://github.com/InjectiveLabs/mcp-server/commit/daa98388cdf6c472c93211b1e9059725d72bc42e)
  dated 2026-07-14.
- Official setup uses local stdio, Node.js, `npm install && npm run build`, then
  `node dist/mcp/server.js` with `INJECTIVE_NETWORK=mainnet` or `testnet`:
  <https://docs.injective.network/developers-ai/mcp>.
- The current pinned README exposes **33 tools, not 22**:
  `address_normalize`; `wallet_generate`, `wallet_import`, `wallet_list`,
  `wallet_remove`; `market_list`, `market_price`, `account_balances`,
  `account_positions`, `token_metadata`; `usdc_native_info`,
  `cctp_supported_chains`, `cctp_attestation_status`, `cctp_mint`;
  `rfq_constants`, `rfq_market_readiness`; `frontend_guidance_topics`,
  `frontend_guidance`; `trade_open`, `trade_close`, `trade_open_eip712`,
  `trade_close_eip712`, `trade_limit_open`, `trade_limit_orders`,
  `trade_limit_close`, `trade_limit_states`; `transfer_send`,
  `subaccount_deposit`, `subaccount_withdraw`; `bridge_withdraw_to_eth`,
  `bridge_debridge_quote`, `bridge_debridge_send`; `evm_broadcast`.

## Agent Skills

- Repository: <https://github.com/InjectiveLabs/agent-skills>
- Pinned `master` commit:
  [`6d68c2c3b9192e52795c8701e9ba94c53a2f67e9`](https://github.com/InjectiveLabs/agent-skills/commit/6d68c2c3b9192e52795c8701e9ba94c53a2f67e9)
  dated 2026-07-11.
- Injective's official install example is
  `npx skills add InjectiveLabs/agent-skills --skill injective-evm-developer`:
  <https://docs.injective.network/developers-ai/injective-evm-developer-skill>.
- The expected contribution is a skill directory containing `SKILL.md` with YAML
  frontmatter (`name` and `description`) and self-contained instructions. The
  upstream contribution path is a pull request to the repository above.

## Circle CCTP route probe

- Circle lists Injective as CCTP domain 29, Solana as domain 5, USDC on both, and
  official testnets when a mainnet is listed:
  <https://developers.circle.com/cctp/concepts/supported-chains-and-domains>.
- Circle lists Injective-testnet TokenMessengerV2 at
  `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` and MessageTransmitterV2 at
  `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA`:
  <https://developers.circle.com/cctp/references/contract-addresses>.
- Live Injective-testnet `eth_getCode` returned 4,350 bytes at the documented
  TokenMessengerV2 address.
- Circle lists Solana-devnet MessageTransmitterV2 program
  `CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC` and TokenMessengerMinterV2
  `CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe`:
  <https://developers.circle.com/cctp/references/solana-programs>.
- Live Solana-devnet `getAccountInfo` reported the documented
  MessageTransmitterV2 account as executable and owned by the upgradeable BPF
  loader.
- Live Circle sandbox request
  `GET https://iris-api-sandbox.circle.com/v2/burn/USDC/fees/29/5` returned HTTP
  200 with finality thresholds 1000 and 2000, each with `minimumFee: 0`. API
  reference: <https://developers.circle.com/api-reference/cctp/all/get-burn-usdc-fees>.
- **Route verdict: yes**, Injective testnet to Solana devnet is a documented and
  live-recognized CCTP route. A funded burn/mint transaction is still
  **unverified** and belongs to Gate 2.

## CCTP Hooks verdict

- Circle documents `hookData` as metadata that can be used by destination logic;
  it does not document automatic arbitrary Solana-program execution merely from
  supplying bytes:
  <https://developers.circle.com/cctp/references/solana-programs>.
- Circle's Forwarding Service can broadcast the Solana mint, but explicitly says
  it does not support wrapper contracts when `destinationCaller` is set. Its
  Solana behavior mints to a USDC associated token account, including a PDA-owned
  ATA; it does not document invoking SURETY's policy instruction:
  <https://developers.circle.com/cctp/concepts/forwarding-service>.
- **Hooks verdict: no authoritative support was found for Hook-triggered SURETY
  issuance on this route.** BROKER must use the specified permissionless watcher:
  burn on Injective, poll Circle, mint on Solana, then separately submit
  `issue_policy_with_validated_odds`. The README must call this non-atomic.

## SURETY and TxLINE

- Repository: <https://github.com/Jennycruzy/surety>
- Pinned commit inspected in this session:
  [`a2f205c9efe90543bb5a867422c105f9f1832ed4`](https://github.com/Jennycruzy/surety/commit/a2f205c9efe90543bb5a867422c105f9f1832ed4).
- Live Solana-devnet `getAccountInfo` for
  `3e5rBR2J9uHPHHn6tP8HF6mPbEJsJWtzQEyicv6v8qVW` reports `executable: true`, owner
  `BPFLoaderUpgradeab1e11111111111111111111111`, and 34 bytes of program data.
  The address is therefore the **program ID**, despite the build spec calling it a
  vault address.
- The pinned repository contains the authoritative Anchor IDL at
  `target/idl/surety_core.json`. Its metadata names `surety_core@0.1.0`, its address
  matches the live program, and it defines `issue_policy_with_validated_odds` with
  holder, vault, reserve, token accounts, exposure bucket, policy, escrow,
  validated-odds receipt, and validated-fixture receipt accounts.
- The repository's deployment guide identifies showcase vault
  `CDyQxhDHsaWYNBvjJgGPVFZdsBD3mC28VEX5DkCZkqEC` and the exercised FRA–ENG
  formula-v2 vault `9npibs7NyjhgWrG5muCFbLRCDoVxMiWWEfp2yMXhUNyF` with asset mint
  `FiJfrnLoc2vZmjixZqCEBuWd8A5EuDaF9MZZhd96bpck`.
- Live Solana-devnet `getMultipleAccounts` confirmed both vault addresses are
  non-executable accounts owned by the SURETY program. The FRA–ENG formula-v2 vault
  is the appropriate Gate 3 target because validated issuance is required.
- The repository package is actually named
  `@surety-tx/txline-verify@0.1.0`, not `@surety/txline-verify`. Public npm served it
  with integrity
  `sha512-X34nN+n+18EIQAJXcM19XQWm8gfdaZnzWxsFU98aAzHIvk/k6XXlNKkfyWvOyqV2sGWL+57sOoTNEnZv8v21PQ==`:
  <https://www.npmjs.com/package/@surety-tx/txline-verify/v/0.1.0>.
- A clean `npm install @surety-tx/txline-verify@0.1.0
  --registry=https://registry.npmjs.org --ignore-scripts` installed 68 packages,
  and importing the registry artifact verified that `validateOddsOnDevnet` and
  `suretyOddsValidationInput` are functions. **Registry consumption is verified.**
- The earlier 404 for `@surety/txline-verify` was a package-name mismatch, not a
  missing publication. BROKER must use the real `@surety-tx` scope everywhere.
- Gate 2 initialized native-USDC formula-v2 vault
  `6BaUXkDZAEmdwGHf1B8KNRUqqYvpTbKmzLdKCrH4eGrp` under the same deployed program.
  Its reserve is `EgwE41BznuyVGtboQb5uBHsPdbabBzjzhyWYr3VRYC5J`; live parsed-account
  verification confirms native devnet USDC mint
  `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` and vault-PDA ownership. This
  replaces the incompatible `FiJfrn...bpck` FRA–ENG vault as BROKER's policy target.

## Gate 3 issuance mechanism (from the pinned SURETY source)

Read in this session from the pinned SURETY commit
`a2f205c9efe90543bb5a867422c105f9f1832ed4`:
`programs/surety_core/src/lib.rs`, `scripts/setup-validated-market.ts`,
`services/odds-validation/src/{sync,live,record}.ts`,
`services/feed-ingest/src/auth.ts`, `app/lib/{config,pda}.ts`.

- `issue_policy_with_validated_odds` reads two pre-existing on-chain PDAs —
  `ValidatedOdds` (seed `validated_odds` + 16-byte message key) and
  `ValidatedFixture` (seed `validated_fixture` + fixture id). These are created
  by `record_validated_odds` / `record_validated_fixture`, which CPI into the
  TxLINE program `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J` to verify the
  proof against the on-chain `daily_batch_roots` / `ten_daily_fixtures_roots`.
- The instruction is fully self-checking; BROKER cannot invent terms. On-chain,
  `validate_verified_quote` re-derives everything: the predicate must be a fixed
  17-byte canonical layout `[1,1,2, fixture_id(8 LE), 0,0, outcome_index, 0,0,0]`;
  the bucket hash must equal `sha256("match:{fixture_id}:{outcome}")`; the premium
  is computed deterministically from `validated_odds.prices` + vault state
  (`validated_quote_terms`) and must match `args.premium`; and `args.quote_hash`
  must equal a `sha256` over domain `SURETY_TXLINE_ODDS_QUOTE_V2`, the vault /
  fixture / odds keys, both receipt hashes, predicate hash, bucket hash, coverage,
  premium, and probability. BROKER computes these from the values it reads back
  off the on-chain validated accounts — matching the contract, not reimplementing
  proprietary logic.
- Freshness: `MAX_ODDS_AGE_MS = 15 * 60 * 1000` and
  `MAX_ODDS_FUTURE_SKEW_MS = 30 * 1000`. The validated odds timestamp must be
  within 15 minutes of the issuance clock, so issuance needs a **freshly fetched**
  odds packet, not a stored recording.
- Fresh odds come from the TxLINE API (`https://txline-dev.txodds.com`) via
  SURETY's `live.ts`, which needs a guest JWT (public) **and** an `X-Api-Token`
  secret (`TXLINE_API_TOKEN` / `.secrets/txline-devnet.json`). The secret is not
  present in this environment — the Gate 3 issuance blocker.
- `reconcile_reserve` folds any surplus reserve balance into `free_reserves` and
  `total_capital` at the start of issuance, so the Gate 2 CCTP-minted USDC in the
  vault reserve becomes underwriting capital automatically.
- The verification primitive is proven independently of the token:
  `scripts/gate3-validate-odds.mjs` runs `validateOddsOnDevnet` /
  `validateFixtureOnDevnet` (read-only `.view()` CPI) against real recorded
  FRA–ENG proofs — authentic proofs verify, tampered proofs are rejected on-chain
  (errors 6003 / 6004).
