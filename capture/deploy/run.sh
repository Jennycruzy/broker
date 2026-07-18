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

exec node capture/recorder.mjs
