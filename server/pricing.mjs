// BROKER pricing — a faithful JS reproduction of the SURETY on-chain contract's
// deterministic quote math (programs/surety_core/src/lib.rs). This is NOT a
// re-implementation of proprietary logic: every function here mirrors the public
// on-chain code that the program itself enforces at issue time
// (validated_quote_terms / normalized_probability_ppm / verified_quote_hash /
// expected_policy_bucket_hash / the 17-byte canonical predicate). BROKER must
// pass args the program will re-derive and accept, so it computes them the same
// way and reads the live inputs (odds prices, receipt hashes) off-chain.
//
// Verified against SURETY's own Rust unit test
// `verified_quote_hash_matches_the_typescript_vector` — see server/pricing.test.mjs.

import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";

const BPS_DENOMINATOR = 10_000n;
const VERIFIED_QUOTE_DOMAIN = Buffer.from("SURETY_TXLINE_ODDS_QUOTE_V2");

export const OUTCOMES = ["WIN_HOME", "DRAW", "WIN_AWAY"];

function sha256(buf) {
  return createHash("sha256").update(buf).digest();
}

function ceilDiv(numerator, denominator) {
  if (denominator <= 0n) throw new Error("denominator must be positive");
  return (numerator + denominator - 1n) / denominator;
}

// Mirror of normalized_probability_ppm: implied probability of `outcomeIndex`
// from the three 1X2 prices, using the cross-product weighting the program uses.
export function normalizedProbabilityPpm(prices, outcomeIndex) {
  const p = prices.map((x) => BigInt(x));
  if (p.some((x) => x <= 0n)) throw new Error("InvalidOddsMarket: prices must be > 0");
  if (outcomeIndex < 0 || outcomeIndex > 2) throw new Error("outcomeIndex out of range");
  const weights = [p[1] * p[2], p[0] * p[2], p[0] * p[1]];
  const total = weights[0] + weights[1] + weights[2];
  const rounded = (weights[outcomeIndex] * 1_000_000n + total / 2n) / total;
  return Number(rounded);
}

export function bucketCap(totalCapital, maxBucketBps) {
  return (BigInt(totalCapital) * BigInt(maxBucketBps)) / BPS_DENOMINATOR;
}

// Mirror of validated_quote_terms: returns { probabilityPpm, premium, utilizationBps }.
// Throws if the projected exposure meets/exceeds the bucket cap (BucketCapExceeded).
export function validatedQuoteTerms({ totalCapital, maxBucketBps, currentExposure, coverage, marginBps, prices, outcomeIndex }) {
  const probabilityPpm = normalizedProbabilityPpm(prices, outcomeIndex);
  const cap = bucketCap(totalCapital, maxBucketBps);
  const projectedExposure = BigInt(currentExposure) + BigInt(coverage);
  if (!(projectedExposure < cap)) {
    throw new Error(`BucketCapExceeded: projected exposure ${projectedExposure} must be < cap ${cap}`);
  }
  const utilizationBps = ceilDiv(projectedExposure * BPS_DENOMINATOR, cap);
  const surchargeBps =
    utilizationBps < 4_000n
      ? 10_000n
      : 10_000n + ((utilizationBps - 4_000n) * 10_000n) / 6_000n;
  const premiumNumerator =
    BigInt(coverage) * BigInt(probabilityPpm) * BigInt(marginBps) * surchargeBps;
  const premium = ceilDiv(premiumNumerator, 1_000_000n * BPS_DENOMINATOR * BPS_DENOMINATOR);
  return { probabilityPpm, premium, utilizationBps: Number(utilizationBps), surchargeBps: Number(surchargeBps) };
}

// Mirror of the 17-byte canonical predicate enforced by policy_outcome_index.
// Layout: [1,1,2, fixtureId(8 LE), 0,0, outcomeIndex, 0,0,0].
export function canonicalPredicate(fixtureId, outcomeIndex) {
  const bytes = Buffer.alloc(17);
  bytes[0] = 1;
  bytes[1] = 1;
  bytes[2] = 2;
  bytes.writeBigUInt64LE(BigInt(fixtureId), 3);
  bytes[11] = 0;
  bytes[12] = 0;
  bytes[13] = outcomeIndex;
  bytes[14] = 0;
  bytes[15] = 0;
  bytes[16] = 0;
  return bytes;
}

export function predicateHash(fixtureId, outcomeIndex) {
  return sha256(canonicalPredicate(fixtureId, outcomeIndex));
}

// Mirror of expected_policy_bucket_hash.
export function bucketHash(fixtureId, outcomeIndex) {
  return sha256(Buffer.from(`match:${fixtureId}:${OUTCOMES[outcomeIndex]}`));
}

// Mirror of verified_quote_hash.
export function verifiedQuoteHash({
  vault,
  validatedFixture,
  validatedOdds,
  probabilityPpm,
  predicateHash: predHash,
  bucketHash: bktHash,
  coverage,
  premium,
  fixtureValidationReceiptHash,
  oddsValidationReceiptHash,
}) {
  const toKey = (k) => (k instanceof PublicKey ? k.toBuffer() : new PublicKey(k).toBuffer());
  const u64le = (v) => {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(BigInt(v));
    return b;
  };
  const u32le = (v) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(Number(v));
    return b;
  };
  const parts = [
    VERIFIED_QUOTE_DOMAIN,
    toKey(vault),
    toKey(validatedFixture),
    toKey(validatedOdds),
    Buffer.from(fixtureValidationReceiptHash),
    Buffer.from(oddsValidationReceiptHash),
    Buffer.from(predHash),
    Buffer.from(bktHash),
    u64le(coverage),
    u64le(premium),
    u32le(probabilityPpm),
  ];
  return sha256(Buffer.concat(parts));
}
