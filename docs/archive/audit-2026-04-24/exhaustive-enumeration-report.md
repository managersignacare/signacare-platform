# Exhaustive Enumeration Report — Signacare EMR (Wave 6)

**Audit date:** 2026-04-24
**Audit scope:** Ruthless file:line enumeration of every class of finding surfaced in Waves 1-5. No scope cap. Nothing out of scope.
**Predecessor reports:**
- `docs/archive/audit-2026-04-24/deep-audit-report.md` (first-audit — 25 findings → BUG-368..392)
- `docs/archive/audit-2026-04-24/comprehensive-audit-report.md` (Wave 5 — 37 findings → BUG-393..429)
- This report (Wave 6 — ~47 findings → BUG-430..476)

**Method:** 13 parallel auditor agents across three sub-waves (6a + 4b + 3c) + 3 live probes. Each agent produced a dedicated inventory file (`findings/findings-6{a,b,c}-<category>.md`) with file:line precision. This document synthesises the 13 inventories into cross-cutting conclusions, severity triage, and pre-Azure-staging go/no-go.

---

## 1. Executive summary

**Total new findings this wave:** 47 new BUG rows (BUG-430..476).

**Cumulative audit total for 2026-04-24:** 109 BUGs across three reports:
- First audit: 25 (BUG-368..392)
- Wave 5: 37 (BUG-393..429)
- Wave 6: 47 (BUG-430..476)

**Severity distribution of Wave 6 new findings:**
- **S0 pre-staging BLOCKER:** 3 — BUG-441 (phiEncryption plaintext fallback), BUG-442 (jwtBlacklist fail-open), BUG-454 (RLS gap on 20 tables)
- **S1 deploy-blocker:** 13
- **S2 should-ship-before-GA:** 23
- **S3 tech-debt:** 8

**Go / no-go for Azure staging:** **CONDITIONAL GO — escalated blockers.**

Previous blockers (first audit): BUG-368 (clinic_id × 5) + BUG-369 (note audit_log) remain.

Wave 6 adds three new S0 pre-staging blockers:
1. **BUG-441** — PHI encryption returns plaintext on encryption/decryption failure (3 sites in `shared/phiEncryption.ts` + `utils/phiEncryption.ts`). Silent plaintext PHI write is a compliance-catastrophic failure mode. Must fail-fast with logger.error + structured event.
2. **BUG-442** — `jwtBlacklist.isTokenBlacklisted` + `isUserRevokedAfter` return `false` on Redis error with NO log. Silent session-revocation fail-open undermines BUG-356. Must fail-closed with alert.
3. **BUG-454** — 20 tenant-scoped tables in the v2 baseline lack `ENABLE ROW LEVEL SECURITY`. Defence-in-depth Layer-2 absent; tenant isolation relies solely on Layer-1 app filtering (which is itself incomplete per BUG-368 / BUG-430 — 186 high-confidence missing-`clinic_id` sites).

**Structural headlines (not individual BUGs):**
1. **Type-safety debt is 1,712 casts, not 1,364.** Wave 5 was under-counted. Web has 2.7× the API count.
2. **Route coverage is 10 %, not 78 %.** ~654 of 725 routes uncovered. Integration suite is a narrow golden-path; 43 entire feature directories at 0 %.
3. **186 high-confidence clinic_id gaps**, not 5. First-audit BUG-368 was a sample.
4. **20 tenant tables lack RLS**, not the reported "101 of 103" from 2026-04-15 baseline squash — progress made, but the residual is architecturally load-bearing.
5. **34 silent catches** remain; three plaintext-PHI regressions are P0.

**Five residual items still deferred to live environments** (not reachable by static analysis):
- Load test with realistic concurrency (k6 against staging)
- External pen test (requires authorised vendor, scheduled window)
- AI adversarial red-team (scripted prompt-injection corpus against live Ollama)
- Vendor-sandbox integration tests (eRx NPDS, HI Service, MyHR, ADHA CTS v3.0.1 endpoint)
- Live UI click-through by a QA persona

These five are tracked in `docs/quality/pre-deployment-checklist.md` Phase-5 + Phase-6 sections — promoted, not hidden.

---

