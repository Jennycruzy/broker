// GATE 6.3 — settle the bound policy against a real TxLINE full-time proof.
//
// settle_policy CPIs into the TxLINE validator with a StatValidationV2 payload.
// The program re-derives the policy predicate from the proved final-period stats
// and either pays the coverage out to the payout account (predicate true) or
// returns the escrowed coverage to the vault reserve (predicate false). Both are
// real on-chain state transitions; neither is chosen by this script. We supply a
// proof and the chain decides.
//
// Nothing here fabricates a result. The stat proof comes from the authenticated
// TxLINE API, or — if the dev feed has aged the fixture out — from the recording
// captured while the match ran, whose bytes are the same ones TxLINE signed. In
// both cases the on-chain TxLINE program verifies the Merkle proof against its
// own daily scores root, so a proof this script got wrong simply fails.
//
// SAFETY: this script SIMULATES by default and writes nothing. Escrow movement is
// irreversible, so a real send requires GATE6_CONFIRM=yes to be set explicitly.
//
// Env:
//   GATE6_POLICY          policy pubkey (default: the Gate 3 policy)
//   GATE6_FIXTURE_ID      fixture to prove (default 18257865)
//   GATE6_CALLER_KEYPAIR  path to the funded caller keypair (any funded signer;
//                         the caller does not have to be the policy holder)
//   GATE6_PROOF_SOURCE    live | recorded | auto  (default auto: live, else recorded)
//   GATE6_CONFIRM         "yes" to actually send the transaction

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { AnchorProvider, Program, Wallet } from "@anchor-lang/core";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { ComputeBudgetProgram, Connection, Keypair, PublicKey } from "@solana/web3.js";
import { dailyScoresRootPda } from "@surety-tx/txline-verify";
import { FINAL_PERIOD } from "../bridge/txline_scores.mjs";
import { buildStatValidationPayload, fetchSettlementProof, scorelineFrom } from "../bridge/settlement_payload.mjs";

const POLICY = new PublicKey(process.env.GATE6_POLICY ?? "9APDuVP895jBhj6u3iZbdr65difkiCW6vDtfMrAfx58L");
const FIXTURE_ID = Number(process.env.GATE6_FIXTURE_ID ?? 18257865);
const PROOF_SOURCE = process.env.GATE6_PROOF_SOURCE ?? "auto";
const CONFIRM = process.env.GATE6_CONFIRM === "yes";
const TXLINE_PROGRAM_ID = new PublicKey("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");
const MIN_CALLER_LAMPORTS = 20_000_000n; // 0.02 SOL

const log = (m) => console.log(m);
const usdc = (units) => (Number(units) / 1e6).toFixed(6);

// --- caller -------------------------------------------------------------------
// settle_policy requires only that the caller signs and can pay fees, so this is
// deliberately not tied to the holder keypair.
const callerPath = process.env.GATE6_CALLER_KEYPAIR
  ?? [".secrets/gate6-caller.json", ".secrets/gate2-solana.json", `${process.env.HOME}/.config/solana/id.json`]
    .find((p) => existsSync(p));
if (!callerPath || !existsSync(callerPath)) {
  throw new Error(
    "no caller keypair found. settle_policy needs a funded devnet signer.\n" +
    "  Set GATE6_CALLER_KEYPAIR=/path/to/keypair.json, or create+fund one with\n" +
    "  node scripts/gate6-create-caller.mjs",
  );
}
const caller = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(callerPath, "utf8"))));

const connection = new Connection(process.env.SURETY_RPC_ENDPOINT ?? "https://api.devnet.solana.com", "confirmed");
const idl = JSON.parse(await readFile(new URL("../bridge/surety_core.idl.json", import.meta.url), "utf8"));
const provider = new AnchorProvider(connection, new Wallet(caller), { commitment: "confirmed" });
const program = new Program(idl, provider);

const callerLamports = BigInt(await connection.getBalance(caller.publicKey));
log(`STEP: caller ${caller.publicKey.toBase58()} (${callerPath}) — ${(Number(callerLamports) / 1e9).toFixed(4)} SOL`);
if (callerLamports < MIN_CALLER_LAMPORTS) {
  throw new Error(`caller balance ${callerLamports} lamports is below the ${MIN_CALLER_LAMPORTS} lamport floor; fund it before settling`);
}

// --- on-chain state before ----------------------------------------------------
const policy = await program.account.policy.fetch(POLICY);
const statusBefore = Object.keys(policy.status)[0];
log(`STEP: policy ${POLICY.toBase58()} status=${statusBefore} coverage=${usdc(policy.coverage.toString())} premium=${usdc(policy.premium.toString())}`);
if (statusBefore !== "open") {
  throw new Error(`policy status is already '${statusBefore}' — settle_policy only acts on an Open policy. Nothing to do.`);
}

const vault = await program.account.vault.fetch(policy.vault);
const payoutAccount = getAssociatedTokenAddressSync(vault.assetMint, policy.payoutAuthority);
// The payout account must already exist: settle_policy transfers into it and does
// not create it. Fail here with a clear message rather than deep in a CPI.
if (!(await connection.getAccountInfo(payoutAccount))) {
  throw new Error(`payout account ${payoutAccount.toBase58()} does not exist; create the ATA for payout authority ${policy.payoutAuthority.toBase58()} first`);
}

