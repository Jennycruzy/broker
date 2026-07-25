// BROKER dashboard client — polls /api/live and renders the match board.
// Pure rendering: every value shown comes from the server payload, which is
// itself live feed, re-verified signed recording, or on-chain state. Where the
// server marks data as replayed or unbindable, the card says so — the client
// never smooths that over.

const fmtPct = (ppm) => (ppm / 10000).toFixed(1) + "%";
const fmtUsdc = (n) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
const fmt6 = (n) => Number(n).toFixed(6); // USDC has 6 decimals — show them all, uniformly
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

function kickoffLabel(f) {
  const d = new Date(f.startTime);
  const t = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  const day = d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  return `${day} · ${t} UTC`;
}

function stateChip(f) {
  if (f.state === "FULL_TIME") return `<span class="state ft" title="Full-time result proved by a TxLINE Merkle proof (seq ${esc(f.result.seq)}).">FULL TIME</span>`;
  // Kickoff has passed and fresh signed odds are still arriving. The feed does not
  // publish an in-play score, so we assert the odds are live — not the scoreline.
  if (f.state === "LIVE_ODDS") return `<span class="state oddslive" title="Match kicked off — showing live signed odds. The feed does not publish an in-play score.">● LIVE ODDS</span>`;
  if (f.state === "IN_PLAY") return `<span class="state live">● IN PLAY</span>`;
  return `<span class="state pre">UPCOMING</span>`;
}

// The provenance line. This is the honesty surface of the whole board: it names
// the source, and for replay it names the limitation rather than hiding it.
function sourceNote(f) {
  if (f.source === "live") {
    return `<span class="fresh">● live feed · signed packet ${f.ageSec}s old${f.bindable ? " · bindable" : " · outside the 15-min bind window"}</span>`;
  }
  const when = new Date(f.recordedAt).toLocaleString([], { timeZone: "UTC" });
  return `<span class="fresh replay" title="The live dev feed serves a moving window of upcoming fixtures; this played match has aged out of it. These are the exact signed packets captured during the match — the proof re-verifies against the packet on every request. Too old to bind a new policy: SURETY enforces a 15-minute odds freshness window on-chain.">◆ replay · closing book recorded ${esc(when)} UTC · not bindable</span>`;
}

function matchCard(f) {
  if (f.error) {
    return `<div class="card"><div class="card-head"><span class="comp">World Cup 2026 · Fixture ${esc(f.id)}</span></div>
      <div class="teams"><div class="team"><span class="flag">${f.homeFlag}</span>—</div>
      <div class="team away"><span class="flag">${f.awayFlag}</span>—</div></div>
      <div class="card-error">no source available — ${esc(f.error)}</div></div>`;
  }
  const p = f.probs, o = f.odds;

  // Only a Merkle-proved full-time result puts a score on the board.
  const scoreHtml = f.result
    ? `<div class="score">${f.result.home}<span class="v"> : </span>${f.result.away}</div>`
    : `<div class="score" style="opacity:.35">–<span class="v"> : </span>–</div>`;

  const quoteHtml = f.quote && !f.quote.unavailable
    ? `<div class="quote${f.bindable ? "" : " stale"}">
        <div class="q-l"><b>BROKER coverage quote · ${esc(f.home)} win</b><br>cover <b>${fmtUsdc(f.quote.coverageUsdc)} USDC</b> · TxLINE probability ${fmtPct(f.quote.probabilityPpm)} · underwriter ${(f.quote.utilizationBps / 100).toFixed(1)}% utilised</div>
        <div class="prem"><div class="big">${fmt6(f.quote.premiumUsdc)}</div><div class="sub">USDC PREMIUM · ${f.bindable ? "via x402" : "indicative"}</div></div>
      </div>`
    : `<div class="quote"><div class="q-l">quote unavailable — ${esc(f.quote?.unavailable ?? "no vault state")}</div></div>`;

  const settledHtml = f.result
    ? `<div class="settled">Proved outcome <b>${esc(f.result.outcome)}</b> — TxLINE scores seq ${esc(f.result.seq)}, verified against the on-chain daily scores root.</div>`
    : "";

  return `<div class="card">
    <div class="card-head"><span class="comp">${esc(f.competition ?? "World Cup 2026")} · Fixture ${esc(f.id)}</span>${stateChip(f)}</div>
    <div class="teams">
      <div class="team"><span class="flag">${f.homeFlag}</span>${esc(f.home)}</div>
      ${scoreHtml}
      <div class="team away"><span class="flag">${f.awayFlag}</span>${esc(f.away)}</div>
    </div>
    <div class="kickoff">${kickoffLabel(f)}</div>

    <div class="meter-label"><span>Implied result probability (1X2)</span><span>de-vigged</span></div>
    <div class="meter">
      <div class="seg home" style="flex-basis:${p.home / 10000}%">${p.home / 10000 > 9 ? fmtPct(p.home) : ""}</div>
      <div class="seg draw" style="flex-basis:${p.draw / 10000}%">${p.draw / 10000 > 9 ? fmtPct(p.draw) : ""}</div>
      <div class="seg away" style="flex-basis:${p.away / 10000}%">${p.away / 10000 > 9 ? fmtPct(p.away) : ""}</div>
    </div>
    <div class="legend">
      <span class="item"><span class="sw home"></span>${esc(f.home)} <span class="odd">${o.home ?? "–"}</span></span>
      <span class="item"><span class="sw draw"></span>Draw <span class="odd">${o.draw ?? "–"}</span></span>
      <span class="item"><span class="sw away"></span>${esc(f.away)} <span class="odd">${o.away ?? "–"}</span></span>
    </div>

    ${quoteHtml}
    ${settledHtml}
    <div class="proof">
      <span class="msg">signed packet ${esc(f.packetMsg)}</span>
      ${sourceNote(f)}
    </div>
  </div>`;
}

