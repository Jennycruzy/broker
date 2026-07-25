// Shapes a TxLINE full-time stat proof into SURETY's `StatValidationInput`.
//
// Shared by settle-policy.mjs and verify-proof-rejection.mjs so the negative
// test tampers with the exact payload the real path submits. If these two drifted
// apart the negative test would be proving something about code nobody runs.
//
// Two field-name traps, both of which serialize silently wrong if missed:
//   payload.fixtureProof      ← proof.subTreeProof (nothing is named "fixtureProof")
//   summary.eventsSubTreeRoot ← TxLINE's summary.eventStatsSubTreeRoot

import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import anchor from "@anchor-lang/core";
import { createTxlineSession } from "./txline.mjs";
import {
  fetchScoresSnapshot,
  findGameFinalisedSeq,
  fetchCombinedStatProof,
  assertAuthenticStatProofShape,
  STAT_KEY_FULL_MATCH_P1_GOALS,
  STAT_KEY_FULL_MATCH_P2_GOALS,
} from "./txline_scores.mjs";

export const STAT_KEYS = [STAT_KEY_FULL_MATCH_P1_GOALS, STAT_KEY_FULL_MATCH_P2_GOALS];
const { BN } = anchor;

const mapProof = (nodes) => nodes.map((n) => ({ hash: [...n.hash], isRightSibling: n.isRightSibling }));

export function buildStatValidationPayload(proof) {
  return {
    ts: new BN(proof.summary.updateStats.minTimestamp),
    fixtureSummary: {
      fixtureId: new BN(proof.summary.fixtureId),
      updateStats: {
        updateCount: proof.summary.updateStats.updateCount,
        minTimestamp: new BN(proof.summary.updateStats.minTimestamp),
        maxTimestamp: new BN(proof.summary.updateStats.maxTimestamp),
      },
      eventsSubTreeRoot: [...proof.summary.eventStatsSubTreeRoot],
    },
    fixtureProof: mapProof(proof.subTreeProof),
    mainTreeProof: mapProof(proof.mainTreeProof),
    eventStatRoot: [...proof.eventStatRoot],
    stats: proof.statsToProve.map((stat, i) => ({
      stat: { key: stat.key, value: stat.value, period: stat.period },
      statProof: mapProof(proof.statProofs[i]),
    })),
  };
}

async function liveProof(fixtureId) {
  const session = await createTxlineSession();
  const { rows } = await fetchScoresSnapshot(session, fixtureId);
  const seq = findGameFinalisedSeq(rows);
  const { proof } = await fetchCombinedStatProof(session, { fixtureId, seq, statKeys: STAT_KEYS });
  return { proof, seq, source: "live" };
}

// The capture stored one single-stat proof per key. They can be combined only if
// they came from the same batch — same summary, same roots, same tree proofs.
// Assert that rather than assume it; a mismatch means the recording spans two
// batches and must not be spliced.
export async function recordedProof(fixtureId) {
  const file = new URL(`../data/recordings/${fixtureId}/full-time-result.json`, import.meta.url);
  const stored = JSON.parse(await readFile(file, "utf8"));
  const { p1Proof, p2Proof, seq } = stored;
  assertAuthenticStatProofShape(p1Proof);
  assertAuthenticStatProofShape(p2Proof);
  assert.deepEqual(p1Proof.summary, p2Proof.summary, "recorded p1/p2 proofs are from different batches (summary differs) — refusing to splice");
  assert.deepEqual(p1Proof.eventStatRoot, p2Proof.eventStatRoot, "recorded p1/p2 eventStatRoot differ — refusing to splice");
  assert.deepEqual(p1Proof.subTreeProof, p2Proof.subTreeProof, "recorded p1/p2 subTreeProof differ — refusing to splice");
  assert.deepEqual(p1Proof.mainTreeProof, p2Proof.mainTreeProof, "recorded p1/p2 mainTreeProof differ — refusing to splice");
  const proof = {
    ts: p1Proof.ts,
    summary: p1Proof.summary,
    eventStatRoot: p1Proof.eventStatRoot,
    subTreeProof: p1Proof.subTreeProof,
    mainTreeProof: p1Proof.mainTreeProof,
    statsToProve: [p1Proof.statsToProve[0], p2Proof.statsToProve[0]],
    statProofs: [p1Proof.statProofs[0], p2Proof.statProofs[0]],
  };
  assertAuthenticStatProofShape(proof);
  return { proof, seq, source: "recorded" };
}

// Live first. The recording is a fallback for a fixture the dev feed has aged
// out, not a substitute — either way the bytes are TxLINE's, and either way the
// on-chain validator is what decides whether they verify.
export async function fetchSettlementProof(fixtureId, mode = "auto", onFallback = () => {}) {
  if (mode === "recorded") return recordedProof(fixtureId);
  if (mode === "live") return liveProof(fixtureId);
  try {
    return await liveProof(fixtureId);
  } catch (error) {
    onFallback(error);
    return recordedProof(fixtureId);
  }
}

export function scorelineFrom(proof) {
  const value = (key) => proof.statsToProve.find((s) => s.key === key)?.value;
  const p1Goals = value(STAT_KEY_FULL_MATCH_P1_GOALS);
  const p2Goals = value(STAT_KEY_FULL_MATCH_P2_GOALS);
  assert(Number.isInteger(p1Goals) && Number.isInteger(p2Goals), "combined proof is missing one of the full-match goal stats");
  return { p1Goals, p2Goals };
}
