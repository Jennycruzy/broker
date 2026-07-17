import assert from "node:assert/strict";
import test from "node:test";
import { generatePrivateKey } from "viem/accounts";
import { createApp } from "./app.mjs";

async function withServer(run) {
  const app = createApp({
    facilitatorPrivateKey: generatePrivateKey(),
    premiumRateBps: 250n,
    rpcUrl: "http://127.0.0.1:1",
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  try {
    const { port } = server.address();
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("unpaid bind returns the package's x402 challenge without network access", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/bind`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fixture: "FRA v ENG", outcome: "France", coverage_amount: "1000000" }),
    });
    assert.equal(response.status, 402);
    assert.ok(response.headers.get("payment-required"));
    const body = await response.json();
    assert.equal(body.x402Version, 2);
    assert.equal(body.accepts[0].amount, "25000");
    assert.equal(body.accepts[0].network, "eip155:1439");
  });
});

test("invalid bind input is rejected before payment", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/bind`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fixture: "FRA v ENG", outcome: "France", coverage_amount: "0" }),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "invalid_coverage_request");
  });
});
