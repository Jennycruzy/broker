// BROKER demo dashboard — a read-only "match board" over the REAL TxLINE feed
// and the REAL on-chain policy.
//
// This is a demo/visualiser surface, not a second product. Two rules govern it:
//
//  1. No mock data. Every number is either fetched live, replayed from a signed
//     recording whose proof re-verifies (bridge/txline_replay.mjs), or read from
//     Solana devnet. Nothing is typed in by hand and presented as state.
//  2. Fail closed and say which. Each fixture card reports its `source`
//     ("live" | "replay") and whether it is `bindable`. If neither source can
//     serve it, the card says so instead of inventing odds.
//
// Why replay exists: the TxLINE dev feed serves a moving window of upcoming
// fixtures. Once a match is played its rows age out and the live path correctly
// 404s. Both World Cup fixtures BROKER covers were captured in full while they
// ran, so their signed packets are on disk. Replayed odds are older than the
// on-chain freshness window and can never bind a policy — the card says that.

import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as live from "../bridge/txline.mjs";
import * as replay from "../bridge/txline_replay.mjs";
import { ODDS_FRESHNESS_MS, oddsAge } from "../bridge/txline.mjs";
import { createReadOnlyProgram, readPolicy, readVault, readBucket, deriveBucket } from "../bridge/surety_read.mjs";
import { normalizedProbabilityPpm, validatedQuoteTerms, bucketHash, OUTCOMES } from "../server/pricing.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, "public");
const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "127.0.0.1";

