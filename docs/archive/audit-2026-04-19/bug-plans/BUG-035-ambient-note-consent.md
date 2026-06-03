# BUG-035 — Recording consent (+ patient-relationship) enforced at /ambient-note backend

> Plan doc authored at end of propose → review → execute cycle, co-committed with the fix.

## 1. Metadata

| | |
|---|---|
| Severity | S0 |
| Track | A |
| Wave | A-2 (patient safety) |
| Change-class | **risky** (PHI + clinical surface + new gate on a path that persists to clinical_notes) |
| Commit SHA | _pending_ |
| Fix-registry anchor | R-FIX-AMBIENT-NOTE-CONSENT-GATE |
| Discovered | pre-plan (EXECUTION-PLAN-v3-FULL.md equiv + AUDIT-SUMMARY-v3.md:127) |
| Closed | _pending_ |

## 2. Diagnosis

**Root cause:** `apps/api/src/features/llm/llmRoutes.ts:432-610` (POST `/ambient-note`) accepts audio uploads, persists the file via `blobStorage.put` (:474), runs Whisper transcription (:485), and saves a draft clinical note (:563) — all **without** (a) verifying a recording consent exists for the patient, OR (b) verifying the clinician has a care relationship with the patient. The full consent subsystem exists in `scribe_consents` + POST `/api/v1/scribe/consent` + `clinic_settings.scribe_consent_mode`, but `/ambient-note` does not check it. A related authorization gap in the same handler: `requirePatientRelationship` (sibling call in `scribeRoutes.ts:357`) is not invoked, so any authenticated clinician can POST audio for any `patientId`.

**Classification:** **structural** — missing-gate problem; the model + sibling guard exist, they just aren't checked here.

**Other instances:**
- `/ws/scribe` WebSocket path (scribeStreaming.ts:194) — same recording flow, no gate. BUG-272 filed.
- Other clinical-note paths use `requirePatientRelationship` already (scribeRoutes.ts:357; patientService, medicationService, clinicalNoteService). `/ambient-note` was the outlier.

## 3. Approach

**Gold-standard fix:** gate the handler **before `blobStorage.put()`** (Review 2 point 1 — my v1 said "before Whisper" which left blob storage unconsented). Order:
1. multer parses (needed to populate `req.body` text fields alongside the audio file).
2. Zod parse of `req.body` text fields (`patientId`, `consentId`, optional `format` / `model` / `interpreterUsed` / `interpreterLanguage`).
3. `buildAuthContext(req, patientId)` + `requirePatientRelationship(auth, patientId)` — Review 2 point 2 absorbed in scope (same endpoint, same surface, 3 LOC).
4. `verifyRecordingConsent(clinicId, patientId, consentId)` — scribe_consents row lookup + TTL check.
5. Size check (≥1000 bytes).
6. `blobStorage.put` (now runs only on verified-and-consented requests).
7. `processAmbientAudio` + save.

**Mode-agnostic gate:** schema `CHECK` constraint on `clinic_settings.scribe_consent_mode` allows only `'patient_esignature'` or `'clinician_attestation'`. Both modes create a `scribe_consents` row. The gate therefore always requires a row and never conditions on mode — documented explicitly (Review 1 point 1).

**AuditAction union extension:** `apps/api/src/utils/audit.ts:4` `AuditAction` union gains `AMBIENT_NOTE_RECORDING_STARTED` (Review 2 point 3). Same pattern as BUG-238's `HL7_DISPATCH_*` additions.

**Pattern cited:**
- `scribeRoutes.ts:357` — existing `requirePatientRelationship` pattern on the sibling endpoint.
- `scribeRoutes.ts:391-407` — existing `scribe_consents` INSERT pattern, mode-matched against `clinic_settings.scribe_consent_mode`.
- `authGuards.ts#requirePatientRelationship` — the canonical clinical-care-relationship guard (AuthContext-typed).
- `medicalScribe.ts` BUG-034 commit (8511751) — `assertScribePromptDiscipline()` boot-time-assert pattern; reuse the idea as a runtime pre-check rather than a module-load assert.
- `writeAuditLog({action, tableName, recordId, clinicId, newData})` — existing pattern for audit-log insertion.

