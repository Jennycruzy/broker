// Fund Gate 3 via CCTP: bridge USDC Injective -> Solana into the holder's
// native-USDC account, then move the capital portion into the new vault reserve.
// Leaves the premium portion in the holder account to pay at issuance.
//
// Env: GATE3_VAULT_RESERVE (required), GATE3_FUND_TOTAL (default 17000000),
//      GATE3_FUND_CAPITAL (default 12000000).
import { readFile } from "node:fs/promises";
import {
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { injectiveTestnet } from "viem/chains";
import { burnFromInjective, waitForAttestation, mintOnSolana } from "../bridge/cctp.mjs";

const NATIVE_USDC = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const RESERVE = new PublicKey(process.env.GATE3_VAULT_RESERVE ?? (() => { throw new Error("GATE3_VAULT_RESERVE is required"); })());
const TOTAL = BigInt(process.env.GATE3_FUND_TOTAL ?? "17000000");
const CAPITAL = BigInt(process.env.GATE3_FUND_CAPITAL ?? "12000000");
const PAYER_KEY = ".secrets/gate1-payer.key";
const GAS_KEY = ".secrets/gate1-facilitator.key";
const INJ_RPC = "https://k8s.testnet.json-rpc.injective.network/";

const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const solSecret = JSON.parse(await readFile(".secrets/gate2-solana.json", "utf8"));
const holder = Keypair.fromSecretKey(Uint8Array.from(solSecret));
const log = (m) => console.log(m);

// --- 1. Ensure the Injective payer (holds the USDC) has gas ------------------
const payerAcct = privateKeyToAccount((await readFile(PAYER_KEY, "utf8")).trim());
const gasAcct = privateKeyToAccount((await readFile(GAS_KEY, "utf8")).trim());
const pub = createPublicClient({ chain: injectiveTestnet, transport: http(INJ_RPC) });
let payerGas = await pub.getBalance({ address: payerAcct.address });
log(`INFO: payer ${payerAcct.address} gas ${(Number(payerGas) / 1e18).toFixed(4)} INJ`);
if (payerGas < 200_000_000_000_000_000n) { // < 0.2 INJ
  log("STEP: topping up payer gas from facilitator (0.3 INJ)");
  const gasWallet = createWalletClient({ account: gasAcct, chain: injectiveTestnet, transport: http(INJ_RPC) });
  const gasTx = await gasWallet.sendTransaction({ account: gasAcct, chain: injectiveTestnet, to: payerAcct.address, value: 300_000_000_000_000_000n });
  log(`  gas tx ${gasTx}`);
  for (let i = 0; i < 30; i += 1) {
    payerGas = await pub.getBalance({ address: payerAcct.address });
    if (payerGas >= 200_000_000_000_000_000n) break;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  log(`  payer gas now ${(Number(payerGas) / 1e18).toFixed(4)} INJ`);
}

// --- 2. Ensure the holder native-USDC ATA exists ----------------------------
const holderAta = await getOrCreateAssociatedTokenAccount(connection, holder, NATIVE_USDC, holder.publicKey, false, "confirmed");
log(`INFO: holder native-USDC ATA ${holderAta.address.toBase58()} (balance ${holderAta.amount})`);

// --- 3. Burn on Injective -> mint into the holder ATA -----------------------
log(`STEP: CCTP burn ${TOTAL} base units from Injective payer -> holder ATA`);
const burn = await burnFromInjective({ keyPath: PAYER_KEY, amount: TOTAL, mintRecipient: holderAta.address });
log(`  burn tx https://testnet.blockscout.injective.network/tx/${burn.burnHash}`);
log("STEP: waiting for Circle attestation");
const record = await waitForAttestation(burn.burnHash);
log("  attestation complete");
log("STEP: minting on Solana into holder ATA");
const mint = await mintOnSolana({ record, recipientTokenAccount: holderAta.address, solanaKeyPath: ".secrets/gate2-solana.json", connection });
log(`  mint tx https://explorer.solana.com/tx/${mint.mintSignature}?cluster=devnet`);

// --- 4. Move the capital portion into the vault reserve ---------------------
const afterMint = BigInt((await connection.getTokenAccountBalance(holderAta.address)).value.amount);
if (afterMint < CAPITAL) throw new Error(`holder balance ${afterMint} < intended capital ${CAPITAL}`);
log(`STEP: transferring ${CAPITAL} base units of capital -> vault reserve ${RESERVE.toBase58()}`);
const ix = createTransferCheckedInstruction(holderAta.address, NATIVE_USDC, RESERVE, holder.publicKey, CAPITAL, 6);
const transferSig = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [holder], { commitment: "confirmed" });
log(`  capital transfer tx https://explorer.solana.com/tx/${transferSig}?cluster=devnet`);

const holderFinal = BigInt((await connection.getTokenAccountBalance(holderAta.address)).value.amount);
const reserveFinal = BigInt((await connection.getTokenAccountBalance(RESERVE)).value.amount);
console.log("\n" + JSON.stringify({
  burn_transaction: `https://testnet.blockscout.injective.network/tx/${burn.burnHash}`,
  mint_transaction: `https://explorer.solana.com/tx/${mint.mintSignature}?cluster=devnet`,
  capital_transfer: `https://explorer.solana.com/tx/${transferSig}?cluster=devnet`,
  holder_ata: holderAta.address.toBase58(),
  holder_balance_base_units: holderFinal.toString(),
  reserve: RESERVE.toBase58(),
  reserve_balance_base_units: reserveFinal.toString(),
}, null, 2));
