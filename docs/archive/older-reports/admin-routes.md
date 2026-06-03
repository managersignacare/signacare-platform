# Operator-only routes

Routes mounted on the API but intentionally not wired to a web/mobile UI. They
exist as backend-only operator surfaces, called via curl/Postman by clinic
administrators or platform operators. Each entry below corresponds to a routes
file with an `@admin-only` JSDoc sentinel at the top — the CI guard
`.github/scripts/check-mounted-routes-have-callers.sh` enforces that pairing.

When a UI eventually lands for one of these routes, remove the sentinel from
the routes file AND the entry below in the same commit.

---

## `/api/v1/reallocations` — patient re-allocation approval queue

**Routes file:** [apps/api/src/features/reallocations/reallocationRoutes.ts](../apps/api/src/features/reallocations/reallocationRoutes.ts)

**Module key:** `PATIENT_ALLOCATIONS` (registered in `apps/api/src/shared/moduleKeys.ts`)

**Auth:** `authMiddleware` + `tenantMiddleware` + `requireModuleRead/Write(PATIENT_ALLOCATIONS)`

**Endpoints:**
- `POST   /api/v1/reallocations` — clinician requests a patient transfer
- `GET    /api/v1/reallocations/pending` — manager approval queue
- `POST   /api/v1/reallocations/:id/approve` — manager approves; fires Viva outreach
- `POST   /api/v1/reallocations/:id/reject` — manager rejects with reason

**Why no UI yet:** the backend service is fully built; the dedicated approval-queue
page is on the roadmap but not yet shipped. Until then managers run the workflow
manually via curl during patient transfer events.

**Example curl (request a transfer):**
```bash
curl -X POST https://api.signacare.local/api/v1/reallocations \
  -H "Cookie: signacare_access=…" \
  -H "Content-Type: application/json" \
  -d '{
    "patientId": "00000000-0000-0000-0000-000000000001",
    "targetOrgUnitId": "00000000-0000-0000-0000-000000000002",
    "reason": "Patient relocating to Eastern catchment"
  }'
```

**Example curl (approval queue):**
```bash
curl https://api.signacare.local/api/v1/reallocations/pending \
  -H "Cookie: signacare_access=…"
```

---

## `/api/v1/webhooks-admin` — webhook source-secret management

**Routes file:** [apps/api/src/features/webhooks/webhookRoutes.ts](../apps/api/src/features/webhooks/webhookRoutes.ts) (the `webhookAdminRouter` export at the bottom of the file)

**Auth:** `authMiddleware` + `requireRoles(['admin', 'superadmin'])`

**Endpoints:**
- `GET    /api/v1/webhooks-admin/secrets` — list configured webhook source secrets (the secret value itself is redacted)
- `POST   /api/v1/webhooks-admin/secrets` — create a new partner source secret
- `PATCH  /api/v1/webhooks-admin/secrets/:id` — update an existing source (rotate, rename)
- `DELETE /api/v1/webhooks-admin/secrets/:id` — deactivate a source
- `GET    /api/v1/webhooks-admin/audit?source=…` — paginated audit log lookup

**Why no UI:** secret rotation is a low-frequency operator task (typically once
per partner per year). A dedicated UI is not on the roadmap because the workflow
is operator-only and adding a UI would make the secrets visible to non-operator
staff who happen to have the admin role.

**Example curl (provision a new partner source):**
```bash
curl -X POST https://api.signacare.local/api/v1/webhooks-admin/secrets \
  -H "Cookie: signacare_access=…" \
  -H "Content-Type: application/json" \
  -d '{
    "source": "partner-lab-x",
    "secret": "<32-byte-hex>",
    "signatureHeader": "X-Partner-Signature"
  }'
```

**Example curl (rotate a secret):**
```bash
curl -X PATCH https://api.signacare.local/api/v1/webhooks-admin/secrets/<id> \
  -H "Cookie: signacare_access=…" \
  -H "Content-Type: application/json" \
  -d '{ "secret": "<new-32-byte-hex>" }'
```

---

## `/api/v1/ai/jobs` — async AI job queue

**Routes file:** [apps/api/src/features/llm/aiJobRoutes.ts](../apps/api/src/features/llm/aiJobRoutes.ts)

**Auth:** `authMiddleware`

**Endpoints:**
- `POST /api/v1/ai/jobs` — submit an async AI job (returns `jobId` immediately, results pushed via SSE)
- `GET  /api/v1/ai/jobs/:id` — poll job status (fallback if SSE drops)
- `GET  /api/v1/ai/jobs` — list recent jobs for the current user

