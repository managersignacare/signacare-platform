# BUG-393 — Allergy acknowledgement gate — Plan

## Root cause / finding (Wave 5 audit clarified)

The audit named `apps/web/src/features/patients/AllergyBanner.tsx` but that file doesn't exist. Actual state:

- `PatientDetailLayout.tsx:281` — allergies rendered as a non-dismissible `<Chip>` in the header. Clinicians see the list but are never forced to acknowledge it.
- `AllergyConflictBanner.tsx` — fires DURING prescribing when a drug name matches a known allergen. Useful but reactive (only appears after the drug name is typed).

**Clinical-safety gap:** no acknowledgement is required before the clinician can open the prescribing/medication UI. A busy clinician on handover can start a prescription without reviewing the allergy list.

## Gold-standard fix (scoped tight)

Create a reusable React gate: `<AllergyAckGate patientId>`. First render in a session shows an overlay with the patient's active allergies + NKA state + "I have reviewed these allergies" button. Acknowledgement is persisted to `sessionStorage` keyed by `(patientId, allergenHash)`. When the allergy list changes, the hash changes, and acknowledgement is re-required.

Wrap the `MedicationsTab` content so the prescription UI is gated. The gate is a cheap overlay — no re-render loop, no backend contract change.

## Files

- NEW `apps/web/src/features/risk-allergies/components/AllergyAckGate.tsx` (~100 lines)
- EDIT `apps/web/src/features/patients/components/detail/tabs/MedicationsTab.tsx` — wrap the outer return with `<AllergyAckGate patientId={patient.id}>`
- `docs/quality/fix-registry.md` — 2 rows (component exists + MedicationsTab wraps)
- `docs/quality/bugs-remaining.md` — mark BUG-393 fixed

## Test

Vitest component test: render `AllergyAckGate` with mock `useAllergies` data. Assert:
1. On first render overlay visible + children hidden
2. After clicking "I have reviewed" children visible + overlay hidden
3. Changing the allergens list rebuilds the hash + re-gates

Use React Testing Library + mock apiClient.

## L3/L4/L5

- L3: yes
- L4: yes (patient-safety gate + medications path — §13.5 semantic trigger)
- L5: yes? — touches frontend only; no `shared/` or middleware. L5 trigger per §13.5 fires ONLY for BE paths. Skip L5 unless overriden.
