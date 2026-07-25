// GATE 6.5 — negative test: a path that cannot fail cannot verify.
//
// The question this answers is narrow and important: is the Merkle proof
// actually being verified on-chain, or is the program taking TxLINE's word for
// the numbers? A test that merely watched settle_policy reject a policy would
// not distinguish the two — the honest result and a rubber stamp look identical
// from outside.
//
// So this test relies on the two rejections being DIFFERENT:
//
//   baseline  authentic proof  → TxLINE validates, returns its verdict, and
//                                SURETY reports 6031 TxlinePredicateRejected.
//                                Reaching 6031 at all proves the proof verified.
//   tampered  one flipped bit  → rejected INSIDE the TxLINE CPI, before any
//                                predicate evaluation, with a proof-level error.
//
// If a tampered proof produced the same error as the authentic one, verification
// would be theatre. Asserting "it failed" is not enough; we assert it failed
// *differently, and earlier*.
//
// Everything here simulates. Nothing is written on-chain, so this is safe to run
// at any time and needs only a funded caller for fee estimation.
//
// Env: GATE6_POLICY, GATE6_FIXTURE_ID, GATE6_CALLER_KEYPAIR, GATE6_PROOF_SOURCE

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { AnchorProvider, Program, Wallet } from "@anchor-lang/core";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { ComputeBudgetProgram, Connection, Keypair, PublicKey } from "@solana/web3.js";
import { dailyScoresRootPda } from "@surety-tx/txline-verify";
import { buildStatValidationPayload, fetchSettlementProof, scorelineFrom } from "../bridge/settlement_payload.mjs";

const POLICY = new PublicKey(process.env.GATE6_POLICY ?? "9APDuVP895jBhj6u3iZbdr65difkiCW6vDtfMrAfx58L");
const FIXTURE_ID = Number(process.env.GATE6_FIXTURE_ID ?? 18257865);
const PROOF_SOURCE = process.env.GATE6_PROOF_SOURCE ?? "auto";
const TXLINE_PROGRAM_ID = new PublicKey("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");

// SURETY's predicate verdict — only reachable AFTER the TxLINE CPI has verified
// the proof and returned. Its presence is the signal that verification passed.
const PREDICATE_REJECTED = 6031;

let pass = true;
const check = (ok, msg) => { pass = pass && ok; console.log(`${ok ? "PASS" : "FAIL"}: ${msg}`); };

const callerPath = process.env.GATE6_CALLER_KEYPAIR
  ?? [".secrets/gate6-caller.json", ".secrets/gate2-solana.json", `${process.env.HOME}/.config/solana/id.json`]
    .find((p) => existsSync(p));
if (!callerPath) throw new Error("no caller keypair found; run node scripts/gate6-create-caller.mjs");
const caller = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(callerPath, "utf8"))));

const connection = new Connection(process.env.SURETY_RPC_ENDPOINT ?? "https://api.devnet.solana.com", "confirmed");
const idl = JSON.parse(await readFile(new URL("../bridge/surety_core.idl.json", import.meta.url), "utf8"));
const provider = new AnchorProvider(connection, new Wallet(caller), { commitment: "confirmed" });
const program = new Program(idl, provider);

const policy = await program.account.policy.fetch(POLICY);
const vault = await program.account.vault.fetch(policy.vault);
const payoutAccount = getAssociatedTokenAddressSync(vault.assetMint, policy.payoutAuthority);

const { proof, seq, source } = await fetchSettlementProof(FIXTURE_ID, PROOF_SOURCE, (error) =>
  console.log(`INFO: live TxLINE proof unavailable (${error.message}); using the recorded capture`));
const { p1Goals, p2Goals } = scorelineFrom(proof);
console.log(`INFO: ${source} proof for fixture ${FIXTURE_ID}, seq ${seq}, P1 ${p1Goals} : P2 ${p2Goals}\n`);

