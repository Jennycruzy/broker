// Reconcile a settlement against current chain state.
//
// Refetch the
// transaction, the policy, the escrow, the vault and the payout account from
// devnet and check that the balances agree.
//
// It also re-derives the payout independently: the escrow drained by exactly the
// policy's own coverage figure, and the payout account grew by exactly the same
// amount. A settlement that moved a different number would fail here even though
// the transaction "succeeded".
//
// Env: BROKER_SETTLEMENT_POLICY, BROKER_SETTLEMENT_TX

import { readFile } from "node:fs/promises";
import { AnchorProvider, Program, Wallet } from "@anchor-lang/core";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

const POLICY = new PublicKey(process.env.BROKER_SETTLEMENT_POLICY ?? "Gmk1L8ZLPySzuGKsjNyxSyRcYMNzkb8QypzBxxzoFeMG");
const SETTLE_TX = process.env.BROKER_SETTLEMENT_TX
  ?? "2SZFA2gaskxaNLjHy34Z3XomRN93i2zY3nbiQgWQaLizTUwmDDeLREvP2Bquih4JZXyYAmHpmfxLHUWBCVcK7qDg";
const TXLINE_PROGRAM_ID = "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J";

const usdc = (u) => (Number(u) / 1e6).toFixed(6);
let pass = true;
const check = (ok, msg) => { pass = pass && ok; console.log(`${ok ? "PASS" : "FAIL"}: ${msg}`); };

const connection = new Connection(process.env.SURETY_RPC_ENDPOINT ?? "https://api.devnet.solana.com", "confirmed");
const idl = JSON.parse(await readFile(new URL("../bridge/surety_core.idl.json", import.meta.url), "utf8"));
const program = new Program(idl, new AnchorProvider(connection, new Wallet(Keypair.generate()), { commitment: "confirmed" }));

// --- 1. The transaction landed and did not error ------------------------------
const tx = await connection.getTransaction(SETTLE_TX, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
check(tx !== null, `settle transaction found on devnet (slot ${tx?.slot})`);
check(tx?.meta?.err === null, `settle transaction succeeded with no error`);

// --- 2. It really went through the TxLINE validator ---------------------------
// A settlement that never CPI'd into TxLINE would not be proof-gated at all.
const logs = tx?.meta?.logMessages ?? [];
check(logs.some((l) => l.includes(`Program ${TXLINE_PROGRAM_ID} invoke`)), `settlement CPI'd into the TxLINE validator program`);
check(logs.some((l) => l.includes(`Program ${TXLINE_PROGRAM_ID} success`)), `the TxLINE validator returned success — the Merkle proof verified on-chain`);

// --- 3. Policy state actually transitioned ------------------------------------
const policy = await program.account.policy.fetch(POLICY);
const status = Object.keys(policy.status)[0];
check(status === "triggered", `policy status is 'triggered' (was 'open') — ${status}`);

const coverage = BigInt(policy.coverage.toString());
const vault = await program.account.vault.fetch(policy.vault);
const payoutAccount = getAssociatedTokenAddressSync(vault.assetMint, policy.payoutAuthority);

// --- 4. The money moved, and moved by exactly the coverage --------------------
const escrowBalance = BigInt((await connection.getTokenAccountBalance(policy.escrow)).value.amount);
check(escrowBalance === 0n, `policy escrow is drained (${usdc(escrowBalance)} USDC remaining)`);

// Reconstruct the deltas from the transaction's own pre/post token balances, so
// this does not depend on nothing else having touched the accounts since.
const keys = tx.transaction.message.getAccountKeys?.({ accountKeysFromLookups: tx.meta.loadedAddresses })
  ?? { get: (i) => tx.transaction.message.accountKeys[i] };
const balanceDelta = (owner) => {
  const post = tx.meta.postTokenBalances?.find((b) => b.owner === owner);
  const pre = tx.meta.preTokenBalances?.find((b) => b.owner === owner);
  if (!post || !pre) return null;
  return BigInt(post.uiTokenAmount.amount) - BigInt(pre.uiTokenAmount.amount);
};

const payoutDelta = balanceDelta(policy.payoutAuthority.toBase58());
check(payoutDelta === coverage, `payout account received exactly the coverage: ${payoutDelta === null ? "not found" : usdc(payoutDelta)} vs ${usdc(coverage)} USDC`);

const escrowDelta = balanceDelta(POLICY.toBase58());
check(escrowDelta === -coverage, `escrow released exactly the coverage: ${escrowDelta === null ? "not found" : usdc(escrowDelta)} USDC`);

// --- 5. Vault accounting released the liability -------------------------------
check(BigInt(vault.lockedLiabilities.toString()) === 0n, `vault locked_liabilities released to ${usdc(vault.lockedLiabilities.toString())} USDC`);

const bucket = await program.account.exposureBucket.fetchNullable(policy.bucket);
check(bucket === null || BigInt(bucket.lockedExposure.toString()) === 0n,
  `exposure bucket unwound to ${bucket ? usdc(bucket.lockedExposure.toString()) : "0 (closed)"} USDC`);

console.log(`\nSETTLEMENT ${pass ? "VERIFIED" : "FAILED"}: policy ${POLICY.toBase58()}`);
console.log(`  https://explorer.solana.com/tx/${SETTLE_TX}?cluster=devnet`);
process.exit(pass ? 0 : 1);
