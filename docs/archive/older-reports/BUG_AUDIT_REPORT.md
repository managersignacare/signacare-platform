# Signacare EMR — Consolidated Bug Audit Report
## Cross-referenced from two independent audits + manual verification

---

## Executive Summary

Two independent audits found overlapping but distinct issues. After verifying every finding against the actual codebase, the confirmed bug count is **32 real bugs** (some previously reported bugs were false positives).

The **single most impactful bug** is #1 below — it silently causes every clinical POST (alerts, notes, medications, legal orders, safety plans) to return 201 but roll back the transaction. Fixing this one bug alone will resolve ~10 user-reported "save doesn't work" issues.

---

## TIER 1: CRITICAL — Data Loss & Security (8 bugs)

### 1. Transaction Poisoning — autoContactRecord.ts:39
**File:** `api/features/contacts/autoContactRecord.ts`
**Verified:** YES — confirmed via E2E test + DB inspection (POST returns 201 but row count stays 0)
```
content::jsonb->>'sourceId'  — JSONB operator on TEXT column
```
**Root cause:** SQL error inside RLS transaction. PostgreSQL marks transaction as aborted. Even though JS catches the error, COMMIT fails and all data in that request is lost.
**Impact:** Every POST to `/patients/:id/alerts`, `/patients/:id/notes`, `/safety-plans`, `/legal-orders`, `/medications`, `/hotspot` loses data silently.
**Fix:** `SAVEPOINT` isolation + `content::jsonb` cast (already partially applied).

### 2. Clinical Notes PATCH — wrong column names (8 fields)
**File:** `api/features/patients/patientRoutes.ts:307-318`
**Verified:** YES
```
patch.foicontent     → should be patch.foi_content
patch.foiexempt      → should be patch.foi_exempt
patch.didnotattend   → should be patch.did_not_attend
patch.isreportablecontact → should be patch.is_reportable_contact
patch.contactmeta    → should be patch.contact_meta
patch.episodeid      → should be patch.episode_id
patch.signedbyid     → should be patch.signed_by_id
patch.signedat       → should be patch.signed_at
```
**Impact:** Note signing, FOI marking, episode linking, attendance marking all silently fail.

### 3. Clinical Notes GET — wrong column reads (8 fields)
**File:** `api/features/patients/patientRoutes.ts:257-265`
**Verified:** YES
```
r.notetype           → should be r.note_type
r.foicontent         → should be r.foi_content
r.foiexempt          → should be r.foi_exempt
r.didnotattend       → should be r.did_not_attend
r.isreportablecontact → should be r.is_reportable_contact
r.contactmeta        → should be r.contact_meta
r.signedbyid         → should be r.signed_by_id
r.signedat           → should be r.signed_at
```
**Impact:** Frontend receives null for note type, signer, FOI status — data appears missing.

### 4. Legal Orders PATCH — wrong column names (6 fields)
**File:** `api/features/patients/patientRoutes.ts:375`
**Verified:** YES
```
'ordernumber'          → 'order_number'
'startdate'            → 'start_date'
'enddate'              → 'end_date'
'reviewdate'           → 'review_date'
'nextapplicationdate'  → 'next_application_date'
'aisummary'            → 'ai_summary'
```
**Impact:** Legal order date changes never persist — MH Act compliance risk.

### 5. Escalation ISBAR columns don't exist
**File:** `api/features/escalations/escalation.repository.ts:46-49, 134-137`
**Verified:** YES — migration defines `situation`, `background`, `assessment`, `recommendation` but code uses `isbar_situation`, `isbar_background`, `isbar_assessment`, `isbar_recommendation`.
**Impact:** Escalation creation and listing crash at runtime.

### 6. MFA recovery codes use Math.random()
**File:** `api/features/auth/authRoutes.ts:47-50`
**Verified:** YES
```typescript
Math.random().toString(36).substring(2, 8).toUpperCase()
```
**Impact:** Cryptographically weak recovery codes. Should use `crypto.randomBytes()`.

### 7. Hotspot PATCH — no clinic_id filter
**File:** `api/features/patients/patientRoutes.ts:562-569`
**Verified:** YES — `db('hotspots').where({ id: req.params.hotspotId }).update(...)` has no clinic_id check.
**Impact:** Authorization bypass — any authenticated user can modify any clinic's hotspots.

### 8. CorrespondenceTab.tsx — variable used before defined
**File:** `web/features/.../CorrespondenceTab.tsx:145`
**Verified:** YES — `selectedDetails` used in mutation at line 145 but defined at line 170.
**Impact:** SMS send crashes with ReferenceError.