## 4. Alternatives considered + rejected

| Alternative | Rejected because |
|---|---|
| Gate only before `processAmbientAudio` (v1 proposal) | Audio is already persisted via `blobStorage.put` before this point; unconsented audio would land in S3/disk. Review 2 caught this correctly. |
| Defer `requirePatientRelationship` to a separate BUG | 2 LOC in the SAME handler against the SAME clinical-safety surface; parallel bug would touch identical lines. Absorbing in scope is cleaner than artificial splitting. |
| Gate on clinic_settings.scribe_consent_mode value (Review 1 edge case) | The mode CHECK constraint allows only two values; both require a consent row; no "disabled" mode exists. The gate is mode-agnostic by design (documented). |
| Add `consent_id` FK to `clinical_notes` table | Schema change + backfill across existing rows; larger blast radius. BUG-273 tracks. The `audit_log` row provides the forensic binding today. |
| Request-idempotency guard (avoid duplicate `AMBIENT_NOTE_RECORDING_STARTED` on retry) | Duplicates in the audit trail are acceptable for forensic purposes (each retry is its own event). Not a blocker. |

## 5. Reviewer refinement trail

**Round 1 — two reviews, both constructive.**

**Review 1** — 3 amendments (all accepted):
- clinic_consent_mode treatment documented explicitly (mode-agnostic).
- Multer pre-gate disclaimer added to residual risk.
- Minor: test-count corrected (8 not 7); interpreter-field-invariant TODO added; `'all'` format doc-note (pre-existing in `medicalScribe.ts#getFormatPrompt:863`).

**Review 2** — 4 technical points, all verified against source:
1. "Consent check must run BEFORE `blobStorage.put`" — verified at `llmRoutes.ts:474` (blob put) vs :485 (processAmbient). ACCEPT.
2. "No `requirePatientRelationship` on /ambient-note" — verified zero hits. ACCEPT in scope.
3. "`AMBIENT_NOTE_RECORDING_STARTED` not in AuditAction union" — verified `apps/api/src/utils/audit.ts:4`. ACCEPT.
4. "Backend is processing + persistence gate, not recording gate" — ACCEPT in residual-risk phrasing.

No fabricated-authority events this round — both reviewers cited real file:line evidence.

## 6. Implementation outline

**Files touched:**
- `apps/api/src/utils/audit.ts` — `AuditAction` union += `'AMBIENT_NOTE_RECORDING_STARTED'`.
- `apps/api/src/features/llm/llmRoutes.ts` — Zod schema; `buildAuthContext` + `requirePatientRelationship`; `verifyRecordingConsent` helper; audit_log write. Ordering: multer → Zod → auth → consent → size → blob → ambient.
- **New** `apps/api/tests/integration/ambientNoteConsentGate.int.test.ts` — 8 integration tests against live Postgres + Redis.
- `docs/audit-2026-04-19/bug-catalogue-v2.yaml` — BUG-035 full row + BUG-272 / 273 / 274 new rows.
- `docs/fix-registry.md` — R-FIX-AMBIENT-NOTE-CONSENT-GATE row.
- `docs/audit-2026-04-19/bug-plans/BUG-035-ambient-note-consent.md` — this plan doc.

