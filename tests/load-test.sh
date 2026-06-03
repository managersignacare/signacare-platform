#!/bin/bash
# ============================================================
# Signacare EMR — Load Test Script
# ============================================================
# Tests API throughput under concurrent load.
# Requires: curl, GNU parallel (or xargs)
#
# Usage: ./tests/load-test.sh [concurrent_users] [requests_per_user]
#   Default: 10 concurrent users, 20 requests each
# ============================================================

set -e

API="http://localhost:4000/api/v1"
CONCURRENT=${1:-10}
REQUESTS=${2:-20}
TOTAL=$((CONCURRENT * REQUESTS))

echo "============================================"
echo "  Signacare EMR — Load Test"
echo "  Concurrent users: $CONCURRENT"
echo "  Requests per user: $REQUESTS"
echo "  Total requests: $TOTAL"
echo "============================================"

# First, login to get a token
echo ""
echo "Step 1: Authenticating..."
LOGIN_RESP=$(curl -s -c /tmp/signacare_cookies.txt -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@signacare.com.au","password":"Admin123!"}')
echo "  Login response: $(echo $LOGIN_RESP | head -c 100)"

# Test endpoints
ENDPOINTS=(
  "GET:patients"
  "GET:staff/lookup"
  "GET:medications/patients/2764e3e4-d6ad-419a-a2f0-4ddece72708f/medications"
  "GET:episodes/patient/2764e3e4-d6ad-419a-a2f0-4ddece72708f"
  "GET:auth/csrf"
)

echo ""
echo "Step 2: Running load test..."
echo ""

for ep_spec in "${ENDPOINTS[@]}"; do
  METHOD=$(echo $ep_spec | cut -d: -f1)
  ENDPOINT=$(echo $ep_spec | cut -d: -f2-)

  echo "--- $METHOD /$ENDPOINT ---"

  START=$(date +%s%N)

  # Run concurrent requests
  seq $TOTAL | xargs -I{} -P $CONCURRENT \
    curl -s -o /dev/null -w "%{http_code} %{time_total}\n" \
    -b /tmp/signacare_cookies.txt \
    "$API/$ENDPOINT" 2>/dev/null | \
  awk '
  BEGIN { ok=0; err=0; total_time=0; min_time=999; max_time=0; count=0 }
  {
    count++
    time = $2
    total_time += time
    if (time < min_time) min_time = time
    if (time > max_time) max_time = time
    if ($1 >= 200 && $1 < 400) ok++
    else err++
  }
  END {
    avg = count > 0 ? total_time / count : 0
    printf "  Requests: %d | OK: %d | Errors: %d\n", count, ok, err
    printf "  Latency:  avg=%.3fs | min=%.3fs | max=%.3fs\n", avg, min_time, max_time
    if (avg > 0) printf "  Throughput: ~%.0f req/s\n", count / total_time * NR / count
  }'

  END=$(date +%s%N)
  ELAPSED=$(( (END - START) / 1000000 ))
  echo "  Wall time: ${ELAPSED}ms"
  echo ""
done

echo "============================================"
echo "  Load test complete"
echo "============================================"
