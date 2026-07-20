#!/usr/bin/env bash
#
# Rebuild the dashboard and restart the always-on launchd service
# (com.threshold.dashboard) onto the fresh build.
#
# SAFE BY DESIGN: the service is only restarted if the build SUCCEEDS, so a
# broken build can never take the live dashboard down — the old build keeps
# serving until the next good build.
#
#   npm run redeploy        (or)   bash scripts/redeploy.sh
#
set -euo pipefail

cd "$(dirname "$0")/.."
LABEL="com.threshold.dashboard"

echo "▸ Building production bundle (→ .next-prod)…"
npm run build:prod

echo "▸ Build OK — restarting $LABEL …"
launchctl kickstart -k "gui/$(id -u)/$LABEL"

# Give next start a moment, then confirm it's serving.
sleep 5
CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 12 http://localhost:3000/dashboard || echo "000")
if [ "$CODE" = "200" ] || [ "$CODE" = "307" ] || [ "$CODE" = "308" ]; then
  echo "✓ Dashboard live at http://localhost:3000 (HTTP $CODE)"
else
  echo "⚠ Dashboard returned HTTP $CODE — check the log:"
  echo "    tail -40 ~/Library/Logs/threshold-dashboard.log"
  exit 1
fi