**Key shape (handler delta):**
```ts
const AmbientNoteRequestSchema = z.object({
  patientId: z.string().uuid('patientId must be a valid UUID — required for recording consent verification'),
  consentId: z.string().uuid('consentId must be a valid UUID — capture via POST /api/v1/scribe/consent before recording'),
  // Pre-existing optional fields:
  format: z.enum(['soap', 'mse', 'progress', 'intake', 'ward_round', 'review',
                  'collateral', 'phone', 'home_visit', 'case_conference', 'group',
                  'incident', 'physical_health', 'lai', 'clozapine', 'all']).optional(),
  model: z.string().max(128).optional(),
  // TODO(BUG-035 follow-up): if interpreterUsed === true, interpreterLanguage must be set.
  // Currently accepted loosely because the pre-fix handler didn't validate either.
  interpreterUsed: z.union([z.boolean(), z.string()]).optional(),
  interpreterLanguage: z.string().max(64).optional(),
});

const CONSENT_TTL_MINUTES = parseInt(process.env.SCRIBE_CONSENT_TTL_MINUTES ?? '15', 10);

async function verifyRecordingConsent(
  clinicId: string,
  patientId: string,
  consentId: string,
): Promise<void> {
  const row = await db('scribe_consents')
    .where({ id: consentId, clinic_id: clinicId, patient_id: patientId })
    .first('id', 'attested_at');
  if (!row) {
    throw new HttpError(
      403,
      'CONSENT_REQUIRED',
      'Recording consent not found for this patient. Capture one via POST /api/v1/scribe/consent before recording.',
    );
  }
  if (!row.attested_at) {
    throw new HttpError(403, 'CONSENT_REQUIRED', 'Consent record exists but has no attestation timestamp.');
  }
  const ageMs = Date.now() - new Date(row.attested_at).getTime();
  if (ageMs > CONSENT_TTL_MINUTES * 60_000) {
    throw new HttpError(
      403,
      'CONSENT_EXPIRED',
      `Consent is older than ${CONSENT_TTL_MINUTES} minutes. Capture a fresh consent before recording.`,
    );
  }
}

// Handler flow — the critical re-ordering (Review 2 point 1):
router.post('/ambient-note', requireRoles([...]), async (req, res, next) => {
  try {
    // 1. multer (multipart form-data parse).
    await new Promise<void>((resolve, reject) =>
      upload.single('audio')(req, res, (err) => err ? reject(err) : resolve()),
    );

    // 2. Zod parse of text fields.
    const dto = AmbientNoteRequestSchema.parse(req.body);

    // 3. AuthContext + patient-relationship gate (Review 2 point 2).
    const auth = buildAuthContext(req, dto.patientId);
    await requirePatientRelationship(auth, dto.patientId);

    // 4. Consent gate (Review 2 point 1 — BEFORE blobStorage.put).
    await verifyRecordingConsent(req.clinicId, dto.patientId, dto.consentId);

    // 5. Size check.
    const audioFile = req.file;
    if (!audioFile) throw new HttpError(400, 'VALIDATION_ERROR', 'No audio file provided');
    if (audioFile.size < 1000) throw new HttpError(400, 'VALIDATION_ERROR', 'Audio file too small');

    // 6. blobStorage.put — now runs only on auth'd + consented requests.
    const audioPut = await blobStorage.put(...);

    // 7. Audit-log the recording start with consent binding.
    await writeAuditLog({
      clinicId: req.clinicId,
      userId: req.user!.id,
      action: 'AMBIENT_NOTE_RECORDING_STARTED',
      tableName: 'scribe_consents',
      recordId: dto.consentId,
      newData: { patientId: dto.patientId, audioStorageKey: audioPut.key },
    });

    // 8. Whisper + LLM + save (existing behaviour).
    const result = await processAmbientAudio(...);
    // ...
  } catch (err) { next(err); }
});
```

## 7. Tests

`apps/api/tests/integration/ambientNoteConsentGate.int.test.ts` — **8** integration tests against live Postgres + Redis. Audio file uploaded as small in-memory buffer (≥1000 bytes). `processAmbientAudio` + `blobStorage.put` mocked so tests don't hit Whisper/Ollama/S3 but the gate ordering is real:

1. **Missing `consentId`** → 422 VALIDATION_ERROR (Zod rejects at boundary).
2. **Missing `patientId`** → 422 VALIDATION_ERROR.
3. **Non-UUID `consentId`** → 422 VALIDATION_ERROR.
4. **Patient-relationship missing** (clinician has no care relationship with patient) → 403 FORBIDDEN via `requirePatientRelationship`.
5. **Consent row does NOT exist** → 403 CONSENT_REQUIRED.
6. **Consent exists but for a DIFFERENT patient** → 403 CONSENT_REQUIRED (cross-patient).
7. **Consent exists but for a DIFFERENT clinic** → 403 CONSENT_REQUIRED (cross-tenant, RLS + explicit clinic_id).
8. **Consent STALE** (attested_at older than TTL) → 403 CONSENT_EXPIRED.

