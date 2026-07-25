# Gates 4 & 6 — handoff (as of 2026-07-25)

This handoff picks up mid-build of Gate 6 (automatic settlement) and Gate 4
(agent tooling). It is written so a fresh operator — or a fresh Claude Code
session — can resume without re-reading the whole conversation.

The build strictly follows the anti-fake doctrine: real on-chain evidence,
no mocks, no synthesized proofs, no hardcoded outcomes. Every claim below
is either code you can run or a chain state you can independently refetch.

**Last updated: 2026-07-25, end of session.**

> **STATUS: Gates 0–4 and 6 are green. Gate 5 is unknown — the plan file
> (`.claude/plans/pure-wiggling-waffle.md`) is not on this host, and the only
> trace of Gate 5 was a deleted README comment reading "Gate 4/5". Check the
> laptop before assuming it does not exist.**
> `make verify` passes end to end. The sections below are kept for their
> archaeology — the payload shapes, the corrections, the reasoning — but the
> "what is LEFT" lists in them are **stale**. The accurate remaining list is:
>
> 1. `git push origin main` — 4 commits are committed locally and unpushed. The
>    VS Code `GIT_ASKPASS` credential went stale mid-session; nothing else is
>    wrong. Run it from a terminal where you are logged in.
> 2. Upstream PR against `InjectiveLabs/agent-skills` — needs the operator's
>    GitHub identity. Not claimed anywhere in EVIDENCE.md.
> 3. `docs/GATE4_TRANSCRIPT.md` — a fresh-profile agent run. Not claimed
>    anywhere either; the repo does not reference it.
> 4. The Gate 3 policy stays Open until `expire_policy` becomes callable on
>    **2026-08-16**. Disclosed in EVIDENCE.md, not hidden.

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
- ~~**Expected settle outcome**: WIN_AWAY is true (P1 4 < P2 6), WIN_HOME
  is false → **expire branch**: escrow 5 USDC returns to vault reserve;
  no payout to holder ATA. Real on-chain state transition either way.~~
  **WRONG — corrected 2026-07-25.** `settle_policy` has no expire branch.
  It is the payout path only and aborts with `TxlinePredicateRejected`
  (6031) when the predicate is false. Closing out a policy whose outcome
  did not occur is `expire_policy`, a separate instruction, time-gated on
  `expires_at` (2026-08-16T23:15:54Z for this policy). See the session log.

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

## Session log — 2026-07-25 (evening)

Environment note: this session ran on the **VPS** (`/opt/broker`, Node
v22.23.1 at `.runtime/bin/node`), not the laptop. The systemd units
(`broker-dashboard`, `broker-capture-*.timer`) are all active here.

### DONE this session — dashboard now serves real data again

**The bug:** both covered fixtures have been played, so the TxLINE dev feed
has aged their rows out of `/api/fixtures/snapshot`. The live path failed
closed (correctly) and every dashboard card rendered "feed unavailable".
`bridge/txline_replay.mjs` had been written to solve exactly this but was
never imported by anything.

**New file — `bridge/surety_read.mjs`** (read-only SURETY chain reader).
Fetches policy / vault / exposure-bucket / validated-odds state from devnet.
Uses a throwaway keypair for the Anchor provider, so it reads no secret and
signs nothing. Exports `createReadOnlyProgram`, `readPolicy`, `readVault`,
`readBucket`, `readValidatedOdds`, `deriveBucket`, `statusLabel`,
`SURETY_PROGRAM_ID`.

Verified live against devnet this session:

- policy `9APDu…x58L` — status **Open**, coverage 5000000, premium 4241692,
  escrow `FfXeHt7z…SpTGT` holding 5000000
- vault `CrnjZE2D…BpqZu` — reserve 11241692, total capital 16241692,
  free reserves 11241692, locked liabilities 5000000, policy_count 1
- bucket `BfWUcS9Qmbv5Sys8bNCgzJCQDmxstCnr6QawhUciiAFH` —
  locked_exposure 5000000, open_policy_count 1
- **`deriveBucket(vault, bucketHash(18257865n, 0))` reproduces the policy's
  own `bucket` field exactly.** Seeds are `["bucket", vault, bucket_hash]`
  under program `3e5rBR2J9uHPHHn6tP8HF6mPbEJsJWtzQEyicv6v8qVW`. Confirmed by
  comparison against chain, not assumed. Bucket accounts do not exist until
  first written, so `readBucket` returns `{exists:false, lockedExposure:0n}`
  rather than throwing.

