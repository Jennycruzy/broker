// BROKER demo dashboard — a read-only "match board" over the REAL TxLINE feed.
//
// This is a demo/visualiser surface, not a second product: it renders the same
// live signed odds BROKER prices from, and reproduces the deployed SURETY vault's
// on-chain premium math (server/pricing.mjs) so the quote it shows is faithful,
// not decorative. No mock data — every number comes from the live feed or the
// recorded on-chain policy. If the feed is unreachable the card fails closed and
// says so; it never invents odds.

import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createTxlineSession,
  fetchFixtureSnapshot,
  fetchLatestFullMatchOdds,
  oddsAge,
} from "../bridge/txline.mjs";
import { normalizedProbabilityPpm, validatedQuoteTerms, OUTCOMES } from "../server/pricing.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, "public");
const PORT = Number(process.env.PORT ?? 8787);

// The two World Cup fixtures BROKER covers, confirmed live from the feed.
const FIXTURES = [
  { id: 18257865n, home: "France", away: "England", homeFlag: "🇫🇷", awayFlag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
  { id: 18257739n, home: "Spain", away: "Argentina", homeFlag: "🇪🇸", awayFlag: "🇦🇷" },
];

// Real parameters of the deployed Gate-3 formula-v2 vault, reproduced so the live
// premium below matches what the SURETY program re-derives and enforces on-chain.
// Verified: these reproduce the bound policy's 4.241692 USDC premium at 51.18%.
const VAULT = { totalCapital: 12_000_000n, maxBucketBps: 9000n, currentExposure: 0n, marginBps: 15_000n };
const SAMPLE_COVERAGE = 5_000_000n; // 5 USDC, the coverage the live policy carries

// The bound, independently-verified on-chain policy (EVIDENCE.md, Gate 3 Part B).
const POLICY = {
  account: "9APDuVP895jBhj6u3iZbdr65difkiCW6vDtfMrAfx58L",
  status: "Open",
  fixture: "France v England",
  fixtureId: "18257865",
  outcome: "WIN_HOME",
  coverageUsdc: 5.0,
  premiumUsdc: 4.241692,
  probabilityPpm: 511818,
  vault: "CrnjZE2DXMPLtRXJ6MPHaKifEi13qp1vAFn9ohXBpqZu",
  links: {
    policy: "https://explorer.solana.com/address/9APDuVP895jBhj6u3iZbdr65difkiCW6vDtfMrAfx58L?cluster=devnet",
    issueTx: "https://explorer.solana.com/tx/4Uq5aW2vsWyv43vZfy3wEi9kd1ivGgnUvJDJuUdyEV3ST6owgutFVuDtfHSucM791V9drPcPFk6RLcghdc8MW3NM?cluster=devnet",
    x402Tx: "https://testnet.blockscout.injective.network/tx/0xd1901dd31772ce78d1f43962d0fb28792df3d54479e96270825340361504fa6a",
    cctpMint: "https://explorer.solana.com/tx/2UNhcfhpuyW1RFHgv81hM9GkC9GRQgvCSUg5dFddonHtuYLZM3FMtd9YgwacaptzmPkVZ65YPptNTrBsNRvnzyHj?cluster=devnet",
  },
};

let sessionPromise = null;
function session() {
  if (!sessionPromise) sessionPromise = createTxlineSession().catch((e) => { sessionPromise = null; throw e; });
  return sessionPromise;
}

// Decimal odds are the reciprocal of the implied 1X2 probabilities.
function decimalOdds(ppm) {
  return ppm > 0 ? Number((1_000_000 / ppm).toFixed(2)) : null;
}

async function fixturePayload(s, f) {
  const snap = await fetchFixtureSnapshot(s, f.id);
  const { packet } = await fetchLatestFullMatchOdds(s, f.id);
  const prices = packet.Prices;
  const probs = { home: normalizedProbabilityPpm(prices, 0), draw: normalizedProbabilityPpm(prices, 1), away: normalizedProbabilityPpm(prices, 2) };

  // Live premium for 5 USDC WIN_HOME, priced with the deployed vault's real terms.
  let quote = null;
  try {
    const t = validatedQuoteTerms({
      totalCapital: VAULT.totalCapital, maxBucketBps: VAULT.maxBucketBps,
      currentExposure: VAULT.currentExposure, coverage: SAMPLE_COVERAGE,
      marginBps: VAULT.marginBps, prices, outcomeIndex: 0,
    });
    quote = { coverageUsdc: 5.0, premiumUsdc: Number(t.premium) / 1e6, outcome: OUTCOMES[0], probabilityPpm: t.probabilityPpm };
  } catch { quote = null; }

  const score = snap.Participant1Score != null && snap.Participant2Score != null
    ? { home: snap.Participant1Score, away: snap.Participant2Score } : null;

  return {
    id: String(f.id), home: f.home, away: f.away, homeFlag: f.homeFlag, awayFlag: f.awayFlag,
    startTime: snap.StartTime, kickoffISO: new Date(snap.StartTime).toISOString(),
    gameState: snap.GameState, live: snap.GameState > 1, score,
    prices, priceNames: packet.PriceNames, probs,
    odds: { home: decimalOdds(probs.home), draw: decimalOdds(probs.draw), away: decimalOdds(probs.away) },
    quote, packetMsg: packet.MessageId, packetTs: packet.Ts, ageSec: Math.round(oddsAge(packet) / 1000),
  };
}

async function livePayload() {
  const s = await session();
  const fixtures = [];
  for (const f of FIXTURES) {
    try { fixtures.push(await fixturePayload(s, f)); }
    catch (e) { fixtures.push({ id: String(f.id), home: f.home, away: f.away, homeFlag: f.homeFlag, awayFlag: f.awayFlag, error: e.message }); }
  }
  return { asOf: new Date().toISOString(), fixtures, policy: POLICY };
}

const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" };

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/api/live") {
      const body = await livePayload();
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(body));
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

server.listen(PORT, () => console.log(`BROKER dashboard on http://localhost:${PORT}`));
