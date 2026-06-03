#!/usr/bin/env bash
# scripts/qa-agent/diagnostic-pool-snapshot.sh
#
# BUG-187 diagnostic — snapshots pg_stat_activity every N seconds to a CSV
# so we can identify which backend PIDs persist vs churn. Connections that
# persist across snapshots without state=idle are the leak candidates.
#
# Usage:
#   scripts/qa-agent/diagnostic-pool-snapshot.sh [INTERVAL_SEC] [DURATION_MIN]
#   defaults: 120s interval, 30 min duration
#
# Output: /tmp/pool-snapshots-YYYYMMDD-HHMMSS/snap-NNN.csv + summary.log

set -euo pipefail

INTERVAL_SEC="${1:-120}"
DURATION_MIN="${2:-30}"
TOTAL_SNAPSHOTS=$(( (DURATION_MIN * 60) / INTERVAL_SEC ))

OUT_DIR="/tmp/pool-snapshots-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT_DIR"

PSQL="psql -h localhost -p 5433 -U signacare_owner -d signacaredb"

# Snapshot query: capture every app_user connection with enough context
# to correlate with application-side logs.
QUERY="
COPY (
  SELECT
    now()                              AS snap_ts,
    pid,
    usename,
    application_name,
    client_addr,
    client_port,
    backend_start,
    xact_start,
    query_start,
    state_change,
    wait_event_type,
    wait_event,
    state,
    backend_xmin,
    left(query, 200)                   AS query_preview
  FROM pg_stat_activity
  WHERE datname = 'signacaredb'
    AND usename IN ('app_user','signacare_owner')
  ORDER BY pid
) TO STDOUT WITH CSV HEADER
"

echo "Snapshot output: $OUT_DIR"
echo "Interval: ${INTERVAL_SEC}s, Duration: ${DURATION_MIN} min, Total: ${TOTAL_SNAPSHOTS} snapshots"
echo ""

for i in $(seq 1 "$TOTAL_SNAPSHOTS"); do
  snap_file="$OUT_DIR/snap-$(printf '%03d' "$i").csv"
  $PSQL -c "$QUERY" > "$snap_file" 2>&1
  n_rows=$(( $(wc -l < "$snap_file") - 1 ))
  ts=$(date +"%H:%M:%S")
  printf "[%s] snap %03d: %d connections → %s\n" "$ts" "$i" "$n_rows" "$snap_file" \
    | tee -a "$OUT_DIR/summary.log"
  [ "$i" -lt "$TOTAL_SNAPSHOTS" ] && sleep "$INTERVAL_SEC"
done

# Analysis pass: find PIDs that appear in every snapshot (persistent)
# vs PIDs that appear and disappear (churning — healthy).
echo ""
echo "=== PERSISTENT CONNECTIONS (appeared in every snapshot) ==="
for snap in "$OUT_DIR"/snap-*.csv; do
  tail -n +2 "$snap" | awk -F',' '{print $2}'
done | sort | uniq -c | awk -v total="$TOTAL_SNAPSHOTS" \
  '$1 == total {print "  pid=" $2 "  (persistent across all " total " snapshots)"}' \
  | tee -a "$OUT_DIR/summary.log"

echo ""
echo "=== CHURN (pids appearing + disappearing — healthy) ==="
for snap in "$OUT_DIR"/snap-*.csv; do
  tail -n +2 "$snap" | awk -F',' '{print $2}'
done | sort | uniq -c | awk -v total="$TOTAL_SNAPSHOTS" \
  '$1 < total {count++} END {print "  " count " pids churned"}' \
  | tee -a "$OUT_DIR/summary.log"

echo ""
echo "=== Final summary written to: $OUT_DIR/summary.log ==="
echo "Individual snapshots: $OUT_DIR/snap-*.csv"
