// Read-only: current capital state relevant to Gate 3 sizing.
import { readFile } from "node:fs/promises";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

const NATIVE_USDC = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const RESERVE = new PublicKey("EgwE41BznuyVGtboQb5uBHsPdbabBzjzhyWYr3VRYC5J");
const VAULT = new PublicKey("6BaUXkDZAEmdwGHf1B8KNRUqqYvpTbKmzLdKCrH4eGrp");
const PROGRAM = new PublicKey("3e5rBR2J9uHPHHn6tP8HF6mPbEJsJWtzQEyicv6v8qVW");

const secret = JSON.parse(await readFile(".secrets/gate2-solana.json", "utf8"));
const wallet = Keypair.fromSecretKey(Uint8Array.from(secret));
const connection = new Connection("https://api.devnet.solana.com", "confirmed");

const usdc = (b) => `${b} base units (${(Number(b) / 1e6).toFixed(6)} USDC)`;

console.log("holder/LP wallet:", wallet.publicKey.toBase58());
console.log("SOL:", (await connection.getBalance(wallet.publicKey)) / 1e9);

const ata = getAssociatedTokenAddressSync(NATIVE_USDC, wallet.publicKey);
const ataInfo = await connection.getAccountInfo(ata);
if (ataInfo) {
  const bal = await connection.getTokenAccountBalance(ata);
  console.log("holder native-USDC ATA:", ata.toBase58(), "->", usdc(bal.value.amount));
} else {
  console.log("holder native-USDC ATA:", ata.toBase58(), "-> DOES NOT EXIST (0 USDC)");
}

const reserveBal = await connection.getTokenAccountBalance(RESERVE);
console.log("vault reserve:", RESERVE.toBase58(), "->", usdc(reserveBal.value.amount));

// Decode vault account fields we care about. Anchor layout: 8 disc, then fields.
// We only need total_capital / free_reserves / locked_liabilities / max_bucket_bps.
// Read raw and locate via the IDL offsets is fragile; instead fetch via getParsedAccountInfo of reserve owner
const vaultInfo = await connection.getAccountInfo(VAULT);
console.log("vault account:", VAULT.toBase58(), "owner", vaultInfo?.owner.toBase58(), "size", vaultInfo?.data.length);
