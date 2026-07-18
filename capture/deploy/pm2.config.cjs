// pm2 fallback if the VPS has no systemd. Start both now; each recorder idles
// through poll errors and self-stops at kickoff+180min. pm2 gives auto-restart
// on crash and survives reboot via `pm2 startup` + `pm2 save`.
//
//   pm2 start capture/deploy/pm2.config.cjs
//   pm2 save && pm2 startup   # persist across reboot
//   pm2 logs broker-capture-fra-eng
//
// Note: pm2 starts these immediately (no schedule). The recorder is cheap
// pre-match (one poll per CAPTURE_POLL_SEC) and records the full window, so
// starting early is safe; it just heartbeats until packets flow.
module.exports = {
  apps: [
    {
      name: "broker-capture-fra-eng",
      script: "capture/recorder.mjs",
      cwd: __dirname + "/../..",
      env: require("fs")
        .readFileSync(__dirname + "/env/fra-eng.env", "utf8")
        .split("\n")
        .filter((l) => l && !l.startsWith("#") && l.includes("="))
        .reduce((acc, l) => {
          const i = l.indexOf("=");
          acc[l.slice(0, i).trim()] = l.slice(i + 1).trim();
          return acc;
        }, {}),
      autorestart: true,
      max_restarts: 50,
    },
    {
      name: "broker-capture-esp-arg",
      script: "capture/recorder.mjs",
      cwd: __dirname + "/../..",
      env: require("fs")
        .readFileSync(__dirname + "/env/esp-arg.env", "utf8")
        .split("\n")
        .filter((l) => l && !l.startsWith("#") && l.includes("="))
        .reduce((acc, l) => {
          const i = l.indexOf("=");
          acc[l.slice(0, i).trim()] = l.slice(i + 1).trim();
          return acc;
        }, {}),
      autorestart: true,
      max_restarts: 50,
    },
  ],
};
