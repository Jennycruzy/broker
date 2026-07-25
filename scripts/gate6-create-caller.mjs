// Creates and funds a devnet caller keypair for Gate 6 settlement.
//
// settle_policy requires a signer that can pay fees — nothing more. It does not
// need to be the policy holder, and the payout still routes to the policy's own
// payout_authority whoever calls. So a host that has no keypair (e.g. the VPS)
// can settle without any secret being copied between machines.
//
// Writes .secrets/gate6-caller.json (gitignored, mode 600) and airdrops from the
// public devnet faucet. Idempotent: reuses the keypair if it already exists, and
// only tops up if the balance is below the floor.

import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";

const KEY_PATH = process.env.GATE6_CALLER_KEYPAIR ?? ".secrets/gate6-caller.json";
const TARGET_SOL = Number(process.env.GATE6_CALLER_SOL ?? "1");
const FLOOR_LAMPORTS = 20_000_000; // 0.02 SOL — the floor gate6-settle-policy enforces

const connection = new Connection(process.env.SURETY_RPC_ENDPOINT ?? "https://api.devnet.solana.com", "confirmed");

let caller;
if (existsSync(KEY_PATH)) {
  caller = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(KEY_PATH, "utf8"))));
  console.log(`reusing existing caller ${caller.publicKey.toBase58()} from ${KEY_PATH}`);
} else {
  caller = Keypair.generate();
  await mkdir(".secrets", { recursive: true });
  await writeFile(KEY_PATH, JSON.stringify([...caller.secretKey]));
  await chmod(KEY_PATH, 0o600);
  console.log(`created caller ${caller.publicKey.toBase58()} → ${KEY_PATH} (mode 600)`);
}

let lamports = await connection.getBalance(caller.publicKey);
console.log(`balance ${(lamports / LAMPORTS_PER_SOL).toFixed(4)} SOL`);

if (lamports >= FLOOR_LAMPORTS) {
  console.log("already above the 0.02 SOL floor — nothing to do.");
  process.exit(0);
}

// The public devnet faucet is rate-limited and refuses often. Report the real
// error and point at the manual faucet rather than retrying forever.
console.log(`requesting ${TARGET_SOL} SOL airdrop...`);
try {
  const signature = await connection.requestAirdrop(caller.publicKey, TARGET_SOL * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(signature, "confirmed");
  lamports = await connection.getBalance(caller.publicKey);
  console.log(`airdrop confirmed — balance ${(lamports / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
} catch (error) {
  console.error(`airdrop failed: ${error.message}`);
  console.error(`\nFund ${caller.publicKey.toBase58()} manually at https://faucet.solana.com (devnet),`);
  console.error("or set GATE6_CALLER_KEYPAIR to an already-funded keypair.");
  process.exit(1);
}

if (lamports < FLOOR_LAMPORTS) {
  console.error(`balance still below the ${FLOOR_LAMPORTS} lamport floor`);
  process.exit(1);
}
console.log(`\ncaller ready. Run:\n  GATE6_CALLER_KEYPAIR=${KEY_PATH} node scripts/gate6-settle-policy.mjs`);
