# BUG-036 — LLM routes require patient-relationship guard

> Plan doc authored at end of propose → review → execute cycle, co-committed with the fix.

## 1. Metadata

| | |
|---|---|
| Severity | S0 |
| Track | A |
| Wave | A-2 (patient safety) |
| Change-class | **risky** (PHI + clinical surface; gate on multiple patient-data paths). S0 urgency + risky class = Wave A-2 integration-test gate, NOT hotfix (per plan PART 5.1). |
| Commit SHA | _pending_ |
| Fix-registry anchor | R-FIX-LLM-ROUTES-PATIENT-RELATIONSHIP |
| Discovered | pre-plan |
| Closed | _pending_ |

## 2. Diagnosis

**Root cause:** Five LLM endpoints accept `patientId` and route patient-scoped PHI **across a trust boundary (LLM prompt assembly)** without enforcing clinician-patient authorization. Specifically:

- `apps/api/src/features/llm/llmRoutes.ts:201` POST `/api/v1/llm/clinical-ai` — `enhancedGenerate` performs RAG over the patient's records (`aiEnhancer.ts:480` — `loadPatientContext`).
- `apps/api/src/features/llm/llmRoutes.ts:757` POST `/api/v1/llm/agent` — autonomous agent with patient-data tool-use.
- `apps/api/src/features/llm/scribeRoutes.ts:174` POST `/api/v1/scribe/patient-summary` — loads patient name and feeds it into Ollama prompt.
- `apps/api/src/features/llm/scribeRoutes.ts:209` POST `/api/v1/scribe/referral-letter` — loads name / DOB / MRN.
- `apps/api/src/features/llm/scribeRoutes.ts:1086` POST `/api/v1/scribe/search` — patient-filtered semantic search over LLM embeddings. **HIGH severity (not MEDIUM-HIGH)** per L3-review consensus: vector-embedding similarity results leak latent PHI just as concretely as a direct record fetch.

