// Read-only Gate 6 probe. Answers one question in ~30 seconds and writes
// nothing on-chain: does TxLINE dev still serve a full-time scores proof
// for our recorded target fixture so we can settle the existing policy
// from this laptop, or do we need to schedule a live fixture on the VPS?
//
// The probe:
//   1. Authenticates to TxLINE (guest JWT + API token).
//   2. Pulls the scores snapshot for the fixture.
//   3. Confirms a game_finalised action exists and lifts its Seq.
//   4. Fetches the RawStatValidationV2 proof for statKey 1 (P1 final
//      goals) and 2 (P2 final goals) at period FINAL_PERIOD (100) —
//      these are the exact leaves settle_policy hashes against.
//   5. Runs the shape assertion built into bridge/txline_scores.mjs.
//   6. Confirms the daily-scores-root PDA for the proof's batch timestamp
//      is present on devnet and owned by the TxLINE program — the account
//      that on-chain settle_policy will read when it CPIs into TxLINE to
//      verify the proof.
//
// It intentionally does NOT run validateStatV2OnDevnet, because that
// requires a funded fee-payer we don't have on this laptop yet. The
// program-side verification is exercised for real inside
// gate6-settle-policy.mjs, where the policy holder's funded keypair does
// the settle transaction.

import { Connection, PublicKey } from "@solana/web3.js";
import { pureFixtureId, dailyScoresRootPda } from "@surety-tx/txline-verify";
import { createTxlineSession } from "../bridge/txline.mjs";
import {
  fetchScoresSnapshot,
  findGameFinalisedSeq,
  fetchStatProofV2,
  STAT_KEY_FULL_MATCH_P1_GOALS,
  STAT_KEY_FULL_MATCH_P2_GOALS,
} from "../bridge/txline_scores.mjs";

const FIXTURE_ID = Number(process.env.GATE6_FIXTURE_ID ?? 18257865);
const TXLINE_PROGRAM_ID = new PublicKey("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");

console.log(`probe fixture ${FIXTURE_ID} against ${process.env.TXLINE_API_ORIGIN ?? "https://txline-dev.txodds.com"}`);

const session = await createTxlineSession();
console.log("PASS: authenticated TxLINE session (guest JWT + API token)");

let rows;
try {
  const snapshot = await fetchScoresSnapshot(session, FIXTURE_ID);
  rows = snapshot.rows;
  console.log(`PASS: scores snapshot returned — ${rows.length} rows`);
} catch (err) {
  console.log(`FAIL: scores snapshot — ${err.message}`);
  console.log("\nRESULT: TxLINE dev cannot serve scores for this fixture. Fall back to live-fixture capture on VPS.");
  process.exit(2);
}

let seq;
try {
  seq = findGameFinalisedSeq(rows);
  console.log(`PASS: game_finalised Seq = ${seq}`);
} catch (err) {
  console.log(`FAIL: game_finalised not present — ${err.message}`);
  console.log("\nRESULT: match not yet finalised on TxLINE; would need to wait for full-time.");
  process.exit(2);
}

let p1, p2;
try {
  p1 = await fetchStatProofV2(session, { fixtureId: FIXTURE_ID, seq, statKey: STAT_KEY_FULL_MATCH_P1_GOALS });
  console.log(`PASS: stat proof for statKey ${STAT_KEY_FULL_MATCH_P1_GOALS} (P1 final goals, period=100) fetched + shape-validated`);
  p2 = await fetchStatProofV2(session, { fixtureId: FIXTURE_ID, seq, statKey: STAT_KEY_FULL_MATCH_P2_GOALS });
  console.log(`PASS: stat proof for statKey ${STAT_KEY_FULL_MATCH_P2_GOALS} (P2 final goals, period=100) fetched + shape-validated`);
} catch (err) {
  console.log(`FAIL: stat-validation fetch — ${err.message}`);
  console.log("\nRESULT: TxLINE dev cannot produce a stat proof for this fixture/seq. Fall back to live-fixture capture.");
  process.exit(2);
}

const p1Goals = p1.proof.statsToProve.find((s) => s.key === STAT_KEY_FULL_MATCH_P1_GOALS).value;
const p2Goals = p2.proof.statsToProve.find((s) => s.key === STAT_KEY_FULL_MATCH_P2_GOALS).value;
console.log(`INFO: full-time scoreline from proofs — P1 ${p1Goals}, P2 ${p2Goals}`);

// Confirm the daily-scores-root PDA that on-chain settle_policy will read
// still exists on devnet and is owned by the TxLINE program.
const connection = new Connection(process.env.SURETY_RPC_ENDPOINT ?? "https://api.devnet.solana.com", "confirmed");
const batchTs = p1.proof.summary.updateStats.minTimestamp;
const rootPda = dailyScoresRootPda(batchTs);
const rootAccount = await connection.getAccountInfo(rootPda, "confirmed");
if (!rootAccount) {
  console.log(`FAIL: dailyScoresRoot PDA ${rootPda.toBase58()} for batch ts ${new Date(batchTs).toISOString()} is ABSENT on devnet.`);
  console.log("\nRESULT: TxLINE has aged out the on-chain root for this fixture. Cannot settle.");
  process.exit(1);
}
if (!rootAccount.owner.equals(TXLINE_PROGRAM_ID)) {
  console.log(`FAIL: dailyScoresRoot PDA owner ${rootAccount.owner.toBase58()} ≠ TxLINE program.`);
  process.exit(1);
}
console.log(`PASS: dailyScoresRoot PDA ${rootPda.toBase58()} present (owner ${rootAccount.owner.toBase58()}, ${rootAccount.data.length}B data) — settle_policy will find it`);

console.log("\nRESULT: fresh full-time scores proofs served by TxLINE, proof shape valid, on-chain root present.");
console.log("        Gate 6 settle_policy can run from this laptop once we have the policy-holder keypair funded.");
console.log(JSON.stringify({
  fixtureId: FIXTURE_ID,
  purifiedFixtureId: pureFixtureId(p1.proof.summary.fixtureId).toString(),
  seq,
  scoreline: { p1Goals, p2Goals },
  batchTsISO: new Date(batchTs).toISOString(),
  dailyScoresRootPda: rootPda.toBase58(),
}, null, 2));