## 2. Cross-cutting patterns — severity-ranked

### 2.1 Pre-staging BLOCKERS (S0)

| # | Finding class | Evidence | Fix shape |
|---|---|---|---|
| 1 | **PHI encryption plaintext fallback** | `shared/phiEncryption.ts:60,85`; `utils/phiEncryption.ts:59` | Replace silent `return plaintext` with `throw new EncryptionFailureError()` + logger.error; fail-fast at write time |
| 2 | **jwtBlacklist fail-open on Redis error** | `middleware/jwtBlacklist.ts:46,71` | Replace silent `return false` with `throw` + alert; auth middleware treats as 503 (fail-closed) |
| 3 | **20 tenant tables missing RLS ENABLE** | `migrations/20260701000000_baseline.ts` + `20260701000027_tier19_training_platform.ts` | Follow-up migration adding `EXISTS`-over-parent policies |
| 4 | **BUG-368 expansion — 186 high-confidence missing `clinic_id` sites** | `findings-6a-missing-clinic-id.md` | Per-feature remediation batch; CI guard from BUG-368 must catch new instances |
| 5 | **BUG-369 — clinical-note audit_log missing** | First audit finding | Add `writeAuditLog` calls + CI guard (existing plan) |
| 6 | **Dependency CVEs — protobufjs CRITICAL + basic-ftp HIGH** | `probes/npm-audit-root.json` | `npm audit fix` + manual root bumps for `dompurify` + `nodemailer` |

### 2.2 S1 deploy-blocker (should close before first clinician)

| # | Finding class | Roll-up BUG |
|---|---|---|
| 1 | Allergy banner dismissible — patient-safety | BUG-393 (Wave 5) |
| 2 | AI scribe drug-allergy cross-check missing | BUG-394 (Wave 5) |
| 3 | AI chat patient-context UUID lock | BUG-395 (Wave 5) |
| 4 | MHA tab UI stub | BUG-400 (Wave 5) |
| 5 | ECT/TMS optimistic locking | BUG-402 (Wave 5) |
| 6 | Frontend ModuleGuard fails OPEN | BUG-416 (Wave 5) |
| 7 | Whisper model version pinning | BUG-424 (Wave 5) |
| 8 | authController login/logout audit-write swallow | BUG-443 (Wave 6) |
| 9 | License middleware silent bypass | BUG-444 (Wave 6) |
| 10 | ReceptionistPage fabricated SMS success | BUG-445 (Wave 6) |
| 11 | WCAG 2.1 AA SC 2.1.1 keyboard-accessibility 67 sites | BUG-447 (Wave 6) |
| 12 | Clinical-safety-critical routes with 0 integration tests | BUG-451 (Wave 6) |
| 13 | JWT payload discriminated union + remove 10 middleware `as unknown as` | BUG-463 (Wave 6) |
| 14 | AUDIT-ACTION-UNION-BYPASS — 10 sites | BUG-467 (Wave 6) |
| 15 | CSP directive gaps | BUG-468 (Wave 6) |
| 16 | authLimiter coverage + upload/webhook limiters | BUG-469 (Wave 6) |
| 17 | Medication schema alignment | BUG-456 (Wave 6) |
| 18 | LlmFeature enum drift | BUG-457 (Wave 6) |
| 19 | Appointment fabricated fields | BUG-458 (Wave 6) |
| 20 | Critical-pathology + MHA-review alerts | BUG-372 (first audit) |
| 21 | Optimistic locking on prescriptions/medications/episodes | BUG-371 (first audit) |
| 22 | Data-retention enforcement job | BUG-374 (first audit) |

### 2.3 S2 should-ship-before-GA (quality / completeness)

23 items (BUG-396, 397, 398, 399, 401, 404, 406, 407, 408, 410, 411, 412, 413, 417, 418, 422, 423, 425, 426, 448, 449, 450, 452, 455, 459, 460, 461, 462, 464, 465, 470, 471, 472, 474, 475 across Waves 5 + 6).

### 2.4 S3 tech-debt

8 items including BUG-403, 405, 414, 415, 419, 427, 428, 453, 466, 473, 476.

### 2.5 STRUCTURAL (architectural decisions)

