import { test } from "node:test";
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import { oddsMessageKey } from "@surety-tx/txline-verify";
import {
  predicateHash,
  bucketHash,
  verifiedQuoteHash,
  normalizedProbabilityPpm,
  validatedQuoteTerms,
  canonicalPredicate,
} from "./pricing.mjs";

const PROGRAM_ID = new PublicKey("3e5rBR2J9uHPHHn6tP8HF6mPbEJsJWtzQEyicv6v8qVW");

// Exact reproduction of the Rust unit test
// `verified_quote_hash_matches_the_typescript_vector` in
// programs/surety_core/src/lib.rs at pinned commit a2f205c9.
test("verified_quote_hash matches the SURETY on-chain Rust vector", () => {
  const fixtureId = 18_237_038n;
  const outcomeIndex = 0; // WIN_HOME

  const predHash = predicateHash(fixtureId, outcomeIndex);
  const bktHash = bucketHash(fixtureId, outcomeIndex);

  const messageKey = oddsMessageKey("1837782566:00003:000791-10021-stab"); // 16 bytes
  const validatedOdds = PublicKey.findProgramAddressSync(
    [Buffer.from("validated_odds"), messageKey],
    PROGRAM_ID,
  )[0];
  const fixtureIdLe = Buffer.alloc(8);
  fixtureIdLe.writeBigUInt64LE(fixtureId);
  const validatedFixture = PublicKey.findProgramAddressSync(
    [Buffer.from("validated_fixture"), fixtureIdLe],
    PROGRAM_ID,
  )[0];

  const hash = verifiedQuoteHash({
    vault: new PublicKey("CDyQxhDHsaWYNBvjJgGPVFZdsBD3mC28VEX5DkCZkqEC"),
    validatedFixture,
    validatedOdds,
    probabilityPpm: 359_202,
    predicateHash: predHash,
    bucketHash: bktHash,
    coverage: 50_000_000n,
    premium: 26_940_150n,
    fixtureValidationReceiptHash: Buffer.alloc(32, 3),
    oddsValidationReceiptHash: Buffer.alloc(32, 4),
  });

  const expected = Buffer.from([
    222, 185, 185, 36, 233, 179, 20, 239, 8, 221, 93, 183, 120, 118, 223, 231,
    114, 229, 33, 135, 108, 174, 209, 209, 96, 71, 15, 203, 50, 117, 147, 159,
  ]);
  assert.deepEqual(hash, expected);
});

test("canonical predicate has the on-chain 17-byte layout", () => {
  const bytes = canonicalPredicate(18_237_038n, 2);
  assert.equal(bytes.length, 17);
  assert.deepEqual([...bytes.subarray(0, 3)], [1, 1, 2]);
  assert.equal(bytes.readBigUInt64LE(3), 18_237_038n);
  assert.equal(bytes[13], 2); // outcome index WIN_AWAY
  assert.deepEqual([...bytes.subarray(14, 17)], [0, 0, 0]);
});

test("normalized probability sums to ~1e6 across the three outcomes", () => {
  const prices = [1953, 4205, 3999]; // live FRA v ENG 1X2
  const p = [0, 1, 2].map((i) => normalizedProbabilityPpm(prices, i));
  const sum = p.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1_000_000) <= 2, `probabilities sum to ${sum}`);
  // Lowest price (France, 1953) must carry the highest implied probability.
  assert.ok(p[0] > p[1] && p[0] > p[2]);
});

test("validatedQuoteTerms enforces the bucket cap and prices a premium", () => {
  // coverage 2 USDC, capital 20 USDC, 2000 bps -> cap 4 USDC, 50% utilization.
  const terms = validatedQuoteTerms({
    totalCapital: 20_000_000n,
    maxBucketBps: 2000,
    currentExposure: 0n,
    coverage: 2_000_000n,
    marginBps: 15_000,
    prices: [1953, 4205, 3999],
    outcomeIndex: 0,
  });
  assert.ok(terms.premium > 0n);
  assert.equal(terms.utilizationBps, 5000);
  // Over-cap coverage must throw (BucketCapExceeded).
  assert.throws(() =>
    validatedQuoteTerms({
      totalCapital: 20_000_000n,
      maxBucketBps: 2000,
      currentExposure: 0n,
      coverage: 4_000_000n, // == cap, not < cap
      marginBps: 15_000,
      prices: [1953, 4205, 3999],
      outcomeIndex: 0,
    }),
  );
});
