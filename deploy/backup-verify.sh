#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# Signacare EMR — Automated Backup Verification
#
# Runs weekly via cron. Creates a backup, restores to a test database,
# verifies data integrity, then cleans up.
#
# Cron: 0 3 * * 0  /path/to/backup-verify.sh  (Sunday 3am)
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

DB_NAME="${DB_NAME:-signacaredb}"
DB_USER="${DB_USER:-signacare_owner}"
DB_HOST="${DB_HOST:-localhost}"
VERIFY_DB="${DB_NAME}_verify_$(date +%Y%m%d)"
BACKUP_DIR="${BACKUP_DIR:-$HOME/signacare/backups}"
LOG_FILE="$BACKUP_DIR/verify_$(date +%Y%m%d).log"

mkdir -p "$BACKUP_DIR"

log() { echo "[$(date +%H:%M:%S)] $1" | tee -a "$LOG_FILE"; }

log "Starting backup verification..."

# 1. Create backup
BACKUP_FILE="$BACKUP_DIR/${DB_NAME}_$(date +%Y%m%d_%H%M%S).sql.gz"
log "Creating backup: $BACKUP_FILE"
pg_dump -h "$DB_HOST" -U "$DB_USER" "$DB_NAME" | gzip > "$BACKUP_FILE"
BACKUP_SIZE=$(ls -lh "$BACKUP_FILE" | awk '{print $5}')
log "Backup created: $BACKUP_SIZE"

# 2. Create verification database
log "Creating verification database: $VERIFY_DB"
createdb -h "$DB_HOST" -U "$DB_USER" "$VERIFY_DB" 2>/dev/null || true

# 3. Restore backup
log "Restoring backup..."
gunzip -c "$BACKUP_FILE" | psql -h "$DB_HOST" -U "$DB_USER" "$VERIFY_DB" > /dev/null 2>&1

# 4. Verify data integrity
log "Verifying data integrity..."
ERRORS=0

# Check table count
ORIG_TABLES=$(psql -h "$DB_HOST" -U "$DB_USER" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'" "$DB_NAME")
VERIFY_TABLES=$(psql -h "$DB_HOST" -U "$DB_USER" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'" "$VERIFY_DB")
if [ "$ORIG_TABLES" = "$VERIFY_TABLES" ]; then
  log "  Tables: $VERIFY_TABLES (MATCH)"
else
  log "  Tables: MISMATCH ($ORIG_TABLES vs $VERIFY_TABLES)"
  ERRORS=$((ERRORS + 1))
fi

# Check patient count
ORIG_PATIENTS=$(psql -h "$DB_HOST" -U "$DB_USER" -tAc "SELECT count(*) FROM patients WHERE deleted_at IS NULL" "$DB_NAME")
VERIFY_PATIENTS=$(psql -h "$DB_HOST" -U "$DB_USER" -tAc "SELECT count(*) FROM patients WHERE deleted_at IS NULL" "$VERIFY_DB")
if [ "$ORIG_PATIENTS" = "$VERIFY_PATIENTS" ]; then
  log "  Patients: $VERIFY_PATIENTS (MATCH)"
else
  log "  Patients: MISMATCH ($ORIG_PATIENTS vs $VERIFY_PATIENTS)"
  ERRORS=$((ERRORS + 1))
fi

# Check staff count
ORIG_STAFF=$(psql -h "$DB_HOST" -U "$DB_USER" -tAc "SELECT count(*) FROM staff WHERE deleted_at IS NULL" "$DB_NAME")
VERIFY_STAFF=$(psql -h "$DB_HOST" -U "$DB_USER" -tAc "SELECT count(*) FROM staff WHERE deleted_at IS NULL" "$VERIFY_DB")
if [ "$ORIG_STAFF" = "$VERIFY_STAFF" ]; then
  log "  Staff: $VERIFY_STAFF (MATCH)"
else
  log "  Staff: MISMATCH ($ORIG_STAFF vs $VERIFY_STAFF)"
  ERRORS=$((ERRORS + 1))
fi

# Check notes count
ORIG_NOTES=$(psql -h "$DB_HOST" -U "$DB_USER" -tAc "SELECT count(*) FROM clinical_notes WHERE deleted_at IS NULL" "$DB_NAME")
VERIFY_NOTES=$(psql -h "$DB_HOST" -U "$DB_USER" -tAc "SELECT count(*) FROM clinical_notes WHERE deleted_at IS NULL" "$VERIFY_DB")
if [ "$ORIG_NOTES" = "$VERIFY_NOTES" ]; then
  log "  Notes: $VERIFY_NOTES (MATCH)"
else
  log "  Notes: MISMATCH ($ORIG_NOTES vs $VERIFY_NOTES)"
  ERRORS=$((ERRORS + 1))
fi

# 5. Clean up
log "Dropping verification database..."
dropdb -h "$DB_HOST" -U "$DB_USER" "$VERIFY_DB" 2>/dev/null || true

# 6. Report
if [ $ERRORS -eq 0 ]; then
  log "BACKUP VERIFICATION: PASSED"
  log "  Backup: $BACKUP_FILE ($BACKUP_SIZE)"
  log "  Tables: $VERIFY_TABLES | Patients: $VERIFY_PATIENTS | Staff: $VERIFY_STAFF | Notes: $VERIFY_NOTES"
else
  log "BACKUP VERIFICATION: FAILED ($ERRORS errors)"
  # In production, send alert here
fi

# 7. Rotate old backups (keep last 30)
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +30 -delete 2>/dev/null
log "Old backups cleaned up. Done."