// Status drives the badge colour, so a settled policy stops rendering as Open.
const STATUS_CLASS = { Open: "badge-open", Triggered: "badge-triggered", Expired: "badge-expired" };

function policyPanel(p, vault) {
  const escrowLine = p.escrowUsdc === null
    ? `<div class="stat"><div class="k">Escrow</div><div class="v" style="font-size:15px">closed</div></div>`
    : `<div class="stat"><div class="k">Locked in escrow</div><div class="v">${fmtUsdc(p.escrowUsdc)}</div></div>`;

  const vaultLine = vault
    ? `<div class="vaultline"><span class="infra-label">UNDERWRITING INFRASTRUCTURE · SURETY</span><br>Vault ${esc(vault.address.slice(0, 8))}… · capital <b>${fmtUsdc(vault.totalCapitalUsdc)}</b> USDC · free <b>${fmtUsdc(vault.freeReservesUsdc)}</b> · locked <b>${fmtUsdc(vault.lockedLiabilitiesUsdc)}</b> · ${vault.policyCount} ${vault.policyCount === 1 ? "policy" : "policies"} written</div>`
    : "";

  return `<div class="pcard">
    <div class="p-top">
      <h3>BROKER policy receipt &nbsp;<small>enforced by SURETY · read from Solana devnet</small></h3>
      <span class="${STATUS_CLASS[p.status] ?? "badge-open"}"><span class="dot"></span>${esc(p.status.toUpperCase())}</span>
    </div>
    <div class="stats">
      <div class="stat"><div class="k">Fixture</div><div class="v" style="font-size:15px">${esc(p.fixture)}</div></div>
      <div class="stat"><div class="k">Coverage</div><div class="v">${fmtUsdc(p.coverageUsdc)}</div></div>
      <div class="stat"><div class="k">Premium (x402)</div><div class="v">${fmt6(p.premiumUsdc)}</div></div>
      ${escrowLine}
    </div>
    ${vaultLine}
    <div class="plinks">
      <a href="${p.links.x402Tx}" target="_blank" rel="noopener">BROKER x402 payment</a>
      <a href="${p.links.cctpMint}" target="_blank" rel="noopener">BROKER CCTP route</a>
      <a href="${p.links.issueTx}" target="_blank" rel="noopener">SURETY issuance tx</a>
      <a href="${p.links.policy}" target="_blank" rel="noopener">On-chain policy</a>
    </div>
  </div>`;
}

function policyError(message) {
  return `<div class="pcard"><div class="card-error">on-chain state unavailable — ${esc(message)}</div></div>`;
}

// The feed pill reports what is actually serving. "replay" is a distinct state
// from "feed down": the board is showing real signed data, just not fresh data.
function feedState(fixtures) {
  if (fixtures.some((f) => f.source === "live")) return ["on", "live feed"];
  if (fixtures.some((f) => f.source === "replay")) return ["replay", "replay — matches played"];
  return ["off", "feed down"];
}

async function tick() {
  const pill = document.getElementById("feedPill");
  const pillTxt = document.getElementById("feedTxt");
  try {
    const r = await fetch("/api/live", { cache: "no-store" });
    const data = await r.json();
    document.getElementById("matches").innerHTML = data.fixtures.map(matchCard).join("");
    document.getElementById("policy").innerHTML = data.policy
      ? policyPanel(data.policy, data.vault)
      : policyError(data.onchainError ?? "unknown error");
    const [cls, txt] = feedState(data.fixtures);
    pill.className = "live-pill " + cls;
    pillTxt.textContent = txt;
    document.getElementById("asOf").textContent = "updated " + new Date(data.asOf).toLocaleTimeString([], { hour12: false });
  } catch (e) {
    pill.className = "live-pill off";
    pillTxt.textContent = "dashboard unreachable";
  }
}

tick();
setInterval(tick, 15000);
