import { createHash } from "node:crypto";
import { z } from "zod";

const decimalInteger = z.string().regex(/^[1-9][0-9]*$/, "must be a positive integer string");

export const coverageRequestSchema = z.object({
  fixture: z.string().trim().min(1).max(160),
  outcome: z.string().trim().min(1).max(160),
  coverage_amount: decimalInteger,
}).strict();

export function parsePremiumRateBps(value) {
  const parsed = decimalInteger.safeParse(value);
  if (!parsed.success) {
    throw new Error("PREMIUM_RATE_BPS must be a positive integer string");
  }
  const rate = BigInt(parsed.data);
  if (rate > 10_000n) {
    throw new Error("PREMIUM_RATE_BPS cannot exceed 10000");
  }
  return rate;
}

export function quoteCoverage(input, premiumRateBps) {
  const request = coverageRequestSchema.parse(input);
  const coverage = BigInt(request.coverage_amount);
  const premium = (coverage * premiumRateBps + 9_999n) / 10_000n;
  if (premium < 1n) {
    throw new Error("calculated premium must be at least one USDC base unit");
  }

  const canonical = JSON.stringify({
    coverage_amount: coverage.toString(),
    fixture: request.fixture,
    outcome: request.outcome,
    premium_amount: premium.toString(),
    premium_rate_bps: premiumRateBps.toString(),
  });

  return {
    quote_id: createHash("sha256").update(canonical).digest("hex"),
    fixture: request.fixture,
    outcome: request.outcome,
    coverage_amount: coverage.toString(),
    premium_amount: premium.toString(),
    premium_rate_bps: premiumRateBps.toString(),
    unit: "USDC base units (6 decimals)",
    network: "Injective EVM testnet (eip155:1439)",
  };
}
