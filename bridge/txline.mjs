// BROKER's TxLINE client — a faithful port of SURETY's
// services/odds-validation/src/live.ts (which BROKER cannot import: it is app
// source, not a published package). It fetches the live fixture snapshot, the
// canonical full-match 1X2 odds packet, and their server-constructed merkle
// proofs from the TxLINE API, then hands the proofs to the public
// @surety-tx/txline-verify package for on-chain verification and record-arg
// shaping. No proof is synthesized here; TxLINE builds them.

import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import {
  assertProofMatchesPacket,
  assertAuthenticFixtureProofShape,
  pureFixtureId,
} from "@surety-tx/txline-verify";

const API_ORIGIN = process.env.TXLINE_API_ORIGIN ?? "https://txline-dev.txodds.com";

export async function loadApiToken() {
  if (process.env.TXLINE_API_TOKEN) return process.env.TXLINE_API_TOKEN;
  const secretPath = process.env.TXLINE_SECRET_PATH ?? ".secrets/txline-devnet.json";
  const stored = JSON.parse(await readFile(secretPath, "utf8"));
  if (!stored.apiToken) throw new Error(`Missing apiToken in ${secretPath}`);
  return stored.apiToken;
}

export async function createTxlineSession() {
  const response = await fetch(`${API_ORIGIN}/auth/guest/start`, { method: "POST" });
  if (!response.ok) throw new Error(`Guest authentication failed: HTTP ${response.status}`);
  const body = await response.json();
  if (!body.token) throw new Error("Guest authentication response omitted token");
  return { apiOrigin: API_ORIGIN, apiToken: await loadApiToken(), jwt: body.token };
}

async function authenticatedJson(session, pathname) {
  const response = await fetch(`${session.apiOrigin}/api${pathname}`, {
    headers: { Authorization: `Bearer ${session.jwt}`, "X-Api-Token": session.apiToken },
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!response.ok) {
    throw new Error(`TxLINE ${pathname} HTTP ${response.status}: ${bytes.toString("utf8").slice(0, 300)}`);
  }
  return { value: JSON.parse(bytes.toString("utf8")), bytes };
}

export async function fetchFixtureSnapshot(session, fixtureId) {
  const { value } = await authenticatedJson(session, "/fixtures/snapshot");
  const fixture = value.find((row) => pureFixtureId(row.FixtureId) === fixtureId);
  if (!fixture) throw new Error(`fixture ${fixtureId} is absent from the authenticated TxLINE snapshot`);
  return fixture;
}

export async function fetchFixtureProof(session, fixture) {
  const query = new URLSearchParams({ fixtureId: String(fixture.FixtureId), timestamp: String(fixture.Ts) });
  const { value, bytes } = await authenticatedJson(session, `/fixtures/validation?${query}`);
  assertAuthenticFixtureProofShape(value);
  assert.equal(pureFixtureId(value.snapshot.FixtureId), pureFixtureId(fixture.FixtureId));
  return { proof: value, bytes };
}

export async function fetchLatestFullMatchOdds(session, fixtureId, asOf = Date.now()) {
  const { value, bytes } = await authenticatedJson(session, `/odds/snapshot/${fixtureId}?asOf=${asOf}`);
  const packet = value.find(
    (row) =>
      BigInt(row.FixtureId) === fixtureId &&
      row.Bookmaker === "TXLineStablePriceDemargined" &&
      row.SuperOddsType === "1X2_PARTICIPANT_RESULT" &&
      row.MarketParameters === null &&
      row.MarketPeriod === null,
  );
  if (!packet) throw new Error(`fixture ${fixtureId} has no canonical full-match TxLINE 1X2 packet`);
  return { packet, snapshotBytes: bytes };
}

export async function fetchOddsProof(session, packet) {
  const query = new URLSearchParams({ messageId: packet.MessageId, ts: String(packet.Ts) });
  const { value, bytes } = await authenticatedJson(session, `/odds/validation?${query}`);
  assertProofMatchesPacket(value, packet);
  return { proof: value, bytes };
}

export const ODDS_FRESHNESS_MS = 15 * 60 * 1000;
export const ODDS_FUTURE_SKEW_MS = 30 * 1000;

export function oddsAge(packet, now = Date.now()) {
  return now - packet.Ts;
}

export function isFresh(packet, now = Date.now()) {
  const age = oddsAge(packet, now);
  return age <= ODDS_FRESHNESS_MS && age >= -ODDS_FUTURE_SKEW_MS;
}
