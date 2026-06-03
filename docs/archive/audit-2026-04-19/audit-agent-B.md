# Signacare EMR — Field/Column Name Consistency Audit (Agent B)

**Audit Date:** 2026-04-18
**Scope:** Layer boundary mismatches (frontend→backend wires, Zod schemas, DB columns)
**Thoroughness:** Very thorough

---

## Section 1 — Guard Output (Current Violations)

### Guard Scripts Status

| Guard Script | Result | Violations |
|---|---|---|
| `npm run guard:query-builder-columns` | ✅ PASS | 0 |
| `npm run guard:code-columns` | ✅ PASS | 0 |
| `npm run guard:row-iface-drift` | ✅ PASS | 0 |

**Summary:** All query-builder, code-write, and row-interface guards pass. No schema drift detected.

---

## Section 2 — Frontend/Backend Wire Mismatches

### Finding A: Group Therapy Attendee API — camelCase/snake_case mismatch

**File:** `/Users/drprakashkamath/Projects/Signacare/apps/web/src/features/group-therapy/pages/GroupTherapyPage.tsx:223`

**Severity:** HIGH

**Issue:**
Frontend sends POST body with snake_case key:
```
mutationFn: (patientId: string) => apiClient.post(`group-therapy/${session.id}/attendees`, 
  { patient_id: patientId, attendance: 'present' })
```

Backend Zod schema expects snake_case, but by convention frontend should send camelCase.

**Why It's Wrong:**
Frontend code sends snake_case (inconsistent with convention). All other endpoints receive camelCase from frontend via the wire.

**Gold-Standard Fix:**
Change Zod schema to accept `patientId` instead of `patient_id`.

---

### Finding B: Bed Board & Related Pages — Defensive fallback to non-existent field names

**Files:**
- `/Users/drprakashkamath/Projects/Signacare/apps/web/src/features/beds/pages/BedBoardPage.tsx:31`
- `/Users/drprakashkamath/Projects/Signacare/apps/web/src/features/beds/components/KanbanBoard.tsx`
- `/Users/drprakashkamath/Projects/Signacare/apps/web/src/features/lists/pages/AdmissionWaitlistPage.tsx`
- `/Users/drprakashkamath/Projects/Signacare/apps/web/src/features/drafts/pages/DraftsPage.tsx`
- `/Users/drprakashkamath/Projects/Signacare/apps/web/src/features/handover/pages/HandoverListPage.tsx:184`

**Severity:** MEDIUM

**Issue:**
Frontend uses defensive fallbacks to snake_case fields that should never be returned:
```
b.status === 'occupied' && (b.patientId ?? b.patient_id)
```

The camelCaseResponse middleware transforms all snake_case to camelCase. The fallback masks bugs.

**Why It's Wrong:**
Defensive fallbacks indicate uncertainty and hide real routing/middleware issues if they occur.

**Gold-Standard Fix:**
Remove fallback branches. Use only `b.patientId` (camelCase).

---

### Finding C: Clinical List Page — Fallback to all-lowercase `patientid`

**File:** `/Users/drprakashkamath/Projects/Signacare/apps/web/src/features/lists/pages/ClinicalListPage.tsx:102`

**Severity:** MEDIUM

**Issue:**
```
const pid = a.patient_id ?? a.patientid;
```

The field `a.patientid` (all lowercase) is never returned by the API. This is a defensive fallback to a non-existent field.

**Why It's Wrong:**
CamelCaseResponse middleware converts `patient_id` → `patientId`, never `patientid`.

**Gold-Standard Fix:**
```
const pid = a.patientId;
```

---

### Finding D: Handover Page — Inconsistent field access for staff IDs

**File:** `/Users/drprakashkamath/Projects/Signacare/apps/web/src/features/handover/pages/HandoverListPage.tsx:184`

**Severity:** MEDIUM

**Issue:**
```
const authorId = handover.outgoingStaffId ?? handover.outgoing_staff_id ?? '';
```

Defensive fallback to snake_case field that should never occur.

**Why It's Wrong:**
CamelCaseResponse middleware should always return `outgoingStaffId`.

**Gold-Standard Fix:**
```
const authorId = handover.outgoingStaffId ?? '';
```

---

## Section 3 — Unused `_prefixed` Param Audit

### Finding E: Unused `_staffId` in waitlist service — Suspicious

**File:** `/Users/drprakashkamath/Projects/Signacare/apps/api/src/features/appointments/waitlistService.ts:46,116`

**Severity:** LOW (Likely legitimate audit param)

**Issue:**
Function signatures include `_staffId` parameter but never use it:
```
async create(clinicId: string, _staffId: string, dto: ...): ... {
  // _staffId never referenced
  const rowToInsert = { ... };  // no created_by_staff_id
}
```

**Assessment:**
Could be: (A) Intentional audit param for permissions, (B) Missing audit trail recording.

**Recommendation:**
Verify if `waitlist` table has `created_by_staff_id` column. If yes, add it to insert. If no, add JSDoc explaining why param is unused.

---

### Finding F: Prescription repository — Legitimate no-op

**File:** `/Users/drprakashkamath/Projects/Signacare/apps/api/src/features/prescriptions/prescriptionRepository.ts:155`

**Assessment:** LEGITIMATE. Intentional stub with JSDoc comment explaining why parameters are unused.

---

## Section 4 — Zod Schema vs Wire Shape Gaps

### Issue: Group Therapy DTOs — snake_case in schema

**Schema:** `packages/shared/src/groupTherapy.Schemas.ts:20-23`

Zod schema uses snake_case:
```
export const AddGroupAttendeeSchema = z.object({
  patient_id: z.string().uuid(),  // Should be patientId
  attendance: z.enum([...]),
});
```

**Fix:** Change to `patientId: z.string().uuid()` for consistency with wire convention.

### Summary

No other significant Zod ↔ frontend wire mismatches detected. CamelCaseResponse middleware successfully bridges DB snake_case ↔ frontend camelCase.

---

## Section 5 — Raw SQL Column-Name Regressions

### Result: No violations detected

All raw SQL in TypeScript correctly uses snake_case column names.

---

## Summary & Recommendations

| Category | Count | Severity |
|---|---|---|
| camelCase/snake_case wire mismatches | 1 | HIGH |
| Defensive fallback anti-patterns | 4 | MEDIUM |
| Suspicious unused params | 1 | LOW |
| Raw SQL regressions | 0 | — |

### Immediate Actions

1. **Fix Group Therapy Schema (Finding A):** Change `AddGroupAttendeeSchema` to use `patientId`.
2. **Remove defensive fallbacks (Findings B, C, D):** Replace all `field ?? snake_case_variant` with just `field`.
3. **Investigate waitlist `_staffId` (Finding E):** Check if audit trail needed; add if table has the column.

---

**Report Generated:** 2026-04-18
**Guard Scripts:** All passing ✅
**Overall Status:** 5 findings (1 HIGH, 4 MEDIUM, 1 LOW)