- BUG-392 (first audit) — DB-trigger audit vs app-layer, decision needed
- BUG-409 (Wave 5) — specialty module stubs
- BUG-420 (Wave 5) — 1,712 `any` casts + 10 god-files
- BUG-421 (Wave 5) — Sara clinician mobile app does not exist (tracking)
- BUG-429 (Wave 5) — 654 uncovered routes

---

## 3. Per-finding summaries (by inventory file)

Wave 6 produced 13 inventory files under `docs/archive/audit-2026-04-24/findings/`. Each is a standalone enumeration. This section summarises — refer to each file for file:line detail.

### 3.1 `findings-6a-any-casts.md` — 1,712 type-safety escape hatches

**Workspace split:** api 464, web 1,248, shared 0.
**Top security-critical surface:** middleware (10 `as unknown as` casts on JWT payloads) + LLM prompt pipeline (~54 casts across aiEnhancer/scribeEnhancements/mcpServer).
**Clean surfaces:** `packages/shared/src/`, `features/legal/**`, `shared/phi*`.
→ BUG-420 (roll-up), BUG-463 (middleware discriminated union), BUG-464 (LLM pipeline), BUG-465 (VivaTab/SummaryTab), BUG-466 (ESLint rule).

### 3.2 `findings-6a-missing-clinic-id.md` — 263 Knex queries missing `clinic_id` filter

**186 high-confidence** + 77 possible false-positive (JOIN / object-spread).
**Worst features:** `mcp/` 42, `integrations/` 41, `seed-good-health/` 24, `features/llm/` 16.
→ BUG-368 (expansion), BUG-430 (new).

### 3.3 `findings-6a-soft-delete.md` — 27 Mode A + 0 Mode B

**27 sites query soft-deletable tables without `.whereNull('deleted_at')`.**
**Worst file:** `mcp/server/mcpServer.ts` 14 sites.
**FHIR surface:** 5 sites leak tombstones to integration partners.
→ BUG-434, 435, 436 (new).

### 3.4 `findings-6a-n-plus-1.md` — 11 HOT + 10 PARALLEL + 0 FOR_EACH_BUG

**Zero `forEach(async)` bugs** — CLAUDE.md §9.6 guard has held.
**Highest-impact HOT:** billingService `getInvoiceWithItems` per invoice; referralService `listAttachments` per row; MCP resolvers fired per row.
→ BUG-383/384 (first audit covered subset), BUG-431, 432, 433 (new).

### 3.5 `findings-6a-unbounded.md` — 24 primary + 19 related UNBOUND_LARGE

**Worst:** messaging `getInbox`/`getThread`; `patientRoutes /:id/notes` returning every note for a patient; pathology double-unbounded joins.
**Partial-clamp gaps:** auditReplayRoutes, staffSettingsRoutes `/audit-log`, MCP tool args.
→ BUG-370 (first audit — 5 endpoints), BUG-437 (expansion), BUG-438 (FHIR _count), BUG-439 (shared pageLimit helper), BUG-440 (MCP SQL aggregation).

### 3.6 `findings-6a-silent-catch.md` — 34 SILENT swallows

**3 P0 PHI** (plaintext fallback on encryption failure).
**2 P0 session-revocation** (jwtBlacklist fail-open).
**Auth audit swallows, Whisper/Ollama/Outlook health routes lie, ReceptionistPage bulk-SMS fabricates success.**
→ BUG-441, 442, 443, 444, 445, 446 (new).

### 3.7 `findings-6b-migrations.md` — 20 tables missing RLS + 2 CHECK gaps

**Strengths:** 100 % index coverage; 100 % §12.4 taxonomy compliance on non-baseline migrations; zero §7.4 violations.
→ BUG-454 (S0, RLS gap-closure), BUG-455 (CHECK constraints).

### 3.8 `findings-6b-routes-tests.md` — 654 of 725 routes uncovered (90 %)

**43 feature directories at 0 % coverage.**
**5 zombie tests** hitting non-existent routes (silent 404 passes).
→ BUG-429 (roll-up), BUG-451 (clinical-safety-critical tests), BUG-452 (zombie test fix + reverse CI guard), BUG-453 (post-staging systematic backfill).