// The two World Cup fixtures BROKER covers, confirmed live from the feed. Only
// the flags are local decoration — team names, kickoff, and state come from the
// feed row itself, so a card can never disagree with the data it is rendering.
const FIXTURES = [
  { id: 18257865n, homeFlag: "🇫🇷", awayFlag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
  { id: 18257739n, homeFlag: "🇪🇸", awayFlag: "🇦🇷" },
];

// The policy whose on-chain state the board reports. Its terms, status, escrow
// balance, and vault accounting are all refetched from devnet on every poll —
// only the identifiers and the historical transaction links are constants here.
const POLICY_ACCOUNT = process.env.BROKER_POLICY ?? "9APDuVP895jBhj6u3iZbdr65difkiCW6vDtfMrAfx58L";
const POLICY_FIXTURE = { id: 18257865n, label: "France v England", outcome: "WIN_HOME" };
const POLICY_LINKS = {
  policy: `https://explorer.solana.com/address/${POLICY_ACCOUNT}?cluster=devnet`,
  issueTx: "https://explorer.solana.com/tx/4Uq5aW2vsWyv43vZfy3wEi9kd1ivGgnUvJDJuUdyEV3ST6owgutFVuDtfHSucM791V9drPcPFk6RLcghdc8MW3NM?cluster=devnet",
  x402Tx: "https://testnet.blockscout.injective.network/tx/0xd1901dd31772ce78d1f43962d0fb28792df3d54479e96270825340361504fa6a",
  cctpMint: "https://explorer.solana.com/tx/2UNhcfhpuyW1RFHgv81hM9GkC9GRQgvCSUg5dFddonHtuYLZM3FMtd9YgwacaptzmPkVZ65YPptNTrBsNRvnzyHj?cluster=devnet",
};

const SAMPLE_COVERAGE = 5_000_000n; // 5 USDC — the coverage the live policy carries
const usdc = (units) => Number(units) / 1e6;

let sessionPromise = null;
function liveSession() {
  if (!sessionPromise) sessionPromise = live.createTxlineSession().catch((e) => { sessionPromise = null; throw e; });
  return sessionPromise;
}

const chain = createReadOnlyProgram();

// Decimal odds are the reciprocal of the implied 1X2 probabilities.
function decimalOdds(ppm) {
  return ppm > 0 ? Number((1_000_000 / ppm).toFixed(2)) : null;
}

// Full-time scoreline → the 1X2 outcome the SURETY predicate settles against.
// P1 is the home side whenever Participant1IsHome, which both fixtures are.
function outcomeFromScore(scoreline, participant1IsHome) {
  const { p1Goals, p2Goals } = scoreline;
  const [home, away] = participant1IsHome ? [p1Goals, p2Goals] : [p2Goals, p1Goals];
  if (home > away) return { index: 0, outcome: "WIN_HOME", home, away };
  if (home < away) return { index: 2, outcome: "WIN_AWAY", home, away };
  return { index: 1, outcome: "DRAW", home, away };
}

// Premium for SAMPLE_COVERAGE on WIN_HOME, priced with the vault's real on-chain
// terms and the bucket's real current exposure — the same inputs the SURETY
// program re-derives and enforces at issuance. Returns null if the book or the
// vault cannot support the quote (e.g. BucketCapExceeded), never a guess.
function quoteFor(prices, vault, bucketExposure) {
  try {
    const terms = validatedQuoteTerms({
      totalCapital: vault.totalCapital,
      maxBucketBps: vault.maxBucketBps,
      currentExposure: bucketExposure,
      coverage: SAMPLE_COVERAGE,
      marginBps: vault.marginBps,
      prices,
      outcomeIndex: 0,
    });
    return {
      coverageUsdc: usdc(SAMPLE_COVERAGE),
      premiumUsdc: usdc(terms.premium),
      outcome: OUTCOMES[0],
      probabilityPpm: terms.probabilityPpm,
      utilizationBps: terms.utilizationBps,
    };
  } catch (error) {
    return { unavailable: error.message };
  }
}

async function fixturePayload(f, vault) {
  // Live first. Replay only covers what the live feed has stopped serving, so a
  // reachable live row always wins and replay never masks a live regression.
  let snap, packet, source, recordedAt = null, liveError = null;
  try {
    const session = await liveSession();
    snap = await live.fetchFixtureSnapshot(session, f.id);
    ({ packet } = await live.fetchLatestFullMatchOdds(session, f.id));
    source = "live";
  } catch (error) {
    liveError = error.message;
    const session = replay.createReplaySession();
    snap = await replay.fetchFixtureSnapshot(session, f.id);
    const recorded = await replay.fetchLatestFullMatchOdds(session, f.id);
    packet = recorded.packet;
    recordedAt = recorded.recordedAt;
    source = "replay";
  }

  const prices = packet.Prices;
  const probs = {
    home: normalizedProbabilityPpm(prices, 0),
    draw: normalizedProbabilityPpm(prices, 1),
    away: normalizedProbabilityPpm(prices, 2),
  };

  const bucketExposure = vault
    ? (await readBucket(chain, deriveBucket(vault.address, bucketHash(f.id, 0)))).lockedExposure
    : null;
  const quote = vault ? quoteFor(prices, vault, bucketExposure) : { unavailable: "vault state unavailable" };

  // The proof-backed full-time result, captured from the TxLINE scores API. This
  // is the only scoreline the board will show: the odds feed's fixture rows never
  // advance their score fields, so anything else would be a guess.
  const recordedResult = await replay.fetchRecordedFullTimeResult(null, f.id);
  const result = recordedResult
    ? { ...outcomeFromScore(recordedResult.scoreline, snap.Participant1IsHome), seq: recordedResult.seq, capturedAt: recordedResult.capturedAt }
    : null;

  const now = Date.now();
  const age = oddsAge(packet, now);
  // Replayed packets are stale by construction, so `bindable` is false for them
  // without a special case: the freshness test is the same one SURETY enforces.
  const fresh = age >= 0 && age <= ODDS_FRESHNESS_MS;
  const kickedOff = now >= snap.StartTime;

  return {
    id: String(f.id),
    home: snap.Participant1IsHome ? snap.Participant1 : snap.Participant2,
    away: snap.Participant1IsHome ? snap.Participant2 : snap.Participant1,
    homeFlag: f.homeFlag,
    awayFlag: f.awayFlag,
    competition: snap.Competition,
    source,
    recordedAt,
    liveError,
    bindable: source === "live" && fresh,
    startTime: snap.StartTime,
    kickoffISO: new Date(snap.StartTime).toISOString(),
    gameState: snap.GameState,
    state: result ? "FULL_TIME" : (kickedOff && fresh ? "LIVE_ODDS" : (kickedOff ? "IN_PLAY" : "UPCOMING")),
    result,
    prices,
    priceNames: packet.PriceNames,
    probs,
    odds: { home: decimalOdds(probs.home), draw: decimalOdds(probs.draw), away: decimalOdds(probs.away) },
    quote,
    packetMsg: packet.MessageId,
    packetTs: packet.Ts,
    ageSec: Math.round(age / 1000),
  };
}

// Policy + vault, refetched from devnet every poll. If the RPC is unreachable the
// panel reports the error rather than showing the last state it remembers.
async function policyPayload() {
  const policy = await readPolicy(chain, POLICY_ACCOUNT);
  const vault = await readVault(chain, policy.vault);
  return {
    policy: {
      account: policy.address,
      status: policy.status,
      fixture: POLICY_FIXTURE.label,
      fixtureId: String(POLICY_FIXTURE.id),
      outcome: POLICY_FIXTURE.outcome,
      coverageUsdc: usdc(policy.coverage),
      premiumUsdc: usdc(policy.premium),
      escrow: policy.escrow,
      escrowUsdc: policy.escrowBalance === null ? null : usdc(policy.escrowBalance),
      holder: policy.holder,
      vault: policy.vault,
      links: POLICY_LINKS,
    },
    vault: {
      address: vault.address,
      totalCapitalUsdc: usdc(vault.totalCapital),
      freeReservesUsdc: usdc(vault.freeReserves),
      lockedLiabilitiesUsdc: usdc(vault.lockedLiabilities),
      reserveUsdc: usdc(vault.reserveBalance),
      policyCount: vault.policyCount,
    },
    raw: { vault },
  };
}

async function livePayload() {
  let onchain = null, onchainError = null;
  try {
    onchain = await policyPayload();
  } catch (error) {
    onchainError = error.message;
  }

  const fixtures = [];
  for (const f of FIXTURES) {
    try {
      fixtures.push(await fixturePayload(f, onchain?.raw.vault ?? null));
    } catch (error) {
      fixtures.push({ id: String(f.id), homeFlag: f.homeFlag, awayFlag: f.awayFlag, error: error.message });
    }
  }

  return {
    asOf: new Date().toISOString(),
    fixtures,
    policy: onchain?.policy ?? null,
    vault: onchain?.vault ?? null,
    onchainError,
  };
}

const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png" };

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/api/live") {
      const body = await livePayload();
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(body));
      return;
    }
    if (url.pathname === "/healthz") {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    const rel = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
    const file = path.join(PUBLIC, path.normalize(rel));
    if (!file.startsWith(PUBLIC)) { res.writeHead(403); res.end("forbidden"); return; }
    const data = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
    res.end(data);
  } catch (e) {
    if (e.code === "ENOENT") { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: e.message }));
  }
});

server.listen(PORT, HOST, () => console.log(`BROKER dashboard on http://${HOST}:${PORT}`));
