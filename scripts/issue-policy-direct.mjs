// Issues a policy through `issue_policy` — the direct path, without a TxLINE
// odds-validation receipt.
//
// WHAT THIS IS AND IS NOT. odds-validated issuance proved odds-validated issuance: a policy priced
// from a signed odds packet that the SURETY program re-verified on-chain inside a
// 15-minute freshness window. That path is the product. This script does NOT
// reproduce it and does not claim to.
//
// This exists to exercise the SETTLEMENT path. Settlement can only be
// demonstrated by a policy whose insured outcome actually occurred, and the
// odds-validated path can only bind against a fixture the feed is actively
// pricing — i.e. a match that has not been played, and therefore has no result.
// The two requirements are mutually exclusive at any single moment. `issue_policy`
// takes the predicate and terms directly, so a policy can be bound on a fixture
// that has already finished, and then settled against its real Merkle proof.
//
// Everything about the resulting policy is real: real USDC premium, real coverage
// locked in a real escrow PDA, real predicate the program re-derives. The single
// thing it lacks is an on-chain ValidatedOdds receipt. The premium is still
// computed by server/pricing.mjs from the fixture's real recorded closing book,
// so the number is reproducible rather than invented — but it is a broker-side
// price, not one the chain re-derived from a validated packet.
//
// Env:
//   BROKER_SETTLEMENT_FIXTURE_ID   fixture to insure (default 18257739, Spain v Argentina)
//   BROKER_SETTLEMENT_OUTCOME      WIN_HOME | DRAW | WIN_AWAY (default WIN_HOME)
//   BROKER_SETTLEMENT_COVERAGE     coverage in USDC base units (default 2000000 = 2 USDC)
//   BROKER_SETTLEMENT_KEYPAIR   holder/payer keypair
//   BROKER_CONFIRM      "yes" to actually send

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { AnchorProvider, BN, Program, Wallet } from "@anchor-lang/core";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { createReplaySession, fetchLatestFullMatchOdds } from "../bridge/txline_replay.mjs";
import {
  OUTCOMES,
  canonicalPredicate,
  predicateHash as predicateHashOf,
  bucketHash as bucketHashOf,
  validatedQuoteTerms,
} from "../server/pricing.mjs";

const PROGRAM_ID = new PublicKey("3e5rBR2J9uHPHHn6tP8HF6mPbEJsJWtzQEyicv6v8qVW");
const FIXTURE_ID = BigInt(process.env.BROKER_SETTLEMENT_FIXTURE_ID ?? "18257739");
const OUTCOME_INDEX = OUTCOMES.indexOf(process.env.BROKER_SETTLEMENT_OUTCOME ?? "WIN_HOME");
if (OUTCOME_INDEX < 0) throw new Error("BROKER_SETTLEMENT_OUTCOME must be WIN_HOME | DRAW | WIN_AWAY");
const COVERAGE = BigInt(process.env.BROKER_SETTLEMENT_COVERAGE ?? "2000000");
const VAULT = new PublicKey(process.env.BROKER_SETTLEMENT_VAULT ?? "CrnjZE2DXMPLtRXJ6MPHaKifEi13qp1vAFn9ohXBpqZu");
const CONFIRM = process.env.BROKER_CONFIRM === "yes";

const log = (m) => console.log(m);
const usdc = (units) => (Number(units) / 1e6).toFixed(6);
const u64LE = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };
const pda = (seeds, programId = PROGRAM_ID) => PublicKey.findProgramAddressSync(seeds, programId)[0];

const keyPath = process.env.BROKER_SETTLEMENT_KEYPAIR
  ?? [".secrets/settlement-caller.json", ".secrets/solana.json"].find((p) => existsSync(p));
if (!keyPath) throw new Error("no holder keypair found; run node scripts/create-settlement-caller.mjs");
const holder = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(keyPath, "utf8"))));

const connection = new Connection(process.env.SURETY_RPC_ENDPOINT ?? "https://api.devnet.solana.com", "confirmed");
const idl = JSON.parse(await readFile(new URL("../bridge/surety_core.idl.json", import.meta.url), "utf8"));
const provider = new AnchorProvider(connection, new Wallet(holder), { commitment: "confirmed" });
const program = new Program(idl, provider);

log(`STEP: holder ${holder.publicKey.toBase58()}`);

// --- price it from the fixture's real recorded closing book -------------------
const { packet, recordedAt } = await fetchLatestFullMatchOdds(createReplaySession(), FIXTURE_ID);
const prices = packet.Prices;
log(`STEP: closing book ${packet.MessageId} prices ${JSON.stringify(prices)} (recorded ${recordedAt})`);

const vault = await program.account.vault.fetch(VAULT);
const bucketHash = bucketHashOf(FIXTURE_ID, OUTCOME_INDEX);
const bucket = pda([Buffer.from("bucket"), VAULT.toBuffer(), bucketHash]);
const bucketAccount = await program.account.exposureBucket.fetchNullable(bucket);
const currentExposure = bucketAccount ? BigInt(bucketAccount.lockedExposure.toString()) : 0n;

const { probabilityPpm, premium, utilizationBps } = validatedQuoteTerms({
  totalCapital: BigInt(vault.totalCapital.toString()),
  maxBucketBps: BigInt(vault.maxBucketBps),
  currentExposure,
  coverage: COVERAGE,
  marginBps: BigInt(vault.marginBps),
  prices,
  outcomeIndex: OUTCOME_INDEX,
});
log(`STEP: quote — ${OUTCOMES[OUTCOME_INDEX]} @ ${(probabilityPpm / 10000).toFixed(2)}%, coverage ${usdc(COVERAGE)}, premium ${usdc(premium)} USDC, util ${(utilizationBps / 100).toFixed(1)}%`);

