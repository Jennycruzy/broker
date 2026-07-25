import { createApp } from "./app.mjs";
import { parsePremiumRateBps } from "./coverage.mjs";
import { createBindOrchestrator } from "./bind_orchestrator.mjs";
import { createCctpBindAdapter } from "./cctp_bind_adapter.mjs";
import { createFreshOddsIssueAdapter } from "./fresh_odds_issue_adapter.mjs";

const port = Number.parseInt(process.env.PORT ?? "8080", 10);
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

const premiumRateBps = parsePremiumRateBps(process.env.PREMIUM_RATE_BPS);
const facilitatorPrivateKey = process.env.X402_FACILITATOR_PRIVATE_KEY;
const rpcUrl = process.env.INJECTIVE_EVM_RPC_URL;
const facilitatorUrl = process.env.X402_FACILITATOR_URL;
const payTo = process.env.X402_PAY_TO;
let bindOrchestrator;
if (process.env.BROKER_ENABLE_FUNDED_BIND === "yes") {
  const solanaKeyPath = process.env.BROKER_SOLANA_KEYPAIR;
  bindOrchestrator = createBindOrchestrator({
    directory: process.env.BROKER_BIND_JOBS_DIR ?? "data/bind-jobs",
    bridgePremium: createCctpBindAdapter({
      injectiveKeyPath: process.env.BROKER_CCTP_INJECTIVE_KEY,
      solanaKeyPath,
      rpcEndpoint: process.env.SURETY_RPC_ENDPOINT,
    }),
    issuePolicy: createFreshOddsIssueAdapter({
      vault: process.env.BROKER_BIND_VAULT,
      solanaKeyPath,
      rpcEndpoint: process.env.SURETY_RPC_ENDPOINT,
      waitMinutes: Number(process.env.BROKER_ODDS_WAIT_MINUTES ?? "0"),
    }),
  });
}

createApp({
  facilitatorPrivateKey,
  facilitatorUrl,
  payTo,
  premiumRateBps,
  rpcUrl,
  bindOrchestrator,
}).listen(port, () => {
  console.log(`BROKER x402 server listening on port ${port}`);
});