**`bridge/txline_replay.mjs`** — its header claimed the recorded proofs
"still verify against the packet"; that claim is now *enforced*, not
asserted. `fetchLatestFullMatchOdds` runs `assertProofMatchesPacket` and
`fetchFixtureSnapshot` runs `assertAuthenticFixtureProofShape` — the same
checks the live path runs. Edit `packets.jsonl` on disk and replay fails
closed instead of serving it.

**`web/server.mjs`** — rewritten:

- Live-first, replay-fallback per fixture. A reachable live row always wins,
  so replay can never mask a live regression.
- Every card carries `source` ("live" | "replay"), `recordedAt`, `liveError`,
  and `bindable`. `bindable` is just `source === "live" && fresh` against the
  same `ODDS_FRESHNESS_MS` SURETY enforces — replayed odds are unbindable by
  construction, with no special case.
- Team names, kickoff, and competition now come from the feed row. Only the
  flag emoji stay local, so a card cannot disagree with its own data.
- **Removed the hardcoded `POLICY` and `VAULT` literals.** Status, coverage,
  premium, escrow balance, and vault accounting are refetched from devnet on
  every poll. This was going to make the dashboard lie the moment Gate 6
  settles — it would still have read `status: "Open"`.
- The displayed quote is priced from the vault's real on-chain terms and the
  real bucket exposure, not restated constants.
- The scoreline shown is **only** the Merkle-proved full-time result from
  `data/recordings/<id>/full-time-result.json`. The odds feed's fixture rows
  never advance their score fields, so anything else would have been a guess.

**`web/public/app.js` + `styles.css`** — render the above: a `replay` feed
state distinct from `feed down` (amber, not red — it is real signed data,
just not fresh), an "indicative" rather than "via x402" premium label when
unbindable, a proved-outcome line, and policy badges that track the on-chain
`PolicyStatus` enum (Open / Triggered / Expired).

**Verified end-to-end** — `systemctl restart broker-dashboard`, then
`GET /api/live` on :8787 returns, with `onchainError: null`:

| fixture | source | state | proved result | indicative premium |
|---|---|---|---|---|
| 18257865 France v England | replay | FULL_TIME | **WIN_AWAY 4–6** | 0.038108 USDC |
| 18257739 Spain v Argentina | replay | FULL_TIME | **WIN_HOME 1–0** | 0.430935 USDC |

### Gate 6 research done — no code written yet

`scripts/gate6-settle-policy.mjs` still does not exist. What was established
this session, so the next session does not have to re-derive it:

**`settle_policy` accounts, from the vendored IDL** (all `accountsStrict`):
`caller` (signer), `vault` (w), `asset_mint`, `reserve` (w), `bucket` (w),
`policy` (w), `policy_escrow` (w), `payout_account` (w), `txline_program`
(pinned to `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J` by the IDL),
`daily_scores_merkle_roots`, `token_program`.

**Single arg `payload: StatValidationInput`** — Anchor camelCases these:

```
ts               i64
fixtureSummary   ScoresBatchSummary { fixtureId i64,
                                      updateStats { updateCount i32,
                                                    minTimestamp i64,
                                                    maxTimestamp i64 },
                                      eventsSubTreeRoot [u8;32] }
fixtureProof     Vec<ProofNode>          ← maps from proof.subTreeProof
mainTreeProof    Vec<ProofNode>
eventStatRoot    [u8;32]
stats            Vec<StatLeaf { stat: ScoreStat { key u32, value i32,
                                                  period i32 },
                                statProof: Vec<ProofNode> }>
ProofNode        { hash [u8;32], isRightSibling bool }
```

⚠️ **Name trap:** TxLINE's JSON calls it `summary.eventStatsSubTreeRoot`;
the on-chain field is `events_sub_tree_root` → **`eventsSubTreeRoot`**.
Also `payload.fixtureProof` is fed from the proof's **`subTreeProof`**, not
from anything named "fixtureProof". Getting either wrong is a silent
serialization mismatch.

