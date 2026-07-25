// BROKER replay feed — serves the RECORDED TxLINE capture for fixtures the live
// dev feed no longer carries.
//
// Why this exists: the TxLINE dev feed publishes a moving window of upcoming
// fixtures. Once a match is played, its rows age out of /api/fixtures/snapshot
// and /api/odds/snapshot, and the live path fails closed (correctly). The two
// World Cup fixtures BROKER covers were captured in full while they ran — see
// capture/recorder.mjs and data/recordings/<fixtureId>/ — so their signed
// packets and Merkle proofs are on disk.
//
// This module is deliberately NOT a mock. It replays the exact bytes TxLINE
// signed: every packet returned here was fetched from the live API during the
// match, and its proof still verifies against the packet via the public
// @surety-tx/txline-verify helpers (assertProofMatchesPacket). Nothing is
// synthesized, interpolated, or back-filled.
//
// What replay CANNOT do, stated plainly: recorded packets are older than
// ODDS_FRESHNESS_MS, so they can never bind a new policy. The SURETY program
// enforces that freshness window on-chain at issuance. Replay drives the
// display only; issuance requires a currently-served fixture. Callers are told
// which source they got via `source: "replay"` and `recordedAt`.

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertProofMatchesPacket, assertAuthenticFixtureProofShape } from "@surety-tx/txline-verify";
import { recordedProof, scorelineFrom } from "./settlement_payload.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RECORDINGS = process.env.BROKER_RECORDINGS_DIR
  ?? path.join(HERE, "..", "data", "recordings");

function recordingDir(fixtureId) {
  return path.join(RECORDINGS, String(fixtureId));
}

async function readJsonl(file) {
  const text = await readFile(file, "utf8");
  return text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

// A replay session carries no credentials — it never touches the network.
export function createReplaySession() {
  return { mode: "replay", recordingsDir: RECORDINGS };
}

export async function listRecordedFixtures() {
  try {
    const entries = await readdir(RECORDINGS, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory() && /^\d+$/.test(e.name)).map((e) => e.name);
  } catch {
    return [];
  }
}

async function records(fixtureId) {
  const file = path.join(recordingDir(fixtureId), "packets.jsonl");
  let rows;
  try {
    rows = await readJsonl(file);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`fixture ${fixtureId} has no recording at ${file}`);
    }
    throw error;
  }
  if (rows.length === 0) throw new Error(`recording for fixture ${fixtureId} is empty`);
  return rows;
}

// Mirrors bridge/txline.mjs::fetchFixtureSnapshot — returns the fixture row as
// TxLINE published it. We take the LAST recorded fixture-proof so the row
// reflects the latest match state the feed ever reported for this fixture.
export async function fetchFixtureSnapshot(_session, fixtureId) {
  const rows = await records(fixtureId);
  const fixtureRows = rows.filter((r) => r.kind === "fixture-proof");
  const last = fixtureRows[fixtureRows.length - 1];
  if (!last) throw new Error(`recording for fixture ${fixtureId} contains no fixture rows`);
  // Same authenticity shape check the live path runs in txline.mjs::fetchFixtureProof.
  // A recording that has been edited on disk fails here rather than being served.
  assertAuthenticFixtureProofShape(last.parsed.proof);
  return { ...last.parsed.fixture, __recordedAt: last.at };
}

// Mirrors bridge/txline.mjs::fetchLatestFullMatchOdds — returns the last signed
// 1X2 packet captured for this fixture, i.e. the closing book. The recorded
// proof travels with it so callers can re-verify rather than trust this module.
export async function fetchLatestFullMatchOdds(_session, fixtureId) {
  const rows = await records(fixtureId);
  const oddsRows = rows.filter((r) => r.kind === "odds");
  const last = oddsRows[oddsRows.length - 1];
  if (!last) throw new Error(`recording for fixture ${fixtureId} contains no odds packets`);
  // The header claim ("its proof still verifies against the packet") is enforced,
  // not asserted: this is the same check the live path runs in
  // txline.mjs::fetchOddsProof. Tamper with packets.jsonl and replay fails closed.
  assertProofMatchesPacket(last.parsed.proof, last.parsed.packet);
  return {
    packet: last.parsed.packet,
    proof: last.parsed.proof,
    snapshotBytes: Buffer.from(last.rawBase64, "base64"),
    recordedAt: last.at,
    packetCount: oddsRows.length,
  };
}

// The proof-backed full-time scoreline, captured from the TxLINE scores API
// (bridge/txline_scores.mjs) and persisted alongside the packet recording.
// Returns null when it was never captured — callers must fail closed, not guess.
export async function fetchRecordedFullTimeResult(_session, fixtureId) {
  const file = path.join(recordingDir(fixtureId), "full-time-result.json");
  try {
    const stored = JSON.parse(await readFile(file, "utf8"));
    const verified = await recordedProof(fixtureId);
    const provedScoreline = scorelineFrom(verified.proof);
    if (
      stored.scoreline?.p1Goals !== provedScoreline.p1Goals
      || stored.scoreline?.p2Goals !== provedScoreline.p2Goals
      || stored.seq !== verified.seq
    ) {
      throw new Error(`recorded result metadata for fixture ${fixtureId} disagrees with its authenticated stat proofs`);
    }
    return {
      seq: stored.seq,
      scoreline: provedScoreline,
      capturedAt: stored.capturedAt,
      proofVerified: true,
    };
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