---

## TIER 2: HIGH — Data Integrity Issues (8 bugs)

| # | File | Bug | Impact |
|---|------|-----|--------|
| 9 | `SafetyPlanTab.tsx:169-180` | Form sends camelCase (`warningSign`) but API stores snake_case (`warning_signs`) | Safety plan data lost |
| 10 | `AppointmentsPage.tsx:395-402` | POST missing `title`, `mode`, `team`, `mbsItem` from form | Appointments have no title |
| 11 | `AlertsPlansTab.tsx:568` | Goals POST sends `goalText`/`goalType` but API expects `title`/`category` | Goals don't save |
| 12 | `patientRoutes.ts:555` | Hotspot INSERT uses `status: 'active'` but column is `is_active` boolean | Hotspot creation may fail |
| 13 | `patientRoutes.ts:562` | Hotspot PATCH uses non-existent columns `resolved_at`, `resolution_notes` | Hotspot resolution fails |
| 14 | `staffSettingsRepository.ts:62-124` | Type expects `orgunitname` but query returns `org_unit_name` | Team assignments display wrong |
| 15 | `tasks/taskController.ts:12-50` | Uses `req.user!.clinicId` instead of `req.clinicId` | Potential cross-tenant leak |
| 16 | `patientRoutes.ts:687` | Provider DELETE uses hard delete, contacts use soft delete | Inconsistent audit trail |

---

## TIER 3: MEDIUM — UI/Query Issues (6 bugs)

| # | File | Bug | Impact |
|---|------|-----|--------|
| 17 | `AlertsPlansTab.tsx:575,582` | Goals query key mismatch (`['care-plan-goals']` vs `['care-plan-goals', planId]`) | UI doesn't refresh |
| 18 | `patientRoutes.ts:236` | Attachment reads `r.mimetype` instead of `r.mime_type` | Metadata null |
| 19 | `AlertsPlansTab.tsx:314,451` | `JSON.parse(tmpl.content)` without try-catch | Tab crashes on bad JSON |
| 20 | `rlsMiddleware.ts:63` | Transaction commits on `res.on('finish')` even for 5xx | Partial data on errors |
| 21 | `mcpServer.ts:161-308` | ILIKE queries don't escape `%` and `_` in user input | Unexpected search results |
| 22 | `server.ts:2-9` | `uncaughtException` handler doesn't terminate process | Corrupted state persists |

---

## TIER 4: LOW — Null Pointer / Crash Risks (10 bugs)

| # | File | Line | Bug |
|---|------|------|-----|
| 23 | `SummaryTab.tsx` | 85-87 | `sorted[0].createdAt` on empty array — Summary tab crashes for new patients |
| 24 | `MedicationsTab.tsx` | 640 | `meds[0].medicationName` on empty array — Represcribe dialog crashes |
| 25 | `IncidentsTab.tsx` | 330 | `.split('=== DESCRIPTION ===')` on wrong format — Incident descriptions blank |
| 26 | `HandoverListPage.tsx` | 68, 277 | `JSON.parse()` without try-catch — Handover page crashes on bad JSON |
| 27 | `DashboardPage.tsx` | 212 | `a.type?.replace()` shows "undefined" when type is null |
| 28 | `IncidentsTab.tsx` | 255 | Severity count fails on undefined — Critical incident badge count inaccurate |
| 29 | `AppointmentsTab.tsx` | 301 | `startTime.split(':')` on null — Appointment time display errors |
| 30 | `PatientRegistrationWizard.tsx` | 161 | Empty name creates ghost contacts — Data corruption |
| 31 | `TasksPage.tsx` | 92 | `t.category.replace()` on null — Tasks page crash (ALREADY FIXED) |
| 32 | `hl7Worker.ts` | 139 | TODO: HL7 transmit not implemented — Feature incomplete |

---

## External Audit Findings — My Assessment

