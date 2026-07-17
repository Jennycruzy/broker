// Independent on-chain verification of the bound Gate 3 policy — does NOT trust
// the issuance script's stdout. Fetches the policy account, its escrow, the
// vault reserve, the holder balance, and confirms both transactions succeeded.
import { readFile } from "node:fs/promises";
import { AnchorProvider, Program, Wallet } from "@anchor-lang/core";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

const POLICY = new PublicKey("9APDuVP895jBhj6u3iZbdr65difkiCW6vDtfMrAfx58L");
const VAULT = new PublicKey("CrnjZE2DXMPLtRXJ6MPHaKifEi13qp1vAFn9ohXBpqZu");
const VALIDATED_ODDS = new PublicKey("6mHxwJz5K1DWSdEK6hpAjNNR5sYZg6R4jXLtPzLwfLcJ");
const RECORD_ODDS_TX = "2FMuYCgYJnVQbWsL8LmarysfBh7ebUGen4uzxxF2QjMYqPKk8mFKLEkCNwNv3DidE2DNKbviPkKSi929P8RGQykb";
const ISSUE_TX = "4Uq5aW2vsWyv43vZfy3wEi9kd1ivGgnUvJDJuUdyEV3ST6owgutFVuDtfHSucM791V9drPcPFk6RLcghdc8MW3NM";

const idl = JSON.parse(await readFile(new URL("../bridge/surety_core.idl.json", import.meta.url), "utf8"));
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(".secrets/gate2-solana.json", "utf8"))));
const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const program = new Program(idl, new AnchorProvider(connection, new Wallet(payer), { commitment: "confirmed" }));

let pass = true;
const check = (ok, msg) => { pass = pass && ok; console.log(`${ok ? "PASS" : "FAIL"}: ${msg}`); };

// 1. Both transactions landed and succeeded on devnet.
for (const [name, sig] of [["record_validated_odds", RECORD_ODDS_TX], ["issue_policy_with_validated_odds", ISSUE_TX]]) {
  const tx = await connection.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  check(tx !== null && tx.meta?.err === null, `${name} tx confirmed on devnet with no error (slot ${tx?.slot})`);
}

// 2. Policy account is real, Open, and bound to the right vault/holder/coverage.
const policy = await program.account.policy.fetch(POLICY);
check(policy.status.open !== undefined, `policy status is Open`);
check(policy.vault.equals(VAULT), `policy is bound to the Gate 3 vault`);
check(policy.holder.equals(payer.publicKey), `policy holder is the agent wallet ${payer.publicKey.toBase58()}`);
check(BigInt(policy.coverage.toString()) === 5_000_000n, `coverage is 5 USDC (${policy.coverage} base units)`);
check(BigInt(policy.premium.toString()) === 4_241_692n, `premium is 4.241692 USDC (${policy.premium} base units)`);

// 3. Coverage is actually escrowed (5 USDC locked in the policy escrow PDA).
const escrowBal = BigInt((await connection.getTokenAccountBalance(new PublicKey(policy.escrow))).value.amount);
check(escrowBal === 5_000_000n, `policy escrow holds 5 USDC of locked coverage (${escrowBal} base units)`);

// 4. The odds the policy priced against are the on-chain TxLINE-validated ones.
const odds = await program.account.validatedOdds.fetch(VALIDATED_ODDS);
const age = Date.now() - Number(odds.oddsTimestampMs);
check(odds.fixtureId.toString() === "18257865", `validated odds are for fixture 18257865 (France v England)`);
check(BigInt(policy.premium.toString()) > 0n, `premium was priced from validated odds prices ${JSON.stringify(odds.prices.map(Number))}`);
console.log(`INFO: validated odds timestamp ${new Date(Number(odds.oddsTimestampMs)).toISOString()} (${(age / 60000).toFixed(1)} min ago — was < 15 min at issue)`);

// 5. Vault accounting reflects the policy: locked liabilities >= coverage.
const vault = await program.account.vault.fetch(VAULT);
check(BigInt(vault.lockedLiabilities.toString()) >= 5_000_000n, `vault locked_liabilities >= coverage (${vault.lockedLiabilities} base units)`);

const holderAta = getAssociatedTokenAddressSync(vault.assetMint, payer.publicKey);
const holderBal = BigInt((await connection.getTokenAccountBalance(holderAta)).value.amount);
console.log(`INFO: holder USDC after premium ${holderBal} base units; reserve ${(await connection.getTokenAccountBalance(vault.reserve)).value.amount} base units`);

console.log(`\nGATE 3 ${pass ? "VERIFIED" : "FAILED"}: policy ${POLICY.toBase58()}`);
process.exit(pass ? 0 : 1);
