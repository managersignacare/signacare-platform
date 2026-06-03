# Plan — BUG-456 REPLAY: Medication backend/frontend schema alignment

[Plan agent invocation 2026-04-25 per `~/.claude/plans/sleepy-roaming-meteor.md` PART 2 §B; first-principles re-derivation per PART 6.1 #3 — no read of any reverted commit (`be8d924`). Atomic-scope per PART 11.]

**Severity:** S1 deploy-blocker (pre-staging)
**Replay queue position:** PART 1 Tier-3 #17 (after BUG-469)
**Sibling shipped at HEAD:** BUG-469 (`560fb90`) — orthogonal (rate-limiters); zero overlap.

---

## 0. Executive summary

The bug catalogue row at `docs/quality/bugs-remaining.md:157` says: *"Medication backend/frontend schema alignment (backend redeclares `MedicationResponse`)"*. Ground-truth confirms a real, currently-shipped drift:

- **SSoT:** `packages/shared/src/medication.schemas.ts:53-83` — `MedicationResponseSchema` Zod object whose `z.infer` is the exported `MedicationResponse` type.
- **Backend redeclares it** at `apps/api/src/features/medications/medicationService.ts:10-36` with a different field set.
- **Frontend imports the canonical type** from `@signacare/shared` (verified in `medicationApi.ts:3`, `MedicationList.tsx:24`). So the frontend EXPECTS the SSoT shape; the backend SHIPS its own shape.
- **Mapper** `toResponse(r: MedicationRow): MedicationResponse` at `medicationService.ts:38-71` returns the backend-local shape — that's what controllers `res.json(...)` back.

### 0.1 Drift matrix (key fields)

| Field | Backend ships? | SSoT requires? | Status |
|---|---|---|---|
| `drugProductId`, `drugCode`, `brandName` | ✗ | ✓ | **MISSING from wire** (DB columns exist) |
| `instructions`, `startDate`, `endDate` | ✗ | ✓ | **MISSING from wire** |
| `reasonForCessation`, `isRegular`, `isPrn` | ✗ | ✓ | **MISSING from wire** |
| `taperSchedule`, `source`, `prescribedByStaffId`, `notes` | ✗ | ✓ | **MISSING from wire** |
| `medicationName`, `isClozapine`, `isS8` | ✓ | ✗ | EXTRA (legacy/derived) |
| `laiFrequency`, `laiNextDue`, `laiLastAdmin` | ✓ (always null) | ✗ | EXTRA (ghost columns; LAI lives in `lai_schedules`) |
| `prescribedAt`, `prescriber` | ✓ | ✗ | EXTRA (legacy aliases) |
| `prescribedBySpecialty`, `category` | ✓ | ✗ | EXTRA |
| `status` | ✓ as `string` | ✓ as `MedicationStatusEnum` | TYPE-WIDENED |

**Net:** 12 fields missing, 9 extra, 1 type-widened.

### 0.2 Why this is a deploy-blocker

1. Frontend reads `m.brandName`, `m.startDate` — gets `undefined` at runtime; UI shows blank cells.
2. Any defensive `MedicationResponseSchema.parse()` on the receive side would 500.
3. `status` widening is clinical-safety risk — malformed DB row propagates.
4. `prescribedByStaffId` (BUG-040 attribution) dropped from wire — AHPRA traceability concern.

### 0.3 Out-of-scope (PART 11 atomic)

- BUG-457 (LlmFeature drift), BUG-458 (Appointment shape), BUG-459 (patientRoutes raw rows), BUG-460 (extend duplicate-types guard), BUG-461 (LegalOrderResponseSchema), BUG-465 (VivaTab/SummaryTab type-safety) — separate cycles.

---

## 1. Current state — ground-truth Read

### 1.1 SSoT — `packages/shared/src/medication.schemas.ts:1-83`

- `MedicationStatusEnum` (3-9) — `'active'|'tapering'|'ceased'|'suspended'|'on_hold'`.
- `MedicationResponseSchema` (53-82) — 28 camelCase fields.
- `MedicationResponse = z.infer<typeof MedicationResponseSchema>` (83).
- Re-exported from `packages/shared/src/index.ts:19`.

### 1.2 Backend redeclaration — `apps/api/src/features/medications/medicationService.ts:10-36`

`export interface MedicationResponse { ... }` with 26 fields. Drift per §0.1.

### 1.3 Mapper — `medicationService.ts:38-71`

`function toResponse(r: MedicationRow): MedicationResponse` returns backend-local shape.

### 1.4 DB row — `medicationRepository.ts:27-60`

`MedicationRow` matches `patient_medications` schema-snapshot (lines 2465-2498). Every SSoT field has a real column — fix is mechanical.

### 1.5 Frontend consumers (untouched)

- `apps/web/src/features/medications/services/medicationApi.ts:3` — imports `MedicationResponse` from `@signacare/shared`.
- `apps/web/src/features/medications/components/MedicationList.tsx:24` — same.

### 1.6 CI guard gap

`.github/scripts/check-no-duplicate-api-types.sh:48-71` scans only `packages/shared/src` and `apps/web/src/features/*/types/*.ts`. Backend service files NOT in scope → backend redeclaration slipped past every CI run. Filed as BUG-460 follow-up; out of scope here.

---

## 2. Design — consolidate to SSoT, mapper rewrite, parse-on-emit

### 2.1 Atomic edits

| File | Change |
|---|---|
| `apps/api/src/features/medications/medicationService.ts` | Delete `interface MedicationResponse` (10-36); add `import { MedicationResponseSchema, type MedicationResponse } from '@signacare/shared'`; rewrite `toResponse()` to populate every SSoT field directly; run `MedicationResponseSchema.parse()` on the mapper output before return |
| `apps/api/tests/integration/medicationResponseShape.int.test.ts` | NEW — 5 cases verifying SSoT alignment |
| `docs/quality/fix-registry.md` | 3 anchor rows |
| `docs/quality/bugs-remaining.md` | Mark BUG-456 fixed atomic with code commit (Wave A-4/A-5 discipline) |

No frontend changes. No CI guard changes. No migration. No `medicationRepository.ts`/Controller/Routes touches.

### 2.2 Rewritten `toResponse()` shape

```ts
import { MedicationResponseSchema, type MedicationResponse } from '@signacare/shared';

function toResponse(r: MedicationRow): MedicationResponse {
  const candidate = {
    id: r.id, clinicId: r.clinic_id, patientId: r.patient_id, episodeId: r.episode_id,
    drugProductId: r.drug_product_id, drugCode: r.drug_code, drugLabel: r.drug_label,
    genericName: r.generic_name, brandName: r.brand_name,
    dose: r.dose, doseUnit: r.dose_unit, route: r.route, frequency: r.frequency,
    instructions: r.instructions, indication: r.indication,
    startDate: r.start_date, endDate: r.end_date,
    status: r.status,
    reasonForCessation: r.reason_for_cessation,
    isRegular: r.is_regular, isPrn: r.is_prn, isLai: r.is_lai,
    taperSchedule: r.taper_schedule,
    source: r.source ?? 'manual',
    prescribedByStaffId: r.prescribed_by_staff_id,
    notes: r.notes,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
  // Fail-loud rather than silently shipping drift back to the frontend.
  return MedicationResponseSchema.parse(candidate);
}
```

`source` defaults to `'manual'` because SSoT marks it `string` (non-nullable); `MedicationRow.source` is `string | null`. Coalesce per repository default precedent.

### 2.3 Why parse-on-emit

Mapper is the SSoT for response shape; that's where parse goes. Single touch site (5 controller methods all go through `toResponse`). Cost: one Zod parse per medication row in list responses (typical patient: <50 rows). Acceptable.

Status enum: pre-fix any DB string propagates; post-fix non-enum value 500s + structured pino warn. Fail-loud > fail-silent per PART 6.1 #2.

### 2.4 What changes for callers

The exported type `MedicationResponse` shape changes. All in-file callers within `medicationService.ts` (lines 93, 187, 203, 223, 255). After rewrite: `import type { MedicationResponse } from '@signacare/shared'`. Controllers / routes don't reference the type symbol — they `res.json(result)`.

`tsc --noEmit -p apps/api/tsconfig.json` is the enforcement.

---

## 3. TDD red plan — `apps/api/tests/integration/medicationResponseShape.int.test.ts` (NEW)

5 test cases:

| # | Test | Pre-fix |
|---|---|---|
| S1 | POST `/medications` returns body satisfying `MedicationResponseSchema.safeParse` | FAIL: 12+ Zod issues for missing fields |
| S2 | GET `/medications/:id` has all 13 historically-missing fields present | FAIL: each `expect(m).toHaveProperty(...)` fails |
| S3 | Response does NOT include legacy fields (`medicationName`, `isClozapine`, etc.) | FAIL: legacy fields are present |
| S4 | `status` is one of the SSoT enum values | PASS today (typically) but regression-trap |
| S5 | List-by-patient — every row satisfies `MedicationResponseSchema` | FAIL: same as S1 |

3× flake on the new file. §13.9 feature-scoped (touches medications/ only, not middleware/shared/db/migrations).

---

## 4. Files modified

| File | Change |
|---|---|
| `apps/api/src/features/medications/medicationService.ts` | Delete redeclaration + rewrite mapper + parse on emit |
| `apps/api/tests/integration/medicationResponseShape.int.test.ts` | NEW |
| `docs/quality/fix-registry.md` | 3 anchor rows |
| `docs/quality/bugs-remaining.md` | Mark BUG-456 fixed |

---

## 5. Fix-registry anchors

| Row | File | Mode | Pattern |
|---|---|---|---|
| `R-FIX-BUG-456-NO-BACKEND-REDECLARATION` | `apps/api/src/features/medications/medicationService.ts` | absent | `(interface\|type) MedicationResponse[ <={]` |
| `R-FIX-BUG-456-SHARED-SSOT-IMPORT` | `apps/api/src/features/medications/medicationService.ts` | present | `import.*MedicationResponse.*@signacare/shared` |
| `R-FIX-BUG-456-MAPPER-SSOT-PARSE` | `apps/api/src/features/medications/medicationService.ts` | present | `MedicationResponseSchema\.parse\(` |

---

## 6. L4 / L5 conditional triggers

### 6.1 L4 — **FIRES**

Per §13.5 path trigger — `apps/api/src/features/medications/`. L4 reviewer focal points:
1. Status enum tightening — pre-fix any DB string passed through; post-fix Zod parse 500s on non-enum. Failure mode: malformed row 500s the response. Mitigation: structured pino warn + ops alert.
2. `prescribedByStaffId` re-exposure — formerly dropped, now emitted. UUID only, no PHI escape.
3. Ghost-field removal — `isClozapine`, `isS8`, `laiFrequency/NextDue/LastAdmin`, `prescriber`, `prescribedAt`. Frontend reads coalesce via `??` to canonical names; no clinical-safety regression.

### 6.2 L5 — **FIRES**

Per §I trigger — modifies `fix-registry.md`. L5 reviewer focal points:
1. SSoT discipline — confirms redeclaration deletion is right shape.
2. Schema parse on emit — accepted pattern.
3. Atomic scope — BUG-457/458/459/460/461 NOT folded in.

### 6.3 L3 — fires unconditionally.

---

## 7. PART 2 §A-§O execution map

§A done. §B done. §C TDD red — write `medicationResponseShape.int.test.ts`, verify 5 cases FAIL with Zod parse-issue shape. §D Implementation. §E L1. §F L2 (3× flake + adjacent feature integration). §G L3. §H L4 (path trigger fires). §I L5 (fix-registry trigger fires). §J 2-REJECT absorb cap. §K fix-registry. §L commit (atomic with bugs-remaining flip per BUG-468 absorb-1 lesson). §M chore commit with SHA. §N push (after explicit user authorization). §O.

---

## 8. Verification log — every cited site Read-confirmed

| Item | File | Line |
|---|---|---|
| BUG-456 row | `docs/quality/bugs-remaining.md` | 157 |
| SSoT enum | `packages/shared/src/medication.schemas.ts` | 3-9 |
| SSoT response schema | `packages/shared/src/medication.schemas.ts` | 53-82 |
| SSoT response type | `packages/shared/src/medication.schemas.ts` | 83 |
| Backend redeclaration | `apps/api/src/features/medications/medicationService.ts` | 10-36 |
| Backend mapper | `apps/api/src/features/medications/medicationService.ts` | 38-71 |
| MedicationRow | `apps/api/src/features/medications/medicationRepository.ts` | 27-60 |
| Ghost-column comment | `apps/api/src/features/medications/medicationRepository.ts` | 11-26 |
| DB schema (verified) | `apps/api/src/db/schema-snapshot.json` | 2465-2498 |
| Frontend canonical-import | `apps/web/src/features/medications/services/medicationApi.ts` | 3 |
| Frontend list component | `apps/web/src/features/medications/components/MedicationList.tsx` | 24, 82, 94 |
| CI guard scope (frontend types only) | `.github/scripts/check-no-duplicate-api-types.sh` | 48-71 |
| TaskResponse historical precedent | `.github/scripts/duplicate-api-types.allowlist` | 30-36 |

---

## 9. Risks + open questions

1. **`source` nullability** — coalesce to `'manual'`. L5 may prefer widening SSoT; default is coalesce.
2. **`status` widening tolerance** — DB `string` vs SSoT enum. Post-fix any off-enum row 500s. L4 may demand a CHECK migration as absorb path.
3. **Frontend legacy-name readers** — 8+ tabs read `m.medicationName ?? m.drugLabel`, `m.prescribedAt ?? m.startDate`, `m.isClozapine`, etc. via `??` from `any`-typed objects. Removing legacy fields means soft tags (e.g. `[S8]` flag in AmbientAiRecorder) drop. Display-only degradation; no clinical-safety regression. L4 to confirm.
4. **`prescribedBySpecialty`, `category`** — dropped from wire. Grep confirms no frontend reader.
5. **Test budget** — 5 round-trip integration cases × ~2s = ~10s. Within budget.

---

## 10. Out-of-scope sibling drift (PART 3 catalogue)

- BUG-457 (LlmFeature drift)
- BUG-458 (Appointment shape)
- BUG-459 (patientRoutes raw rows)
- BUG-460 (extend duplicate-types guard) — append context: SHOULD scan backend service files; currently only scans frontend types
- BUG-461 (LegalOrderResponseSchema missing)
- BUG-465 (VivaTab/SummaryTab type-safety) — covers the `any`-typed legacy readers

---

## 11. Critical Files

- `apps/api/src/features/medications/medicationService.ts`
- `apps/api/tests/integration/medicationResponseShape.int.test.ts` (NEW)
- `packages/shared/src/medication.schemas.ts` (read-only reference)
- `docs/quality/fix-registry.md`
- `docs/quality/bugs-remaining.md`
