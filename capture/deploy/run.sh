#!/usr/bin/env bash
# Loads a match env file and runs the recorder from the repo root so relative
# paths (data/recordings, bridge/, .secrets/) resolve. Supervisor-agnostic:
# called by systemd, pm2, or cron alike.
set -euo pipefail

ENV_FILE="${1:?usage: run.sh <env-file>  (e.g. capture/deploy/env/fra-eng.env)}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

# @surety-tx/txline-verify's named imports of @anchor-lang/core (a CJS build with
# no exports map) only resolve under Node's newer CJS export detection. Prefer a
# repo-local runtime if one is provisioned; fall back to the system node.
NODE_BIN="node"
if [ -x "$REPO_ROOT/.runtime/bin/node" ]; then
  NODE_BIN="$REPO_ROOT/.runtime/bin/node"
fi

exec "$NODE_BIN" capture/recorder.mjs
