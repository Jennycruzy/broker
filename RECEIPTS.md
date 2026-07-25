# On-chain receipts

All transactions use Injective testnet or Solana devnet.

## x402 payment

- Settlement:
  <https://testnet.blockscout.injective.network/tx/0xd1901dd31772ce78d1f43962d0fb28792df3d54479e96270825340361504fa6a>
- The desk issued a payment receipt only after settlement metadata matched the
  requested premium.

## CCTP transfer

- Injective burn:
  <https://testnet.blockscout.injective.network/tx/0x281ef407852ccf4bb34c04f71c70c496e10e6b1479174872115b2d4177c62059>
- Solana mint:
  <https://explorer.solana.com/tx/aFzY4dorCBd28epYUdbLKZUozTi7TfshMQxTg42muLCiKq989L7NgyDs9ZQquggPefagkcC7eNRUVhSMtDG47CJ?cluster=devnet>
- Route: Injective domain 29 to Solana domain 5.

## Odds-validated policy

- Issuance:
  <https://explorer.solana.com/tx/4Uq5aW2vsWyv43vZfy3wEi9kd1ivGgnUvJDJuUdyEV3ST6owgutFVuDtfHSucM791V9drPcPFk6RLcghdc8MW3NM?cluster=devnet>
- Policy:
  <https://explorer.solana.com/address/9APDuVP895jBhj6u3iZbdr65difkiCW6vDtfMrAfx58L?cluster=devnet>
- Coverage: 5 USDC.
- Premium: 4.241692 USDC.

## Proof-gated settlement

- Settlement:
  <https://explorer.solana.com/tx/2SZFA2gaskxaNLjHy34Z3XomRN93i2zY3nbiQgWQaLizTUwmDDeLREvP2Bquih4JZXyYAmHpmfxLHUWBCVcK7qDg?cluster=devnet>
- Policy:
  <https://explorer.solana.com/address/Gmk1L8ZLPySzuGKsjNyxSyRcYMNzkb8QypzBxxzoFeMG?cluster=devnet>
- The policy moved from Open to Triggered, its 2 USDC escrow was drained, and
  the payout account received the coverage.

## Repeatable verification

```bash
make verify
```

This runs unit and MCP transport tests, verifies tampered result proofs receive
different on-chain errors from an authentic proof, and reconciles the recorded
settlement against current Solana state. Historical write transactions are
listed above and are not replayed by this command.
