# Gates 4 & 6 — handoff (as of 2026-07-25)

This handoff picks up mid-build of Gate 6 (automatic settlement) and Gate 4
(agent tooling). It is written so a fresh operator — or a fresh Claude Code
session — can resume without re-reading the whole conversation.

The build strictly follows the anti-fake doctrine: real on-chain evidence,
no mocks, no synthesized proofs, no hardcoded outcomes. Every claim below
is either code you can run or a chain state you can independently refetch.

---

## What is DONE and green

### Environment
- **Node runtime**: v24.18.0 (installed via `nvm install --lts`). `package.json`
  requires `>=20`. On this laptop the shell default is v18.20.8 — always
  `nvm use --lts` before running BROKER scripts.
- **TxLINE credentials**: `.secrets/txline-devnet.json` (mode 600) copied from
  the VPS. `bridge/txline.mjs::createTxlineSession` uses it end-to-end.
- **Solana caller**: `~/.config/solana/id.json`
  (`JBe17qhF2zge69dYBDfQfbjcpRUYci5XjjPWoaRosxaz`) — 9.87 SOL, no USDC yet.
  `settle_policy` only needs the caller as signer; USDC is only needed if
  you want to bind a fresh policy first (see "Optional bind branch" below).

### Package fix (persisted via patch-package)
- `patches/@surety-tx+txline-verify+0.1.0.patch` rewrites one import line in
  the shipped package to work around an ESM/CJS bug that would otherwise
  break every script that imports the verify helpers. `npm install`
  re-applies it via a `postinstall` hook. Upstream owe: publish
  `@surety-tx/txline-verify@0.1.1` from `Jennycruzy/surety` with the same
  one-line change, then remove this patch.

### Gate 6.1 + 6.2 — TxLINE scores client + shape helpers
- **File**: `bridge/txline_scores.mjs`
- Exports `fetchScoresSnapshot`, `findGameFinalisedSeq`, `fetchStatProofV2`,
  `fetchCombinedStatProof`, `fetchFullMatchResult`,
  `assertAuthenticStatProofShape`.
- **Correct stat keys**: `STAT_KEY_FULL_MATCH_P1_GOALS = 1`,
  `STAT_KEY_FULL_MATCH_P2_GOALS = 2`, `FINAL_PERIOD = 100`. These match
  what `settle_policy` in `programs/surety_core/src/lib.rs`
  (`strategy_for_policy` clause type 2) actually verifies. The snapshot
  row's `Stats["3001"]/["3002"]` fields are a different aggregation and
  are NOT what the on-chain program checks.
- Shape helper asserts `stat.period === FINAL_PERIOD` — so a mid-match
  proof would be rejected before it ever hit the chain.

### Gate 6 probe (read-only, no chain writes)
- **File**: `scripts/gate6-probe-scores.mjs`
- **Run**: `npm run probe:gate6`
- **Result today (PASSING)**:
  - fixture 18257865 (France v England)
  - `game_finalised` Seq = 1195
  - Stat proof for key=1 period=100 → **P1 value 4**
  - Stat proof for key=2 period=100 → **P2 value 6**
  - Canonical full-time result: **P1 4, P2 6 → WIN_AWAY** (not WIN_HOME)
  - `dailyScoresRoot` PDA `C9vY83pzub2a4d3Qve5NuR4cuXc8Yq68fKRRad4xR4bi`
    present on devnet, TxLINE-owned, 9232 B — `settle_policy` will find it.

