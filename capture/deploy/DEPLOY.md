# Match capture — deploy on the VPS

Two matches remain, then the World Cup is over: **FRA v ENG Sat 18 Jul 21:00 UTC**
(fixture 18257865) and the **ESP v ARG final Sun 19 Jul 19:00 UTC** (fixture
18257739). Both kickoff times and the fixture ids were confirmed from the live
TxLINE `/api/fixtures/snapshot`, not assumed.

The recorder (`capture/recorder.mjs`) is standalone and append-only. It records
every new signed 1X2 odds packet + proof, snapshots on state/score change, pulls
the fixture (result) proof, heartbeats every 60s, and self-stops 180 min after
kickoff (covers 90 + ET + penalties + buffer). It never synthesizes a packet.

## Prerequisites on the VPS

1. Node ≥ 20 and the repo checked out (paths below assume `/opt/broker` — edit
   the unit/env files if different).
2. `npm install` (needs `@surety-tx/txline-verify` from the public registry).
3. The TxLINE token present as either `.secrets/txline-devnet.json`
   (`{"apiToken":"…"}`) or the env var `TXLINE_API_TOKEN`.
4. **Confirm egress**: the VPS must reach `https://txline-dev.txodds.com`. Test:
   `curl -s -o /dev/null -w '%{http_code}\n' -X POST https://txline-dev.txodds.com/auth/guest/start`
   → expect `200`. If it is not on the allowlist, that is a blocker — fix it now,
   not at kickoff.
5. **Confirm the clock is UTC**: `timedatectl` (or `date -u`). The schedules below
   are written in UTC.

## Option A — systemd (preferred: survives reboot, clean logs)

```bash
sudo cp capture/deploy/systemd/broker-capture-*.service /etc/systemd/system/
sudo cp capture/deploy/systemd/broker-capture-*.timer   /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now broker-capture-fra-eng.timer broker-capture-esp-arg.timer

# Eyeball the next fire times — must read 20:50 and 18:50 UTC:
systemctl list-timers 'broker-capture-*' --all
```

## Option B — pm2 (no systemd)

```bash
pm2 start capture/deploy/pm2.config.cjs
pm2 save && pm2 startup     # persist across reboot
pm2 logs broker-capture-fra-eng
```

## Option C — cron (neither)

```bash
crontab capture/deploy/crontab.txt
crontab -l          # confirm the two UTC lines
```

## Prove it fires TODAY (do not trust an untested schedule)

Set a throwaway timer 3 min out and watch it start, record, heartbeat, stop:

```bash
# quick manual dry-run into a throwaway dir (~2 min), proves recording works:
CAPTURE_FIXTURE_ID=18257865 CAPTURE_LABEL=dryrun CAPTURE_KICKOFF_MS=$(date +%s000) \
  CAPTURE_STOP_AFTER_MIN=2 CAPTURE_POLL_SEC=12 CAPTURE_HEARTBEAT_SEC=30 \
  CAPTURE_OUT_DIR=data/recordings/dryrun node capture/recorder.mjs
cat data/recordings/dryrun/HEARTBEAT.log      # packets>0, feedAlive=true
rm -rf data/recordings/dryrun
```

For systemd specifically, prove auto-restart: `systemctl start broker-capture-fra-eng`,
`kill` the node pid, confirm `systemctl status` shows it restarted.

## Check after each match (from anywhere, no live presence needed)

```bash
tail -5  data/recordings/18257865/HEARTBEAT.log   # ran the full window? feedAlive?
cat      data/recordings/18257865/CAPTURE_LOG.md  # start/stop, gaps, proofs
ls -la   data/recordings/18257865/result-packet.json   # settleable result present?
```

Full window + a `result-packet.json` with a proof → proceed to Gate 6 settlement.
Partial capture is still real data — report exactly what exists; never backfill.
