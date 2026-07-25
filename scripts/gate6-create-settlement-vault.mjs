// Creates and capitalises a formula-v1 SURETY vault so the SETTLEMENT path can be
// demonstrated on a fixture that has already been played.
//
// WHY A SECOND VAULT EXISTS. The Gate 3 vault is formula_version 2, which enforces
// `issue_policy_with_validated_odds` — direct issuance is rejected with
// ValidatedOddsRequired (6046). That rule is the strongest thing about Gate 3: a
// policy can only bind against a signed odds packet less than 15 minutes old.
//
// It is also, unavoidably, what makes settlement undemonstrable on that vault
// right now. Settling requires a policy whose insured outcome already occurred;
// binding on the v2 vault requires a match that has not been played and therefore
// has no outcome. The two cannot be true of the same fixture at the same moment.
//
// So: v2 vault proves odds-validated issuance (Gate 3). This v1 vault proves
// proof-gated settlement (Gate 6). Both are real capital in real escrow on devnet.
// Neither claim is used to imply the other — see EVIDENCE.md.
//
// Idempotent: re-running will not re-initialize or double-deposit.
//
// Env: GATE6_CALLER_KEYPAIR, GATE6_DEPOSIT (base units, default 10000000 = 10 USDC)

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { AnchorProvider, BN, Program, Wallet } from "@anchor-lang/core";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

const PROGRAM_ID = new PublicKey("3e5rBR2J9uHPHHn6tP8HF6mPbEJsJWtzQEyicv6v8qVW");
const NATIVE_USDC = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const DEPOSIT = BigInt(process.env.GATE6_DEPOSIT ?? "10000000");

const usdc = (u) => (Number(u) / 1e6).toFixed(6);
const log = (m) => console.log(m);

const keyPath = process.env.GATE6_CALLER_KEYPAIR
  ?? [".secrets/gate6-caller.json", ".secrets/gate2-solana.json"].find((p) => existsSync(p));
if (!keyPath) throw new Error("no keypair found; run node scripts/gate6-create-caller.mjs");
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(keyPath, "utf8"))));

const connection = new Connection(process.env.SURETY_RPC_ENDPOINT ?? "https://api.devnet.solana.com", "confirmed");
const idl = JSON.parse(await readFile(new URL("../bridge/surety_core.idl.json", import.meta.url), "utf8"));
const program = new Program(idl, new AnchorProvider(connection, new Wallet(payer), { commitment: "confirmed" }));

const vaultId = createHash("sha256").update("broker:native-usdc:settlement-demo:18257739:v1").digest();
const pda = (...seeds) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
const vault = pda(Buffer.from("vault"), vaultId);
const reserve = pda(Buffer.from("reserve"), vault.toBuffer());
const shareMint = pda(Buffer.from("share_mint"), vault.toBuffer());

log(`STEP: authority/LP ${payer.publicKey.toBase58()}`);
log(`STEP: vault ${vault.toBase58()}`);

// --- initialize ---------------------------------------------------------------
// formula_version = 1 → direct issue_policy permitted. Same 9000-bps bucket cap
// and 15000-bps margin as the Gate 3 vault so the premium math is comparable.
let initTx = "already_initialized";
if (!(await connection.getAccountInfo(vault, "confirmed"))) {
  log("STEP: initializing formula-v1 vault");
  initTx = await program.methods
    .initializeVault([...vaultId], 9_000, new BN(172_800), 15_000, 1, 0)
    .accountsStrict({
      authority: payer.publicKey,
      vault,
      assetMint: NATIVE_USDC,
      reserve,
      shareMint,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  log(`  init tx ${initTx}`);
} else {
  log("STEP: vault already initialized");
}

// --- capitalise ---------------------------------------------------------------
const lpAssetAccount = getAssociatedTokenAddressSync(NATIVE_USDC, payer.publicKey);
const lpShareAccount = getAssociatedTokenAddressSync(shareMint, payer.publicKey);

const state = await program.account.vault.fetch(vault);
let depositTx = "skipped";
if (BigInt(state.totalCapital.toString()) === 0n) {
  const balance = BigInt((await connection.getTokenAccountBalance(lpAssetAccount)).value.amount);
  if (balance < DEPOSIT) throw new Error(`LP USDC ${balance} < deposit ${DEPOSIT}; fund at https://faucet.circle.com`);
  log(`STEP: depositing ${usdc(DEPOSIT)} USDC as underwriting capital`);
  depositTx = await program.methods
    .lpDeposit(new BN(DEPOSIT.toString()))
    .accountsStrict({
      lp: payer.publicKey,
      vault,
      assetMint: NATIVE_USDC,
      reserve,
      shareMint,
      lpAssetAccount,
      lpShareAccount,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .preInstructions([
      createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, lpShareAccount, payer.publicKey, shareMint),
    ])
    .rpc();
  log(`  deposit tx ${depositTx}`);
} else {
  log(`STEP: vault already capitalised (${usdc(state.totalCapital.toString())} USDC)`);
}

const final = await program.account.vault.fetch(vault);
console.log("\n" + JSON.stringify({
  vault: vault.toBase58(),
  reserve: reserve.toBase58(),
  asset_mint: NATIVE_USDC.toBase58(),
  formula_version: final.formulaVersion,
  max_bucket_bps: final.maxBucketBps,
  margin_bps: final.marginBps,
  total_capital_usdc: usdc(final.totalCapital.toString()),
  free_reserves_usdc: usdc(final.freeReserves.toString()),
  transactions: {
    initialize: initTx === "already_initialized" ? initTx : `https://explorer.solana.com/tx/${initTx}?cluster=devnet`,
    deposit: depositTx === "skipped" ? depositTx : `https://explorer.solana.com/tx/${depositTx}?cluster=devnet`,
  },
  next: `GATE6_VAULT=${vault.toBase58()} node scripts/gate6-issue-policy-direct.mjs`,
}, null, 2));
