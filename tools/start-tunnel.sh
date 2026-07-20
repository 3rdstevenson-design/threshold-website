#!/bin/bash
# Threshold Dev Server + Cloudflare Tunnel
# Starts the Next.js dev server (if not already running) and exposes it via a
# Cloudflare Quick Tunnel so you can reach the dashboard from your phone or
# work laptop. Prints the tunnel URL and keeps running until Ctrl+C.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
URL_FILE="/tmp/threshold-tunnel-url.txt"
LOG_FILE="/tmp/threshold-tunnel.log"

# ─── Check dependencies ───────────────────────────────────────────────────────

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "Error: cloudflared is not installed." >&2
  echo "Install with: brew install cloudflared" >&2
  exit 1
fi

# ─── Find or start dev server ─────────────────────────────────────────────────

PORT=""
for p in 3000 3001 3002 3003 3004; do
  if curl -sf --max-time 1 "http://localhost:$p/api/queue" -o /dev/null 2>&1; then
    PORT="$p"
    break
  fi
done

if [[ -z "$PORT" ]]; then
  echo "▸ Dev server not running — starting it in the background"
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
    echo "Error: dev server failed to start within 30s" >&2
    echo "Check /tmp/threshold-dev.log" >&2
    exit 1
  fi
fi

echo "▸ Dev server is running on port $PORT"

# ─── Start Cloudflare Quick Tunnel ────────────────────────────────────────────

echo "▸ Starting Cloudflare tunnel…"
: > "$LOG_FILE"
cloudflared tunnel --url "http://localhost:$PORT" --no-autoupdate > "$LOG_FILE" 2>&1 &
TUNNEL_PID=$!

# Ensure the tunnel is killed on exit / Ctrl+C
cleanup() {
  echo ""
  echo "▸ Stopping tunnel (PID $TUNNEL_PID)"
  kill "$TUNNEL_PID" 2>/dev/null || true
  rm -f "$URL_FILE"
}
trap cleanup EXIT INT TERM

# Wait for the URL to appear in cloudflared's log (up to 30s)
TUNNEL_URL=""
for _ in $(seq 1 60); do
  sleep 0.5
  # Quick tunnels always print: https://<random>.trycloudflare.com
  TUNNEL_URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG_FILE" | head -1 || true)
  if [[ -n "$TUNNEL_URL" ]]; then
    break
  fi
done

if [[ -z "$TUNNEL_URL" ]]; then
  echo "Error: tunnel URL never appeared. Check $LOG_FILE" >&2
  exit 1
fi

echo "$TUNNEL_URL" > "$URL_FILE"

cat <<EOF

╭──────────────────────────────────────────────────────────────╮
│  Threshold tunnel is live                                    │
│                                                              │
│  Dashboard:  ${TUNNEL_URL}/dashboard
│  Carousels:  ${TUNNEL_URL}/dashboard/carousels
│                                                              │
│  URL saved to: ${URL_FILE}
│  Tunnel log:   ${LOG_FILE}
│                                                              │
│  Keep this terminal open. Ctrl+C to stop.                   │
╰──────────────────────────────────────────────────────────────╯

EOF

# Keep running until the tunnel exits or we're interrupted
wait "$TUNNEL_PID"
