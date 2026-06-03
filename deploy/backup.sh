#!/bin/bash
# ============================================================
# Signacare EMR — Automated PostgreSQL Backup
# ============================================================
#
# Creates compressed backups with rotation policy.
#
# Usage:
#   Manual:   ./deploy/backup.sh
#   Cron:     0 2 * * * /path/to/deploy/backup.sh >> /var/log/signacare-backup.log 2>&1
#   (Runs at 2:00 AM daily)
#
# Restore:
#   gunzip -c backup_file.sql.gz | psql -U signacare_owner signacaredb
#
# Reliability notes (fixed 2026-04-15 after an 18-day silent failure
# was found in the installer-generated sibling script at
# ~/nous-emr/backup.sh):
#
#   * set -euo pipefail ensures any failure in the pg_dump|gzip
#     pipeline aborts the script with a non-zero exit. Before this,
#     a bug in the sibling installer script used `if [ $? -eq 0 ]`
#     AFTER the pipeline, which only checks gzip's exit code (the
#     last command in a pipeline), so pg_dump could crash with
#     "role does not exist" and gzip would still succeed writing
#     an empty 20-byte gzip header, and the log would happily say
#     "Backup complete".
#
#   * pg_dump stderr is redirected to the backup log (not /dev/null)
#     so when pg_dump crashes, the error message is captured and
#     loud — not silently dropped.
#
#   * PATH is explicitly exported so the script works the same way
#     under cron / LaunchAgent / systemd (where the inherited PATH
#     may not include the Postgres binaries) as it does in an
#     interactive shell. The keg suffix must match whichever
#     server version is running — update this on server version
#     upgrade.
#
# ============================================================

set -euo pipefail

# ── PATH — work reliably under cron / LaunchAgent / systemd ─────────────────
# Pick the Postgres version matching the running server. On macOS/Homebrew
# this is typically /opt/homebrew/opt/postgresql@17/bin. On Linux servers
# the packages live in /usr/lib/postgresql/<ver>/bin or /usr/bin.
export PATH="/opt/homebrew/opt/postgresql@17/bin:/usr/lib/postgresql/17/bin:/usr/lib/postgresql/16/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

# ── Configuration ──
DB_NAME="${DB_NAME:-signacaredb}"
DB_USER="${DB_USER:-signacare_owner}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/signacare}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/signacare_${DB_NAME}_${TIMESTAMP}.sql.gz"
PG_DUMP_LOG="${BACKUP_DIR}/pg_dump.err.log"

# S3 backup (optional)
S3_BUCKET="${S3_BACKUP_BUCKET:-}"
S3_PREFIX="${S3_BACKUP_PREFIX:-signacare-backups}"

echo "============================================"
echo "  Signacare EMR Backup — $(date)"
echo "============================================"

# ── Create backup directory ──
mkdir -p "$BACKUP_DIR"

# ── Run pg_dump ──
echo "Backing up ${DB_NAME}@${DB_HOST}:${DB_PORT}..."

PGPASSWORD="${DB_PASSWORD:-}" pg_dump \
  -h "$DB_HOST" \
  -p "$DB_PORT" \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  --format=plain \
  --no-owner \
  --no-privileges \
  --verbose \
  2>>"$PG_DUMP_LOG" | gzip > "$BACKUP_FILE"

BACKUP_SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
echo "  Backup saved: $BACKUP_FILE ($BACKUP_SIZE)"

# ── Verify backup ──
if gunzip -t "$BACKUP_FILE" 2>/dev/null; then
  echo "  Integrity check: PASSED"
else
  echo "  ERROR: Backup file corrupted!"
  exit 1
fi

# ── Upload to S3 (if configured) ──
if [ -n "$S3_BUCKET" ]; then
  echo "Uploading to S3: s3://${S3_BUCKET}/${S3_PREFIX}/..."
  aws s3 cp "$BACKUP_FILE" "s3://${S3_BUCKET}/${S3_PREFIX}/$(basename "$BACKUP_FILE")" \
    --storage-class STANDARD_IA \
    --quiet
  echo "  S3 upload complete"
fi

# ── Clean old backups ──
echo "Cleaning backups older than ${RETENTION_DAYS} days..."
DELETED=$(find "$BACKUP_DIR" -name "signacare_*.sql.gz" -mtime +${RETENTION_DAYS} -delete -print | wc -l)
echo "  Deleted: ${DELETED} old backups"

# ── Summary ──
TOTAL_BACKUPS=$(find "$BACKUP_DIR" -name "signacare_*.sql.gz" | wc -l)
TOTAL_SIZE=$(du -sh "$BACKUP_DIR" 2>/dev/null | cut -f1)
echo ""
echo "  Total backups: ${TOTAL_BACKUPS} (${TOTAL_SIZE})"
echo "  Latest: $(basename "$BACKUP_FILE")"
echo "============================================"
echo "  Backup complete — $(date)"
echo "============================================"
