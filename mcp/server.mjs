// BROKER MCP server.
//
// Configuration:
//   BROKER_URL             desk base URL          (default http://127.0.0.1:8080)
//   SURETY_RPC_ENDPOINT    Solana RPC             (default devnet)
//   BROKER_DEFAULT_VAULT   vault for vault_solvency when the agent omits one

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createReadOnlyProgram, readPolicy, readVault } from "../bridge/surety_read.mjs";

const BROKER_URL = (process.env.BROKER_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
const DEFAULT_VAULT = process.env.BROKER_DEFAULT_VAULT;

const usdc = (units) => (Number(units) / 1e6).toFixed(6);

// Lazily built so the server starts even when the RPC is unreachable; the tools
// that need it fail individually rather than taking the whole server down.
let chain = null;
const chainCtx = () => (chain ??= createReadOnlyProgram());

const ok = (payload) => ({ content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] });
const fail = (message, extra = {}) => ({
  isError: true,
  content: [{ type: "text", text: JSON.stringify({ error: message, ...extra }, null, 2) }],
});

async function deskPost(path, body) {
  const response = await fetch(`${BROKER_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = { raw: text.slice(0, 500) }; }
  return { status: response.status, body: parsed, headers: Object.fromEntries(response.headers) };
}

const server = new McpServer({ name: "broker", version: "0.1.0" });

// --- quote_coverage -----------------------------------------------------------
server.registerTool(
  "quote_coverage",
  {
    title: "Quote coverage",
    description:
      "Price protection against a World Cup outcome. Free — no payment required, so an agent can shop " +
      "before committing. Returns the premium in USDC base units and a quote_id.",
    inputSchema: {
      fixture: z.string().describe("TxLINE fixture id, e.g. \"18257865\""),
      outcome: z.string().describe("Outcome to insure against: WIN_HOME, DRAW or WIN_AWAY"),
      coverage_amount: z.string().describe("Coverage in USDC base units (6 decimals), e.g. \"5000000\" for 5 USDC"),
    },
  },
  async ({ fixture, outcome, coverage_amount }) => {
    try {
      const { status, body } = await deskPost("/quote", { fixture, outcome, coverage_amount });
      if (status !== 200) return fail(`desk rejected the quote request (HTTP ${status})`, { response: body });
      return ok({
        ...body,
        premium_usdc: usdc(body.premium_amount),
        coverage_usdc: usdc(body.coverage_amount),
        note: "Quoting is free. Use bind_coverage to purchase; it requires an x402 payment.",
      });
    } catch (error) {
      return fail(`BROKER desk unreachable at ${BROKER_URL}: ${error.message}`);
    }
  },
);

// --- bind_coverage ------------------------------------------------------------
server.registerTool(
  "bind_coverage",
  {
    title: "Bind coverage",
    description:
      "Purchase the quoted coverage. The endpoint is x402-gated: without a payment header it returns a real " +
      "HTTP 402 challenge describing the amount, asset and network to pay on Injective. Pass payment_header " +
      "with a signed x402 authorization to settle and receive the bind authorization.",
    inputSchema: {
      fixture: z.string().describe("TxLINE fixture id"),
      outcome: z.string().describe("Outcome to insure against: WIN_HOME, DRAW or WIN_AWAY"),
      coverage_amount: z.string().describe("Coverage in USDC base units (6 decimals)"),
      payment_header: z.string().optional().describe("Signed x402 payment authorization (X-PAYMENT header value)"),
    },
  },
  async ({ fixture, outcome, coverage_amount, payment_header }) => {
    try {
      const response = await fetch(`${BROKER_URL}/bind`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(payment_header ? { "X-PAYMENT": payment_header } : {}),
        },
        body: JSON.stringify({ fixture, outcome, coverage_amount }),
      });
      const text = await response.text();
      let body;
      try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 500) }; }

      // 402 is the normal, expected first answer — not an error to hide.
      if (response.status === 402) {
        return ok({
          status: "payment_required",
          http_status: 402,
          challenge: body,
          next_step:
            "Sign this x402 payment authorization and call bind_coverage again with it as payment_header. " +
            "Coverage is NOT bound until the payment settles on Injective.",
        });
      }
      if (response.status !== 200 && response.status !== 202) {
        return fail(`bind failed (HTTP ${response.status})`, { response: body });
      }
      return ok(body);
    } catch (error) {
      return fail(`BROKER desk unreachable at ${BROKER_URL}: ${error.message}`);
    }
  },
);

// --- policy_status ------------------------------------------------------------
server.registerTool(
  "policy_status",
  {
    title: "Policy status",
    description:
      "Read a policy's live state from Solana devnet: Open, Triggered (paid out) or Expired, plus coverage, " +
      "premium and how much is still locked in its escrow. Reads the chain directly, not the desk.",
    inputSchema: {
      policy: z.string().describe("Policy account public key (base58)"),
    },
  },
  async ({ policy }) => {
    try {
      const state = await readPolicy(chainCtx(), policy);
      return ok({
        policy: state.address,
        status: state.status,
        coverage_usdc: usdc(state.coverage),
        premium_usdc: usdc(state.premium),
        escrow: state.escrow,
        escrow_locked_usdc: state.escrowBalance === null ? null : usdc(state.escrowBalance),
        holder: state.holder,
        vault: state.vault,
        expires_at: new Date(state.expiresAt * 1000).toISOString(),
        explorer: `https://explorer.solana.com/address/${state.address}?cluster=devnet`,
      });
    } catch (error) {
      return fail(`could not read policy ${policy}: ${error.message}`);
    }
  },
);

// --- vault_solvency -----------------------------------------------------------
server.registerTool(
  "vault_solvency",
  {
    title: "Vault solvency",
    description:
      "Check that the underwriting vault can actually pay. Returns capital, free reserves, locked liabilities " +
      "and the real token balance of the reserve account, read from Solana devnet. This is the question an " +
      "agent should ask before buying cover from anyone.",
    inputSchema: {
      vault: z.string().optional().describe("Vault account public key (base58). Defaults to BROKER_DEFAULT_VAULT."),
    },
  },
  async ({ vault }) => {
    const address = vault ?? DEFAULT_VAULT;
    if (!address) return fail("no vault specified and BROKER_DEFAULT_VAULT is not set");
    try {
      const state = await readVault(chainCtx(), address);
      // Compare reserve balance with the vault's free-reserve accounting.
      const backed = state.reserveBalance >= state.freeReserves;
      return ok({
        vault: state.address,
        asset_mint: state.assetMint,
        total_capital_usdc: usdc(state.totalCapital),
        free_reserves_usdc: usdc(state.freeReserves),
        locked_liabilities_usdc: usdc(state.lockedLiabilities),
        reserve_token_balance_usdc: usdc(state.reserveBalance),
        policies_written: state.policyCount,
        reserve_covers_free_reserves: backed,
        explorer: `https://explorer.solana.com/address/${state.address}?cluster=devnet`,
      });
    } catch (error) {
      return fail(`could not read vault ${address}: ${error.message}`);
    }
  },
);

await server.connect(new StdioServerTransport());