### 3.9 `findings-6b-shared-types.md` — 6 ENUM_DRIFT + 13 redup + 2 dead contracts

**Worst:** LlmInteraction schema has zero overlap between shared Zod and frontend enum.
**Backend redeclaration:** Medication.
**Missing shared schemas:** LegalOrder.
→ BUG-456, 457, 458, 459, 460, 461, 462 (new).

### 3.10 `findings-6b-audit-action-union.md` — 10 raw `audit_log.insert` bypass sites writing 9 literals NOT in union

**Bypass files:** forbiddenAccessAudit, patientAccessAudit, superadminGuard, llmRoutes, breakGlassRoutes.
**Semantic-drift:** adminAlert.ts uses `UPDATE` for ADMIN_ALERT events.
→ BUG-467 (new).

### 3.11 `findings-6c-security-headers.md` — 13 gaps on otherwise-strong posture

**Strong posture confirmed** by live `curl -I localhost:4000/health`: HSTS 2y preload, helmet full suite, strict Permissions-Policy, proper cookie flags.
**Gaps:** CSP directives missing; authLimiter coverage holes; Emotion unsafe-inline; upload/webhook limiters absent.
→ BUG-468, 469, 470, 471, 472, 473 (new).

### 3.12 `findings-6c-wcag.md` — ~137 distinct WCAG 2.1 AA violation sites

**67 SC 2.1.1 keyboard-inaccessibility** (clickable `<Card>`/`<Paper>`/`<Box>` without role+tabIndex+onKeyDown across 36 files).
**14 SC 4.1.2 IconButton** missing accessible names.
**96 Dialogs share `aria-labelledby="dialog-title"`** — WCAG 4.1.1 parsing violation.
**Top patient-facing offenders:** MedicationsTab (prescription surface), EpisodesTab, AlertsPlansTab (safety plans), CorrespondenceTab, EctTab, EscalationList, DashboardPage.
→ BUG-447, 448, 449, 450 (new).

### 3.13 `findings-6c-deps.md` — 1 CRITICAL + 1 HIGH + 10 moderate + 1 low

**protobufjs 7.5.4** CRITICAL RCE (prod, OpenTelemetry chain) — `npm audit fix` is SAFE auto-fix.
**basic-ftp 5.2.0** HIGH (via pm2 → pac-proxy-agent) — SAFE auto-fix.
**uuid chain** moderate cluster gated on upstream bumps.
**npm audit fix `--force` is UNSAFE** — would downgrade Azure identity + yank bullmq.
→ BUG-373 (first audit — upgrade severity S1 → S0), BUG-474, 475, 476 (new).

---

## 4. Live probe artefacts

All three probes ran successfully (local dev env was live):

### Probe 1 — `npm audit --json`

- Artefact: `docs/archive/audit-2026-04-24/probes/npm-audit-root.json` (11 KB)
- Method: `cd /Users/.../Signacare && npm audit --json`
- Finding: 1 CRITICAL, 1 HIGH, 10 moderate, 1 low (captured in §3.13)

### Probe 2 — Live security headers

- Artefact: `docs/archive/audit-2026-04-24/probes/security-headers.txt`
- Method: `curl -I http://localhost:4000/health` + `curl -D -`
- Finding: Headers match `server.ts:280-316` configuration. CSP emitted, HSTS 2y preload, Permissions-Policy strict.

### Probe 3 — `EXPLAIN ANALYZE` on 9 hot-path queries

- Artefact: `docs/archive/audit-2026-04-24/probes/query-plans.txt` (145 lines)
- Method: `psql -p 5433 -U signacare_owner -d signacaredb -f <(9 hot queries)`
- Q10 (index-usage report) errored — `pg_stat_user_indexes` uses `relname` not `tablename` — cosmetic; Q1-Q9 succeeded.
- Results — current dev DB is small; all plans complete < 1 ms. At production scale, re-run is required per pre-deployment checklist.

**Note:** probes are captured for baseline; re-run at Azure staging with seeded production-volume data to detect N+1 + unbounded query regressions in a realistic load.

---

## 5. Severity triage — what gates Azure staging

### 5.1 Must close pre-clinician (S0)

