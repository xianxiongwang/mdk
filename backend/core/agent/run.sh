#!/usr/bin/env bash
# Run the MDK agent CLI with the native Linux node (the deps were installed with it,
# so we must NOT use the fnm/Windows node that the login shell puts on PATH).
# Set MDK_NODE to point at a different node binary.
#
#   ./run.sh                       # default: qwen3-600m over http://127.0.0.1:11500/v1
#   ./run.sh --model qwen3-4b      # use the 4B once it's downloaded
#   ./run.sh --base-url http://127.0.0.1:11500/v1
#   MDK_NODE=$(which node) ./run.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "${MDK_NODE:-/usr/bin/node}" "$HERE/bin/mdk-agent.js" "$@"
