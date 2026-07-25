import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import test from "node:test";

function rpcClient(child) {
  let buffer = "";
  let id = 0;
  const pending = new Map();
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    for (;;) {
      const end = buffer.indexOf("\n");
      if (end < 0) break;
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    }
  });
  return (method, params) => new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 10_000);
    pending.set(requestId, (message) => {
      clearTimeout(timer);
      resolve(message);
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params })}\n`);
  });
}

test("MCP paid-bind contract forwards the payment header and preserves pending job state", async () => {
  const paymentHeader = "signed-x402-test-payload";
  const desk = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      assert.equal(req.method, "POST");
      assert.equal(req.url, "/bind");
      assert.equal(req.headers["x-payment"], paymentHeader);
      assert.deepEqual(JSON.parse(body), {
        fixture: "18257865",
        outcome: "WIN_HOME",
        coverage_amount: "5000000",
      });
      res.writeHead(202, { "content-type": "application/json" });
      res.end(JSON.stringify({
        status: "bridging",
        payment_receipt: { status: "payment_settled", payment_transaction: `0x${"ab".repeat(32)}` },
        bind_job: { id: "job-1", status: "bridging" },
      }));
    });
  });
  await new Promise((resolve) => desk.listen(0, "127.0.0.1", resolve));

  const child = spawn(process.execPath, [new URL("../mcp/server.mjs", import.meta.url).pathname], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, BROKER_URL: `http://127.0.0.1:${desk.address().port}` },
  });
  const rpc = rpcClient(child);
  try {
    await rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "mcp-payment-contract-test", version: "1.0.0" },
    });
    const response = await rpc("tools/call", {
      name: "bind_coverage",
      arguments: {
        fixture: "18257865",
        outcome: "WIN_HOME",
        coverage_amount: "5000000",
        payment_header: paymentHeader,
      },
    });
    assert.equal(response.result.isError, undefined);
    const payload = JSON.parse(response.result.content[0].text);
    assert.equal(payload.status, "bridging");
    assert.equal(payload.payment_receipt.status, "payment_settled");
    assert.equal(payload.bind_job.status, "bridging");
  } finally {
    child.kill();
    await new Promise((resolve) => desk.close(resolve));
  }
});
