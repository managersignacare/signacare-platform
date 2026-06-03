# `as any` Category B — Row-Interface Shortcut Depth Audit

**Date:** 2026-04-19
**Input inventory:** `inventory/every-as-any.md` — 37 Category B sites flagged
**Ghost-column bug class:** same as BUG-001/002 (buildPatientContext reading `medication_name` instead of `drug_label`)

## Summary

37 Category B casts confirmed. **3+ NEW ghost-column bugs discovered in the patients encryption layer.** Top 5 highest-risk call sites are in patientRepository + pathologyService + appointmentService.

## Per-service breakdown

| Service | Casts | Table | Row interface exists? |
|---|---|---|---|
| Allergies | 5 | `patient_allergies` | `AllergyRow` (not enforced at cast point) |
| Appointments | 7 | `appointments` | `AppointmentDb` |
| Waitlist | 4 | `waitlist_entries` | `WaitlistEntryDb` |
| Billing | 2 | `billing_accounts` | `BillingAccountRow` |
| Flags | 4 | `patient_flags` | `PatientFlagRow` |
| Pathology orders | 3 | `pathology_orders` | `PathologyOrderRow` |
| Pathology results | 3 | `pathology_results` | `PathologyResultRow` |
| Patients | 6 | `patients` | `PatientRow` **— encryption-layer risk** |
| Risk assessments | 3 | `risk_assessments` | `RiskAssessmentRow` |
| **Total** | **37** | — | — |

## NEW ghost-column bugs discovered

The `patients` module has the highest risk. `PatientRow` interface declares 64 columns but `encryptPatientPhi()` / `decryptPatientPhi()` perform bidirectional field renames:

| Column (interface expects) | Schema actual | Risk |
|---|---|---|
| `medicare_number` | `medicare_number` + `medicare_number_lookup` | interface reads plaintext, schema stores encrypted+lookup — dual columns |
| `ihi_number` | `ihi_number` + `ihi_number_lookup` | same |
| `dva_number` | `dva_number` + `dva_number_lookup` | same |

**BUG-095 CRITICAL** — `patientRepository.ts:125` (create path): encryption transform silently drops/renames on insert; cast bypasses the check.
**BUG-096 CRITICAL** — `patientRepository.ts:217` (bulk list): decrypt path silently drops fields on read; clinicians see incomplete patient records.
**BUG-097 HIGH** — `appointmentService.ts:485` (updateStatus invoice fallback): raw cast in invoice-generation path.

## Top 5 highest-risk call sites

1. **`apps/api/src/features/patients/patientRepository.ts:125`** (create) — encryption mismatch before DB write. **CRITICAL**.
2. **`apps/api/src/features/patients/patientRepository.ts:217`** (list) — bulk decrypt drops fields silently. **CRITICAL**.
3. **`apps/api/src/features/appointments/appointmentService.ts:485`** (updateStatus invoice) — raw cast in billing fallback. **HIGH**.
4. **`apps/api/src/features/pathology/pathologyService.ts:101`** (placeOrder) — DB row passed to mapper without type check. **HIGH**.
5. **`apps/api/src/features/appointments/appointmentService.ts:562`** (list) — bulk map with no per-row validation. **HIGH**.

## Proposed structural fix

For all 37: replace `row as any` with an explicit, schema-verified typed interface. The interfaces ALREADY EXIST in code but aren't enforced at cast point. Example:

```typescript
// WRONG
const row: AllergyRow = await db('patient_allergies').where({ id }).first() as any;

// RIGHT (verified against schema-snapshot.json)
const row = await db<AllergyRow>('patient_allergies').where({ id }).first();
// row is AllergyRow | undefined; no cast needed
```

One structural sweep per service (9 commits, one per service folder). Each commit also adds an `apps/api/src/features/<service>/rowTypes.ts` with the canonical row interface re-exported from schema-snapshot (if not already).

## Bugs catalogued

- **BUG-095** S0 patients create encryption mismatch
- **BUG-096** S0 patients list decryption mismatch
- **BUG-097** S1 appointment invoice raw cast
- **BUG-098** S2 pathology order mapper raw cast
- **BUG-099** S2 appointment list bulk raw cast
- **BUG-100 through BUG-131** (32 more) — each of remaining 32 Cat-B sites gets a BUG row (S3 defense-in-depth). Listed in inventory row-by-row.
