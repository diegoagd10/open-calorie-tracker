#!/bin/sh
set -eu

ARCHIVE="${1:?Usage: scripts/restore.sh backup.tar.gz}"
DATA_DIR="${DATA_DIR:-./data}"
PARENT_DIR="$(dirname "$DATA_DIR")"
DATA_NAME="$(basename "$DATA_DIR")"

if ! tar -tzf "$ARCHIVE" | while IFS= read -r member; do
  case "$member" in
    "$DATA_NAME"|"$DATA_NAME"/*)
      case "/$member/" in
        */../*) printf '%s\n' "Unsafe archive path: $member" >&2; exit 1 ;;
      esac
      ;;
    *) printf '%s\n' "Archive must contain only $DATA_NAME: $member" >&2; exit 1 ;;
  esac
done
then
  exit 1
fi

if [ -e "$DATA_DIR" ]; then
  mv "$DATA_DIR" "${DATA_DIR}.before-restore-$(date -u +%Y%m%dT%H%M%SZ)"
fi
mkdir -p "$PARENT_DIR"
tar --no-absolute-names -xzf "$ARCHIVE" -C "$PARENT_DIR"
printf '%s\n' "Restore extracted. Start the application and verify GET /health before removing the prior data directory."
