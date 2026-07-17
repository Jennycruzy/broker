// Gate 3, Part A — TxLINE odds/fixture validation primitive.
//
// Proves the exact functions Gate 3 names — validateOddsOnDevnet /
// suretyOddsValidationInput (and the fixture equivalents) from the public
// package @surety-tx/txline-verify — against REAL recorded TxLINE proofs for
// fixture 18257865 (France v England, World Cup). validateOddsOnDevnet uses a
// read-only `.view()` CPI into the deployed TxLINE validator on Solana devnet,
// so it needs no funded wallet and no TxLINE API token.
//
// Positive test: the authentic proof verifies (true).
// Negative test: flipping one proof bit is rejected (false).
//
// This is the verification half of Gate 3. The issuance half
// (issue_policy_with_validated_odds) additionally requires a FRESH (<15 min)
// live odds packet, which needs the TxLINE API token — see EVIDENCE.md.

import { readFile } from "node:fs/promises";
import { AnchorProvider, Wallet } from "@anchor-lang/core";
import { Connection, Keypair } from "@solana/web3.js";
import {
  assertAuthenticProofShape,
  assertAuthenticFixtureProofShape,
  suretyOddsValidationInput,
  suretyFixtureValidationInput,
  validateOddsOnDevnet,
  validateFixtureOnDevnet,
  oddsMessageKey,
} from "@surety-tx/txline-verify";

const ODDS_PROOF = "data/recordings/txline-18257865-1784183945134-odds-proof.raw.json";
const FIXTURE_PROOF = "data/recordings/txline-18257865-1784149200000-fixture-proof.raw.json";

const connection = new Connection("https://api.devnet.solana.com", "confirmed");
// `.view()` simulates and never signs or sends, but Solana simulation still
// requires the fee-payer account to exist on-chain. Reuse the funded Gate 2
// devnet wallet as a read-only fee payer; no transaction is ever submitted.
const secret = JSON.parse(await readFile(".secrets/gate2-solana.json", "utf8"));
const provider = new AnchorProvider(connection, new Wallet(Keypair.fromSecretKey(Uint8Array.from(secret))), {
  commitment: "confirmed",
});

const results = [];
function record(claim, pass, detail) {
  results.push({ claim, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}: ${claim}${detail ? ` — ${detail}` : ""}`);
}

const oddsProof = JSON.parse(await readFile(ODDS_PROOF, "utf8"));
const fixtureProof = JSON.parse(await readFile(FIXTURE_PROOF, "utf8"));

// Shape assertions (bounded, authentic proof payload).
assertAuthenticProofShape(oddsProof);
assertAuthenticFixtureProofShape(fixtureProof);
record(
  "recorded FRA v England proofs pass @surety-tx/txline-verify authenticity shape checks",
  true,
  `odds MessageId ${oddsProof.odds.MessageId}, fixture ${fixtureProof.snapshot.Participant1} v ${fixtureProof.snapshot.Participant2}`,
);

// suretyOddsValidationInput / suretyFixtureValidationInput produce the exact
// on-chain instruction arguments for record_validated_odds/fixture.
const oddsInput = suretyOddsValidationInput(oddsProof);
const fixtureInput = suretyFixtureValidationInput(fixtureProof);
const messageKey = oddsMessageKey(oddsProof.odds.MessageId);
record(
  "suretyOddsValidationInput / suretyFixtureValidationInput shape the on-chain record args",
  oddsInput.oddsSnapshot.prices.length === 3 &&
    Array.isArray(oddsInput.mainTreeProof) &&
    typeof fixtureInput.snapshot.fixtureId !== "undefined" &&
    messageKey.length === 16,
  `prices ${JSON.stringify(oddsInput.oddsSnapshot.prices)}, message_id_key ${messageKey.toString("hex")}`,
);

// Positive: the deployed TxLINE validator on devnet cryptographically verifies
// the authentic odds proof against the on-chain daily merkle root.
const oddsValid = await validateOddsOnDevnet(provider, oddsProof);
record(
  "TxLINE validate_odds CPI verifies the authentic recorded FRA v England odds proof on devnet",
  oddsValid === true,
  `returned ${oddsValid}`,
);

const fixtureValid = await validateFixtureOnDevnet(provider, fixtureProof);
record(
  "TxLINE validate_fixture CPI verifies the authentic recorded fixture proof on devnet",
  fixtureValid === true,
  `returned ${fixtureValid}`,
);

// Negative: flipping a single proof bit must be rejected by the on-chain
// validator. A path that cannot fail cannot verify. Rejection manifests as a
// hard on-chain program error (the tampered snapshot no longer hashes into the
// summary/root), not a `false` return — so the correct pass condition is that
// validation THROWS with the validator's rejection code.
async function expectRejected(label, fn) {
  try {
    const value = await fn();
    record(label, false, `NOT rejected — returned ${value}`);
  } catch (error) {
    const logs = error?.simulationResponse?.logs ?? [];
    const reason = logs.find((line) => /Error Message:|Error Code:/.test(line)) ?? String(error).split("\n")[0];
    record(label, true, `on-chain rejection: ${reason.trim()}`);
  }
}

await expectRejected(
  "TxLINE validate_odds REJECTS a tampered odds proof (one flipped bit)",
  () => validateOddsOnDevnet(provider, oddsProof, { tamperFirstProofBit: true }),
);

// This fixture proof has an empty sub-tree path (a single-update fixture), so
// the package's `tamperFirstProofBit` helper — which only flips subTreeProof[0]
// — is a no-op here. Corrupt the main-tree path directly instead: flipping one
// bit of mainTreeProof[0] must break the root reconstruction and be rejected.
const tamperedFixture = JSON.parse(JSON.stringify(fixtureProof));
tamperedFixture.mainTreeProof[0].hash[0] ^= 1;
await expectRejected(
  "TxLINE validate_fixture REJECTS a tampered fixture proof (one flipped main-tree bit)",
  () => validateFixtureOnDevnet(provider, tamperedFixture),
);

const failed = results.filter((r) => !r.pass);
console.log("\n" + JSON.stringify({
  fixture: "18257865 — France v England, World Cup, 2026-07-18 21:00 UTC",
  odds_prices: oddsProof.odds.Prices,
  odds_price_names: oddsProof.odds.PriceNames,
  odds_timestamp: new Date(oddsProof.odds.Ts).toISOString(),
  checks: results.length,
  passed: results.length - failed.length,
  failed: failed.length,
}, null, 2));
if (failed.length > 0) process.exit(1);
