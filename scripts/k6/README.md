# Category 6 — Performance & Load Tests (k6)

Five k6 scenarios + a Postgres query-plan audit covering the
performance SLAs for the Signacare EMR API.

> **Never run any of these against production.** Load tests against
> a live patient-data instance are a clinical-safety incident. The
> scripts default to `http://localhost:4000` and accept a `STAGING_URL`
> override; CI must set the staging URL explicitly.

## Install k6

```bash
# macOS
brew install k6

# Debian / Ubuntu (CI runners)
sudo gpg -k && sudo gpg --no-default-keyring \
  --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
  --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
  | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6
```

## Layout

```
scripts/k6/
├── lib/
│   ├── config.js     # SLA thresholds, BASE_URL, test credentials
│   └── auth.js       # login() helper used by every scenario
├── baseline.js       # 1 VU, 5 min  — clean p50/p95/p99 reference
├── load.js           # 200 VUs, 10 min — busy clinic morning mix
├── stress.js         # 0→1000 VUs, 10 min — find the breaking point
├── spike.js          # 0→500 VUs in 30s — shift change burst
├── soak.js           # 100 VUs, 2 hrs — memory leak detector
├── db-explain.sql    # Postgres query-plan audit (no Seq Scans)
└── README.md         # This file
```

## SLA thresholds (enforced as pass/fail)

| Endpoint                          | Tag                | Target  |
|-----------------------------------|--------------------|---------|
| GET  `/patients/:id`              | `patient_get`      | p95 < 300ms |
| POST `/clinical-notes`            | `note_post`        | p95 < 500ms |
| GET  `/medications/...`           | `medication_list`  | p95 < 200ms |
| POST `/auth/login`                | `login`            | p95 < 400ms |
| GET  `/episodes/patient/:id`      | `episode_list`     | p95 < 250ms |
| GET  `/patients?search=`          | `patient_search`   | p95 < 500ms |
| POST `/attachments`               | `file_upload`      | p95 < 2000ms |
| GET  `/fhir/Patient/:id`          | `fhir_export`      | p95 < 3000ms |
| Global error rate                 | `http_req_failed`  | < 0.1%  |

The thresholds live in `lib/config.js` so all scenarios share one
source of truth. A breach exits the k6 process with code 99 — wire
that into the CI step's success criterion.

## Running

```bash
# Local dev (API on :4000)
k6 run scripts/k6/baseline.js
k6 run scripts/k6/load.js

# Against staging
STAGING_URL=https://staging.signacare.au k6 run scripts/k6/load.js

# Soak with shorter duration for local validation
K6_SOAK_DURATION=10m k6 run scripts/k6/soak.js

# Override the seeded admin credentials
K6_TEST_USER=loadtest@signacare.local K6_TEST_PASS='Loadt3st!' \
  k6 run scripts/k6/load.js
```

## Scenarios in detail

### `baseline.js` — reference numbers
- **VUs:** 1
- **Duration:** 5 minutes
- **Goal:** capture clean p50 / p95 / p99 per endpoint with no
  contention. The output is the reference baseline that load /
  stress / spike runs are compared against.
- **Pass:** all SLA thresholds in `lib/config.js`.

### `load.js` — busy clinic morning
- **VUs:** 200
- **Duration:** 10 minutes
- **Mix:** 40% patient reads, 20% note creates, 20% medication
  reads, 10% search, 10% login cycling.
- **Goal:** prove the system holds SLAs under realistic peak.
- **Pass:** all SLA thresholds.

### `stress.js` — find the ceiling
- **VUs:** ramp 0 → 1000 over 10 minutes
- **Goal:** record the VU count at first SLA breach. **Does NOT**
  enforce SLAs — instead it observes them so the data isn't lost
  to an early abort.
- **Pass:** error rate stays under 10% (system doesn't crash).
  Read the per-stage histograms to find the headroom ceiling.
- **Provisioning rule of thumb:** size production for 1.5× the peak
  observed traffic on the ceiling VU count.

### `spike.js` — shift change
- **VUs:** 0 → 500 in 30 seconds, hold 2 minutes, ramp down 1 minute
- **Goal:** prove the system degrades gracefully (503) rather than
  crashing (5xx) when every clinician on the next shift logs in
  within a 30-second window.
- **Pass:** ZERO HTTP 5xx responses across the run; p99
  `patient_get` stays under 5s.

### `soak.js` — memory-leak detector
- **VUs:** 100
- **Duration:** 2 hours (override with `K6_SOAK_DURATION=10m` for
  local validation)
- **Goal:** detect Node heap growth, PG pool drift, Redis connection
  leaks, BullMQ queue depth.
- **Observation:** the k6 process generates traffic; the leak
  signal lives in Prometheus. Watch:
  - `process_resident_memory_bytes`
  - `nodejs_heap_size_used_bytes`
  - `signacare_pg_pool_used`
  - `bullmq_queue_depth`
- **Pass:** at the end of 2h, none of those metrics is higher than
  1.5× their value at the 30-minute mark (steady state).

### `db-explain.sql` — query plan audit
- **Tool:** `psql`, not k6.
- **Goal:** assert every query touching a >10k-row table uses an
  Index Scan, never a Sequential Scan.
- **Run:**
  ```bash
  psql "$STAGING_DSN" -f scripts/k6/db-explain.sql > db-explain.out
  grep -i 'Seq Scan' db-explain.out && echo 'FAIL' || echo 'PASS'
  ```
- **Pass:** zero `Seq Scan` matches on any clinical table.

## Recommended CI wiring

1. After staging deploy, run `baseline.js` first — fast (5 min)
   and catches obvious regressions.
2. Run `load.js` (10 min) — gates the merge on SLA compliance.
3. Run `db-explain.sql` — gates on no Seq Scans.
4. `stress.js`, `spike.js`, `soak.js` are nightly jobs, not per-PR
   — they take too long for the merge gate.
5. Upload the k6 HTML summary as a CI artifact:
   ```bash
   k6 run --summary-export=k6-summary.json scripts/k6/load.js
   ```

## Pre-merge checklist (the auditor's view)

- [ ] `baseline.js` p95 numbers logged to PR description
- [ ] `load.js` exits zero (SLA compliance)
- [ ] `db-explain.sql` shows zero Seq Scans on clinical tables
- [ ] No regression vs the previous baseline by more than 10%
