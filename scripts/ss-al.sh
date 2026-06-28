#!/usr/bin/env bash
set -euo pipefail

OUT_DIR="/Users/oktaykzlky/Documents/Codex/eary-screenshots"
LATEST="$OUT_DIR/eary-latest.png"
STAMPED="$OUT_DIR/eary-$(date +%Y%m%d-%H%M%S).png"

mkdir -p "$OUT_DIR"

DEVICE_ID="${1:-}"
if [[ -z "$DEVICE_ID" ]]; then
  DEVICE_ID="$(xcrun simctl list devices booted | awk -F '[()]' '/Booted/ { print $2; exit }')"
fi

if [[ -z "$DEVICE_ID" ]]; then
  echo "Acik simulator bulunamadi. Once simulatoru ac." >&2
  exit 1
fi

xcrun simctl io "$DEVICE_ID" screenshot "$LATEST" >/dev/null
cp "$LATEST" "$STAMPED"

echo "$LATEST"
echo "$STAMPED"