**Error codes to expect** (for 6.5's negative test — read the real one, do
not assume): 6025 `TxlineProofTooLarge`, 6026 `InvalidProofTimestamp`,
6027 `InvalidTxlineRoot`, 6031 `TxlinePredicateRejected`,
6032 `SettlementPredicateMismatch`, 6033 `SettlementNotFinal`, plus the
TxLINE CPI's own 6003/6004 for tampered sub/main-tree proofs.

**Fallback if TxLINE ages out the scores rows:**
`data/recordings/<fixtureId>/full-time-result.json` already holds captured
`p1Proof` and `p2Proof` for both fixtures (captured 2026-07-25 18:19 UTC).
For 18257865 the two share an identical `summary`, `eventStatRoot`,
`subTreeProof`, and `mainTreeProof`, so a combined two-stat payload can be
assembled from them: `stats = [{stat: p1.statsToProve[0], statProof:
p1.statProofs[0]}, {stat: p2.statsToProve[0], statProof: p2.statProofs[0]}]`.
Prefer a live `fetchCombinedStatProof` when the feed still serves it.

**Expected outcome is unchanged:** policy predicate is WIN_HOME on 18257865;
the proved result is WIN_AWAY (4–6), so settlement takes the **expire**
branch — escrow's 5 USDC returns to the vault reserve (11.241692 →
16.241692), no payout to the holder ATA. Still a real on-chain state
transition, still real evidence.

### Uncommitted at end of session

Nothing was committed. `git status` shows:

- **new, unstaged:** `bridge/surety_read.mjs`, `bridge/txline_replay.mjs`,
  `data/recordings/18257739/full-time-result.json`,
  `data/recordings/18257865/full-time-result.json`
- **modified:** `web/server.mjs`, `web/public/app.js`, `web/public/styles.css`,
  `docs/GATE_HANDOFF.md`, `capture/deploy/env/esp-arg.env` (stop-after 180 →
  240 min), `package-lock.json`
- **ignorable:** `data/dashboard.{out,err}.log`

---

## How to resume

1. `nvm use --lts` (must be Node 20+; local default is 18)
2. `npm install` (re-applies the patch)
3. `npm run probe:gate6` — confirms TxLINE + on-chain root are still live
   before touching anything write-side
4. `curl -s localhost:8787/api/live | head -c 400` — confirms the dashboard,
   the replay path, and the devnet reads are all still healthy.
5. Pick up at "Gate 6.3 — settle orchestrator" above, using the payload
   shape recorded in the 2026-07-25 session log.
6. Before firing a real settle tx, confirm with the operator. Escrow
   movement is irreversible.

## Session log — 2026-07-25 (late) — Gate 6 built, and what it revealed

**Caller keypair.** This VPS had no Solana secret at all (only
`.secrets/txline-devnet.json`); `gate2-solana.json` and `~/.config/solana/id.json`
live on the laptop. `settle_policy` needs only a funded signer — not the holder,
and the payout still routes to the policy's own `payout_authority` — so
`scripts/gate6-create-caller.mjs` mints and airdrops a local one. Created
`5wm3XiKk4LnHfZLu524i4g2toHwsQeS5CkVE1nxRU8WV`, funded 1 SOL from the devnet
faucet. No secret was copied between machines.

**New files:** `bridge/settlement_payload.mjs` (shared payload builder, so the
negative test tampers with exactly the payload the real path submits),
`scripts/gate6-settle-policy.mjs`, `scripts/gate6-tamper-negative.mjs`,
`scripts/gate6-expire-policy.mjs`, `scripts/gate6-create-caller.mjs`.
New npm scripts: `caller:gate6`, `settle:gate6`, `expire:gate6`, `verify:gate6`.
Both write-capable scripts simulate by default and require `GATE6_CONFIRM=yes`.

**THE BIG CORRECTION.** `settle_policy` has no expire branch. It is the payout
path only: it verifies the TxLINE proof by CPI and pays out if the predicate
holds, otherwise it aborts with `TxlinePredicateRejected` (6031).
`expire_policy` is a separate instruction — no proof, no args, gated purely on
`expires_at` by `PolicyNotExpired` (6022). Everything in the old blueprint that
said "expire branch" was wrong.

**Gate 6.5 negative test PASSES 8/8** (`npm run verify:gate6`) and is the real
evidence Gate 6 has. It works because the two rejections differ:

- authentic proof → TxLINE CPI completes and returns a verdict → 6031.
  *Reaching 6031 at all proves the proof verified on-chain.*
