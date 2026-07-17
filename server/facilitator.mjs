import express from "express";
import { InjectiveFacilitator } from "@injectivelabs/x402/facilitator";
import { encodeTransferWithAuthorizationCalldata } from "@injectivelabs/x402/eip3009";
import { privateKeyToAccount } from "viem/accounts";

const transactionHashPattern = /0x[0-9a-fA-F]{64}/;

export function createFacilitatorApp({ privateKey, rpcUrl, explorerApiUrl, allowedAssets }) {
  const account = privateKeyToAccount(privateKey);
  const facilitator = new InjectiveFacilitator({
    privateKey,
    rpcUrl,
    allowedAssets,
    minPaymentPerAsset: Object.fromEntries(allowedAssets.map((asset) => [asset.toLowerCase(), "1"])),
  });
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));

  app.post("/verify", async (req, res) => {
    res.json(await facilitator.verify(req.body));
  });

  app.post("/settle", async (req, res) => {
    const result = await facilitator.settle(req.body);
    if (result.success) {
      res.json(result);
      return;
    }

    const transaction = result.errorMessage?.match(transactionHashPattern)?.[0];
    if (!transaction) {
      res.json(result);
      return;
    }

    const reconciled = await reconcileExplorerTransaction({
      explorerApiUrl,
      transaction,
      facilitatorAddress: account.address,
      request: req.body,
    });
    res.json(reconciled ?? result);
  });

  return { app, payTo: account.address };
}

export async function reconcileExplorerTransaction({
  explorerApiUrl,
  transaction,
  facilitatorAddress,
  request,
  fetchImpl = fetch,
}) {
  const url = new URL("/api", explorerApiUrl);
  url.searchParams.set("module", "transaction");
  url.searchParams.set("action", "gettxinfo");
  url.searchParams.set("txhash", transaction);
  const response = await fetchImpl(url);
  if (!response.ok) return undefined;
  const body = await response.json();
  const tx = body?.result;
  if (body?.status !== "1" || tx?.success !== true) return undefined;

  const expectedInput = encodeTransferWithAuthorizationCalldata(request.paymentPayload.payload);
  const expectedAsset = request.paymentRequirements.asset;
  if (
    tx.hash?.toLowerCase() !== transaction.toLowerCase()
    || tx.from?.toLowerCase() !== facilitatorAddress.toLowerCase()
    || tx.to?.toLowerCase() !== expectedAsset.toLowerCase()
    || tx.input?.toLowerCase() !== expectedInput.toLowerCase()
  ) {
    return undefined;
  }

  return {
    success: true,
    transaction,
    network: request.paymentRequirements.network,
    payer: request.paymentPayload.payload.authorization.from,
    amount: request.paymentRequirements.amount,
    extra: { blockNumber: tx.blockNumber, reconciledVia: explorerApiUrl },
  };
}