**Why no UI:** every clinical AI surface today (Summary, Medications, Legal tabs)
calls the synchronous `/api/v1/llm/clinical-ai` endpoint directly. The async queue
is staged for future long-running tasks (multi-document summaries, batch chart
reviews) but no UI submits jobs yet. The `aiWorker` is wired to BullMQ and
processes jobs from this queue.

**Example curl (submit a test job):**
```bash
curl -X POST https://api.signacare.local/api/v1/ai/jobs \
  -H "Cookie: signacare_access=…" \
  -H "Content-Type: application/json" \
  -d '{ "action": "summarise", "data": "<long text>", "model": "gpt-4o-mini" }'
```

---

## `/api/v1/clinical-decision` — CDS rule catalogue + alert preview

**Routes file:** [apps/api/src/features/clinical-decision/clinicalDecisionRoutes.ts](../apps/api/src/features/clinical-decision/clinicalDecisionRoutes.ts)

**Auth:** `authMiddleware` + `requireRoles(['clinician','admin','superadmin'])`

**Endpoints:**
- `GET /api/v1/clinical-decision/alerts/patient/:patientId` — preview CDS alerts for a patient (metabolic, drug interactions, clozapine monitoring)
- `GET /api/v1/clinical-decision/rules` — return the static rule catalogue

**Why no UI:** today the metabolic + clozapine + drug interaction rules are
surfaced through the Pathology and Medications tabs, which evaluate them inline
as part of each tab's existing query. The standalone `/clinical-decision`
endpoints are a future consolidation surface (one bell that lists every
patient-level CDS alert across categories) — the aggregator UI has not shipped.

**Example curl (preview alerts):**
```bash
curl https://api.signacare.local/api/v1/clinical-decision/alerts/patient/<patientId> \
  -H "Cookie: signacare_access=…"
```

---

## `/api/v1/feature-flags-admin` — feature flag override management

**Routes file:** [apps/api/src/features/feature-flags/featureFlagRoutes.ts](../apps/api/src/features/feature-flags/featureFlagRoutes.ts) (the `featureFlagAdminRouter` named export)

**Auth:** `authMiddleware` + `tenantMiddleware` + `requireRoles(['admin','superadmin'])`

**Endpoints:**
- `GET    /api/v1/feature-flags-admin` — list all flags + descriptions
- `PUT    /api/v1/feature-flags-admin` — upsert a flag value for the current clinic
- `DELETE /api/v1/feature-flags-admin/:name` — delete a flag override

**Why no UI:** flag overrides are set once per clinic per release. The
read-side bootstrap (`GET /api/v1/feature-flags`, mounted from the same file
as the default export `featureFlagRoutes`) IS called by every web client on
app load — that's the consumer half. The admin write half is platform-team
only and lives outside the in-app surface intentionally so a clinic admin
cannot accidentally toggle production flags.

**Example curl (set a clinic flag):**
```bash
curl -X PUT https://api.signacare.local/api/v1/feature-flags-admin \
  -H "Cookie: signacare_access=…" \
  -H "Content-Type: application/json" \
  -d '{ "name": "calendar.beta", "value": true }'
```

---

## `/api/v1/imports` — bulk CSV import for clinic onboarding

**Routes file:** [apps/api/src/features/imports/importRoutes.ts](../apps/api/src/features/imports/importRoutes.ts)

**Auth:** `authMiddleware` + `tenantMiddleware` + `requireModuleWrite(MODULE_KEYS.IMPORTS)` (commit) / `requireModuleRead` (list)

**Endpoints:**
- `POST /api/v1/imports/:kind/dry-run` — upload a CSV, parse + validate, returns an `import_jobs` row with status `validated` or `rejected`
- `POST /api/v1/imports/:kind/commit` — commit a previously-validated job by id
- `GET  /api/v1/imports/jobs?kind=…` — list recent import jobs for the clinic
- `GET  /api/v1/imports/jobs/:id` — fetch one job (errors, sample rows)

**Why no UI:** bulk imports are a one-off operator task during new-clinic
onboarding (loading the staff roster, the patient register, the org unit
hierarchy from the existing system). Once the clinic is live the route is
not used. A dedicated ops UI is a Phase 13+ consideration.

**Example curl (dry-run a staff CSV):**
```bash
curl -X POST https://api.signacare.local/api/v1/imports/staff/dry-run \
  -H "Cookie: signacare_access=…" \
  -F "file=@./staff-roster.csv"
```

**Example curl (commit a validated job):**
```bash
curl -X POST https://api.signacare.local/api/v1/imports/staff/commit \
  -H "Cookie: signacare_access=…" \
  -H "Content-Type: application/json" \
  -d '{ "jobId": "<import_jobs.id>" }'
```
