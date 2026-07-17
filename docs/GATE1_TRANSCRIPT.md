# Gate 1 request/response transcript

Run date: 2026-07-17. Network: Injective EVM testnet, CAIP-2
`eip155:1439`. Asset: native testnet USDC
`0x0C382e685bbeeFE5d3d9C29e29E341fEE8E84C5d`.

Private keys and full payment signatures are intentionally omitted. The requests
below were executed by `scripts/gate1-live.mjs` against the real x402 middleware
and facilitator.

## Unpaid

Request: `POST /bind`, no `PAYMENT-SIGNATURE` header.

Response: HTTP 402 with `PAYMENT-REQUIRED`; exact required amount `10000` USDC
base units.

## Wrong amount

Request: `POST /bind` with a valid EIP-3009 signature authorizing `9999` base
units against a `10000`-unit requirement.

Response: HTTP 402:

```json
{
  "error": "payment_amount_mismatch"
}
```

No settlement transaction was submitted for the underpayment.

## Exact payment

Request: `POST /bind` with a valid EIP-3009 authorization for `10000` base units.

Response: HTTP 200:

```json
{
  "bind_authorization": {
    "quote_id": "861af0e15e8ddfaf16ad5cec79ef44f92988e8c103dcde9dbfbac81ab9ff8589",
    "fixture": "FRA v ENG — 2026-07-18T21:00:00Z",
    "outcome": "France wins",
    "coverage_amount": "1000000",
    "premium_amount": "10000",
    "payer": "0x1719e9B06ECE6c38BB25f47BFC57892DC0585111",
    "payment_transaction": "0xd1901dd31772ce78d1f43962d0fb28792df3d54479e96270825340361504fa6a",
    "network": "eip155:1439",
    "status": "premium_paid_policy_pending_cctp"
  }
}
```

Explorer:
<https://testnet.blockscout.injective.network/tx/0xd1901dd31772ce78d1f43962d0fb28792df3d54479e96270825340361504fa6a>

## Receipt-indexing failure discovered and contained

The first exact payment was transferred on-chain, but the public JSON-RPC receipt
lookup returned `null`, so the package returned HTTP 402 after charging. Explorer
transaction:
<https://testnet.blockscout.injective.network/tx/0x1df3a43e3b0e8bb92efe05083ebcd2b4c70047e68c7b697a3eefd26dde04ba9c>.

The facilitator now reconciles this narrow failure against Injective's explorer
API. It accepts reconciliation only when explorer status is successful and the
transaction hash, facilitator sender, USDC contract destination, and complete
`transferWithAuthorization` calldata exactly match the submitted request. Tests
prove corrupted calldata and failed explorer transactions remain rejected.
