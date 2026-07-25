// Read-only SURETY chain reader.
//
// Everything here fetches; nothing signs, and nothing is cached across calls.
// It exists so the dashboard and the proof-gated settlement verifier read policy/vault state
// from devnet instead of restating figures a human typed into a source file —
// a hardcoded `status: "Open"` becomes a lie the moment settlement lands.
//
// The provider carries a throwaway keypair: Anchor requires a wallet to build a
// Program, but account fetches never use it. No secret is read by this module.

import { readFile } from "node:fs/promises";
import { AnchorProvider, Program, Wallet } from "@anchor-lang/core";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

export const RPC_ENDPOINT = process.env.SURETY_RPC_ENDPOINT ?? "https://api.devnet.solana.com";

const idl = JSON.parse(await readFile(new URL("./surety_core.idl.json", import.meta.url), "utf8"));

export const SURETY_PROGRAM_ID = new PublicKey(idl.address);

// Mirror of the on-chain `bucket` PDA seeds. Quoting needs the bucket's current
// exposure, and the bucket account does not exist until the first policy is
// written into it — so callers must treat "missing" as zero exposure, not error.
export function deriveBucket(vault, bucketHash) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bucket"), new PublicKey(vault).toBuffer(), Buffer.from(bucketHash)],
    SURETY_PROGRAM_ID,
  )[0];
}

export function createReadOnlyProgram(endpoint = RPC_ENDPOINT) {
  const connection = new Connection(endpoint, "confirmed");
  const provider = new AnchorProvider(connection, new Wallet(Keypair.generate()), { commitment: "confirmed" });
  return { program: new Program(idl, provider), connection };
}

// PolicyStatus is an Anchor enum: `{ open: {} }` / `{ triggered: {} }` / `{ expired: {} }`.
export function statusLabel(status) {
  const key = Object.keys(status ?? {})[0];
  if (!key) throw new Error("policy status enum is empty — IDL/account mismatch");
  return key[0].toUpperCase() + key.slice(1);
}

async function tokenAmount(connection, account) {
  const balance = await connection.getTokenAccountBalance(new PublicKey(account));
  return BigInt(balance.value.amount);
}

// Full policy view including the escrow balance, which is what actually proves
// whether coverage is still locked. Escrow is closed on settlement, so a missing
// account is a real state, not an error — reported as null.
export async function readPolicy({ program, connection }, policyAddress) {
  const address = new PublicKey(policyAddress);
  const policy = await program.account.policy.fetch(address);
  let escrowBalance = null;
  try {
    escrowBalance = await tokenAmount(connection, policy.escrow);
  } catch {
    escrowBalance = null; // escrow closed at settlement, or never funded
  }
  return {
    address: address.toBase58(),
    status: statusLabel(policy.status),
    vault: policy.vault.toBase58(),
    holder: policy.holder.toBase58(),
    payoutAuthority: policy.payoutAuthority.toBase58(),
    bucket: policy.bucket.toBase58(),
    escrow: policy.escrow.toBase58(),
    escrowBalance,
    bucketHash: Buffer.from(policy.bucketHash),
    predicateBytes: Buffer.from(policy.predicateBytes),
    predicateLen: policy.predicateLen,
    coverage: BigInt(policy.coverage.toString()),
    premium: BigInt(policy.premium.toString()),
    createdAt: Number(policy.createdAt),
    expiresAt: Number(policy.expiresAt),
  };
}

export async function readVault({ program, connection }, vaultAddress) {
  const address = new PublicKey(vaultAddress);
  const vault = await program.account.vault.fetch(address);
  return {
    address: address.toBase58(),
    authority: vault.authority.toBase58(),
    assetMint: vault.assetMint.toBase58(),
    reserve: vault.reserve.toBase58(),
    reserveBalance: await tokenAmount(connection, vault.reserve),
    totalCapital: BigInt(vault.totalCapital.toString()),
    freeReserves: BigInt(vault.freeReserves.toString()),
    lockedLiabilities: BigInt(vault.lockedLiabilities.toString()),
    maxBucketBps: BigInt(vault.maxBucketBps),
    marginBps: BigInt(vault.marginBps),
    formulaVersion: Number(vault.formulaVersion),
    policyCount: Number(vault.policyCount),
  };
}

export async function readValidatedOdds({ program }, oddsAddress) {
  const odds = await program.account.validatedOdds.fetch(new PublicKey(oddsAddress));
  return {
    address: new PublicKey(oddsAddress).toBase58(),
    fixtureId: odds.fixtureId.toString(),
    oddsTimestampMs: Number(odds.oddsTimestampMs),
    prices: odds.prices.map(Number),
  };
}

// The exposure bucket a policy is priced into — `locked_exposure` is the live
// `currentExposure` input to the premium formula in server/pricing.mjs.
export async function readBucket({ program }, bucketAddress) {
  const bucket = await program.account.exposureBucket.fetchNullable(new PublicKey(bucketAddress));
  if (bucket === null) return { exists: false, lockedExposure: 0n, openPolicyCount: 0 };
  return {
    exists: true,
    lockedExposure: BigInt(bucket.lockedExposure.toString()),
    openPolicyCount: Number(bucket.openPolicyCount),
  };
}