- one bit flipped in `mainTreeProof[0].hash` → `InvalidMainTreeProof`, raised
  **inside** the CPI before any predicate evaluation.
- proved stat value forged (England 6 → 0) → `InvalidStatProof`.

The payload shape is also confirmed correct: the instruction consumed 222,156 CU
and reached predicate evaluation, impossible unless `StatValidationInput`
serialized exactly right.

**What is blocked, and it is not a code problem.** The bound policy insures
WIN_HOME on a match that finished 4–6 (WIN_AWAY):

- `settle_policy` can never close it — no payout exists to make.
- `expire_policy` is 22 days out — `expires_at` is **2026-08-16T23:15:54Z**.
  Simulated: the only obstacle is the clock.
- The payout path cannot be demonstrated without a policy whose predicate comes
  true, and issuance needs odds fresh inside the 15-minute on-chain window.
  Checked live this session: the dev snapshot carries 9 fixtures, earliest
  kickoff 2026-09-23, and **none is being served a 1X2 packet yet**. Nothing is
  bindable today. The feed starts streaming 1X2 near kickoff.

So Gate 6 is written up in EVIDENCE.md as **PARTIAL**, honestly: verification
proven, state transition not claimed.

**Decision needed from the operator** (see the three options in the chat
summary): wait ~22 days for the expiry transition, wait ~60 days for a bindable
fixture to prove the payout path, or ship Gate 6 as PARTIAL and move to Gate 4.

---

## What is genuinely left, in priority order

1. **Gate 6 close-out** — depends on the operator decision above. The scripts are
   written and dry-run green; what is missing is a chain state transition that
   cannot happen today. `gate6-verify-settlement.mjs` (6.4) is deliberately not
   written yet: there is no settlement to verify, and writing a verifier for an
   event that has not happened is how fake evidence gets born.
2. **Gate 4, entirely** — `mcp/server.mjs`, `skills/broker/SKILL.md`,
   `mcp/README.md`, `scripts/gate4-verify.mjs`, `docs/GATE4_TRANSCRIPT.md`.
   Needs `@modelcontextprotocol/sdk` added. Zero lines written so far.
3. **`Makefile` with a `verify` target.** `README.md:125` tells the reader to
   run `make verify` and there is no Makefile in the repo. This is currently
   the most visible broken promise in the project — anyone following the
   README hits it immediately. Should wire the existing `node --test`
   suites plus the gate verify scripts into PASS/FAIL output.
4. **Three `<!-- TODO (Gate 4) -->` blocks in README.md** (lines 42, 48, 99) —
   clear them only once Gate 4 evidence actually exists.
5. **Replay tamper negative test.** `bridge/txline_replay.mjs` now fails
   closed on an edited recording, but nothing asserts that yet. A small test
   that flips one byte in `packets.jsonl` and asserts the throw would make
   the claim verifiable rather than merely true.
6. **`scripts/gate3-issue-policy.mjs` hardcodes `.secrets/gate2-solana.json`**
   as payer. Thread a `GATE3_HOLDER_KEYPAIR` env var through if the optional
   bind branch is ever wanted.

## Files touched in this session

- **new**: `bridge/txline_scores.mjs`, `scripts/gate6-probe-scores.mjs`,
  `patches/@surety-tx+txline-verify+0.1.0.patch`,
  `.secrets/txline-devnet.json`, `docs/GATE_HANDOFF.md` (this file)
- **modified**: `package.json` (postinstall + probe:gate6 script + patch-package
  devDep), `docs/FRICTION_LOG.md` (corrected stat-key entry, added 4 new
  entries covering Node 18, caller-signer rule, and Circle faucet)
- **untouched**: all Gate 0–3 code, deployed SURETY program, README, EVIDENCE.md

## Files NOT yet created (planned)

Still accurate as of 2026-07-25 evening — none of these exist yet:

- `scripts/gate6-settle-policy.mjs`
- `scripts/gate6-verify-settlement.mjs`
- `scripts/gate6-tamper-negative.mjs`
- `mcp/server.mjs`
- `mcp/README.md`
- `skills/broker/SKILL.md`
- `scripts/gate4-verify.mjs`
- `docs/GATE4_TRANSCRIPT.md`
- `Makefile` (the `make verify` the README already promises)
