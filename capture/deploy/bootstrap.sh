#!/usr/bin/env bash
# One-shot VPS deploy for BROKER match capture. Idempotent; safe to re-run.
# Touches ONLY /opt/broker and broker-* systemd units — nothing else on the box.
#
# Usage (on the VPS, as root):
#   export TXLINE_API_TOKEN='...'          # required if .secrets not already present
#   curl -fsSL https://raw.githubusercontent.com/Jennycruzy/broker/main/capture/deploy/bootstrap.sh | bash
# or, once checked out:
#   TXLINE_API_TOKEN='...' bash capture/deploy/bootstrap.sh
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/Jennycruzy/broker}"
REPO_DIR="${REPO_DIR:-/opt/broker}"
FIXTURES=(18257865 18257739)

say() { printf '\n=== %s ===\n' "$*"; }

say "1. checkout $REPO_DIR"
if [ -d "$REPO_DIR/.git" ]; then
  git -C "$REPO_DIR" fetch --quiet origin main
  git -C "$REPO_DIR" reset --hard origin/main
else
  git clone --quiet "$REPO_URL" "$REPO_DIR"
fi
cd "$REPO_DIR"
git --no-pager log --oneline -1

say "2. node / npm"
node --version
npm --version
npm install --no-audit --no-fund

say "3. TxLINE token"
mkdir -p "$REPO_DIR/.secrets"
if [ -f "$REPO_DIR/.secrets/txline-devnet.json" ]; then
  echo "token file already present"
elif [ -n "${TXLINE_API_TOKEN:-}" ]; then
  printf '{"apiToken":"%s"}\n' "$TXLINE_API_TOKEN" > "$REPO_DIR/.secrets/txline-devnet.json"
  chmod 600 "$REPO_DIR/.secrets/txline-devnet.json"
  echo "token written to .secrets/txline-devnet.json"
else
  echo "!! no token: set TXLINE_API_TOKEN or place .secrets/txline-devnet.json, then re-run"
  exit 1
fi

say "4. egress + UTC clock check"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST https://txline-dev.txodds.com/auth/guest/start --max-time 15 || echo 000)
echo "txline guest-auth HTTP $code (want 200)"
[ "$code" = "200" ] || { echo "!! feed host not reachable from this box — fix egress/allowlist"; exit 1; }
date -u
(timedatectl 2>/dev/null | grep -i 'time zone') || true

say "5. output dirs"
for f in "${FIXTURES[@]}"; do mkdir -p "$REPO_DIR/data/recordings/$f/snapshots"; done

say "6. schedule"
if systemctl is-system-running >/dev/null 2>&1 || [ -d /run/systemd/system ]; then
  # systemd path. Units already point at /opt/broker; rewrite if REPO_DIR differs.
  tmp=$(mktemp -d)
  for u in capture/deploy/systemd/broker-capture-*.service capture/deploy/systemd/broker-capture-*.timer; do
    sed "s#/opt/broker#${REPO_DIR}#g" "$u" > "$tmp/$(basename "$u")"
  done
  cp "$tmp"/broker-capture-*.service "$tmp"/broker-capture-*.timer /etc/systemd/system/
  rm -rf "$tmp"
  systemctl daemon-reload
  systemctl enable --now broker-capture-fra-eng.timer broker-capture-esp-arg.timer
  echo "--- next fire times (want 2026-07-18 20:50 UTC and 2026-07-19 18:50 UTC) ---"
  systemctl list-timers 'broker-capture-*' --all --no-pager
elif command -v pm2 >/dev/null 2>&1; then
  echo "no systemd; using pm2"
  pm2 start capture/deploy/pm2.config.cjs
  pm2 save
  pm2 startup | tail -1
  pm2 ls
else
  echo "no systemd, no pm2 — installing cron fallback"
  ( crontab -l 2>/dev/null | grep -v 'capture/deploy/run.sh'; \
    echo "50 20 18 7 * cd $REPO_DIR && capture/deploy/run.sh capture/deploy/env/fra-eng.env >> data/recordings/18257865/cron.log 2>&1"; \
    echo "50 18 19 7 * cd $REPO_DIR && capture/deploy/run.sh capture/deploy/env/esp-arg.env >> data/recordings/18257739/cron.log 2>&1" \
  ) | crontab -
  crontab -l | grep run.sh
fi

say "DONE"
echo "Verify next-fire times above read 20:50 and 18:50 UTC."
echo "After each match: tail data/recordings/<fixture>/HEARTBEAT.log and check result-packet.json"
