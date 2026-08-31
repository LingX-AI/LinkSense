#!/bin/sh

set -eu

umask 077

: "${PGHOST:?PGHOST is required}"
: "${PGDATABASE:?PGDATABASE is required}"
: "${PGUSER:?PGUSER is required}"
: "${PGPASSWORD:?PGPASSWORD is required}"

backup_interval="${LINKSENSE_POSTGRES_BACKUP_INTERVAL_SECONDS:-86400}"
retention_days="${LINKSENSE_POSTGRES_BACKUP_RETENTION_DAYS:-14}"

case "$backup_interval" in
  *[!0-9]* | "")
    echo "LINKSENSE_POSTGRES_BACKUP_INTERVAL_SECONDS must be a positive integer" >&2
    exit 1
    ;;
esac
case "$retention_days" in
  *[!0-9]* | "")
    echo "LINKSENSE_POSTGRES_BACKUP_RETENTION_DAYS must be a positive integer" >&2
    exit 1
    ;;
esac
if [ "$backup_interval" -lt 60 ] || [ "$retention_days" -lt 1 ]; then
  echo "backup interval must be at least 60 seconds and retention at least one day" >&2
  exit 1
fi

partial_path=""
cleanup() {
  if [ -n "$partial_path" ]; then
    rm -f "$partial_path"
  fi
  exit 143
}
trap cleanup INT TERM

backup_directory="/backups/postgres"
mkdir -p "$backup_directory"

while :; do
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  final_path="${backup_directory}/${PGDATABASE}-${timestamp}.dump"
  partial_path="${final_path}.partial"

  pg_dump \
    --format=custom \
    --compress=6 \
    --no-owner \
    --no-privileges \
    --file="$partial_path"
  pg_restore --list "$partial_path" >/dev/null
  mv "$partial_path" "$final_path"
  partial_path=""

  status_path="${backup_directory}/.last-success.tmp"
  date -u +%Y-%m-%dT%H:%M:%SZ >"$status_path"
  mv "$status_path" "${backup_directory}/.last-success"
  find "$backup_directory" -type f -name '*.dump' -mtime "+${retention_days}" -delete
  echo "PostgreSQL backup completed: $(basename "$final_path")"

  sleep "$backup_interval" &
  wait "$!"
done
