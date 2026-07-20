#!/bin/bash
# Threshold Carousel Draft Generator — weekly cron
# Runs Sunday 08:00 CT via launchd. Starts the dev server if it isn't running,
# then POSTs to /api/carousels/generate which drafts carousels from the top
# outlier posts of the last 7 days.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_DIR/.env.local"
LOG_FILE="/tmp/threshold-carousel-drafts.log"

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG_FILE"
}

if [[ ! -f "$ENV_FILE" ]]; then
  log "ERROR: .env.local not found at $ENV_FILE"
  exit 1
fi

CRON_SECRET=$(grep '^CRON_SECRET=' "$ENV_FILE" | cut -d= -f2- | tr -d '"' | tr -d "'")
if [[ -z "$CRON_SECRET" ]]; then
  log "ERROR: CRON_SECRET not set in .env.local"
  exit 1
fi

# Find an active dev server port; start one if none are running
PORT=""
for p in 3000 3001 3002 3003 3004; do
  if curl -sf --max-time 1 "http://localhost:$p/api/queue" -o /dev/null 2>&1; then
    PORT="$p"
    break
  fi
done

if [[ -z "$PORT" ]]; then
  log "Dev server not running — starting it"
  cd "$PROJECT_DIR"
  nohup npm run dev > /tmp/threshold-dev.log 2>&1 &
  # Wait up to 30s for boot
  for _ in $(seq 1 30); do
    sleep 1
    for p in 3000 3001 3002 3003 3004; do
      if curl -sf --max-time 1 "http://localhost:$p/api/queue" -o /dev/null 2>&1; then
        PORT="$p"
        break 2
      fi
    done
  done
  if [[ -z "$PORT" ]]; then
    log "ERROR: dev server failed to start within 30s"
    exit 1
  fi
  log "Dev server up on port $PORT"
fi

log "Triggering carousel draft generation on port $PORT"
RESULT=$(curl -s -X POST \
  -H "Authorization: Bearer $CRON_SECRET" \
  "http://localhost:$PORT/api/carousels/generate?count=3&days=7" 2>&1)

log "Response: $RESULT"
