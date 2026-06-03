# BUG-430-PATIENT-APP — Implementation Plan

[Source: Plan agent invocation 2026-04-24 per runbook PART 2 §B; verbatim record below for executor reference. APPENDIX A of /Users/drprakashkamath/.claude/plans/sleepy-roaming-meteor.md is the parent scope sheet.]

## 0. Source-of-truth verification (Plan agent confirmed)

- `dbAdmin` is RLS-bypassing — confirmed at apps/api/src/db/db.ts:144-161
- 24 allowlist entries all reference BUG-430-PATIENT-APP after BUG-430 commit 8f929dd
- JWT shape: `{id, patientId, clinicId, role:'patient', isPatientApp:true}` issued at patientAppRoutes.ts:387-396; req.user.patientId + req.user.clinicId + req.clinicId all populated by authMiddleware.ts:84-108
- All 13 affected tables have `clinic_id` columns (verified via schema-snapshot.json)
- AuditAction union does NOT yet contain `'PATIENT_APP_IDOR_ATTEMPT'`
- HttpError signature: `new HttpError(status, code, message, details?)` — code is open string union

## 1. Site classification (verified line-by-line)

### Class A — pre-auth (4 sites): 285, 322, 377, 382
Add explicit `clinic_id: <invite|account>.clinic_id` predicate.

### Class B — post-auth, ALREADY ownership-checked (6 sites): 925, 963, 993, 1038, 1113, 1210
Add `clinic_id: patient.clinic_id` for defence-in-depth. For 963/993, lookup `patient.clinic_id` once before the existing query.

### Class C — post-auth, IDOR-vulnerable (14 sites — DEPLOY-BLOCKER):
507, 555, 582, 591, 649, 679, 690, 699, 776, 790, 809, 847, 857, 880

Each needs:
1. `await requirePatientOwnership(req, req.params.patientId)` at handler top (before first dbAdmin call)
2. `clinic_id: req.clinicId` predicate in the WHERE

## 2. New helper `requirePatientOwnership` (apps/api/src/shared/authGuards.ts)

```typescript
import type { Request } from 'express';
import { HttpError } from './errors';
import { writeAuditLog } from '../utils/audit';

export async function requirePatientOwnership(
  req: Request,
  paramPatientId: string,
): Promise<void> {
  const tokenPatientId = (req.user as { patientId?: string } | undefined)?.patientId;
  const tokenClinicId = (req.user as { clinicId?: string } | undefined)?.clinicId ?? req.clinicId;
  const isPatientApp = (req.user as { isPatientApp?: boolean } | undefined)?.isPatientApp;
  const actorId = (req.user as { id?: string } | undefined)?.id ?? '';

  if (isPatientApp !== true || !tokenPatientId) {
    throw new HttpError(403, 'PATIENT_OWNERSHIP_MISMATCH', 'Patient-app session required');
  }
  if (tokenPatientId === paramPatientId) return;

  await writeAuditLog({
    clinicId: tokenClinicId ?? '00000000-0000-0000-0000-000000000000',
    actorId,
    action: 'PATIENT_APP_IDOR_ATTEMPT',
    tableName: 'patient_app_accounts',
    recordId: tokenPatientId,
    newData: {
      attempted_patient_id: paramPatientId,
      route: req.originalUrl,
      method: req.method,
      ip: req.ip ?? null,
    },
  });
  throw new HttpError(403, 'PATIENT_OWNERSHIP_MISMATCH', 'You can only access your own patient data');
}
```

Audit-write-then-throw ordering is HIPAA §164.312(b).

## 3. New audit-action literal `'PATIENT_APP_IDOR_ATTEMPT'`

Append to AuditAction union in apps/api/src/utils/audit.ts immediately after `'PATIENT_MERGED'`.

## 4. New L1 guard `scripts/guards/check-patient-app-ownership.ts`

Walks patientAppRoutes.ts. For every handler whose route contains `:patientId`, assert the body either:
1. Calls `requirePatientOwnership(req, req.params.patientId)` before first `dbAdmin(`, OR
2. Carries `// @patient-app-ownership-exempt: <reason>` annotation (≥10 chars after colon).

Add `"guard:patient-app-ownership"` script to root package.json.

## 5. TDD red plan (PART 2 §C)

apps/api/tests/integration/patientAppOwnership.int.test.ts:
- 14 IDOR negative tests (patient-A JWT GETs patient-B endpoint → expect 403)
- 6 Class B positive tests (own JWT works)
- 4 Class A pre-auth happy-path tests (clinic_id predicate doesn't break flow)

Pre-fix: 14 IDOR tests FAIL. Post-fix: 24/24 pass × 3 flake.

## 6. Allowlist deletion + invariant test cleanup

Delete in same atomic commit:
- `scripts/guards/check-query-has-clinic-id.allowlist.txt`
- `apps/api/tests/unit/clinicIdAllowlistInvariant.test.ts`

Guard at scripts/guards/check-query-has-clinic-id.ts:85-90 already handles file-not-exist (ENOENT → empty allowlist).

## 7. Fix-registry rows (4 anchors)

```
| R-FIX-BUG-430-PATIENT-APP-OWNERSHIP-GUARD | apps/api/src/shared/authGuards.ts | present | `export async function requirePatientOwnership` | ... |
| R-FIX-BUG-430-PATIENT-APP-IDOR-DRAINED | apps/api/src/features/patient-app/patientAppRoutes.ts | present | `requirePatientOwnership\(req, req\.params\.patientId\)` | ... |
| R-FIX-BUG-430-PATIENT-APP-CI-GUARD | scripts/guards/check-patient-app-ownership.ts | present | `requirePatientOwnership` | ... |
| R-FIX-BUG-430-PATIENT-APP-ALLOWLIST-DELETED | scripts/guards/check-query-has-clinic-id.allowlist.txt | absent | `BUG-430-PATIENT-APP` | ... |
```

## 8. Out-of-scope discoveries (file BEFORE this BUG's commit per PART 6.1#6)

- **BUG-486 (S2 post-staging)** — Convert ~63 patient-app `dbAdmin` queries to RLS-enforced `db`. NOT in bugs-remaining.md yet — must file.
- **BUG-488 (S1 candidate)** — patient-app entry-id-keyed IDOR. Verified sites: patientAppRoutes.ts:539 (PATCH /tracking/:entryId), :546 (DELETE /tracking/:entryId), :640 (PATCH /appointments/:appointmentId). Different fix shape: must verify entry/appointment.patient_id === req.user.patientId. NOT in 24-entry allowlist (no patient_id key). Must file.

## 9. PART 2 §A–§O execution checklist

§A done. §B done (this file). Continue:
- §C TDD red → write integration test
- §D implement (audit literal → helper → 24 site edits → new guard → delete allowlist + invariant test)
- §E L1 (tsc + 15 guards + new guard)
- §F L2 (3× flake + adjacent + unit + full integration since touches features/patient-app/ + shared/)
- §G L3 — code-reviewer-general
- §H L4 — clinical-safety-reviewer (semantic + path-based triggers BOTH fire)
- §I L5 — architecture-reviewer (4 triggers fire)
- §J absorb if needed (max 2 REJECTs/level)
- §K fix-registry verify (4 anchors)
- §L commit (single atomic; deletes + adds in one commit)
- §M bugs-remaining.md (BUG-430-PATIENT-APP fixed; BUG-486 + BUG-488 filed)
- §N push — after explicit user authorization
- §O progress.md
