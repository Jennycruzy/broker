import { createApp } from "./app.mjs";
import { parsePremiumRateBps } from "./coverage.mjs";

const port = Number.parseInt(process.env.PORT ?? "", 10);
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

const premiumRateBps = parsePremiumRateBps(process.env.PREMIUM_RATE_BPS);
const facilitatorPrivateKey = process.env.X402_FACILITATOR_PRIVATE_KEY;
const rpcUrl = process.env.INJECTIVE_EVM_RPC_URL;

createApp({ facilitatorPrivateKey, premiumRateBps, rpcUrl }).listen(port, () => {
  console.log(`BROKER x402 server listening on port ${port}`);
});