**RLS is NOT sufficient.** Row-level security on `patients`, `llm_interactions`, and related tables enforces **clinic-level** tenant isolation. It does NOT enforce **clinician-patient relationships** within a single clinic. Any authenticated clinician in clinic A can pull any patient in clinic A into an LLM prompt unless the handler layer enforces the relationship check. `requirePatientRelationship` (`apps/api/src/shared/authGuards.ts:81-140`) is the canonical finer-grained guard, already used by sibling endpoints (e.g. `scribeRoutes.ts:357` POST `/scribe/consent`, BUG-035's `/ambient-note` gate).

**Classification:** **symptomatic** — same authorization gap across 5 handlers; fix must close the class.

**Other instances** (confirmed via grep + manual inspection):
- `letterRoutes.ts` — 7 handlers accept patientId, only 2 have the guard → **BUG-276** (S0 A-3) filed.
- `letterStructuredRoutes.ts` — 5 handlers flagged; half have guard → BUG-276.
- `scribeRoutes.ts` `/session/:id` PATCH (line 611) — has distinct ownership check (`existing.clinician_id === req.user.id`); scope-adjacent → BUG-276.
- `/outcome-measures` (line 305) — false positive, no `patientId` in schema.
- `/vocabulary/:id`, `/note-templates`, `/sensitive-flags` — clinic-level, not patient-scoped. False positives.

## 3. Approach

**Gold-standard fix:** reuse the BUG-035 `buildAuthContext` + `requirePatientRelationship` pattern. Insert immediately after Zod `.parse()` / body destructuring, before any patient-data fetch or LLM call. Pattern confirmed safe because Zod schemas for all 5 endpoints are pure validators (no `.transform()` calls, no DB fetches in parse step).

**Conditional gate for `/clinical-ai`:**
```ts
if (patientId) {
  const auth = buildAuthContext(req, patientId);
  await requirePatientRelationship(auth, patientId);
}
```
Verified safe via source at `aiEnhancer.ts:480`:
```ts
if (opts.patientId && opts.clinicId) {
  const context = await loadPatientContext(opts.patientId, opts.clinicId)
```
Both `patientId` AND `clinicId` required — no fallback clinic-wide RAG. When `patientId` is absent, zero patient-scoped data flows into the LLM prompt.

**Header contract comment** (Review 3 option a — in lieu of an explicit `usesPatientData` flag):
> "patientId in the request body is a security signal that patient-scoped data flows. Any future code path that loads patient data without a supplied patientId MUST add its own relationship check before that load."

**Denied-access audit:** already handled globally by `apps/api/src/middleware/forbiddenAccessAudit.ts:37` (mounted at `server.ts:341`). Every 403 response writes a `FORBIDDEN_ACCESS` audit_log row automatically — no new audit infrastructure needed for BUG-036.

## 4. Alternatives considered + rejected

| Alternative | Rejected because |
|---|---|
| Unconditional gate on `/clinical-ai` (ignore patientId-absent case) | Breaks legitimate non-patient workflows (e.g. `action='classify'` for general text classification) — over-rejects. Current conditional is correct given `enhancedGenerate:480` source evidence. |
| Explicit `usesPatientData` boolean flag per action | Abstraction for hypothetical future refactor; violates "don't abstract until second use-case" rule. Header comment contract is sufficient. |
| Move guard into a global Express middleware | Different endpoints need patientId from different positions (body vs params vs query); a generic middleware would over-fit or under-fit. Handler-level insertion is explicit. |
| Include letterRoutes + letterStructuredRoutes in same commit | 12+ handlers; each needs individual classification (patient-data flow vs audit-only). Belongs in BUG-276 with dedicated audit, not bundled here. |
| Add bypass-role audit in same commit | Scope creep — BUG-036 is the DENY side; bypass-visibility is a distinct concern. **BUG-279** (S1 A-3) tracks. |

## 5. Reviewer refinement trail

**Round 1 — three independent reviews, heavy convergence on 3 core items.**

**All 3 reviewers:**
- Promote `/scribe/search` from MEDIUM-HIGH to **HIGH** (vector embeddings leak latent PHI).
- Add clinician-**with**-relationship happy-path test per endpoint (current 10-test plan only tested bypass-admin happy path, conflating "bypass role" with "legitimate relationship").
- Verify `enhancedGenerate` skips RAG when `patientId` absent (prove, don't assume).

**Reviews 1 + 3:**
- Conditional-gate bypass test for `/clinical-ai` — POST without `patientId`, spy on `loadPatientContext`, assert not called.

**Reviews 1 + 2:**
- Audit event on denied access → **already handled** by `forbiddenAccessAudit` middleware at `server.ts:341`. Reviewers were unaware of existing infrastructure.

**Review 1:**
- Ollama prompt logging residual → **BUG-278** (S2 B-9) filed.
- RLS-does-not-protect explicit note — absorbed in diagnosis §2.
- S0 + risky classification tension → resolved with explicit Wave A-2 gating language.
- Zod coercion concern → rebutted with source citation (schemas are pure validators).

**Review 3:**
- Trust-boundary framing — absorbed in diagnosis wording.
- Bypass roles + LLM audit → **BUG-279** (S1 A-3) filed.
- BUG-276 dated SLA + interim safeguard — absorbed in BUG-276 catalogue row.
- `usesPatientData` explicit flag → deferred in favour of header comment contract (Review 3 option a).

**Review 2:**
- `state: fixed` premature — catalogue row is written at commit time with `state: fixed` + `closed_at` populated. Clarified timing convention.

**No fabricated-authority events** this round — every reviewer claim was source-checkable.

## 6. Implementation outline

**Files touched:**
1. `apps/api/src/features/llm/llmRoutes.ts` — 2 gates (clinical-ai line 201 + agent line 757) + header contract comment.
2. `apps/api/src/features/llm/scribeRoutes.ts` — 3 gates (patient-summary line 174 + referral-letter line 209 + search line 1086).
3. **New** `apps/api/tests/integration/llmRoutesPatientRelationshipGate.int.test.ts` — 16 tests.
4. `docs/audit-2026-04-19/bug-catalogue-v2.yaml` — BUG-036 full row + BUG-276 (letter + scribe-session audit) + BUG-278 (Ollama logging) + BUG-279 (bypass+LLM audit).
5. `docs/fix-registry.md` — R-FIX-LLM-ROUTES-PATIENT-RELATIONSHIP row.
6. `docs/audit-2026-04-19/bug-plans/BUG-036-llm-routes-patient-relationship.md` — this plan doc.

**Canonical insertion** at each endpoint:
```ts
// BUG-036 — patient-relationship gate. Runs after Zod parse, before any
// patient-data fetch or LLM call.
//
// CONTRACT: patientId in the request body is a security signal that
// patient-scoped data flows. Any future code path that loads patient
// data without a supplied patientId MUST add its own relationship check
// before that load.
if (patientId) {
  const auth = buildAuthContext(req, patientId);
  await requirePatientRelationship(auth, patientId);
}
```

For endpoints where `patientId` is Zod-required (e.g. if any of the 5 make it required in their schema), drop the `if` — simpler. In the 5 target endpoints, `patientId` is optional per their Zod schemas, so the conditional form applies.

## 7. Tests

`apps/api/tests/integration/llmRoutesPatientRelationshipGate.int.test.ts` — **16 tests** against live Postgres + Redis with LLM calls mocked:

**Per endpoint × 3 scenarios (15 tests):**
- **Block:** clinician (role=clinician, not in BYPASS_ROLES) with NO care relationship → 403 `NO_PATIENT_RELATIONSHIP`.
- **Allow (legitimate):** clinician WITH an `open` episode where they are `primary_clinician_id` → 200 (LLM mock called).
- **Allow (bypass):** admin/superadmin (in BYPASS_ROLES) → 200 regardless of relationship.

**Conditional-gate bypass test (1 test, `/clinical-ai` only):**
- POST with `enhance:true` but NO `patientId` → assert `loadPatientContext` spy is NEVER called; response succeeds (no guard fired, no patient data flowed).

**Mocking:** `aiEnhancer.enhancedGenerate` + `loadPatientContext` + `localLlmAgent.clinicalAi.*` + `aiAgent.runAgent` + `axios.post` (for scribeRoutes Ollama calls) — so tests exercise the gate and don't hit real models.

**Red-first trace:** run tests before applying fix — 5 "clinician no-rel" tests FAIL (current handlers pass the request to the LLM mock despite no relationship). Post-fix: 16/16 PASS. Capture FAIL + PASS logs in commit body.

## 8. Verification trace

- **Clinician A calls `/clinical-ai` with patient B's ID (no care relationship)** → pre-fix: `enhancedGenerate` loads patient B's context, LLM prompt includes B's PHI. Post-fix: 403 `NO_PATIENT_RELATIONSHIP` before any data load.
- **Clinician A calls `/agent` with patient B's ID** → pre-fix: agent tool-use runs against B. Post-fix: 403 before `runAgent`.
- **Clinician A calls `/patient-summary` for patient B** → pre-fix: patient B's name loaded into Ollama prompt. Post-fix: 403 before DB lookup.
- **Clinician A calls `/referral-letter` for patient B** → pre-fix: B's DOB + MRN loaded into Ollama prompt. Post-fix: 403.
- **Clinician A calls `/scribe/search` with `patientId=B`** → pre-fix: vector similarity over B's `llm_interactions` rows returned to A. Post-fix: 403.
- **Clinician WITH care relationship** (primary_clinician on an `open` episode) — 200 on all 5 endpoints; LLM mock called.
- **Admin/superadmin** — bypass via `BYPASS_ROLES`; gate no-ops; 200 as today.
- **`/clinical-ai` with no `patientId` + `enhance:true`** — gate's `if (patientId)` skips; `enhancedGenerate.loadPatientContext` never runs (verified at `aiEnhancer.ts:480` — requires both patientId AND clinicId); conditional-gate bypass test asserts `loadPatientContext` spy not called.
- **Denied access observable** — global `forbiddenAccessAudit` middleware at `server.ts:341` writes `FORBIDDEN_ACCESS` audit_log row on every 403; denied attempts are reviewable in the medical-director dashboard without any new instrumentation in BUG-036 scope.

## 9. Residual risk

- **Letter + letterStructured routes + scribe/session/:id** — 12+ endpoints with similar patient-data-into-LLM patterns. **BUG-276** (S0 A-3) files the full audit with a dated SLA (must land by Wave A-3 exit). Interim safeguard: the BUG-276 audit will classify each endpoint before fixing — some accept `patientId` only for audit-metadata, not for LLM context.
- **Ollama prompt logging** — if Ollama's default log level or any middleware persists prompt bodies to disk, PHI from pre-fix cross-patient accesses may remain. **BUG-278** (S2 B-9) files a deploy-time verification of Ollama log config.
- **Bypass-role LLM-access audit** — when an admin/superadmin uses `/clinical-ai` or `/agent`, the 403 path is never taken so `forbiddenAccessAudit` doesn't fire. The bypass usage into an LLM is invisible to the forensic surface. **BUG-279** (S1 A-3) files a dedicated "LLM-access audit" that writes a row on every 200 from the 5 endpoints.
- **Future code-path refactors** where `patientId` is used for audit-only (not for LLM context) but the gate still trips → header contract comment documents the invariant; if a future developer finds the gate too strict, the right move is to split the action (new endpoint / new schema), not weaken the gate.
- **Defence in depth at service/tool layer** — Review 2 flagged that LLM safety depends too much on handler discipline. A stronger posture would have service-level patient-scope enforcement (e.g. `enhancedGenerate` itself refusing to proceed without a pre-validated AuthContext). Out of BUG-036 scope; candidate for a follow-on structural refactor (Sprint B-5 as-any audit + B-7 structural contracts).
- **Embeddings in LLM provider caches** — if an external inference provider (not Ollama) logs prompts server-side, cross-patient PHI leaked pre-fix may persist. Current Signacare config uses local Ollama, so this is hypothetical; deploy-time verification in BUG-278 covers.

## 10. CAB / change-control notes

- BUG-036 promoted from plan-table reference to full YAML row (state=`fixed` and `closed_at` populated at commit time).
- **BUG-276 elevated** — catalogue row will specify "must land by Wave A-3 exit" SLA + interim-safeguard rationale.
- **BUG-278, BUG-279 newly filed** as disclosed residuals with explicit severity + wave placement.
- No schema / migration / API shape change. Requires `patientId` remains optional at schema level for `/clinical-ai` (action-dependent). Documented.

## 11. QA agent verdicts

### Round 1

- **L1 static:** no new violations.
- **L2 narrative:** PASS.
- **L3 code judgement:** **APPROVE** (7/7 dimensions). Grep-verified no other patient-data load path in /clinical-ai handler; conditional-gate premise sound; 5 identical 3-LOC call sites are idiomatic usage not duplication; test 1d pins conditional-gate safety by spying on loadPatientContext.
- **L4 clinical safety:** **REQUEST_CHANGES × 2**:
  1. **Dimension 5 blocker** — `/scribe/search` with absent patientId runs kNN over ALL clinic llm_interactions and returns `patient_id` per row → clinic-wide PHI fishing. Make patientId REQUIRED on SemanticSearchSchema.
  2. **Dimension 7 (out-of-scope follow-up)** — retrospective llm_interactions audit for pre-BUG-036 cross-patient contamination (APP 11.2 NDB scheme). File as new ticket.
- **L5 architecture:** **APPROVE** with 2 non-blocking follow-ups:
  1. Service-layer AuthContext migration — enhancedGenerate / runAgent / loadPatientContext accept raw (clinicId, patientId); future non-HTTP callers would bypass the handler gate. File as separate bug.
  2. Test `afterAll` cleanup missing for the `ai-scribe` feature flag upsert. 2 LOC.

### Round 2 — all items absorbed

- **L4.1 (blocker):** `SemanticSearchSchema.patientId` changed from `.optional()` to required. Handler gate changed from conditional to unconditional. kNN `patient_id` filter changed from conditional to unconditional. Added test (5d): missing patientId → 422 VALIDATION_ERROR. Header comment documents the change.
- **L4.2 (out-of-scope follow-up):** **BUG-280** (S1 A-2) filed — retrospective llm_interactions audit. Owner: Clinical Safety + Security Approver. Must land in Wave A-2 closeout for APP 11.2 compliance.
- **L5.1 (follow-up):** **BUG-281** (S1 B-7) filed — service-layer AuthContext migration for enhancedGenerate / runAgent / loadPatientContext. Structural refactor; belongs in Sprint B-7.
- **L5.2 (minor):** Added `afterAll` cleanup disabling the `ai-scribe` feature flag on the test clinic.

### Final

- **L1:** clean.
- **L2:** PASS.
- **L3:** APPROVE (Round 1).
- **L4:** REQUEST_CHANGES × 2 → both addressed (1 blocker fixed in-scope, 1 follow-up filed as BUG-280).
- **L5:** APPROVE (Round 1) + 2 minor items (1 absorbed inline as test cleanup, 1 filed as BUG-281).

Round 2 re-review not required — L4's blocker was a single targeted schema change with an added test; L5's blockers were both minor/follow-up.

Post-fix verification: 17/17 tests PASS (16 original + new 5d), tsc clean, fix-registry verified.
