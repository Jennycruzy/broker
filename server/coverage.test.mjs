import assert from "node:assert/strict";
import test from "node:test";
import { parsePremiumRateBps, quoteCoverage } from "./coverage.mjs";

test("quote calculation is deterministic and rounds premium upward", () => {
  const input = { fixture: "FRA v ENG", outcome: "France", coverage_amount: "1000001" };
  const first = quoteCoverage(input, 250n);
  const second = quoteCoverage(input, 250n);
  assert.deepEqual(first, second);
  assert.equal(first.premium_amount, "25001");
});

test("invalid and zero coverage fail closed", () => {
  assert.throws(() => quoteCoverage({ fixture: "FRA v ENG", outcome: "France", coverage_amount: "0" }, 250n));
  assert.throws(() => quoteCoverage({ fixture: "", outcome: "France", coverage_amount: "100" }, 250n));
});

test("premium rate must be explicit and bounded", () => {
  assert.throws(() => parsePremiumRateBps(undefined));
  assert.throws(() => parsePremiumRateBps("10001"));
  assert.equal(parsePremiumRateBps("250"), 250n);
});
