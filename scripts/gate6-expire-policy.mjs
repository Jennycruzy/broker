// GATE 6 — close out a policy whose insured outcome did not occur.
//
// settle_policy is the PAYOUT path: it requires the proved result to satisfy the
// policy predicate, and aborts with TxlinePredicateRejected (6031) when it does
// not. The counterpart is expire_policy, which takes no proof and no arguments —
// it simply returns the escrowed coverage to the vault reserve once the policy
// passes its expires_at, releasing the underwriter's locked capital.
//
// Why no proof is needed: expiry does not assert anything about the match. It
// asserts that the policy's own clock ran out with no payout claimed. The
// coverage was locked from issuance, so the only safe direction is back to the
// reserve, and the program gates it on time alone (PolicyNotExpired, 6022).
//
// SAFETY: simulates by default. Escrow movement is irreversible, so a real send
// requires GATE6_CONFIRM=yes.
//
// Env: GATE6_POLICY, GATE6_CALLER_KEYPAIR, GATE6_CONFIRM

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { AnchorProvider, Program, Wallet } from "@anchor-lang/core";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

const POLICY = new PublicKey(process.env.GATE6_POLICY ?? "9APDuVP895jBhj6u3iZbdr65difkiCW6vDtfMrAfx58L");
const CONFIRM = process.env.GATE6_CONFIRM === "yes";
const POLICY_NOT_EXPIRED = 6022;

const log = (m) => console.log(m);
const usdc = (units) => (Number(units) / 1e6).toFixed(6);

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
const statusBefore = Object.keys(policy.status)[0];
const vault = await program.account.vault.fetch(policy.vault);

const expiresAt = Number(policy.expiresAt);
const remainingDays = (expiresAt * 1000 - Date.now()) / 86_400_000;
log(`STEP: caller ${caller.publicKey.toBase58()}`);
log(`STEP: policy ${POLICY.toBase58()} status=${statusBefore} coverage=${usdc(policy.coverage.toString())} USDC`);
log(`STEP: expires_at ${new Date(expiresAt * 1000).toISOString()} — ${remainingDays > 0 ? `${remainingDays.toFixed(1)} days away` : `passed ${Math.abs(remainingDays).toFixed(1)} days ago`}`);

if (statusBefore !== "open") {
  throw new Error(`policy status is already '${statusBefore}' — expire_policy only acts on an Open policy.`);
}

const balances = async () => ({
  escrow: BigInt((await connection.getTokenAccountBalance(policy.escrow)).value.amount),
  reserve: BigInt((await connection.getTokenAccountBalance(vault.reserve)).value.amount),
});
const before = await balances();
log(`STEP: balances before — escrow ${usdc(before.escrow)}  reserve ${usdc(before.reserve)} USDC`);

const builder = program.methods
  .expirePolicy()
  .accountsStrict({
    caller: caller.publicKey,
    vault: policy.vault,
    assetMint: vault.assetMint,
    reserve: vault.reserve,
    bucket: policy.bucket,
    policy: POLICY,
    policyEscrow: policy.escrow,
    tokenProgram: TOKEN_PROGRAM_ID,
  });

log("STEP: simulating expire_policy (no state change)");
const simulation = await builder.simulate().catch((error) => ({ error }));
if (simulation.error) {
  const response = simulation.error.simulationResponse ?? {};
  const logs = simulation.error.logs ?? response.logs ?? [];
  const custom = response.err?.InstructionError?.[1]?.Custom;
  for (const line of logs) log(`  ${line}`);
  if (custom === POLICY_NOT_EXPIRED) {
    log(`\nDIAGNOSIS: error ${custom} PolicyNotExpired — not a bug, a clock.`);
    log(`  The policy cannot be expired until ${new Date(expiresAt * 1000).toISOString()}`);
    log(`  (${remainingDays.toFixed(1)} days from now). Nothing else is blocking it:`);
    log(`  the accounts resolve and the caller is funded.`);
    process.exit(3);
  }
  throw simulation.error;
}
log("PASS: simulation succeeded — the policy is expirable now");

if (!CONFIRM) {
  log("\nDRY RUN. Nothing was written on-chain.");
  log("Escrow movement is irreversible; re-run with GATE6_CONFIRM=yes to expire for real.");
  process.exit(0);
}

log("\nSTEP: GATE6_CONFIRM=yes — sending expire_policy for real");
const signature = await builder.rpc();
log(`  expire tx ${signature}`);
await connection.confirmTransaction(signature, "confirmed");

const after = await balances();
const policyAfter = await program.account.policy.fetch(POLICY);

console.log("\n" + JSON.stringify({
  gate: "6 — policy expiry releases locked coverage back to the vault",
  policy: POLICY.toBase58(),
  caller: caller.publicKey.toBase58(),
  status: { before: statusBefore, after: Object.keys(policyAfter.status)[0] },
  balances_usdc: {
    escrow: { before: usdc(before.escrow), after: usdc(after.escrow) },
    reserve: { before: usdc(before.reserve), after: usdc(after.reserve) },
  },
  transaction: `https://explorer.solana.com/tx/${signature}?cluster=devnet`,
}, null, 2));
