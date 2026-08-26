#!/bin/sh
# Snapshot every company to a place the container cannot reach.
#
#   docker/backup.sh [destination]
#
# Run from the HOST, never from inside the factory. The point is that agents
# have a shell and write access to /data — so a copy they can also reach is
# not a backup, it is a second thing to lose. The destination is deliberately
# not mounted into any container.
#
# Nothing here needs Docker: the data directory is a bind mount, so it is
# ordinary files on your disk whether the container is running or not.
set -eu

DATA="${RIFF_DATA:-$HOME/.riff}"
DEST="${1:-$HOME/riff-backups}"
STAMP=$(date +%Y-%m-%dT%H-%M-%S)

[ -d "$DATA" ] || { echo "No data directory at $DATA" >&2; exit 1; }

mkdir -p "$DEST"
OUT="$DEST/riff-$STAMP.tar.gz"

# Each world is a git repository, so the history is inside the tarball too —
# a backup you can `git log` is worth more than a pile of current files.
tar -czf "$OUT" -C "$(dirname "$DATA")" "$(basename "$DATA")"

SIZE=$(du -h "$OUT" | cut -f1)
COUNT=$(find "$DATA/companies" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
echo "  $COUNT compan$([ "$COUNT" = 1 ] && echo y || echo ies) → $OUT ($SIZE)"

# Keep the last 30. Old enough to cover a bad week, few enough to stay small.
ls -1t "$DEST"/riff-*.tar.gz 2>/dev/null | tail -n +31 | while read -r old; do
  rm -f "$old"
  echo "  pruned $(basename "$old")"
done
