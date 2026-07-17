import assert from "node:assert/strict";
import test from "node:test";
import { encodeTransferWithAuthorizationCalldata } from "@injectivelabs/x402/eip3009";
import { reconcileExplorerTransaction } from "./facilitator.mjs";

const transaction = `0x${"ab".repeat(32)}`;
const facilitatorAddress = `0x${"12".repeat(20)}`;
const payer = `0x${"34".repeat(20)}`;
const recipient = `0x${"56".repeat(20)}`;
const asset = `0x${"78".repeat(20)}`;
const signature = `0x${"11".repeat(32)}${"22".repeat(32)}1b`;
const request = {
  paymentPayload: {
    x402Version: 2,
    accepted: {},
    payload: {
      signature,
      authorization: {
        from: payer,
        to: recipient,
        value: "10000",
        validAfter: "1",
        validBefore: "9999999999",
        nonce: `0x${"9a".repeat(32)}`,
      },
    },
  },
  paymentRequirements: {
    network: "eip155:1439",
    asset,
    amount: "10000",
  },
};

function explorerFetch(overrides = {}) {
  return async () => ({
    ok: true,
    async json() {
      return {
        status: "1",
        result: {
          success: true,
          hash: transaction,
          from: facilitatorAddress,
          to: asset,
          input: encodeTransferWithAuthorizationCalldata(request.paymentPayload.payload),
          blockNumber: "123",
          ...overrides,
        },
      };
    },
  });
}

test("reconciliation accepts only the exact successful authorization transaction", async () => {
  const result = await reconcileExplorerTransaction({
    explorerApiUrl: "https://explorer.invalid/",
    transaction,
    facilitatorAddress,
    request,
    fetchImpl: explorerFetch(),
  });
  assert.equal(result.success, true);
  assert.equal(result.transaction, transaction);
});

test("reconciliation rejects a successful transaction with corrupted calldata", async () => {
  const result = await reconcileExplorerTransaction({
    explorerApiUrl: "https://explorer.invalid/",
    transaction,
    facilitatorAddress,
    request,
    fetchImpl: explorerFetch({ input: "0xdeadbeef" }),
  });
  assert.equal(result, undefined);
});

test("reconciliation rejects failed explorer transactions", async () => {
  const result = await reconcileExplorerTransaction({
    explorerApiUrl: "https://explorer.invalid/",
    transaction,
    facilitatorAddress,
    request,
    fetchImpl: explorerFetch({ success: false }),
  });
  assert.equal(result, undefined);
});
