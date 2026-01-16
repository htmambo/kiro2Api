#!/usr/bin/env bash
set -euo pipefail

CMD="node --max-old-space-size=120 src/api/server.js"

if [ -f /tmp/nodemon-restart-flag ]; then
  CMD="$CMD --disableopenserverurl"
  rm -f /tmp/nodemon-restart-flag
fi

exec $CMD