const balances = async () => ({
  escrow: BigInt((await connection.getTokenAccountBalance(policy.escrow)).value.amount),
  reserve: BigInt((await connection.getTokenAccountBalance(vault.reserve)).value.amount),
  payout: BigInt((await connection.getTokenAccountBalance(payoutAccount)).value.amount),
});
const before = await balances();
log(`STEP: balances before — escrow ${usdc(before.escrow)}  reserve ${usdc(before.reserve)}  payout ${usdc(before.payout)} USDC`);

// --- the proof ----------------------------------------------------------------
const { proof, seq, source } = await fetchSettlementProof(FIXTURE_ID, PROOF_SOURCE, (error) =>
  log(`WARN: live TxLINE proof unavailable (${error.message}); falling back to the recorded capture`));

const { p1Goals, p2Goals } = scorelineFrom(proof);
log(`STEP: ${source} full-time proof — seq ${seq}, P1 ${p1Goals} : P2 ${p2Goals}, period ${FINAL_PERIOD}`);

const payload = buildStatValidationPayload(proof);

const dailyScoresMerkleRoots = dailyScoresRootPda(proof.summary.updateStats.minTimestamp);
const rootInfo = await connection.getAccountInfo(dailyScoresMerkleRoots);
if (!rootInfo) throw new Error(`daily scores root PDA ${dailyScoresMerkleRoots.toBase58()} is absent on devnet — TxLINE has aged it out; settlement is impossible`);
if (!rootInfo.owner.equals(TXLINE_PROGRAM_ID)) throw new Error(`daily scores root PDA owner ${rootInfo.owner.toBase58()} is not the TxLINE program`);
log(`STEP: daily scores root ${dailyScoresMerkleRoots.toBase58()} present, TxLINE-owned`);

const builder = program.methods
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
  .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })]);

// --- simulate -----------------------------------------------------------------
// settle_policy is the PAYOUT path only. If the proved result does not satisfy
// the policy predicate, TxLINE's CPI returns false and the program aborts with
// TxlinePredicateRejected (6031) — it does not silently take an expire branch.
// Closing out a policy whose predicate did not occur is `expire_policy`, a
// separate instruction with no proof and a time gate. See gate6-expire-policy.mjs.
const PREDICATE_REJECTED = 6031;

log("STEP: simulating settle_policy (no state change)");
const simulation = await builder.simulate().catch((error) => ({ error }));
if (simulation.error) {
  const logs = simulation.error.logs ?? simulation.error.simulationResponse?.logs ?? [];
  const custom = simulation.error.simulationResponse?.err?.InstructionError?.[1]?.Custom;
  log("\nSIMULATION FAILED — the chain rejected this payload. Program logs:");
  for (const line of logs) log(`  ${line}`);

  if (custom === PREDICATE_REJECTED) {
    log(`\nDIAGNOSIS: error ${custom} TxlinePredicateRejected — this is not a payload bug.`);
    log(`  The proof verified: TxLINE's validator ran to completion and returned false.`);
    log(`  Proved full-time result is P1 ${p1Goals} : P2 ${p2Goals}, which does not satisfy`);
    log(`  this policy's predicate, so there is no payout to make.`);
    log(`  settle_policy cannot close this policy. Use scripts/gate6-expire-policy.mjs`);
    log(`  once the policy reaches its expires_at.`);
    process.exit(3);
  }
  throw simulation.error;
}
for (const line of simulation.raw ?? []) log(`  ${line}`);
log("PASS: simulation succeeded — the proof verifies on-chain and the predicate resolves");

if (!CONFIRM) {
  log("\nDRY RUN. Nothing was written on-chain.");
  log("Escrow movement is irreversible; re-run with GATE6_CONFIRM=yes to settle for real.");
  process.exit(0);
}

// --- send ---------------------------------------------------------------------
log("\nSTEP: GATE6_CONFIRM=yes — sending settle_policy for real");
const signature = await builder.rpc();
log(`  settle tx ${signature}`);
await connection.confirmTransaction(signature, "confirmed");

const after = await balances();
const policyAfter = await program.account.policy.fetch(POLICY);
const statusAfter = Object.keys(policyAfter.status)[0];

console.log("\n" + JSON.stringify({
  gate: "6 — automatic settlement on SURETY from a TxLINE full-time proof",
  policy: POLICY.toBase58(),
  caller: caller.publicKey.toBase58(),
  proofSource: source,
  seq,
  scoreline: { p1Goals, p2Goals },
  status: { before: statusBefore, after: statusAfter },
  balances_usdc: {
    escrow: { before: usdc(before.escrow), after: usdc(after.escrow) },
    reserve: { before: usdc(before.reserve), after: usdc(after.reserve) },
    payout: { before: usdc(before.payout), after: usdc(after.payout) },
  },
  transaction: `https://explorer.solana.com/tx/${signature}?cluster=devnet`,
}, null, 2));
