#!/bin/sh
set -eu

DATA_DIR="${DATA_DIR:-./data}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"

if [ "${CALORIES_STOPPED:-}" != "1" ]; then
  printf '%s\n' "Stop Calories first, then rerun with CALORIES_STOPPED=1." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
tar -czf "$BACKUP_DIR/calories-$(date -u +%Y%m%dT%H%M%SZ).tar.gz" -C "$(dirname "$DATA_DIR")" "$(basename "$DATA_DIR")"
