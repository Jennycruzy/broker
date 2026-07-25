// Compare MCP responses with the desk and independent chain reads.
//
// The failure mode this guards against is an MCP server that looks right in a
// transcript while quietly serving its own numbers. So every tool response is
// compared against the thing it claims to be reporting: the desk's own HTTP
// response, or the chain read done independently in this process.
//
// Spawns mcp/server.mjs as a real subprocess and speaks MCP JSON-RPC over stdio —
// no in-process shortcuts, because the transport is part of what is being tested.
//
// Also starts a real BROKER desk on an ephemeral port with a local x402
// facilitator, so quote and bind are exercised against the same server code the
// product runs.

import { spawn } from "node:child_process";
import { once } from "node:events";
import assert from "node:assert/strict";
import { createApp } from "../server/app.mjs";
import { parsePremiumRateBps } from "../server/coverage.mjs";
import { createReadOnlyProgram, readPolicy, readVault } from "../bridge/surety_read.mjs";

const POLICY = process.env.BROKER_VERIFY_POLICY ?? "Gmk1L8ZLPySzuGKsjNyxSyRcYMNzkb8QypzBxxzoFeMG";
const VAULT = process.env.BROKER_VERIFY_VAULT ?? "EP2fr7ThxUnvRxVmyXXi2c2xm9uu79JMWyTPWFznFFRV";
const FIXTURE = "18257739";
const OUTCOME = "WIN_HOME";
const COVERAGE = "2000000";

let pass = true;
const check = (ok, msg) => { pass = pass && ok; console.log(`${ok ? "PASS" : "FAIL"}: ${msg}`); };

// --- 1. Real desk on an ephemeral port ----------------------------------------
// A throwaway facilitator key: this process never sends a payment, it only needs
// the middleware to construct genuine 402 challenges.
const facilitatorPrivateKey = "0x" + "11".repeat(32);
const app = createApp({
  facilitatorPrivateKey,
  premiumRateBps: parsePremiumRateBps("500"),
  rpcUrl: process.env.INJECTIVE_EVM_RPC_URL ?? "https://k8s.testnet.json-rpc.injective.network/",
});
const desk = app.listen(0);
await once(desk, "listening");
const deskUrl = `http://127.0.0.1:${desk.address().port}`;
console.log(`INFO: BROKER desk on ${deskUrl}`);

// --- 2. MCP server as a subprocess --------------------------------------------
const child = spawn(process.execPath, [new URL("../mcp/server.mjs", import.meta.url).pathname], {
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, BROKER_URL: deskUrl, BROKER_DEFAULT_VAULT: VAULT },
});
child.stderr.on("data", (d) => {
  const text = String(d);
  if (!/bigint|ExperimentalWarning/i.test(text)) process.stderr.write(`[mcp] ${text}`);
});

// Minimal JSON-RPC client over the child's stdio. Line-delimited framing is what
// the stdio transport uses.
let buffer = "";
const pending = new Map();
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    let message;
    try { message = JSON.parse(line); } catch { continue; }
    if (message.id !== undefined && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  }
});

let nextId = 1;
function rpc(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`MCP call ${method} timed out`)), 45_000);
    pending.set(id, (message) => { clearTimeout(timer); resolve(message); });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}
const notify = (method, params) =>
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");

// Tool responses are JSON encoded inside a text content block.
const payloadOf = (response) => JSON.parse(response.result.content[0].text);
const callTool = (name, args) => rpc("tools/call", { name, arguments: args });

async function finish(code) {
  child.kill();
  desk.close();
  process.exit(code);
}

