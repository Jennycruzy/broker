// BROKER's TxLINE scores client — companion to bridge/txline.mjs.
// Fetches the full-match scores snapshot for a completed fixture and the
// server-constructed StatValidationV2 Merkle proofs that SURETY's on-chain
// settle_policy instruction verifies via CPI into the TxLINE program.
//
// No proof is synthesized here. Every field returned to callers comes
// verbatim from the authenticated TxLINE API response. If TxLINE cannot
// produce a proof the fetch throws with the real HTTP status + body.
//
// Endpoint surface (discovered in Jennycruzy/surety
// services/odds-validation/src/probe-cli.ts):
//   GET /api/scores/snapshot/{fixtureId}
//     → array of raw score-update rows; the row whose Action is
//       "game_finalised" carries the Seq we must quote for a full-time
//       stat proof.
//   GET /api/scores/stat-validation?fixtureId=&seq=&statKeys=
//     → RawStatValidationV2 object (shape defined in
//       @surety-tx/txline-verify dist/txline.d.ts) suitable for feeding
//       into validateStatV2OnDevnet or into SURETY's settle_policy
//       StatValidationInput payload.
//
// On-chain-verifiable stat keys, as required by SURETY's WIN_HOME/DRAW/
// WIN_AWAY predicate branch (see programs/surety_core/src/lib.rs
// strategy_for_policy) and TxLINE's crate txline-cpi:
//
//   key = 1, period = FINAL_PERIOD (100)  → home-participant final goals
//   key = 2, period = FINAL_PERIOD (100)  → away-participant final goals
//
// These are the keys/periods TxLINE hashes into the merkle leaves that
// the on-chain program verifies during settle_policy. The snapshot rows'
// raw `Stats["3001"]` field is a different, human-facing aggregation and
// is NOT what settle_policy checks against. Using it would fail on-chain
// with SettlementPredicateMismatch.

import assert from "node:assert/strict";
import { pureFixtureId } from "@surety-tx/txline-verify";

const API_ORIGIN = process.env.TXLINE_API_ORIGIN ?? "https://txline-dev.txodds.com";

// FINAL_PERIOD constant from crates/txline-cpi/src/lib.rs (pub const
// FINAL_PERIOD: i32 = 100). SURETY's require_leaf enforces this for
// full-match settlement.
export const FINAL_PERIOD = 100;

export const STAT_KEY_FULL_MATCH_P1_GOALS = 1;
export const STAT_KEY_FULL_MATCH_P2_GOALS = 2;

