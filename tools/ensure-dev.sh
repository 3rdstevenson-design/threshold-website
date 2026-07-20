#!/bin/bash
# Starts the Next.js dev server if it's not already running.
# Tries ports 3000–3004 and returns whichever is active.

PROJECT="$HOME/Code/Development/threshold-dashboard"
PORTS=(3000 3001 3002 3003 3004)

for port in "${PORTS[@]}"; do
  if curl -s -o /dev/null "http://localhost:$port/api/queue"; then
    echo $port
    exit 0
  fi
done

# Not running — start it in the background
cd "$PROJECT" && npm run dev > /tmp/threshold-dev.log 2>&1 &
echo "Starting dev server..." >&2

# Wait up to 15s for it to come up
for i in {1..15}; do
  sleep 1
  for port in "${PORTS[@]}"; do
    if curl -s -o /dev/null "http://localhost:$port/api/queue"; then
      echo $port
      exit 0
    fi
  done
done

echo "ERROR: Dev server failed to start. Check /tmp/threshold-dev.log" >&2
exit 1
