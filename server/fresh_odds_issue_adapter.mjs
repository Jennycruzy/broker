import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../scripts/gate3-issue-policy.mjs", import.meta.url));

function finalJson(stdout) {
  const starts = [];
  for (let i = 0; i < stdout.length; i += 1) if (stdout[i] === "{") starts.push(i);
  for (const start of starts.reverse()) {
    try { return JSON.parse(stdout.slice(start)); } catch {}
  }
  throw new Error("fresh-odds issuance produced no final JSON receipt");
}

// Process adapter around the proven Gate 3 transaction path. Keeping the
// transaction builder in one implementation prevents the demo script and
// server worker from drifting. The script itself fetches and validates a fresh
// TxLINE packet, computes SURETY's quote, checks holder funds, and issues.
export function createFreshOddsIssueAdapter({
  vault,
  solanaKeyPath,
  rpcEndpoint = "https://api.devnet.solana.com",
  waitMinutes = 0,
}) {
  if (!vault || !solanaKeyPath) {
    throw new Error("fresh-odds issuance adapter requires vault and solanaKeyPath");
  }
  return async function issuePolicy(paymentReceipt, bridgeReceipt) {
    if (bridgeReceipt.holder_asset_account === undefined) {
      throw new Error("issuance requires the CCTP holder asset account receipt");
    }
    const env = {
      ...process.env,
      GATE3_VAULT: vault,
      GATE3_FIXTURE_ID: paymentReceipt.fixture,
      GATE3_OUTCOME: paymentReceipt.outcome,
      GATE3_COVERAGE: paymentReceipt.coverage_amount,
      GATE3_EXPECTED_PREMIUM: paymentReceipt.premium_amount,
      GATE3_SOLANA_KEYPAIR: solanaKeyPath,
      GATE3_WAIT_MINUTES: String(waitMinutes),
      SURETY_RPC_ENDPOINT: rpcEndpoint,
    };
    const child = spawn(process.execPath, [SCRIPT], { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const code = await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", resolve);
    });
    if (code !== 0) {
      throw new Error(`fresh-odds issuance failed (${code}): ${(stderr || stdout).slice(-1000)}`);
    }
    return finalJson(stdout);
  };
}
