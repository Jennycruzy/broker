import { readFile } from "node:fs/promises";
import {
  createPayment,
  encodePaymentSignatureHeader,
  parsePaymentRequired,
  parsePaymentResponseHeader,
} from "@injectivelabs/x402/client";
import { createApp } from "../server/app.mjs";
import { parsePremiumRateBps } from "../server/coverage.mjs";
import { createFacilitatorApp } from "../server/facilitator.mjs";

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const facilitatorPrivateKey = (await readFile(".secrets/gate1-facilitator.key", "utf8")).trim();
const payerPrivateKey = (await readFile(".secrets/gate1-payer.key", "utf8")).trim();
const premiumRateBps = parsePremiumRateBps(required("PREMIUM_RATE_BPS"));
const requestBody = {
  fixture: required("GATE1_FIXTURE"),
  outcome: required("GATE1_OUTCOME"),
  coverage_amount: required("GATE1_COVERAGE_AMOUNT"),
};

const rpcUrl = "https://k8s.testnet.json-rpc.injective.network/";
const { app: facilitatorApp, payTo } = createFacilitatorApp({
  privateKey: facilitatorPrivateKey,
  rpcUrl,
  explorerApiUrl: "https://testnet.blockscout-api.injective.network/",
  allowedAssets: ["0x0C382e685bbeeFE5d3d9C29e29E341fEE8E84C5d"],
});
const facilitatorServer = facilitatorApp.listen(0, "127.0.0.1");
await new Promise((resolve, reject) => {
  facilitatorServer.once("listening", resolve);
  facilitatorServer.once("error", reject);
});
const facilitatorUrl = `http://127.0.0.1:${facilitatorServer.address().port}`;

const app = createApp({
  facilitatorUrl,
  payTo,
  premiumRateBps,
});
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve, reject) => {
  server.once("listening", resolve);
  server.once("error", reject);
});

const endpoint = `http://127.0.0.1:${server.address().port}/bind`;
const init = {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(requestBody),
};

try {
  const unpaid = await fetch(endpoint, init);
  const paymentRequiredHeader = unpaid.headers.get("payment-required");
  if (unpaid.status !== 402 || !paymentRequiredHeader) {
    throw new Error(`unpaid request did not produce x402 challenge: ${unpaid.status}`);
  }
  const challenge = parsePaymentRequired(paymentRequiredHeader);
  const exact = challenge.accepts[0];
  if (!exact) throw new Error("x402 challenge offered no payment requirement");

  const smallerAmount = (BigInt(exact.amount) - 1n).toString();
  if (BigInt(smallerAmount) < 1n) throw new Error("premium is too small for underpayment test");
  const underpaymentRequirement = { ...exact, amount: smallerAmount };
  const underpayment = await createPayment(
    { privateKey: payerPrivateKey, rpcUrl },
    underpaymentRequirement,
  );
  const wrong = await fetch(endpoint, {
    ...init,
    headers: {
      ...init.headers,
      "payment-signature": encodePaymentSignatureHeader(underpayment),
    },
  });
  const wrongBody = await wrong.json();
  if (wrong.status !== 402) {
    throw new Error(`underpayment was not rejected: ${wrong.status}`);
  }

  const exactPayment = await createPayment(
    { privateKey: payerPrivateKey, rpcUrl },
    exact,
  );
  const paid = await fetch(endpoint, {
    ...init,
    headers: {
      ...init.headers,
      "payment-signature": encodePaymentSignatureHeader(exactPayment),
    },
  });
  const paidBody = await paid.json();
  const receipt = parsePaymentResponseHeader(paid);
  if (paid.status !== 200 || !receipt?.success || !receipt.transaction) {
    throw new Error(`exact payment did not settle: ${paid.status} ${JSON.stringify(paidBody)}`);
  }

  console.log(JSON.stringify({
    network: exact.network,
    unpaid: { status: unpaid.status, required_amount: exact.amount },
    underpayment: {
      status: wrong.status,
      offered_amount: smallerAmount,
      rejection: wrongBody.error ?? wrongBody.message,
    },
    paid: {
      status: paid.status,
      receipt,
      bind_authorization: paidBody.bind_authorization,
      explorer: `https://testnet.blockscout.injective.network/tx/${receipt.transaction}`,
    },
  }, null, 2));
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await new Promise((resolve, reject) => facilitatorServer.close((error) => error ? reject(error) : resolve()));
}
