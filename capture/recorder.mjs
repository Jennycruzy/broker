// BROKER match-capture recorder — standalone, unattended, append-only.
//
// Records the live TxLINE feed for one fixture across its full window:
//   - every NEW full-match 1X2 odds packet (deduped by MessageId) with its
//     server-built merkle proof, byte-faithful, appended to packets.jsonl;
//   - a labelled odds snapshot at kickoff / each GameState change / each score
//     change / stop, written under snapshots/;
//   - the fixture (result) proof on every GameState change and near stop, so a
//     settleable result packet exists regardless of how full-time is signalled;
//   - a 60s heartbeat to HEARTBEAT.log (checkable from a phone);
//   - an optional webhook alert if the feed goes silent past a threshold.
//
// It NEVER synthesizes, back-fills, or edits a packet. A missed poll is logged
// and retried; it is never filled. The only catch here logs the error, marks
// the heartbeat feed-alive=false, and continues polling — it never writes data
// the feed did not return.
//
// Run directly (dry-run / manual) or under a supervisor (systemd/pm2/cron) —
// see capture/deploy/. Config is env-only so the same binary serves both.

import { mkdir, appendFile, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  createTxlineSession,
  fetchFixtureSnapshot,
  fetchFixtureProof,
  fetchLatestFullMatchOdds,
  fetchOddsProof,
  oddsAge,
} from "../bridge/txline.mjs";

const cfg = {
  fixtureId: BigInt(reqEnv("CAPTURE_FIXTURE_ID")),
  label: process.env.CAPTURE_LABEL ?? String(process.env.CAPTURE_FIXTURE_ID),
  kickoffMs: Number(reqEnv("CAPTURE_KICKOFF_MS")),
  stopAfterMin: Number(process.env.CAPTURE_STOP_AFTER_MIN ?? 180),
  pollSec: Number(process.env.CAPTURE_POLL_SEC ?? 15),
  heartbeatSec: Number(process.env.CAPTURE_HEARTBEAT_SEC ?? 60),
  silenceSec: Number(process.env.CAPTURE_SILENCE_SEC ?? 120),
  fixtureProofEverySec: Number(process.env.CAPTURE_FIXTURE_PROOF_EVERY_SEC ?? 300),
  webhookUrl: process.env.CAPTURE_WEBHOOK_URL ?? null,
  outDir:
    process.env.CAPTURE_OUT_DIR ??
    path.join("data", "recordings", String(process.env.CAPTURE_FIXTURE_ID)),
};

function reqEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env ${name}`);
  return v;
}

const files = {
  packets: path.join(cfg.outDir, "packets.jsonl"),
  heartbeat: path.join(cfg.outDir, "HEARTBEAT.log"),
  captureLog: path.join(cfg.outDir, "CAPTURE_LOG.md"),
  snapshots: path.join(cfg.outDir, "snapshots"),
  result: path.join(cfg.outDir, "result-packet.json"),
};

const iso = (ms = Date.now()) => new Date(ms).toISOString();
const line = (s) => process.stdout.write(`${iso()} ${s}\n`);

async function logCapture(msg) {
  await appendFile(files.captureLog, `- ${iso()} — ${msg}\n`);
  line(msg);
}

// Append-only, byte-faithful: each record carries the raw bytes the feed sent
// (base64) alongside the parsed view, so nothing is lost to re-encoding.
async function appendPacket(kind, parsed, rawBytes) {
  const rec = {
    kind,
    at: iso(),
    fixtureId: String(cfg.fixtureId),
    rawBase64: Buffer.from(rawBytes).toString("base64"),
    parsed,
  };
  await appendFile(files.packets, JSON.stringify(rec) + "\n");
}

async function alert(text) {
  if (!cfg.webhookUrl) return;
  try {
    await fetch(cfg.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: `[BROKER capture ${cfg.label}] ${text}` }),
    });
  } catch (e) {
    line(`webhook failed: ${e.message}`);
  }
}

let lastMessageId = null;
let lastGameState = null;
let lastScoreKey = null;
let lastPollOkMs = Date.now();
let lastFixtureProofMs = 0;
let lastHeartbeatMs = 0;
let alertedSilence = false;
let packetCount = 0;
let session = null;

// Restore dedupe cursor if the supervisor restarted us mid-match, so we resume
// appending instead of re-writing packets already captured.
async function restoreCursor() {
  if (!existsSync(files.packets)) return;
  const lines = (await readFile(files.packets, "utf8")).trim().split("\n").filter(Boolean);
  packetCount = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const rec = JSON.parse(lines[i]);
      if (rec.kind === "odds" && rec.parsed?.packet?.MessageId) {
        lastMessageId = rec.parsed.packet.MessageId;
        break;
      }
    } catch {
      /* skip a partial trailing line from a hard kill; never fabricate it */
    }
  }
  if (lastMessageId) line(`resumed after restart at ${packetCount} packets, cursor ${lastMessageId}`);
}

function scoreKeyOf(fixture) {
  // Score field names vary by feed state; capture whatever numeric score-like
  // fields exist so a goal (score change) triggers a snapshot. Never invent one.
  const s = [fixture.Score, fixture.ScoreHome, fixture.ScoreAway, fixture.Participant1Score, fixture.Participant2Score];
  return s.some((v) => v !== undefined) ? JSON.stringify(s) : null;
}

async function snapshot(reason, fixture, oddsPacket) {
  const name = `${Date.now()}-${reason}.json`;
  await writeFile(
    path.join(files.snapshots, name),
    JSON.stringify({ reason, at: iso(), fixture, odds: oddsPacket ?? null }, null, 2),
  );
  await logCapture(`snapshot (${reason}) written: snapshots/${name}`);
}

async function captureFixtureProof(reason) {
  const fixture = await fetchFixtureSnapshot(session, cfg.fixtureId);
  const { proof, bytes } = await fetchFixtureProof(session, fixture);
  await appendPacket("fixture-proof", { reason, fixture, proof }, bytes);
  packetCount++;
  // The result packet is the latest fixture proof; overwrite so Gate 6 always
  // has the freshest verifiable result artifact.
  await writeFile(
    files.result,
    JSON.stringify({ reason, at: iso(), fixtureId: String(cfg.fixtureId), fixture, proof }, null, 2),
  );
  await logCapture(`fixture proof captured (${reason}); GameState=${fixture.GameState}`);
  return fixture;
}

async function poll() {
  const now = Date.now();
  let fixture = null;

  // 1. Odds: append only genuinely new packets, with their proof.
  const { packet, snapshotBytes } = await fetchLatestFullMatchOdds(session, cfg.fixtureId, now);
  if (packet.MessageId !== lastMessageId) {
    const { proof, bytes } = await fetchOddsProof(session, packet);
    await appendPacket("odds", { packet, proof, snapshotBase64: Buffer.from(snapshotBytes).toString("base64") }, bytes);
    lastMessageId = packet.MessageId;
    packetCount++;
    await logCapture(
      `odds packet ${packet.MessageId} prices=${JSON.stringify(packet.Prices)} age=${Math.round(oddsAge(packet, now) / 1000)}s`,
    );
  }

  // 2. Fixture state: snapshot on GameState change and score change; periodic
  //    fixture proof so a result artifact exists no matter how FT is signalled.
  fixture = await fetchFixtureSnapshot(session, cfg.fixtureId);
  const gs = fixture.GameState;
  const scoreKey = scoreKeyOf(fixture);
  if (gs !== lastGameState) {
    await snapshot(`gamestate-${gs}`, fixture, packet);
    await captureFixtureProof(`gamestate-${gs}`);
    lastGameState = gs;
    lastFixtureProofMs = now;
  } else if (scoreKey !== lastScoreKey && lastScoreKey !== null) {
    await snapshot("goal", fixture, packet);
    lastScoreKey = scoreKey;
  } else if (now - lastFixtureProofMs >= cfg.fixtureProofEverySec * 1000) {
    await captureFixtureProof("periodic");
    lastFixtureProofMs = now;
  }
  if (lastScoreKey === null) lastScoreKey = scoreKey;

  lastPollOkMs = now;
  alertedSilence = false;
  return fixture;
}

async function heartbeat(feedAlive, note = "") {
  const now = Date.now();
  await appendFile(
    files.heartbeat,
    `${iso(now)} packets=${packetCount} lastMsg=${lastMessageId ?? "-"} gameState=${lastGameState ?? "-"} feedAlive=${feedAlive}${note ? " " + note : ""}\n`,
  );
  lastHeartbeatMs = now;
}

async function main() {
  await mkdir(files.snapshots, { recursive: true });
  await logCapture(
    `recorder start; fixture=${cfg.fixtureId} kickoff=${iso(cfg.kickoffMs)} stopAfter=${cfg.stopAfterMin}min poll=${cfg.pollSec}s`,
  );
  await restoreCursor();
  session = await createTxlineSession();

  const stopAtMs = cfg.kickoffMs + cfg.stopAfterMin * 60 * 1000;
  await snapshot("kickoff-window-open", await fetchFixtureSnapshot(session, cfg.fixtureId), null).catch((e) =>
    line(`kickoff snapshot deferred: ${e.message}`),
  );

  while (Date.now() < stopAtMs) {
    const now = Date.now();
    try {
      await poll();
    } catch (e) {
      // Honest resilience: log, mark feed dead, keep polling. Never fabricate.
      line(`poll error: ${e.message}`);
      if (String(e.message).includes("HTTP 401") || String(e.message).includes("authentication")) {
        try {
          session = await createTxlineSession();
          line("re-authenticated");
        } catch (re) {
          line(`re-auth failed: ${re.message}`);
        }
      }
    }

    const silent = Date.now() - lastPollOkMs > cfg.silenceSec * 1000;
    if (silent && !alertedSilence) {
      await alert(`feed silent >${cfg.silenceSec}s (last ok ${iso(lastPollOkMs)})`);
      alertedSilence = true;
    }
    if (Date.now() - lastHeartbeatMs >= cfg.heartbeatSec * 1000) {
      await heartbeat(!silent);
    }
    await sleep(cfg.pollSec * 1000);
  }

  // Final result capture at window close.
  try {
    const fixture = await captureFixtureProof("window-close");
    await snapshot("full-time", fixture, null);
  } catch (e) {
    await logCapture(`window-close result capture failed: ${e.message}`);
    await alert(`window closed but final result capture failed: ${e.message}`);
  }
  await heartbeat(false, "window-closed");
  await logCapture(`recorder stop; total packets=${packetCount}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

main().catch(async (e) => {
  line(`fatal: ${e.message}`);
  await appendFile(files.captureLog, `- ${iso()} — FATAL ${e.message}\n`).catch(() => {});
  process.exit(1); // non-zero so the supervisor restarts us
});
