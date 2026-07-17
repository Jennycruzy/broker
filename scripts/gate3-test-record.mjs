// De-risk the record path (untested until a fresh packet arrives): record the
// ValidatedFixture and ValidatedOdds receipts on-chain from the already-valid
// recorded proofs. The fixture receipt (PDA keyed by fixture id) is REUSED by
// the fresh issuance; the odds receipt here is an orphan (a stale message key)
// that only proves the instruction mechanics. Idempotent.
import { readFile } from "node:fs/promises";
import { AnchorProvider, BN, Program, Wallet } from "@anchor-lang/core";
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  oddsMessageKey,
  suretyOddsValidationInput,
  suretyFixtureValidationInput,
  pureFixtureId,
} from "@surety-tx/txline-verify";

const PROGRAM_ID = new PublicKey("3e5rBR2J9uHPHHn6tP8HF6mPbEJsJWtzQEyicv6v8qVW");
const TXLINE_PROGRAM_ID = new PublicKey("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");
const u16LE = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; };
const u64LE = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };
const pda = (seeds, pid = PROGRAM_ID) => PublicKey.findProgramAddressSync(seeds, pid)[0];
const dailyOddsRootsPda = (ms) => pda([Buffer.from("daily_batch_roots"), u16LE(Math.floor(ms / 86_400_000))], TXLINE_PROGRAM_ID);
const tenDailyFixturesRootsPda = (ms) => pda([Buffer.from("ten_daily_fixtures_roots"), u16LE(Math.floor(Math.floor(ms / 86_400_000) / 10) * 10)], TXLINE_PROGRAM_ID);

const idl = JSON.parse(await readFile(new URL("../bridge/surety_core.idl.json", import.meta.url), "utf8"));
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(".secrets/gate2-solana.json", "utf8"))));
const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const program = new Program(idl, new AnchorProvider(connection, new Wallet(payer), { commitment: "confirmed" }));

const fixtureProof = JSON.parse(await readFile("data/recordings/txline-18257865-1784149200000-fixture-proof.raw.json", "utf8"));
const oddsProof = JSON.parse(await readFile("data/recordings/txline-18257865-1784183945134-odds-proof.raw.json", "utf8"));
const fixtureId = pureFixtureId(fixtureProof.snapshot.FixtureId);

const validatedFixture = pda([Buffer.from("validated_fixture"), u64LE(fixtureId)]);
if (!(await program.account.validatedFixture.fetchNullable(validatedFixture))) {
  const sig = await program.methods
    .recordValidatedFixture(new BN(fixtureId.toString()), suretyFixtureValidationInput(fixtureProof))
    .accountsStrict({ payer: payer.publicKey, validatedFixture, txlineProgram: TXLINE_PROGRAM_ID, tenDailyFixturesRoots: tenDailyFixturesRootsPda(fixtureProof.snapshot.Ts), systemProgram: SystemProgram.programId })
    .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 })])
    .rpc();
  console.log(`PASS: record_validated_fixture -> https://explorer.solana.com/tx/${sig}?cluster=devnet`);
} else {
  console.log("PASS: ValidatedFixture already recorded (reused by issuance)");
}
const fx = await program.account.validatedFixture.fetch(validatedFixture);
console.log(`  ValidatedFixture ${validatedFixture.toBase58()} fixture_id ${fx.fixtureId} receiptHash ${Buffer.from(fx.validationReceiptHash).toString("hex").slice(0, 16)}…`);

const messageKey = oddsMessageKey(oddsProof.odds.MessageId);
const validatedOdds = pda([Buffer.from("validated_odds"), messageKey]);
if (!(await program.account.validatedOdds.fetchNullable(validatedOdds))) {
  const sig = await program.methods
    .recordValidatedOdds([...messageKey], suretyOddsValidationInput(oddsProof))
    .accountsStrict({ payer: payer.publicKey, validatedOdds, txlineProgram: TXLINE_PROGRAM_ID, dailyOddsMerkleRoots: dailyOddsRootsPda(oddsProof.odds.Ts), systemProgram: SystemProgram.programId })
    .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })])
    .rpc();
  console.log(`PASS: record_validated_odds (stale recorded proof) -> https://explorer.solana.com/tx/${sig}?cluster=devnet`);
} else {
  console.log("PASS: ValidatedOdds (recorded proof) already present");
}
const od = await program.account.validatedOdds.fetch(validatedOdds);
console.log(`  ValidatedOdds ${validatedOdds.toBase58()} prices ${JSON.stringify(od.prices.map(Number))} ts ${new Date(Number(od.oddsTimestampMs)).toISOString()}`);
console.log("\nRESULT: record_validated_fixture and record_validated_odds both execute on-chain against the TxLINE validator.");