// Fail closed rather than let the program reject us deep in a transfer.
const freeReserves = BigInt(vault.freeReserves.toString());
if (COVERAGE > freeReserves) throw new Error(`coverage ${COVERAGE} exceeds vault free reserves ${freeReserves}`);

const holderAssetAccount = getAssociatedTokenAddressSync(vault.assetMint, holder.publicKey);
if (!(await connection.getAccountInfo(holderAssetAccount))) {
  throw new Error(`holder has no USDC account ${holderAssetAccount.toBase58()} — fund it at https://faucet.circle.com (Solana devnet)`);
}
const holderBalance = BigInt((await connection.getTokenAccountBalance(holderAssetAccount)).value.amount);
if (holderBalance < premium) throw new Error(`holder USDC ${holderBalance} < premium ${premium}`);
log(`STEP: holder USDC ${usdc(holderBalance)} covers the ${usdc(premium)} premium`);

// --- policy terms -------------------------------------------------------------
// predicate_hash must be sha256 of the canonical 17-byte predicate or the program
// rejects with PredicateHashMismatch (6019). bucket_hash likewise pins the
// exposure bucket. Both come from the same helpers odds-validated issuance used.
const predicate17 = canonicalPredicate(FIXTURE_ID, OUTCOME_INDEX);
const predicateBytes = Buffer.alloc(32);
predicate17.copy(predicateBytes);
const predicateHash = predicateHashOf(FIXTURE_ID, OUTCOME_INDEX);

// quote_hash is a broker-side commitment to the terms. On the validated path the
// program re-derives it from the ValidatedOdds/ValidatedFixture receipts; on this
// direct path there are no such receipts, so it commits to the inputs that DO
// exist. Documented here so nobody later mistakes it for a chain-verified quote.
const quoteHash = createHash("sha256")
  .update(Buffer.from("BROKER_DIRECT_ISSUE_V1"))
  .update(VAULT.toBuffer())
  .update(predicateHash)
  .update(bucketHash)
  .update(u64LE(COVERAGE))
  .update(u64LE(premium))
  .update(Buffer.from(String(packet.MessageId)))
  .digest();

const nonce = BigInt(Date.now());
const policy = pda([Buffer.from("policy"), VAULT.toBuffer(), holder.publicKey.toBuffer(), predicateHash, u64LE(nonce)]);
const policyEscrow = pda([Buffer.from("policy_escrow"), policy.toBuffer()]);

const builder = program.methods
  .issuePolicy({
    nonce: new BN(nonce.toString()),
    predicateLen: 17,
    predicateBytes: [...predicateBytes],
    predicateHash: [...predicateHash],
    quoteHash: [...quoteHash],
    bucketHash: [...bucketHash],
    payoutAuthority: holder.publicKey,
    coverage: new BN(COVERAGE.toString()),
    premium: new BN(premium.toString()),
    expiresAt: new BN(Math.floor(Date.now() / 1000) + 30 * 24 * 3600),
  })
  .accountsStrict({
    holder: holder.publicKey,
    vault: VAULT,
    assetMint: vault.assetMint,
    reserve: vault.reserve,
    holderAssetAccount,
    brokerAssetAccount: null,
    bucket,
    policy,
    policyEscrow,
    tokenProgram: TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  })
  .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })]);

log(`STEP: simulating issue_policy for ${policy.toBase58()}`);
const simulation = await builder.simulate().catch((error) => ({ error }));
if (simulation.error) {
  const response = simulation.error.simulationResponse ?? {};
  for (const line of simulation.error.logs ?? response.logs ?? []) log(`  ${line}`);
  throw simulation.error;
}
log("PASS: simulation succeeded");

if (!CONFIRM) {
  log("\nDRY RUN. Nothing was written on-chain. Re-run with BROKER_CONFIRM=yes to issue.");
  process.exit(0);
}

log("\nSTEP: BROKER_CONFIRM=yes — issuing for real");
const signature = await builder.rpc();
await connection.confirmTransaction(signature, "confirmed");

const stored = await program.account.policy.fetch(policy);
const escrowBalance = BigInt((await connection.getTokenAccountBalance(policyEscrow)).value.amount);

console.log("\n" + JSON.stringify({
  note: "issued via issue_policy (direct path) — NOT odds-validated; see script header",
  fixture: FIXTURE_ID.toString(),
  outcome_insured: OUTCOMES[OUTCOME_INDEX],
  policy: policy.toBase58(),
  policyEscrow: policyEscrow.toBase58(),
  holder: holder.publicKey.toBase58(),
  coverage_usdc: usdc(COVERAGE),
  premium_usdc: usdc(premium),
  probability_ppm: probabilityPpm,
  priced_from: { messageId: packet.MessageId, prices, recordedAt },
  status: Object.keys(stored.status)[0],
  escrow_balance_usdc: usdc(escrowBalance),
  transaction: `https://explorer.solana.com/tx/${signature}?cluster=devnet`,
  next: `BROKER_SETTLEMENT_POLICY=${policy.toBase58()} BROKER_SETTLEMENT_FIXTURE_ID=${FIXTURE_ID} npm run settle:settlement`,
}, null, 2));
