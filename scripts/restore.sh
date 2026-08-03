#!/bin/sh
set -eu

ARCHIVE="${1:?Usage: scripts/restore.sh backup.tar.gz}"
DATA_DIR="${DATA_DIR:-./data}"

if [ -e "$DATA_DIR" ]; then
  mv "$DATA_DIR" "${DATA_DIR}.before-restore-$(date -u +%Y%m%dT%H%M%SZ)"
fi
mkdir -p "$(dirname "$DATA_DIR")"
tar -xzf "$ARCHIVE" -C "$(dirname "$DATA_DIR")"
printf '%s\n' "Restore extracted. Start the application and verify GET /health before removing the prior data directory."
