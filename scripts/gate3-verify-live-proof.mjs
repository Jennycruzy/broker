// De-risk: prove a FRESHLY-fetched TxLINE odds+fixture proof verifies on-chain,
// the way issuance will need it (not a stored recording). Read-only; no burns.
import { readFile } from "node:fs/promises";
import { AnchorProvider, Wallet } from "@anchor-lang/core";
import { Connection, Keypair } from "@solana/web3.js";
import { validateOddsOnDevnet, validateFixtureOnDevnet, pureFixtureId } from "@surety-tx/txline-verify";
import {
  createTxlineSession,
  fetchFixtureSnapshot,
  fetchFixtureProof,
  fetchLatestFullMatchOdds,
  fetchOddsProof,
  oddsAge,
  isFresh,
} from "../bridge/txline.mjs";

const FIXTURE_ID = 18257865n; // France v England, World Cup

const secret = JSON.parse(await readFile(".secrets/gate2-solana.json", "utf8"));
const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const provider = new AnchorProvider(connection, new Wallet(Keypair.fromSecretKey(Uint8Array.from(secret))), {
  commitment: "confirmed",
});

const session = await createTxlineSession();
console.log("PASS: authenticated TxLINE session (guest JWT + API token)");

const fixture = await fetchFixtureSnapshot(session, FIXTURE_ID);
console.log(`PASS: fixture in live snapshot — ${fixture.Participant1} v ${fixture.Participant2}, kickoff ${new Date(fixture.StartTime).toISOString()}`);

const { proof: fixtureProof } = await fetchFixtureProof(session, fixture);
const fixtureValid = await validateFixtureOnDevnet(provider, fixtureProof);
console.log(`${fixtureValid ? "PASS" : "FAIL"}: fresh fixture proof verified on-chain by TxLINE validator — ${fixtureValid}`);

const { packet } = await fetchLatestFullMatchOdds(session, FIXTURE_ID);
const age = oddsAge(packet);
console.log(`INFO: latest 1X2 packet ${packet.MessageId} — prices ${JSON.stringify(packet.Prices)} (${packet.PriceNames.join("/")}) age ${(age / 60000).toFixed(1)} min, fresh=${isFresh(packet)}`);

const { proof: oddsProof } = await fetchOddsProof(session, packet);
const oddsValid = await validateOddsOnDevnet(provider, oddsProof);
console.log(`${oddsValid ? "PASS" : "FAIL"}: fresh odds proof verified on-chain by TxLINE validator — ${oddsValid}`);

if (!fixtureValid || !oddsValid) {
  console.log("\nRESULT: live proof pipeline NOT fully verified");
  process.exit(1);
}
console.log("\nRESULT: fresh live proof pipeline verified end-to-end — issuance can consume these proofs.");
console.log(JSON.stringify({
  fixtureId: pureFixtureId(fixture.FixtureId).toString(),
  packetMessageId: packet.MessageId,
  packetTs: packet.Ts,
  packetTsISO: new Date(packet.Ts).toISOString(),
  prices: packet.Prices,
  ageMinutes: Number((age / 60000).toFixed(2)),
}, null, 2));
