# Deep Audit Scope — Pre-Azure-staging Cutover

_The investigative checklist that runs against the cleaned, bug-reduced codebase immediately before Azure staging deployment (step 11 of the pre-staging plan)._

Any NEW finding surfaced by this audit gets promoted into `bugs-remaining.md` with a severity + state, and blocks staging cutover until resolved or explicitly deferred by the user.

## Scope — 10 audit tracks

### 1. Dependency + supply chain

- `npm audit` across root, `apps/api`, `apps/web`, `packages/shared` — document each CVE with (a) severity, (b) whether exploitable in our usage, (c) remediation path.
- `npm outdated` — list major-version-behind deps; recommend upgrades or explicit pins.
- License audit (license-checker or npx license-report) — flag any GPL / AGPL in production deps (should be zero).
- Transitive dep tree size — flag any runtime dep pulling >50 transitive modules.
- Lockfile integrity — verify `package-lock.json` matches `package.json` declared versions across all workspaces.

**Expected output:** `docs/archive/audit-2026-04-24/dependency-audit.md` with a per-CVE triage row.

### 2. Schema + migration consistency

- `apps/api/src/db/schema-snapshot.json` vs the actual `knex_migrations` ledger on a freshly-migrated dev DB — any drift = new BUG.
- Every `.sql` in `apps/api/src/db/migrations/` has a tracked `.ts` wrapper in `apps/api/migrations/`.
- Every CREATE TABLE with `clinic_id` has RLS + `clinic_id` index + `patient_id` index (if applicable) per CLAUDE.md §9.3 new-table checklist.
- Every CREATE TRIGGER function either emits `INSERT INTO audit_log` OR fails closed with RAISE (BUG-358 guard).
- No forward-only migration has an empty / unused `down()`.

### 3. Fix-registry live verification

- Run `bash .github/scripts/check-fix-registry.sh` — expect 920+ PASS.
- For every S0 / S1 `R-FIX-BUG-*` anchor, manually open the anchored file + line and confirm the code looks architecturally correct (not just that the regex matches).
- Flag any anchor whose target code has been refactored in a way that degrades the original fix.

### 4. Integration test status

- `node apps/api/scripts/run-integration-tests.mjs` — full suite.
- Classify each failing test as: (a) pre-existing and genuinely broken → BUG; (b) broken against a dev-DB out of sync → re-seed and retry; (c) depends on unshipped feature → park with forward-reference.
- Flake check: re-run the full suite ×3; any test that fails only intermittently goes on the flaky-test list with a BUG.

### 5. Security headers + CORS + CSP

- Probe every public endpoint for: `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`, `Content-Security-Policy`, `Referrer-Policy`, `Permissions-Policy`.
- Verify CORS allow-list is production-tight (no wildcard, no localhost leaks in `.env.production.template`).
- Verify CSP blocks inline script except via nonce.
- Verify cookie flags (`Secure`, `HttpOnly`, `SameSite=Strict` on session cookies).

### 6. Rate-limit coverage

- Every `/auth/*` endpoint has a rate limit.
- Every destructive endpoint (DELETE, bulk-update) has a rate limit.
- Every expensive endpoint (AI, file-upload, FHIR bulk-export) has a rate limit DIFFERENT from the API-wide default.
- Rate-limit responses return `429` with `Retry-After` header.

### 7. PHI egress path audit

- Every path that sends data outside the tenant clinic is gated by `AuthContext` + `requirePatientRelationship` + break-glass audit if appropriate.
- External APIs (HI Service, NPDS, MyHR, ACS, Azure Blob, S3) do NOT send PHI without explicit consent (check against the consent table).
- Every Pino log statement with a patient object is redacted via `redactPhi`.
- No `console.log` / `console.error` with PHI in any `src/` file.

### 8. Auth boundary audit

- Every route has `authMiddleware` OR is explicitly public (health, auth, webhook).
- Every service method accepts `AuthContext` first (CLAUDE.md §13) — flag ANY service that still accepts raw `(clinicId, actorId, ...)`.
- Every frontend route has a parallel RBAC gate (not just hidden-nav).
- Break-glass sessions emit the mandatory audit row and expire on schedule.

### 9. Data-model integrity

- Every `clinic_id`, `patient_id`, `created_at` is NOT NULL where business semantics require.
- Every soft-deleted table has `.whereNull('deleted_at')` in every query that should hide deleted rows.
- Every table that should NOT have soft-delete (the CLAUDE.md §1.4 list) has no stray `.whereNull('deleted_at')` query.
- Every RLS policy uses `NULLIF(current_setting('app.clinic_id', true), '')::uuid` pattern — no bare `current_setting` that throws on unset.

### 10. Observability + ops readiness

- Every `kind: '*'` structured log tag is documented in `docs/operations/runbooks/on-call.md` with its alert threshold.
- Sentry DSN is wired + PHI-scrub `beforeSend` hook is active.
- Application Insights connection string is documented in `.env.production.template`.
- Health checks `/health` and `/ready` return the expected shape under a failure mode (drop DB → `/ready` goes 503).
- Shutdown hooks run in documented priority order; `graceful shutdown` log appears within 5 s of SIGTERM.

## Not in scope for this audit

- **Performance load testing** — separate track (`pre-deployment-checklist.md` load-test baseline).
- **Cross-browser compatibility** — separate track; QA sub-wave.
- **Accessibility (WCAG 2.1 AA)** — tracked in `docs/compliance/accessibility/` with the A11Y3 / A11Y-SR1 fix-registry anchors; revisit if regressed, not re-audited here.
- **User acceptance testing** — staging-only track (step 15 of the Azure plan).

## Output deliverable

A single audit report at `docs/archive/audit-2026-04-24/deep-audit-report.md` with sections per track, a summary of new BUG-* items filed, and a go / no-go recommendation for staging cutover. Any new S0 or S1 finding is a no-go.

## Running the audit

The audit is NOT automated end-to-end. Each track has a runbook in this file that a human or agent follows. For tracks with `bash` commands, capture stdout into the audit report. For tracks requiring judgement, the report includes the grep / query output and the auditor's determination.

Target duration: 1 working day for a single engineer, or a parallel sub-agent sweep delivering <4 hours elapsed.
