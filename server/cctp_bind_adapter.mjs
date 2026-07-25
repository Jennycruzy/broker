import { readFile } from "node:fs/promises";
import { getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { burnFromInjective, mintOnSolana, waitForAttestation } from "../bridge/cctp.mjs";

const NATIVE_DEVNET_USDC = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

// Creates the real CCTP stage used by bind orchestration. The Injective key must
// control the address that received the x402 premium. The Solana key is both the
// CCTP mint payer and the eventual policy holder; minting to its ATA is required
// because SURETY debits the premium from the holder during issuance.
export function createCctpBindAdapter({
  injectiveKeyPath,
  solanaKeyPath,
  rpcEndpoint = "https://api.devnet.solana.com",
  attestationTimeoutMs = 180_000,
}) {
  if (!injectiveKeyPath || !solanaKeyPath) {
    throw new Error("CCTP bind adapter requires injectiveKeyPath and solanaKeyPath");
  }

  return async function bridgePremium(paymentReceipt) {
    const amount = BigInt(paymentReceipt.premium_amount);
    if (amount <= 0n) throw new Error("cannot bridge a non-positive premium");

    const secret = JSON.parse(await readFile(solanaKeyPath, "utf8"));
    const holder = Keypair.fromSecretKey(Uint8Array.from(secret));
    const connection = new Connection(rpcEndpoint, "confirmed");
    const holderAta = await getOrCreateAssociatedTokenAccount(
      connection,
      holder,
      NATIVE_DEVNET_USDC,
      holder.publicKey,
      false,
      "confirmed",
    );

    const burn = await burnFromInjective({
      keyPath: injectiveKeyPath,
      amount,
      mintRecipient: holderAta.address,
    });
    const attestation = await waitForAttestation(burn.burnHash, {
      timeoutMs: attestationTimeoutMs,
    });
    const mint = await mintOnSolana({
      record: attestation,
      recipientTokenAccount: holderAta.address,
      solanaKeyPath,
      connection,
    });

    return {
      amount: amount.toString(),
      holder: holder.publicKey.toBase58(),
      holder_asset_account: holderAta.address.toBase58(),
      approve_transaction: burn.approveHash,
      burn_transaction: burn.burnHash,
      mint_transaction: mint.mintSignature,
    };
  };
}