try {
  // --- 3. Handshake -----------------------------------------------------------
  const init = await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "verify-mcp", version: "1.0.0" },
  });
  check(init.result?.serverInfo?.name === "broker", `MCP handshake — server identifies as "${init.result?.serverInfo?.name}"`);
  notify("notifications/initialized", {});

  // --- 4. Tool surface --------------------------------------------------------
  const listed = await rpc("tools/list", {});
  const names = (listed.result?.tools ?? []).map((t) => t.name).sort();
  const expected = ["bind_coverage", "policy_status", "quote_coverage", "vault_solvency"];
  check(JSON.stringify(names) === JSON.stringify(expected), `exposes exactly the four tools: ${names.join(", ")}`);
  check((listed.result?.tools ?? []).every((t) => t.description?.length > 40), `every tool carries a real description`);

  // --- 5. quote_coverage matches the desk's own answer ------------------------
  const quoteResponse = await callTool("quote_coverage", { fixture: FIXTURE, outcome: OUTCOME, coverage_amount: COVERAGE });
  const quote = payloadOf(quoteResponse);
  const direct = await (await fetch(`${deskUrl}/quote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fixture: FIXTURE, outcome: OUTCOME, coverage_amount: COVERAGE }),
  })).json();
  check(quote.quote_id === direct.quote_id, `quote_coverage quote_id matches a direct HTTP call (${direct.quote_id.slice(0, 16)}…)`);
  check(quote.premium_amount === direct.premium_amount, `premium matches exactly: ${direct.premium_amount} base units`);
  check(quote.premium_usdc === (Number(direct.premium_amount) / 1e6).toFixed(6), `premium_usdc is a faithful rendering of the base units`);

  // --- 6. bind_coverage returns a REAL 402, not a fake success ----------------
  const bind = payloadOf(await callTool("bind_coverage", { fixture: FIXTURE, outcome: OUTCOME, coverage_amount: COVERAGE }));
  check(bind.status === "payment_required" && bind.http_status === 402, `unpaid bind_coverage returns a real 402 payment challenge`);
  check(bind.challenge?.accepts?.length > 0, `challenge carries x402 payment requirements the agent can act on`);
  const accept = bind.challenge.accepts[0];
  check(accept.maxAmountRequired === direct.premium_amount || accept.amount === direct.premium_amount,
    `challenge demands exactly the quoted premium (${accept.maxAmountRequired ?? accept.amount})`);
  check(!JSON.stringify(bind).includes("bind_authorization"), `no bind authorization is issued without payment`);

  // --- 7. Chain tools match an independent read -------------------------------
  const ctx = createReadOnlyProgram();
  const policyTruth = await readPolicy(ctx, POLICY);
  const policyTool = payloadOf(await callTool("policy_status", { policy: POLICY }));
  check(policyTool.status === policyTruth.status, `policy_status reports '${policyTruth.status}' — matches an independent chain read`);
  check(policyTool.coverage_usdc === (Number(policyTruth.coverage) / 1e6).toFixed(6), `policy coverage matches: ${policyTool.coverage_usdc} USDC`);
  check(policyTool.escrow === policyTruth.escrow, `policy escrow account matches`);

  const vaultTruth = await readVault(ctx, VAULT);
  const vaultTool = payloadOf(await callTool("vault_solvency", { vault: VAULT }));
  check(vaultTool.total_capital_usdc === (Number(vaultTruth.totalCapital) / 1e6).toFixed(6), `vault_solvency capital matches: ${vaultTool.total_capital_usdc} USDC`);
  check(vaultTool.reserve_token_balance_usdc === (Number(vaultTruth.reserveBalance) / 1e6).toFixed(6), `reserve token balance matches the real SPL account`);
  check(vaultTool.reserve_covers_free_reserves === true, `solvency check is meaningful and currently true`);

  // --- 8. Failure is reported, not invented -----------------------------------
  const bogus = await callTool("policy_status", { policy: "11111111111111111111111111111111" });
  check(bogus.result?.isError === true, `policy_status on a non-policy account reports an error rather than inventing state`);

  console.log(`\nMCP ${pass ? "VERIFIED" : "FAILED"}: tools agree with the desk and chain.`);
  await finish(pass ? 0 : 1);
} catch (error) {
  console.error(`\nFAIL: ${error.message}`);
  await finish(1);
}
