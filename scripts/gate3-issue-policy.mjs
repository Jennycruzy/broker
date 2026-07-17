// GATE 3 — bind a policy on the deployed SURETY vault with real TxLINE-validated
// odds. Fetches a FRESH full-match 1X2 odds packet + fixture snapshot for France
// v England from the live TxLINE API, verifies each proof on-chain, records the
// ValidatedOdds / ValidatedFixture receipts (CPI into the TxLINE validator), then
// issues issue_policy_with_validated_odds. Every quote term is computed from the
// values read back off the on-chain validated accounts, exactly as the program
// re-derives and enforces them. No mock, no synthesized proof, no hardcoded odds.
//
// Env:
//   GATE3_VAULT      vault pubkey (default: Gate 2 native-USDC vault)
//   GATE3_OUTCOME    WIN_HOME | DRAW | WIN_AWAY (default WIN_HOME)
//   GATE3_COVERAGE   coverage in USDC base units (default 1500000 = 1.5 USDC)

import { readFile } from "node:fs/promises";
import { AnchorProvider, BN, Program, Wallet } from "@anchor-lang/core";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  oddsMessageKey,
  suretyOddsValidationInput,
  suretyFixtureValidationInput,
  validateOddsOnDevnet,
  validateFixtureOnDevnet,
} from "@surety-tx/txline-verify";
import {
  createTxlineSession,
  fetchFixtureSnapshot,
  fetchFixtureProof,
  fetchLatestFullMatchOdds,
  fetchOddsProof,
  isFresh,
  oddsAge,
} from "../bridge/txline.mjs";
import {
  OUTCOMES,
  canonicalPredicate,
  predicateHash as predicateHashOf,
  bucketHash as bucketHashOf,
  validatedQuoteTerms,
  verifiedQuoteHash,
} from "../server/pricing.mjs";

const PROGRAM_ID = new PublicKey("3e5rBR2J9uHPHHn6tP8HF6mPbEJsJWtzQEyicv6v8qVW");
const TXLINE_PROGRAM_ID = new PublicKey("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");
const FIXTURE_ID = 18257865n; // France v England, World Cup, 2026-07-18 21:00 UTC
const VAULT = new PublicKey(process.env.GATE3_VAULT ?? "6BaUXkDZAEmdwGHf1B8KNRUqqYvpTbKmzLdKCrH4eGrp");
const OUTCOME_INDEX = OUTCOMES.indexOf(process.env.GATE3_OUTCOME ?? "WIN_HOME");
if (OUTCOME_INDEX < 0) throw new Error("GATE3_OUTCOME must be WIN_HOME | DRAW | WIN_AWAY");
const COVERAGE = BigInt(process.env.GATE3_COVERAGE ?? "1500000");

const u16LE = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; };
const u64LE = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };
const pda = (seeds, programId = PROGRAM_ID) => PublicKey.findProgramAddressSync(seeds, programId)[0];
const dailyOddsRootsPda = (ms) => pda([Buffer.from("daily_batch_roots"), u16LE(Math.floor(ms / 86_400_000))], TXLINE_PROGRAM_ID);
const tenDailyFixturesRootsPda = (ms) => pda([Buffer.from("ten_daily_fixtures_roots"), u16LE(Math.floor(Math.floor(ms / 86_400_000) / 10) * 10)], TXLINE_PROGRAM_ID);

const idl = JSON.parse(await readFile(new URL("../bridge/surety_core.idl.json", import.meta.url), "utf8"));
const secret = JSON.parse(await readFile(".secrets/gate2-solana.json", "utf8"));
const payer = Keypair.fromSecretKey(Uint8Array.from(secret));
const connection = new Connection(process.env.SURETY_RPC_ENDPOINT ?? "https://api.devnet.solana.com", "confirmed");
const provider = new AnchorProvider(connection, new Wallet(payer), { commitment: "confirmed" });
const program = new Program(idl, provider);

const log = (m) => console.log(m);

// --- 1. Fetch fresh live odds + fixture and verify both proofs on-chain -------
const session = await createTxlineSession();
const fixture = await fetchFixtureSnapshot(session, FIXTURE_ID);
log(`STEP: fixture ${fixture.Participant1} v ${fixture.Participant2}, kickoff ${new Date(fixture.StartTime).toISOString()}`);
const { proof: fixtureProof } = await fetchFixtureProof(session, fixture);
if (!(await validateFixtureOnDevnet(provider, fixtureProof))) throw new Error("fresh fixture proof failed on-chain validation");