async function authenticatedJson(session, pathname) {
  const response = await fetch(`${(session.apiOrigin ?? API_ORIGIN)}/api${pathname}`, {
    headers: { Authorization: `Bearer ${session.jwt}`, "X-Api-Token": session.apiToken },
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!response.ok) {
    throw new Error(`TxLINE ${pathname} HTTP ${response.status}: ${bytes.toString("utf8").slice(0, 300)}`);
  }
  return { value: JSON.parse(bytes.toString("utf8")), bytes };
}

// Raw scores snapshot for a fixture. Rows are score-update records; each
// carries a Seq that TxLINE uses as the batch identity when building
// stat proofs. Returns the raw array plus the bytes for byte-fidelity
// recording.
export async function fetchScoresSnapshot(session, fixtureId) {
  const { value, bytes } = await authenticatedJson(session, `/scores/snapshot/${fixtureId}`);
  if (!Array.isArray(value)) {
    throw new Error(`TxLINE scores snapshot for ${fixtureId} was not an array (got ${typeof value})`);
  }
  return { rows: value, bytes };
}

// Returns the Seq (batch identity) of the row that recorded full-time.
// Throws if the match has not been finalised yet on TxLINE's side —
// which is the correct fail-closed behavior: settle_policy would reject
// a mid-match proof anyway.
export function findGameFinalisedSeq(rows) {
  const finalised = rows.find((row) => row?.Action === "game_finalised");
  if (!finalised) {
    throw new Error(`TxLINE has not recorded a game_finalised action for this fixture yet`);
  }
  if (typeof finalised.Seq !== "number") {
    throw new Error(`game_finalised row missing numeric Seq (got ${JSON.stringify(finalised.Seq)})`);
  }
  return finalised.Seq;
}

// Fetches a RawStatValidationV2 proof from TxLINE. The API assembles
// the Merkle proofs server-side; we only validate that the returned
// shape matches what @surety-tx/txline-verify and settle_policy expect,
// and that the proof is genuinely about the fixture and stat key we
// asked for.
export async function fetchStatProofV2(session, { fixtureId, seq, statKey }) {
  const query = new URLSearchParams({
    fixtureId: String(fixtureId),
    seq: String(seq),
    statKeys: String(statKey),
  });
  const { value, bytes } = await authenticatedJson(session, `/scores/stat-validation?${query}`);
  assertAuthenticStatProofShape(value);
  assert.equal(
    pureFixtureId(value.summary.fixtureId),
    BigInt(fixtureId),
    `stat proof fixtureId ${value.summary.fixtureId} does not match requested ${fixtureId}`,
  );
  const requestedStat = value.statsToProve.find((stat) => stat.key === statKey);
  assert(requestedStat, `stat proof did not include requested key ${statKey} (got ${value.statsToProve.map((s) => s.key).join(",")})`);
  return { proof: value, bytes };
}

// Multi-stat variant: fetch a single RawStatValidationV2 proof carrying
// all requested statKeys. TxLINE builds a single unified merkle proof
// covering every stat in `statKeys`; SURETY's `settle_policy` needs
// exactly this shape when its predicate is a comparison across multiple
// stats (e.g. WIN_HOME = P1_goals > P2_goals).
export async function fetchCombinedStatProof(session, { fixtureId, seq, statKeys }) {
  assert(Array.isArray(statKeys) && statKeys.length > 0, "statKeys must be a non-empty array");
  const query = new URLSearchParams({
    fixtureId: String(fixtureId),
    seq: String(seq),
    statKeys: statKeys.map(String).join(","),
  });
  const { value, bytes } = await authenticatedJson(session, `/scores/stat-validation?${query}`);
  assertAuthenticStatProofShape(value);
  assert.equal(
    pureFixtureId(value.summary.fixtureId),
    BigInt(fixtureId),
    `stat proof fixtureId ${value.summary.fixtureId} does not match requested ${fixtureId}`,
  );
  for (const key of statKeys) {
    assert(
      value.statsToProve.some((s) => s.key === key),
      `combined proof missing requested statKey ${key} (got ${value.statsToProve.map((s) => s.key).join(",")})`,
    );
  }
  assert.equal(value.statProofs.length, statKeys.length, "combined proof statProofs count mismatch");
  return { proof: value, bytes };
}

// Convenience: fetch the full-match result (both participants' final
// goal counts) as two on-chain-verifiable proofs, plus the derived
// scoreline. TxLINE requires one proof per statKey.
export async function fetchFullMatchResult(session, fixtureId) {
  const { rows, bytes: snapshotBytes } = await fetchScoresSnapshot(session, fixtureId);
  const seq = findGameFinalisedSeq(rows);
  const p1 = await fetchStatProofV2(session, { fixtureId, seq, statKey: STAT_KEY_FULL_MATCH_P1_GOALS });
  const p2 = await fetchStatProofV2(session, { fixtureId, seq, statKey: STAT_KEY_FULL_MATCH_P2_GOALS });
  const p1Goals = p1.proof.statsToProve.find((s) => s.key === STAT_KEY_FULL_MATCH_P1_GOALS).value;
  const p2Goals = p2.proof.statsToProve.find((s) => s.key === STAT_KEY_FULL_MATCH_P2_GOALS).value;
  return {
    seq,
    snapshotBytes,
    p1Proof: p1.proof,
    p1Bytes: p1.bytes,
    p2Proof: p2.proof,
    p2Bytes: p2.bytes,
    scoreline: { p1Goals, p2Goals },
  };
}

// Structural check for a RawStatValidationV2 as returned by TxLINE
// (matches the type published in @surety-tx/txline-verify dist/
// txline.d.ts and the payload consumed by validateStatV2OnDevnet).
export function assertAuthenticStatProofShape(proof) {
  assert(proof && typeof proof === "object", "stat proof must be an object");
  assert(Number.isSafeInteger(proof.ts) && proof.ts > 0, "stat proof ts is invalid");
  assert(Array.isArray(proof.statsToProve) && proof.statsToProve.length > 0, "stat proof missing statsToProve");
  for (const stat of proof.statsToProve) {
    assert(Number.isSafeInteger(stat.key), "stat key must be an integer");
    assert(Number.isSafeInteger(stat.value), "stat value must be an integer");
    assert(Number.isSafeInteger(stat.period), "stat period must be an integer");
    assert.equal(
      stat.period,
      FINAL_PERIOD,
      `stat.period ${stat.period} is not FINAL_PERIOD (${FINAL_PERIOD}) — settle_policy would reject this as SettlementNotFinal`,
    );
  }
  assertBytes32("eventStatRoot", proof.eventStatRoot);
  assert(proof.summary && typeof proof.summary === "object", "stat proof missing summary");
  assert(Number.isSafeInteger(proof.summary.fixtureId) || typeof proof.summary.fixtureId === "number", "summary.fixtureId invalid");
  assert(proof.summary.updateStats && typeof proof.summary.updateStats === "object", "summary.updateStats missing");
  assert(Number.isSafeInteger(proof.summary.updateStats.updateCount), "updateStats.updateCount invalid");
  assert(Number.isSafeInteger(proof.summary.updateStats.minTimestamp) && proof.summary.updateStats.minTimestamp > 0, "updateStats.minTimestamp invalid");
  assert(Number.isSafeInteger(proof.summary.updateStats.maxTimestamp) && proof.summary.updateStats.maxTimestamp > 0, "updateStats.maxTimestamp invalid");
  assertBytes32("summary.eventStatsSubTreeRoot", proof.summary.eventStatsSubTreeRoot);
  assert(Array.isArray(proof.statProofs) && proof.statProofs.length === proof.statsToProve.length, "statProofs cardinality mismatch");
  assert(Array.isArray(proof.subTreeProof), "subTreeProof must be array");
  assert(Array.isArray(proof.mainTreeProof), "mainTreeProof must be array");
  assert(proof.subTreeProof.length <= 32, "subTreeProof too long");
  assert(proof.mainTreeProof.length <= 32, "mainTreeProof too long");
  for (const [group, nodes] of [
    ["subTreeProof", proof.subTreeProof],
    ["mainTreeProof", proof.mainTreeProof],
  ]) {
    for (const [i, node] of nodes.entries()) {
      assert(node && typeof node.isRightSibling === "boolean", `${group}[${i}] missing isRightSibling`);
      assertBytes32(`${group}[${i}].hash`, node.hash);
    }
  }
  for (const [i, nodes] of proof.statProofs.entries()) {
    assert(Array.isArray(nodes), `statProofs[${i}] must be array`);
    assert(nodes.length <= 32, `statProofs[${i}] too long`);
    for (const [j, node] of nodes.entries()) {
      assert(node && typeof node.isRightSibling === "boolean", `statProofs[${i}][${j}] missing isRightSibling`);
      assertBytes32(`statProofs[${i}][${j}].hash`, node.hash);
    }
  }
}

function assertBytes32(label, value) {
  assert(Array.isArray(value) && value.length === 32, `${label} must be a 32-byte array`);
  for (const byte of value) {
    assert(Number.isInteger(byte) && byte >= 0 && byte <= 255, `${label} contains non-byte value`);
  }
}