| BUG | Title | Owner | Est effort |
|---|---|---|---|
| **BUG-368** | 5 patientRoutes `clinic_id` + CI guard (first audit) | — | 0.5 day |
| **BUG-369** | Clinical-note audit_log + CI guard (first audit) | — | 0.5 day |
| **BUG-373** (upgrade to S0) | `npm audit fix` (protobufjs CRITICAL + basic-ftp HIGH) | — | 0.5 day |
| **BUG-441** | phiEncryption fail-fast on encryption error | — | 0.5 day |
| **BUG-442** | jwtBlacklist fail-closed on Redis error | — | 0.5 day |
| **BUG-454** | RLS gap-closure — 20 tenant tables | — | 1 day |
| **BUG-393** | Allergy banner dismissibility (Wave 5) | — | 1 day |
| **BUG-395** | AI chat patient-context UUID lock (Wave 5) | — | 1 day |

**Total S0 effort estimate:** ~5 days of focused work with L1-L5 gate per commit.

### 5.2 Must close before first 10 clinicians use staging (S1)

22 items from §2.2 — ~15 days estimated.

### 5.3 Can close post-staging

S2 / S3 / STRUCTURAL — track in `bugs-remaining.md` as open work.

---

## 6. Integration health summary (Wave 6 additions)

Extends first-audit table + Wave 5 additions. Wave 6 adds:

| Integration | Wave 6 finding |
|---|---|
| Azure Monitor / App Insights | WCAG + performance observability gaps deferred to pre-deploy checklist |
| FHIR external surface | 5 soft-delete tombstone leaks (findings-6a-soft-delete) + `_count` not honoured (findings-6a-unbounded) |
| OpenTelemetry | protobufjs CRITICAL RCE in the tracing chain (findings-6c-deps) |

---

## 7. Known-unknowns for operator visibility

Wave 6 does NOT:
- Run axe-core live against `apps/web` for SC 1.4.3 contrast / SC 2.4.1 skip-links / SC 4.1.1 DOM parsing — deferred to live Playwright with axe-playwright
- Stress-test Redis failure modes against rate-limiters in production
- Prove 7-year retention + SAR export completeness without a seeded aged-patient dataset
- Prove the AI pipeline's non-inferential guard holds against adversarial prompts
- Verify ADHA CTS v3.0.1 conformance against the actual ADHA endpoint (BUG-344 open, vendor-credential gated)
- Verify eRx NPDS round-trip against the actual NPDS sandbox
- Verify HI Service SOAP against the actual HI endpoint

All seven are promoted to `docs/quality/pre-deployment-checklist.md` as mandatory Phase-5 or Phase-6 items before production cutover.

---

## 8. Cross-reference

- First audit: `docs/archive/audit-2026-04-24/deep-audit-report.md`
- Wave 5: `docs/archive/audit-2026-04-24/comprehensive-audit-report.md`
- Wave 6 inventories: `docs/archive/audit-2026-04-24/findings/findings-6*.md` (13 files)
- Wave 6 probes: `docs/archive/audit-2026-04-24/probes/` (3 artefacts)
- Bug catalogue: `docs/quality/bugs-remaining.md` (authoritative)

---

## 9. Final pre-staging posture

**Cumulative blockers for Azure staging first-clinician cutover:**
1. 2 CRITICAL from first audit (BUG-368 + BUG-369) + 1 CVE upgrade (BUG-373)
2. 3 S0 from Wave 6 (BUG-441 + BUG-442 + BUG-454)
3. 2 S0 from Wave 5 (BUG-393 + BUG-395)

**Total: 8 S0 items** — all closeable within ~5 engineering days under the L1-L5 gate discipline.

After S0 closure: **CONDITIONAL GO** for Azure staging with the S1 list scheduled to close in the first sprint on staging (before promotion to broader clinical use).

**Post-staging roadmap:** close S1 → S2 → S3 → STRUCTURAL in priority order. The total 109-bug catalogue is traceable from today's three reports; every future audit should start by verifying how many of these are still open.

**Terminal audit pass.** No further pre-Azure-staging audit is planned. All subsequent engineering work is fix-work against this catalogue, per the approved plan.