// TxLINE's demo feed emits fresh full-match 1X2 packets intermittently. Poll
// until one is comfortably inside the on-chain freshness window (leaving buffer
// for record + issue), up to GATE3_WAIT_MINUTES (0 = do not wait).
const waitMinutes = Number(process.env.GATE3_WAIT_MINUTES ?? "0");
const freshBufferMs = 10 * 60 * 1000; // require age < 10 min so record+issue stay < 15
const deadline = Date.now() + waitMinutes * 60 * 1000;
let packet;
for (let attempt = 0; ; attempt += 1) {
  ({ packet } = await fetchLatestFullMatchOdds(session, FIXTURE_ID));
  const age = oddsAge(packet);
  if (age <= freshBufferMs && age >= -30_000) break;
  if (Date.now() >= deadline) throw new Error(`no odds packet inside the freshness window (latest ${(age / 60000).toFixed(1)} min old) after waiting ${waitMinutes} min`);
  if (attempt % 5 === 0) log(`WAIT: latest 1X2 packet ${(age / 60000).toFixed(1)} min old; polling for a fresher one...`);
  await new Promise((r) => setTimeout(r, 60_000));
}
log(`STEP: fresh 1X2 packet ${packet.MessageId} prices ${JSON.stringify(packet.Prices)} age ${(oddsAge(packet) / 60000).toFixed(1)} min`);
const { proof: oddsProof } = await fetchOddsProof(session, packet);
if (!(await validateOddsOnDevnet(provider, oddsProof))) throw new Error("fresh odds proof failed on-chain validation");

// --- 2. Record ValidatedFixture and ValidatedOdds (CPI into TxLINE) -----------
const messageKey = oddsMessageKey(oddsProof.odds.MessageId);
const validatedFixture = pda([Buffer.from("validated_fixture"), u64LE(FIXTURE_ID)]);
const validatedOdds = pda([Buffer.from("validated_odds"), messageKey]);
const txns = {};

if (!(await program.account.validatedFixture.fetchNullable(validatedFixture))) {
  log("STEP: recording ValidatedFixture receipt");
  txns.recordFixture = await program.methods
    .recordValidatedFixture(new BN(FIXTURE_ID.toString()), suretyFixtureValidationInput(fixtureProof))
    .accountsStrict({
      payer: payer.publicKey,
      validatedFixture,
      txlineProgram: TXLINE_PROGRAM_ID,
      tenDailyFixturesRoots: tenDailyFixturesRootsPda(fixtureProof.snapshot.Ts),
      systemProgram: SystemProgram.programId,
    })
    .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 })])
    .rpc();
  log(`  ValidatedFixture tx ${txns.recordFixture}`);
} else {
  log("STEP: ValidatedFixture already recorded");
}

if (!(await program.account.validatedOdds.fetchNullable(validatedOdds))) {
  log("STEP: recording ValidatedOdds receipt");
  txns.recordOdds = await program.methods
    .recordValidatedOdds([...messageKey], suretyOddsValidationInput(oddsProof))
    .accountsStrict({
      payer: payer.publicKey,
      validatedOdds,
      txlineProgram: TXLINE_PROGRAM_ID,
      dailyOddsMerkleRoots: dailyOddsRootsPda(oddsProof.odds.Ts),
      systemProgram: SystemProgram.programId,
    })
    .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })])
    .rpc();
  log(`  ValidatedOdds tx ${txns.recordOdds}`);
} else {
  log("STEP: ValidatedOdds already recorded");
}

// --- 3. Read back on-chain validated accounts and vault, compute quote terms --
const oddsAccount = await program.account.validatedOdds.fetch(validatedOdds);
const fixtureAccount = await program.account.validatedFixture.fetch(validatedFixture);
const vault = await program.account.vault.fetch(VAULT);
const reserveBalance = BigInt((await connection.getTokenAccountBalance(vault.reserve)).value.amount);
// reconcile_reserve folds surplus reserve into total_capital before quoting.
const reconciledCapital =
  BigInt(vault.totalCapital.toString()) +
  (reserveBalance - BigInt(vault.freeReserves.toString()));

const prices = oddsAccount.prices.map((p) => Number(p));
const bucketHash = bucketHashOf(FIXTURE_ID, OUTCOME_INDEX);
const bucket = pda([Buffer.from("bucket"), VAULT.toBuffer(), bucketHash]);
const bucketAccount = await program.account.exposureBucket.fetchNullable(bucket);
const currentExposure = bucketAccount ? BigInt(bucketAccount.lockedExposure.toString()) : 0n;

