#!/bin/bash
# Threshold Auto-Publisher
# Runs every 60s via launchd — finds the active dev server port, then POSTs to /api/publish

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_DIR/.env.local"

# Load CRON_SECRET
if [[ ! -f "$ENV_FILE" ]]; then
  echo "$(date): .env.local not found at $ENV_FILE" >> /tmp/threshold-autopublish.log
  exit 1
fi

CRON_SECRET=$(grep '^CRON_SECRET=' "$ENV_FILE" | cut -d= -f2- | tr -d '"' | tr -d "'")

if [[ -z "$CRON_SECRET" ]]; then
  echo "$(date): CRON_SECRET not set" >> /tmp/threshold-autopublish.log
  exit 1
fi

# Find active dev server port (3000–3004)
PORT=""
for p in 3000 3001 3002 3003 3004; do
  if curl -sf --max-time 1 "http://localhost:$p/api/queue" -o /dev/null 2>&1; then
    PORT="$p"
    break
  fi
done

if [[ -z "$PORT" ]]; then
  echo "$(date): No dev server found on ports 3000-3004" >> /tmp/threshold-autopublish.log
  exit 0
fi

# Step 1: kick off any approved posts (reels get container created; images/carousels publish immediately)
RESULT=$(curl -s -X POST \
  -H "Authorization: Bearer $CRON_SECRET" \
  "http://localhost:$PORT/api/publish" 2>&1)

if echo "$RESULT" | grep -qE '"(published|processing)":[^0]' 2>/dev/null || echo "$RESULT" | grep -q '"errors":\[.' 2>/dev/null; then
  echo "$(date) [port $PORT] publish: $RESULT" >> /tmp/threshold-autopublish.log
fi

# Step 2: finalize any reel containers that Meta has finished processing
RESULT2=$(curl -s -X POST \
  -H "Authorization: Bearer $CRON_SECRET" \
  "http://localhost:$PORT/api/cron/publish-pending-containers" 2>&1)

if echo "$RESULT2" | grep -qE '"finalized":[^0]' 2>/dev/null || echo "$RESULT2" | grep -q '"errors":\[.' 2>/dev/null; then
  echo "$(date) [port $PORT] finalize: $RESULT2" >> /tmp/threshold-autopublish.log
fi
