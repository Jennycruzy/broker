import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { bindJobId, createBindOrchestrator } from "./bind_orchestrator.mjs";

const receipt = {
  network: "eip155:1439",
  payment_transaction: `0x${"ab".repeat(32)}`,
  premium_amount: "10000",
  coverage_amount: "200000",
  fixture: "18257865",
  outcome: "WIN_HOME",
};

test("bind orchestration is durable and idempotent across repeated enqueue calls", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "broker-bind-"));
  let bridgeCalls = 0;
  let issueCalls = 0;
  const orchestrator = createBindOrchestrator({
    directory,
    bridgePremium: async () => {
      bridgeCalls += 1;
      return { burn_transaction: "burn", mint_transaction: "mint" };
    },
    issuePolicy: async () => {
      issueCalls += 1;
      return { address: "policy", issue_transaction: "issue" };
    },
  });

  const first = await orchestrator.enqueue(receipt);
  const second = await orchestrator.enqueue(receipt);
  assert.equal(first.id, bindJobId(receipt));
  assert.equal(second.id, first.id);

  const complete = await orchestrator.wait(first.id);
  assert.equal(complete.status, "policy_bound");
  assert.equal(complete.policy.address, "policy");
  assert.equal(bridgeCalls, 1);
  assert.equal(issueCalls, 1);

  await orchestrator.enqueue(receipt);
  assert.equal(bridgeCalls, 1);
  assert.equal(issueCalls, 1);
});

test("a failed stage never reports a bound policy", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "broker-bind-"));
  const orchestrator = createBindOrchestrator({
    directory,
    bridgePremium: async () => { throw new Error("attestation unavailable"); },
    issuePolicy: async () => assert.fail("issuance must not run after bridge failure"),
  });
  const job = await orchestrator.enqueue(receipt);
  const failed = await orchestrator.wait(job.id);
  assert.equal(failed.status, "failed");
  assert.match(failed.error.message, /attestation unavailable/);
  assert.equal(failed.policy, undefined);
});