Plus a happy-path test (HP): fresh valid consent + care relationship + 1500-byte audio + mocked downstream → 200 AND audit_log row exists with `action='AMBIENT_NOTE_RECORDING_STARTED'` and `record_id=<consentId>`.

**Red-first trace:** run tests before touching llmRoutes.ts. Expected FAILs:
- Tests 1-3 (Zod) FAIL — no schema today.
- Test 4 (patient-relationship) FAIL — no guard today.
- Tests 5-8 (consent) FAIL — no gate today.
- Happy path test FAILS (422 instead of 200, because Zod/guards absent mean the OLD handler never validated body).

Capture pre-fix FAIL log → apply fix → capture post-fix PASS log. Both in commit body.

## 8. Verification trace

- **Pre-fix scenario** (current production): POST `/ambient-note` with `{ audio }` + `{}` body → 200 + audio persisted + note saved. No consent checked, no relationship checked. Privacy + authorization double-failure.
- **Post-fix happy path**: fresh consent captured within 15 min + clinician has care relationship + audio ≥1000 bytes → 200 + audit_log row bound to consent_id.
- **Cross-patient attack**: attacker submits consentId from another patient → 403 CONSENT_REQUIRED (row lookup filters by patient_id).
- **Cross-tenant attack**: clinic A submits consent from clinic B → 403 CONSENT_REQUIRED (explicit `clinic_id` filter + RLS).
- **Stale consent (>15 min)** → 403 CONSENT_EXPIRED, no blob-put, no audit row.
- **No patient relationship** → 403 via `requirePatientRelationship` throwing AppError, before blob-put.
- **Malformed UUID** → 422 via Zod, before multer-file-size check; no blob-put.
- **Backend-only gate disclaimer**: audio bytes still arrive at multer's in-memory buffer before any check. Blob-put is gated; Whisper is gated; save is gated. The client-side recording itself is not gated by this backend fix — that's BUG-272 (WebSocket) + frontend consent dialog. Documented honestly in residual risk.

## 9. Residual risk

- **Backend is a processing + persistence gate, not a recording gate.** Audio bytes land in the multer memory buffer before consent is verified (Review 2 point 4). The gate prevents **transcription, blob storage, and note persistence** for unconsented requests. True "record button prevention" is a **frontend + WebSocket concern** — BUG-272 (S0 A-2) tracks the WebSocket path; frontend pre-capture dialog is feature work outside the bug catalogue.
- **`clinical_notes` row has no `consent_id` FK.** The audit_log row provides the binding. BUG-273 (S1 A-2) tracks adding the FK + backfill.
- **Patient revocation mid-session** — no active-session signal. BUG-274 (S2 B-8) tracks if needed.
- **Consent TTL is env-driven** (`SCRIBE_CONSENT_TTL_MINUTES`, default 15). A clinic configuring `1440` (24h) would weaken the gate. BUG-233 (env validator, Wave A-4) will enforce a sensible ceiling at startup.
- **Interpreter field invariant** not checked (`interpreterUsed=true` → `interpreterLanguage` required). TODO comment in the Zod schema flags for follow-up; not a consent-gate concern, but worth tracking.
- **`'all'` format value** — pre-existing in `medicalScribe.ts#getFormatPrompt:863`. Documented, not modified.
- **Duplicate `AMBIENT_NOTE_RECORDING_STARTED` events on retry** — acceptable for forensic purposes; each retry is its own event.

## 10. CAB / change-control notes