### On-chain state we care about
- **Vault** `CrnjZE2DXMPLtRXJ6MPHaKifEi13qp1vAFn9ohXBpqZu`
  - asset mint: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` (Circle
    native devnet USDC)
  - total_capital: 16.24 USDC (11.24 free reserves + 5 locked in escrow)
- **Policy** `9APDuVP895jBhj6u3iZbdr65difkiCW6vDtfMrAfx58L`
  - status: `Open`
  - predicate: WIN_HOME on fixture 18257865
  - coverage: 5 USDC, premium: 4.241692 USDC
  - policy_escrow: `FfXeHt7zCiD7jY3rYK6Tg9TBuu1x4ZBK2uQPV48SpTGT` (5 USDC)
  - payout_authority: `CarQShkY6uY8HvCD392uaevcttP4gpn55D61UMkpKZox`
- **Expected settle outcome**: WIN_AWAY is true (P1 4 < P2 6), WIN_HOME
  is false → **expire branch**: escrow 5 USDC returns to vault reserve;
  no payout to holder ATA. Real on-chain state transition either way.

---

## What is LEFT — Gate 6

### 6.3 — settle orchestrator (**next work item**)
**New file**: `scripts/gate6-settle-policy.mjs`

Blueprint (all inputs already validated by the probe):

```js
// Load caller (~/.config/solana/id.json), assert SOL >= 0.02
// Read policy account = env.GATE6_POLICY ?? "9APDu…x58L"
// Read vault via policy.vault
// Derive:
//   policy_escrow  = pda(["policy_escrow", policy])
//   bucket         = pda(["bucket", vault, policy.bucketHash])
//   payout_account = getAssociatedTokenAddressSync(
//                      vault.assetMint, policy.payoutAuthority)   // pre-existing
//   dailyScoresMerkleRoots = pda(["daily_scores_roots", u16LE(epochDay)],
//                                TXLINE_PROGRAM_ID)
//     where epochDay = Math.floor(payload.ts / 86_400_000)
// Fetch TxLINE:
//   session = createTxlineSession()
//   { rows } = fetchScoresSnapshot(session, fixtureId)
//   seq = findGameFinalisedSeq(rows)
//   { proof } = fetchCombinedStatProof(session, {
//                  fixtureId, seq, statKeys: [1, 2] })
// Build StatValidationInput (mirror v2-payload.ts in Jennycruzy/surety):
//   ts             = new BN(proof.summary.updateStats.minTimestamp)
//   fixtureSummary = { fixtureId: BN, updateStats: {...}, eventsSubTreeRoot }
//   fixtureProof   = mapProof(proof.subTreeProof)
//   mainTreeProof  = mapProof(proof.mainTreeProof)
//   eventStatRoot  = proof.eventStatRoot
//   stats          = proof.statsToProve.slice(0, 2).map((stat, i) => ({
//                      stat, statProof: mapProof(proof.statProofs[i])
//                    }))
// Simulate first (getSimulationResult). If GATE6_CONFIRM=yes, .rpc() it.
// preInstructions: ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })
// Accounts (accountsStrict, from setup-settlement-demo.ts):
//   caller, vault, assetMint, reserve, bucket, policy, policyEscrow,
//   payoutAccount, txlineProgram, dailyScoresMerkleRoots, tokenProgram
// Print: settle tx URL, before/after balances of policyEscrow, reserve,
// payoutAccount; new policy.status.
```

**Reference implementations to copy from** (not vendored; read on GitHub):
- `Jennycruzy/surety` `scripts/setup-settlement-demo.ts` — the full
  `settlePolicy(payload)` call including accountsStrict + compute budget.
- `Jennycruzy/surety` `services/settlement/src/v2-payload.ts` —
  `settlementPayloadFromProof(proof)`, exact anchor payload shape.
- `Jennycruzy/surety` `app/lib/settle-action.ts` — the "any funded caller
  can settle" pattern, matches what we want here.

### 6.4 — independent verifier
**New file**: `scripts/gate6-verify-settlement.mjs`

Re-fetch from chain (don't trust 6.3's stdout):
- policy.status is `triggered` or `expired` (was `open`)
- policyEscrow token balance is 0 (was 5000000)
- If expire branch: vault reserve balance +5000000
- If payout branch: payoutAccount balance +5000000
- Print explorer URL for the settle tx.

### 6.5 — negative test
**New file**: `scripts/gate6-tamper-negative.mjs`

Flip one bit in `mainTreeProof[0].hash` and resubmit. Assert on-chain
rejection with the actual error code. Discover the code from the IDL's
`errors[]` (likely `SettlementProofInvalid` or a TxLINE CPI 6003/6004).
Never assert "should have failed" — read the actual error, print it,
assert non-success.

### 6.6 — evidence
Append `## Gate 6 — Automatic settlement: PASS` to `EVIDENCE.md`:
- real settle_policy tx hash
- real outcome (WIN_HOME false → expire branch)
- policy_escrow before/after: 5.000000 → 0
- vault reserve before/after: 11.241692 → 16.241692
- negative test: tampered proof rejected with error code X on tx Y
- anti-fake self-audit block matching Gate 3 style

