import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../scripts/issue-policy-with-odds.mjs", import.meta.url));

function finalJson(stdout) {
  const starts = [];
  for (let i = 0; i < stdout.length; i += 1) if (stdout[i] === "{") starts.push(i);
  for (const start of starts.reverse()) {
    try { return JSON.parse(stdout.slice(start)); } catch {}
  }
  throw new Error("fresh-odds issuance produced no final JSON receipt");
}

// Runs the shared odds-validated issuance command used by the server worker.
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
      BROKER_ISSUE_VAULT: vault,
      BROKER_ISSUE_FIXTURE_ID: paymentReceipt.fixture,
      BROKER_ISSUE_OUTCOME: paymentReceipt.outcome,
      BROKER_ISSUE_COVERAGE: paymentReceipt.coverage_amount,
      BROKER_EXPECTED_PREMIUM: paymentReceipt.premium_amount,
      BROKER_SOLANA_KEYPAIR: solanaKeyPath,
      BROKER_ODDS_WAIT_MINUTES: String(waitMinutes),
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