// Simulate a payload and report how the chain rejected it: which custom error,
// and — crucially — whether the TxLINE CPI got far enough to return a verdict.
async function simulate(payload) {
  const dailyScoresMerkleRoots = dailyScoresRootPda(proof.summary.updateStats.minTimestamp);
  const result = await program.methods
    .settlePolicy(payload)
    .accountsStrict({
      caller: caller.publicKey,
      vault: policy.vault,
      assetMint: vault.assetMint,
      reserve: vault.reserve,
      bucket: policy.bucket,
      policy: POLICY,
      policyEscrow: policy.escrow,
      payoutAccount,
      txlineProgram: TXLINE_PROGRAM_ID,
      dailyScoresMerkleRoots,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })])
    .simulate()
    .catch((error) => ({ error }));

  if (!result.error) return { ok: true, logs: result.raw ?? [] };
  const response = result.error.simulationResponse ?? {};
  const logs = result.error.logs ?? response.logs ?? [];
  return {
    ok: false,
    custom: response.err?.InstructionError?.[1]?.Custom,
    logs,
    // TxLINE returning at all means the proof cleared verification.
    txlineReturned: logs.some((l) => l.includes(`Program ${TXLINE_PROGRAM_ID.toBase58()} success`)),
    anchorError: logs.find((l) => l.includes("Error Code:"))?.match(/Error Code: (\w+)/)?.[1],
  };
}

// --- 1. Baseline: the authentic proof must clear verification ------------------
console.log("--- baseline: authentic proof ---");
const baseline = await simulate(buildStatValidationPayload(proof));
check(!baseline.ok, `authentic proof is rejected at the predicate, not paid out (this policy's predicate is false)`);
check(baseline.txlineReturned === true, `TxLINE CPI ran to completion and returned a verdict — the proof VERIFIED on-chain`);
check(baseline.custom === PREDICATE_REJECTED, `rejection is ${baseline.anchorError} (${baseline.custom}) — a predicate verdict, not a proof failure`);

// --- 2. Tamper the main-tree proof --------------------------------------------
// One bit. This is the proof linking the batch summary to the on-chain daily
// root, so corrupting it must be caught inside TxLINE before any verdict exists.
console.log("\n--- tampered: one bit flipped in mainTreeProof[0].hash ---");
const tamperedMain = buildStatValidationPayload(proof);
tamperedMain.mainTreeProof[0].hash[0] ^= 0x01;
const mainResult = await simulate(tamperedMain);
check(!mainResult.ok, `tampered main-tree proof is rejected`);
check(mainResult.custom !== PREDICATE_REJECTED,
  `rejected with ${mainResult.anchorError ?? "custom " + mainResult.custom} — a DIFFERENT error than the authentic proof, so verification is real`);
check(mainResult.txlineReturned === false, `rejected INSIDE the TxLINE CPI, before any predicate was evaluated`);

// --- 3. Tamper a proved stat value --------------------------------------------
// Claim England scored 0 instead of the proved 6. The leaf no longer hashes to
// the committed root, so this must fail — this is the attack that would matter,
// since a forged scoreline is what would steal a payout.
console.log("\n--- tampered: proved stat value rewritten (a forged scoreline) ---");
const tamperedStat = buildStatValidationPayload(proof);
const original = tamperedStat.stats[1].stat.value;
tamperedStat.stats[1].stat.value = 0;
const statResult = await simulate(tamperedStat);
check(!statResult.ok, `forged stat value (${original} → 0) is rejected`);
check(statResult.custom !== PREDICATE_REJECTED || statResult.txlineReturned === false,
  `forging the scoreline does not buy a payout — rejected with ${statResult.anchorError ?? "custom " + statResult.custom}`);

console.log(`\nGATE 6.5 ${pass ? "PASS" : "FAIL"}: on-chain proof verification distinguishes authentic from tampered proofs.`);
if (!pass) {
  console.log("\nFull logs from the tampered main-tree run:");
  for (const line of mainResult.logs) console.log(`  ${line}`);
}
process.exit(pass ? 0 : 1);
