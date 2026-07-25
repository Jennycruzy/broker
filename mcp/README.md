# BROKER MCP server

Four tools that let an agent hedge World Cup exposure: `quote_coverage`,
`bind_coverage`, `policy_status`, `vault_solvency`.

## Install

```bash
npm install                                   # from the repo root
npm run server &                              # start the BROKER desk on :8080
claude mcp add broker -- node "$PWD/mcp/server.mjs"
```

That is the whole install. The server speaks MCP over stdio, so any MCP client
works — the `claude mcp add` line is just the shortest example. For a client that
reads a JSON config:

```json
{
  "mcpServers": {
    "broker": {
      "command": "node",
      "args": ["/absolute/path/to/broker/mcp/server.mjs"],
      "env": {
        "BROKER_URL": "http://127.0.0.1:8080",
        "BROKER_DEFAULT_VAULT": "EP2fr7ThxUnvRxVmyXXi2c2xm9uu79JMWyTPWFznFFRV"
      }
    }
  }
}
```

## Configuration

Everything is environment-driven; no address or network is baked into the code.

| variable | default | purpose |
|---|---|---|
| `BROKER_URL` | `http://127.0.0.1:8080` | the BROKER desk, used by `quote_coverage` and `bind_coverage` |
| `SURETY_RPC_ENDPOINT` | `https://api.devnet.solana.com` | Solana RPC for the two chain-reading tools |
| `BROKER_DEFAULT_VAULT` | *(unset)* | vault used by `vault_solvency` when the agent does not name one |

The desk itself needs `PORT`, `PREMIUM_RATE_BPS`, and either a local facilitator
key (`X402_FACILITATOR_PRIVATE_KEY` + `INJECTIVE_EVM_RPC_URL`) or a remote
facilitator URL. See the repo root README.

## The tools

**`quote_coverage`** `{ fixture, outcome, coverage_amount }` — free. Returns the
premium in USDC base units plus a `quote_id`.

**`bind_coverage`** `{ fixture, outcome, coverage_amount, payment_header? }` —
x402-gated. Called without `payment_header` it returns a real HTTP 402 challenge
describing what to pay, on which asset and network. Sign it and call again with
the authorization as `payment_header`.

The tool does not pretend to have bought anything on the unpaid call. Coverage is
bound only when the payment settles on Injective and a `bind_authorization` comes
back — an MCP tool that reported success off a 402 would be a lie the calling
agent could not detect.

**`policy_status`** `{ policy }` — reads the policy account from Solana devnet:
`Open`, `Triggered` or `Expired`, plus coverage, premium and the balance still
locked in its escrow.

**`vault_solvency`** `{ vault? }` — reads the underwriting vault: capital, free
reserves, locked liabilities, and the reserve's real SPL token balance.

The last two read the chain directly rather than asking the desk, because
solvency and policy status are chain facts and routing them through the desk
would only invite the desk to shade them.

## Verifying it

```bash
node scripts/gate4-verify.mjs
```

Spawns this server as a real subprocess, speaks MCP JSON-RPC over stdio, and
checks each tool against the thing it claims to report — the desk's own HTTP
response, or an independent chain read done in the verifying process. It also
asserts that an unpaid bind yields no authorization, and that a bad account
produces an error rather than invented state.