### Optional bind branch (only if a fresh policy is wanted)
If the user wants a WIN_AWAY policy that will pay out instead of expire:

1. Fund `JBe17q…osxaz`'s USDC ATA with ≥ 5 USDC via Circle's manual
   faucet at <https://faucet.circle.com/> (Solana chain, USDC token).
   The ATA `E5EJR8185QDjrzKsQ4Ers5ZLPFSQiaJQ1Tzcui68vRut` will be
   created automatically on receipt.
2. Run `GATE3_OUTCOME=WIN_AWAY GATE3_VAULT=CrnjZE2DXMPLtRXJ6MPHaKifEi13qp1vAFn9ohXBpqZu
   node scripts/gate3-issue-policy.mjs` — this reuses the existing
   validated-odds issuance path. It hardcodes `.secrets/gate2-solana.json`
   as the payer; change that to also read `~/.config/solana/id.json` (or
   thread through a `GATE3_HOLDER_KEYPAIR` env var).
3. Pass the resulting policy pubkey into `scripts/gate6-settle-policy.mjs`
   via `GATE6_POLICY`.

This branch demonstrates the payout side of settle_policy but is not
required for a green Gate 6 — the expire branch is equally real on-chain
evidence.

---

## What is LEFT — Gate 4

Nothing built yet. Full spec is in `.claude/plans/pure-wiggling-waffle.md`
sections 4.1–4.7. Order of operations:

1. `mcp/server.mjs` — real stdio MCP server, 4 tools (quote_coverage,
   bind_coverage, policy_status, vault_solvency). Env-configured
   (`BROKER_URL`, `SURETY_RPC_ENDPOINT`), zero hardcoded pubkeys.
2. `skills/broker/SKILL.md` — Claude Code skill file, frontmatter with
   hedge/insurance/prize-indemnity trigger keywords.
3. `mcp/README.md` — three-line install/connect docs.
4. `scripts/gate4-verify.mjs` — spawn `mcp/server.mjs` as subprocess,
   speak MCP JSON-RPC, assert every tool's response byte-matches a
   direct HTTP/RPC call.
5. Manual fresh Claude Code run → save transcript to
   `docs/GATE4_TRANSCRIPT.md`.
6. Prep upstream PR against `InjectiveLabs/agent-skills` (default branch
   `master`). Operator opens the PR (their GitHub identity).
7. Append `## Gate 4 — Agent tooling: PASS` to `EVIDENCE.md` and remove
   the three README `<!-- TODO (Gate 4) -->` blocks.

Add to `package.json` scripts: `mcp`, `verify:gate4`, `settle:gate6`,
`verify:gate6`. Add dependency `@modelcontextprotocol/sdk`.

---

## How to resume

1. `nvm use --lts` (must be Node 20+; local default is 18)
2. `npm install` (re-applies the patch)
3. `npm run probe:gate6` — confirms TxLINE + on-chain root are still live
   before touching anything write-side
4. Pick up at "Gate 6.3 — settle orchestrator" above.
5. Before firing a real settle tx, confirm with the operator. Escrow
   movement is irreversible.

## Files touched in this session

- **new**: `bridge/txline_scores.mjs`, `scripts/gate6-probe-scores.mjs`,
  `patches/@surety-tx+txline-verify+0.1.0.patch`,
  `.secrets/txline-devnet.json`, `docs/GATE_HANDOFF.md` (this file)
- **modified**: `package.json` (postinstall + probe:gate6 script + patch-package
  devDep), `docs/FRICTION_LOG.md` (corrected stat-key entry, added 4 new
  entries covering Node 18, caller-signer rule, and Circle faucet)
- **untouched**: all Gate 0–3 code, deployed SURETY program, README, EVIDENCE.md

## Files NOT yet created (planned)

- `scripts/gate6-settle-policy.mjs`
- `scripts/gate6-verify-settlement.mjs`
- `scripts/gate6-tamper-negative.mjs`
- `mcp/server.mjs`
- `mcp/README.md`
- `skills/broker/SKILL.md`
- `scripts/gate4-verify.mjs`
- `docs/GATE4_TRANSCRIPT.md`
