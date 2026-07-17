// Create a fresh native-USDC SURETY vault for Gate 3, with a 9000-bps bucket cap
// (capital-efficient: coverage may approach 90% of capital) and formula version 2
// so it accepts issue_policy_with_validated_odds. Idempotent.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { AnchorProvider, BN, Program, Wallet } from "@anchor-lang/core";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

const PROGRAM_ID = new PublicKey("3e5rBR2J9uHPHHn6tP8HF6mPbEJsJWtzQEyicv6v8qVW");
const NATIVE_USDC = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const idl = JSON.parse(await readFile(new URL("../bridge/surety_core.idl.json", import.meta.url), "utf8"));

const secret = JSON.parse(await readFile(".secrets/gate2-solana.json", "utf8"));
const payer = Keypair.fromSecretKey(Uint8Array.from(secret));
const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const provider = new AnchorProvider(connection, new Wallet(payer), { commitment: "confirmed" });
const program = new Program(idl, provider);

const vaultId = createHash("sha256").update("broker:native-usdc:fra-eng:18257865:v2-9000bps").digest();
const pda = (...seeds) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
const vault = pda(Buffer.from("vault"), vaultId);
const reserve = pda(Buffer.from("reserve"), vault.toBuffer());
const shareMint = pda(Buffer.from("share_mint"), vault.toBuffer());

let signature = "already_initialized";
if (!(await connection.getAccountInfo(vault, "confirmed"))) {
  // args: vault_id, max_bucket_bps=9000, epoch_seconds=172800, margin_bps=15000,
  //       formula_version=2, broker_commission_bps=0
  signature = await program.methods
    .initializeVault([...vaultId], 9_000, new BN(172_800), 15_000, 2, 0)
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
}

const state = await program.account.vault.fetch(vault);
console.log(JSON.stringify({
  vault: vault.toBase58(),
  reserve: reserve.toBase58(),
  share_mint: shareMint.toBase58(),
  asset_mint: NATIVE_USDC.toBase58(),
  max_bucket_bps: state.maxBucketBps,
  margin_bps: state.marginBps,
  formula_version: state.formulaVersion,
  broker_commission_bps: state.brokerCommissionBps,
  total_capital: state.totalCapital.toString(),
  initialize_transaction: signature,
  explorer: signature === "already_initialized" ? undefined : `https://explorer.solana.com/tx/${signature}?cluster=devnet`,
}, null, 2));
