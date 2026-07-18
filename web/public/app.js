// BROKER dashboard client — polls /api/live and renders the match board.
// Pure rendering; every value shown comes from the server's live feed payload.

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
  if (f.gameState >= 3) return `<span class="state ft">FULL TIME</span>`;
  if (f.live) return `<span class="state live">● LIVE</span>`;
  // Kickoff has passed and fresh signed odds are still arriving. The feed does not
  // publish an in-play score, so we assert the odds are live — not the scoreline.
  if (f.oddsLive) return `<span class="state oddslive" title="Match kicked off — showing live signed odds. The feed does not publish an in-play score.">● LIVE ODDS</span>`;
  return `<span class="state pre">UPCOMING</span>`;
}

function matchCard(f) {
  if (f.error) {
    return `<div class="card"><div class="card-head"><span class="comp">World Cup 2026</span></div>
      <div class="teams"><div class="team"><span class="flag">${f.homeFlag}</span>${esc(f.home)}</div>
      <div class="team away"><span class="flag">${f.awayFlag}</span>${esc(f.away)}</div></div>
      <div class="card-error">feed unavailable — ${esc(f.error)}</div></div>`;
  }
  const p = f.probs, o = f.odds;
  const scoreHtml = f.score
    ? `<div class="score">${f.score.home}<span class="v"> : </span>${f.score.away}</div>`
    : `<div class="score" style="opacity:.35">–<span class="v"> : </span>–</div>`;
  const quoteHtml = f.quote
    ? `<div class="quote">
        <div class="q-l"><b>BROKER quote · ${esc(f.home)} win</b><br>cover <b>${fmtUsdc(f.quote.coverageUsdc)} USDC</b> · priced live from signed odds @ ${fmtPct(f.quote.probabilityPpm)}</div>
        <div class="prem"><div class="big">${fmt6(f.quote.premiumUsdc)}</div><div class="sub">USDC PREMIUM · via x402</div></div>
      </div>`
    : `<div class="quote"><div class="q-l">quote unavailable at current book</div></div>`;

  return `<div class="card">
    <div class="card-head"><span class="comp">World Cup 2026 · Fixture ${f.id}</span>${stateChip(f)}</div>
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
    <div class="proof">
      <span class="msg">signed packet ${esc(f.packetMsg)}</span>
      <span class="fresh">● live · ${f.ageSec}s old</span>
    </div>
  </div>`;
}

function policyPanel(p) {
  return `<div class="pcard">
    <div class="p-top">
      <h3>Live policy bound on-chain &nbsp;<small>SURETY vault · Solana devnet</small></h3>
      <span class="badge-open"><span class="dot"></span>${p.status.toUpperCase()}</span>
    </div>
    <div class="stats">
      <div class="stat"><div class="k">Fixture</div><div class="v" style="font-size:15px">${esc(p.fixture)}</div></div>
      <div class="stat"><div class="k">Coverage</div><div class="v">${fmtUsdc(p.coverageUsdc)}</div></div>
      <div class="stat"><div class="k">Premium (x402)</div><div class="v">${fmt6(p.premiumUsdc)}</div></div>
      <div class="stat"><div class="k">Priced at</div><div class="v">${fmtPct(p.probabilityPpm)}</div></div>
    </div>
    <div class="plinks">
      <a href="${p.links.policy}" target="_blank" rel="noopener">Policy account</a>
      <a href="${p.links.issueTx}" target="_blank" rel="noopener">issue_policy tx</a>
      <a href="${p.links.x402Tx}" target="_blank" rel="noopener">x402 payment</a>
      <a href="${p.links.cctpMint}" target="_blank" rel="noopener">CCTP mint</a>
    </div>
  </div>`;
}

async function tick() {
  const pill = document.getElementById("feedPill");
  const pillTxt = document.getElementById("feedTxt");
  try {
    const r = await fetch("/api/live", { cache: "no-store" });
    const data = await r.json();
    document.getElementById("matches").innerHTML = data.fixtures.map(matchCard).join("");
    document.getElementById("policy").innerHTML = policyPanel(data.policy);
    const ok = data.fixtures.some((f) => !f.error);
    pill.className = "live-pill " + (ok ? "on" : "off");
    pillTxt.textContent = ok ? "live feed" : "feed down";
    document.getElementById("asOf").textContent = "updated " + new Date(data.asOf).toLocaleTimeString([], { hour12: false });
  } catch (e) {
    pill.className = "live-pill off";
    pillTxt.textContent = "feed down";
  }
}

tick();
setInterval(tick, 15000);