### Confirmed as real bugs (agree):
- Transaction poisoning (Bug #1) — **this is THE critical bug**
- All snake_case mismatches in patientRoutes.ts (Bugs #2-4)
- Escalation ISBAR columns (Bug #5) — **new finding, real bug**
- MFA Math.random (Bug #6) — **security issue, agree**
- CSRF accepting X-Request-Id — **valid concern but low risk** (same-origin header still provides protection)
- ILIKE wildcard escape (Bug #21) — **agree, low-priority**
- uncaughtException handler (Bug #22) — **agree, production reliability issue**
- HL7 TODO (Bug #32) — **incomplete feature, not a runtime bug**

### Refuted / false positives:
- **reportsRepository.ts column names** — FALSE. The migration intentionally creates columns as `clinicid`, `reporttype`, etc. (unusual but the code matches the schema).
- **clinicalReviewRepository.ts aliases** — FALSE. The lowercase aliases match what the SQL returns.
- **"tsconfig.json baseUrl deprecated in TS 7.0"** — FALSE. We're on TS 5.x, this is a non-issue.
- **"eslint: command not found"** — environment issue, not a code bug.

### Partially correct:
- **staffSettingsRepository type mismatch** — TRUE but low impact (defensive `??` fallbacks exist).
- **"CSRF too permissive"** — The `x-request-id` acceptance is intentional (Axios sets it on every request as a custom header, which browsers won't send cross-origin without CORS approval). Not ideal but not exploitable.

---

## Root Cause Analysis

The bugs cluster around **3 systemic issues**:

### Issue A: autoContactRecord transaction poisoning
One SQL error in one utility function silently breaks ~10 clinical endpoints. This is an architectural flaw — a non-critical utility (ABF contact record creation) runs inside the same DB transaction as the critical operation (saving an alert/note). The utility's failure should never roll back the parent operation.

### Issue B: Manual snake_case ↔ camelCase conversion
The codebase has no automatic conversion between PostgreSQL snake_case and JavaScript camelCase. Every endpoint hand-writes the mapping, leading to ~20 instances of wrong column names (`foicontent` instead of `foi_content`, `isbar_situation` instead of `situation`).

**Recommended fix:** Add Knex `postProcessResponse` and `wrapIdentifier` hooks to db.ts for automatic conversion. This eliminates the entire class of bugs at the infrastructure level.

### Issue C: Missing null guards on API response data
The frontend trusts API responses to always have complete data. When the backend returns null/undefined (often due to Issue B), the frontend crashes with `.split()`, `.replace()`, `[0].property` on null values.

---

## Fix Priority Order

| Priority | Bugs | Effort | Impact |
|----------|------|--------|--------|
| **P0 — Fix today** | #1 (transaction poison) | 30 min | Unblocks ALL clinical saves |
| **P1 — Fix this week** | #2-5 (column mismatches) | 2 hrs | Notes, legal orders, escalations work |
| **P1 — Fix this week** | #6-8 (security + crash) | 1 hr | MFA, authz, SMS |
| **P2 — Fix next** | #9-16 (data integrity) | 3 hrs | Safety plan, appointments, goals |
| **P2 — Fix next** | Add Knex auto-conversion hooks | 2 hrs | Prevents ALL future column name bugs |
| **P3 — Cleanup** | #17-32 (null guards, query keys) | 3 hrs | Stability |

---

## Files to Modify (16 files)

| File | Bug #s | Changes |
|------|--------|---------|
| `api/features/contacts/autoContactRecord.ts` | 1 | SAVEPOINT + jsonb cast |
| `api/features/patients/patientRoutes.ts` | 2-4, 12-14, 16, 18 | ~35 column name fixes |
| `api/features/escalations/escalation.repository.ts` | 5 | Remove `isbar_` prefix from 4 columns |
| `api/features/auth/authRoutes.ts` | 6 | crypto.randomBytes for recovery codes |
| `api/features/contacts/contactRecordRoutes.ts` | 3 | 4 column name fixes |
| `api/features/tasks/taskController.ts` | 15 | req.clinicId instead of req.user.clinicId |
| `api/features/staff-settings/staffSettingsRepository.ts` | 14 | Fix type definitions |
| `api/src/server.ts` | 22 | process.exit(1) on uncaught exceptions |
| `web/.../SafetyPlanTab.tsx` | 9 | Key mapping on save |
| `web/.../AppointmentsPage.tsx` | 10 | Add missing POST fields |
| `web/.../AlertsPlansTab.tsx` | 11, 17, 19 | Goal fields, query keys, try-catch |
| `web/.../CorrespondenceTab.tsx` | 8 | Move variable declaration |
| `web/.../SummaryTab.tsx` | 23 | Empty array guard |
| `web/.../MedicationsTab.tsx` | 24 | Empty array guard |
| `web/.../HandoverListPage.tsx` | 26 | try-catch JSON.parse |
| `api/mcp/server/mcpServer.ts` | 21 | Escape LIKE wildcards |