- BUG-035 promoted from plan-table reference to full YAML row.
- BUG-272 (WebSocket recording-gate, S0 A-2), BUG-273 (clinical_notes.consent_id FK, S1 A-2), BUG-274 (consent revocation, S2 B-8) newly filed.
- No new dependency. No schema/migration (AuditAction is a TS union). No public API shape change beyond ADDING required fields (clients that omit them get 422 — that's the point).
- **Scope-absorption note:** `requirePatientRelationship` added to the same handler in the same commit; not a standalone filing because it's 2 LOC on the same file:line surface as the consent gate. Catalogue entry + commit body both name both fixes explicitly.

## 11. QA agent verdicts

### Round 1

- **L1 static:** no new violations.
- **L2 narrative:** PASS.
- **L3 code judgement:** REQUEST_CHANGES × 2:
  1. Test 4 (patient-relationship) didn't actually guard the line — all tests used the seeded superadmin who bypasses `requirePatientRelationship` via `BYPASS_ROLES`. Add a clinician-role non-bypass test.
  2. Pre-fix catch-block hostile swallow pattern (wraps everything in `new Error(msg)`, strips HttpError + ZodError class) needs its own catalogue row.
- **L4 clinical safety:** REQUEST_CHANGES × 3:
  1. TTL default 15 min is clinically unreasonable — psychiatric sessions run 45-90 min. Raise to 60 min.
  2. BUG-272 WebSocket gate must land in same wave — shipping S0 with known bypass undermines the fix.
  3. BUG-274 revocation reclassified — privacy-live violation, not a deferrable B-8 residual. Move to A-3 with interim SOP.
- **L5 architecture:** REQUEST_CHANGES × 2 blockers + 1 non-blocking:
  1. Extract `verifyRecordingConsent` to `apps/api/src/shared/recordingConsent.ts` so BUG-272 can reuse verbatim (SSOT).
  2. Validate `CONSENT_TTL_MINUTES` at module load — malformed env (`abc`) produces NaN → `ageMs > NaN` always false → silent TTL disable (privacy violation).
  3. (Non-blocking) boot-time assertion that gate wiring stays intact.

### Round 2 — all items absorbed in same commit

- **L3.1:** test (7b) added — logs in as seeded `sarah.chen@signacare.local` (role=clinician), seeds an orphan patient with no care relationship, valid consent, asserts 403 with `code: 'NO_PATIENT_RELATIONSHIP'`. This genuinely guards the `requirePatientRelationship` line — a revert of that line would fail test 7b.
- **L3.2:** BUG-275 filed (S1 A-2) for the hostile catch-block swallow pattern. Fix-registry row `R-FIX-AMBIENT-CATCH-PASSTHROUGH` tracks the BUG-035 inline passthrough fix; BUG-275 tracks the broader cleanup (typed-error branching + L1 static check against `next(new Error(msg))`).
- **L4.1:** `CONSENT_TTL_MINUTES` default raised 15 → 60. Test 7 (stale consent) adjusted to 90 min to remain unambiguously stale.
- **L4.2:** BUG-272 already at S0/A-2. Catalogue row amended with explicit "must land in same wave" language + cross-reference to BUG-035 as dependency.
- **L4.3:** BUG-274 reclassified S2/B-8 → S1/A-3. Catalogue row updated with privacy-live-violation rationale + interim SOP requirement.
- **L5.1:** `verifyRecordingConsent` + `CONSENT_TTL_MINUTES` extracted to `apps/api/src/shared/recordingConsent.ts`. llmRoutes.ts now imports from shared. BUG-272 will import the identical helper.
- **L5.2:** Module-load validator in shared/recordingConsent.ts: `if (!Number.isFinite(CONSENT_TTL_MINUTES) || CONSENT_TTL_MINUTES <= 0) throw` — malformed env surfaces at import, not at the first unconsented recording.
- **L5.3:** Boot-time assertion in llmRoutes.ts confirms `verifyRecordingConsent` is imported (module-level `typeof ... === 'function'` guard with explicit error message pointing at the plan doc).

### Final

- **L1 static:** clean.
- **L2 narrative:** PASS.
- **L3 code judgement:** Round 1 REQUEST_CHANGES × 2 → absorbed. Tests 9/9 PASS post-fix.
- **L4 clinical safety:** Round 1 REQUEST_CHANGES × 3 → absorbed. TTL realistic; BUG-272 + BUG-274 wave-discipline corrected.
- **L5 architecture:** Round 1 REQUEST_CHANGES × 2 + 1 non-blocking → all absorbed. SSOT helper in shared/; NaN guard at module load; boot-time assertion in handler module.

tsc clean; fix-registry verified; 9/9 tests PASS against live Postgres + Redis (red-first: 8/8 FAIL → 9/9 PASS including new clinician-role test).