const { probabilityPpm, premium, utilizationBps } = validatedQuoteTerms({
  totalCapital: reconciledCapital,
  maxBucketBps: vault.maxBucketBps,
  currentExposure,
  coverage: COVERAGE,
  marginBps: vault.marginBps,
  prices,
  outcomeIndex: OUTCOME_INDEX,
});
log(`STEP: quote — capital ${reconciledCapital} base units, prob ${probabilityPpm} ppm, util ${(utilizationBps / 100).toFixed(1)}%, premium ${premium} base units, coverage ${COVERAGE}`);

const predicate17 = canonicalPredicate(FIXTURE_ID, OUTCOME_INDEX);
const predicateBytes = Buffer.alloc(32);
predicate17.copy(predicateBytes);
const predicateHash = predicateHashOf(FIXTURE_ID, OUTCOME_INDEX);
const quoteHash = verifiedQuoteHash({
  vault: VAULT,
  validatedFixture,
  validatedOdds,
  probabilityPpm,
  predicateHash,
  bucketHash,
  coverage: COVERAGE,
  premium,
  fixtureValidationReceiptHash: Buffer.from(fixtureAccount.validationReceiptHash),
  oddsValidationReceiptHash: Buffer.from(oddsAccount.validationReceiptHash),
});

// --- 4. Issue the policy ------------------------------------------------------
const nonce = BigInt(packet.Ts);
const policy = pda([Buffer.from("policy"), VAULT.toBuffer(), payer.publicKey.toBuffer(), predicateHash, u64LE(nonce)]);
const policyEscrow = pda([Buffer.from("policy_escrow"), policy.toBuffer()]);
const holderAssetAccount = getAssociatedTokenAddressSync(vault.assetMint, payer.publicKey);

// Fail closed if the holder cannot pay the premium.
const holderInfo = await connection.getAccountInfo(holderAssetAccount);
const holderBalance = holderInfo ? BigInt((await connection.getTokenAccountBalance(holderAssetAccount)).value.amount) : 0n;
if (holderBalance < premium) {
  throw new Error(`holder native-USDC balance ${holderBalance} < premium ${premium}. Fund the holder ATA ${holderAssetAccount.toBase58()} first.`);
}
if (!isFresh(packet)) throw new Error("odds went stale before issuance; re-run to fetch a fresher packet");

if (!(await program.account.policy.fetchNullable(policy))) {
  log("STEP: issuing policy");
  txns.issuePolicy = await program.methods
    .issuePolicyWithValidatedOdds({
      nonce: new BN(nonce.toString()),
      predicateLen: 17,
      predicateBytes: [...predicateBytes],
      predicateHash: [...predicateHash],
      quoteHash: [...quoteHash],
      bucketHash: [...bucketHash],
      payoutAuthority: payer.publicKey,
      coverage: new BN(COVERAGE.toString()),
      premium: new BN(premium.toString()),
      expiresAt: new BN(Math.floor(Date.now() / 1000) + 30 * 24 * 3600),
    })
    .accountsStrict({
      holder: payer.publicKey,
      vault: VAULT,
      assetMint: vault.assetMint,
      reserve: vault.reserve,
      holderAssetAccount,
      brokerAssetAccount: null,
      bucket,
      policy,
      policyEscrow,
      validatedOdds,
      validatedFixture,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  log(`  issuePolicy tx ${txns.issuePolicy}`);
} else {
  log("STEP: policy already issued at this nonce");
}

// --- 5. Verify the bound policy on-chain --------------------------------------
const stored = await program.account.policy.fetch(policy);
if (!Buffer.from(stored.quoteHash).equals(quoteHash)) throw new Error("stored policy quote hash does not match computed quote hash");
const escrowBalance = BigInt((await connection.getTokenAccountBalance(policyEscrow)).value.amount);

console.log("\n" + JSON.stringify({
  gate: "3 — policy bound on SURETY with TxLINE-validated odds",
  fixture: `${fixture.Participant1} v ${fixture.Participant2} (${FIXTURE_ID})`,
  outcome_insured: OUTCOMES[OUTCOME_INDEX],
  odds: { messageId: packet.MessageId, prices, timestampMs: Number(oddsAccount.oddsTimestampMs) },
  vault: VAULT.toBase58(),
  validatedOdds: validatedOdds.toBase58(),
  validatedFixture: validatedFixture.toBase58(),
  policy: policy.toBase58(),
  policyEscrow: policyEscrow.toBase58(),
  coverage_base_units: COVERAGE.toString(),
  premium_base_units: premium.toString(),
  probability_ppm: probabilityPpm,
  policy_status: stored.status,
  escrow_balance_base_units: escrowBalance.toString(),
  transactions: Object.fromEntries(Object.entries(txns).map(([k, v]) => [k, `https://explorer.solana.com/tx/${v}?cluster=devnet`])),
}, null, 2));
