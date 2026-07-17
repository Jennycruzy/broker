import express from "express";
import { injectivePaymentMiddleware } from "@injectivelabs/x402/middleware";
import {
  getToken,
  INJECTIVE_TESTNET_CAIP2,
} from "@injectivelabs/x402/networks";
import { quoteCoverage } from "./coverage.mjs";

const testnetUsdc = getToken(INJECTIVE_TESTNET_CAIP2, "USDC");
if (!testnetUsdc?.eip3009) {
  throw new Error("published Injective x402 registry has no EIP-3009 testnet USDC");
}

export function createApp({ facilitatorPrivateKey, facilitatorUrl, payTo, premiumRateBps, rpcUrl }) {
  const usesLocalFacilitator = facilitatorPrivateKey !== undefined;
  if (usesLocalFacilitator && !/^0x[0-9a-fA-F]{64}$/.test(facilitatorPrivateKey)) {
    throw new Error("X402_FACILITATOR_PRIVATE_KEY must be a 32-byte hex private key");
  }
  if (!usesLocalFacilitator && (!facilitatorUrl || !/^0x[0-9a-fA-F]{40}$/.test(payTo ?? ""))) {
    throw new Error("remote facilitator requires facilitatorUrl and a 20-byte hex payTo address");
  }

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "16kb" }));

  app.post("/quote", (req, res) => {
    const quote = quoteCoverage(req.body, premiumRateBps);
    res.json(quote);
  });

  app.post("/bind", (req, res, next) => {
    let quote;
    try {
      quote = quoteCoverage(req.body, premiumRateBps);
    } catch (error) {
      res.status(400).json({ error: "invalid_coverage_request", message: error.message });
      return;
    }

    const middleware = injectivePaymentMiddleware(
      {
        "POST /bind": {
          description: `Bind BROKER coverage quote ${quote.quote_id}`,
          mimeType: "application/json",
          accepts: [{
            network: INJECTIVE_TESTNET_CAIP2,
            asset: testnetUsdc.address,
            amount: quote.premium_amount,
            payTo,
          }],
        },
      },
      {
        facilitator: usesLocalFacilitator ? {
          privateKey: facilitatorPrivateKey,
          rpcUrl,
          allowedAssets: [testnetUsdc.address],
          minPaymentPerAsset: { [testnetUsdc.address.toLowerCase()]: "1" },
        } : undefined,
        facilitatorUrl,
        settlementPolicy: "before",
      },
    );

    middleware(req, res, (error) => {
      if (error) {
        next(error);
        return;
      }
      const payment = req.x402;
      if (!payment?.txHash || payment.amount !== quote.premium_amount) {
        next(new Error("x402 settlement metadata missing or inconsistent"));
        return;
      }
      res.json({
        bind_authorization: {
          quote_id: quote.quote_id,
          fixture: quote.fixture,
          outcome: quote.outcome,
          coverage_amount: quote.coverage_amount,
          premium_amount: quote.premium_amount,
          payer: payment.payer,
          payment_transaction: payment.txHash,
          network: payment.network,
          status: "premium_paid_policy_pending_cctp",
        },
      });
    });
  });

  app.use((error, _req, res, _next) => {
    res.status(500).json({ error: "internal_error", message: error.message });
  });

  return app;
}
