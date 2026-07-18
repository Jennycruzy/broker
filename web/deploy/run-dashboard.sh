#!/usr/bin/env bash
# Runs the BROKER demo dashboard from the repo root so relative paths
# (bridge/, server/, web/public/, .secrets/) resolve. Supervisor-agnostic.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

# Same runtime rule as the capture recorder: @surety-tx/txline-verify's named
# imports of @anchor-lang/core only resolve under Node's newer CJS export
# detection. Prefer a repo-local runtime if provisioned; else system node.
NODE_BIN="node"
if [ -x "$REPO_ROOT/.runtime/bin/node" ]; then
  NODE_BIN="$REPO_ROOT/.runtime/bin/node"
fi

export PORT="${PORT:-8787}"
exec "$NODE_BIN" web/server.mjs
