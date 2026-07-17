import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { AnchorProvider, BN, Program, Wallet } from "@anchor-lang/core";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

const PROGRAM_ID = new PublicKey("3e5rBR2J9uHPHHn6tP8HF6mPbEJsJWtzQEyicv6v8qVW");
const NATIVE_USDC = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const idl = {
  address: PROGRAM_ID.toBase58(),
  metadata: { name: "surety_core", version: "0.1.0", spec: "0.1.0" },
  instructions: [{
    name: "initialize_vault",
    discriminator: [48, 191, 163, 44, 71, 129, 63, 164],
    accounts: [
      { name: "authority", writable: true, signer: true },
      { name: "vault", writable: true },
      { name: "asset_mint" },
      { name: "reserve", writable: true },
      { name: "share_mint", writable: true },
      { name: "token_program" },
      { name: "system_program", address: SystemProgram.programId.toBase58() },
    ],
    args: [
      { name: "vault_id", type: { array: ["u8", 32] } },
      { name: "max_bucket_bps", type: "u16" },
      { name: "epoch_seconds", type: "i64" },
      { name: "margin_bps", type: "u16" },
      { name: "formula_version", type: "u16" },
      { name: "broker_commission_bps", type: "u16" },
    ],
  }],
};

const secret = JSON.parse(await readFile(".secrets/gate2-solana.json", "utf8"));
const payer = Keypair.fromSecretKey(Uint8Array.from(secret));
const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const provider = new AnchorProvider(connection, new Wallet(payer), { commitment: "confirmed" });
const program = new Program(idl, provider);
const vaultId = createHash("sha256").update("broker:native-usdc:fra-eng:18257865:v1").digest();
const pda = (...seeds) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
const vault = pda(Buffer.from("vault"), vaultId);
const reserve = pda(Buffer.from("reserve"), vault.toBuffer());
const shareMint = pda(Buffer.from("share_mint"), vault.toBuffer());

const existing = await connection.getAccountInfo(vault, "confirmed");
let signature;
if (!existing) {
  signature = await program.methods
    .initializeVault([...vaultId], 2_000, new BN(172_800), 15_000, 2, 500)
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

const reserveInfo = await connection.getParsedAccountInfo(reserve, "confirmed");
const parsed = reserveInfo.value?.data;
if (!parsed || !("parsed" in parsed)) throw new Error("SURETY reserve was not created as a parsed token account");
if (parsed.parsed.info.mint !== NATIVE_USDC.toBase58()) throw new Error("SURETY reserve mint is not native USDC");
if (parsed.parsed.info.owner !== vault.toBase58()) throw new Error("SURETY reserve owner is not the vault PDA");

console.log(JSON.stringify({
  program: PROGRAM_ID.toBase58(),
  vault: vault.toBase58(),
  reserve: reserve.toBase58(),
  share_mint: shareMint.toBase58(),
  asset_mint: NATIVE_USDC.toBase58(),
  formula_version: 2,
  initialization_transaction: signature ?? "already_initialized",
  explorer: signature ? `https://explorer.solana.com/tx/${signature}?cluster=devnet` : undefined,
}, null, 2));
