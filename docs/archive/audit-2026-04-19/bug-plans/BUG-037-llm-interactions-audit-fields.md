# BUG-037 — llm_interactions must record model_version + temperature + pipeline

> Plan doc authored at end of propose → review → execute cycle, co-committed with the fix.

## 1. Metadata

| | |
|---|---|
| Severity | S0 |
| Track | A |
| Wave | A-2 (patient safety / forensic auditability) |
| Change-class | **risky** (schema migration + PHI-adjacent audit surface + 4 call-site refactor). S0 urgency + risky = Wave A-2 integration-test gate, NOT hotfix. |
| Commit SHA | _pending_ |
| Fix-registry anchor | R-FIX-LLM-INTERACTIONS-AUDIT-FIELDS |
| Discovered | pre-plan |
| Closed | _pending_ |

## 2. Diagnosis

**Root cause — two distinct failure modes:**

**(a) Missing determinism inputs.** `llm_interactions` has `model_name` + `model_provider` + token counts + latency, but **no `model_version`, no `temperature`**. Without these, an AI-assisted clinical output cannot be re-derived for forensic review: the same `llama3:70b` tag can resolve to different manifest digests week-to-week; different temperatures produce materially different outputs for the same prompt. `model_name` + tokens tell *approximately* what ran; they do not let an auditor reconstruct *exactly* what ran.

**(b) Missing execution trace.** No `pipeline` column exists to record which processing stages ran (Whisper transcribe → PII redact → Pass 1 extract → Pass 2 safety verify → Pass 3 format → hallucination check → save). When a clinician questions an AI-drafted note three weeks later, the audit row cannot distinguish "hallucination check fired but passed" from "hallucination check was bypassed" from "hallucination check threw and was swallowed."

Four insertion sites write audit rows today, all missing the 3 fields:
- `apps/api/src/features/llm/llmRoutes.ts:803` — /agent
- `apps/api/src/mcp/ambientProcessor.ts:503` — ambient scribe
- `apps/api/src/mcp/trainingPipeline.ts:65` — training feedback
- `apps/api/src/features/documents/documentService.ts:222` — document generation

**Regulatory alignment:** this fix is a **necessary prerequisite** for reproducibility — not full reproducibility by itself (prompt capture + config resolution + deterministic infra behaviour are the remaining pieces; BUG-282 tracks). Aligns with:
- **HIPAA 164.312(b)** — audit controls: mechanisms to record AND examine activity in systems with ePHI. Silent loss of audit records breaches the "examine" half.
- **Australian Privacy Principle 11.1 security** — reasonable steps to protect against unauthorised access + modification + disclosure. Audit logs ARE reasonable steps for detection. *(Review 3 correction: previously mis-cited as APP 11.2; APP 11.2 is destruction/de-identification.)*
- **TGA non-device classification** — evidence log must support post-hoc review; "no inference inside the scribe" claim from BUG-034 header requires reproducible audit to defend.

**llm_interactions is the canonical audit source** for AI-assisted clinical outputs. Derivative tables (`ai_training_feedback`, per-feature audit rows) MUST reference it by FK rather than duplicate audit fields. (Review 2.2 — explicit declaration.)

**Classification:** structural — schema change + 4 call-site refactor + shared helper extraction.

## 3. Approach

**Fix shape:**

1. **Migration** — add 3 columns + CHECK constraint. Nullable (no backfill; historical rows remain NULL).

2. **Shared helper** `apps/api/src/shared/recordLlmInteraction.ts` — single canonical writer. Rejects metadata with PHI patterns (review 3.4). Non-blocking for clinical flow; structured log + metric + best-effort secondary write on audit-insert failure (review 3.5, review 2.4).

3. **PipelineTracker** `apps/api/src/shared/pipelineTracker.ts` — composable stage-timing utility. Exports `PIPELINE_STAGES` constants (review 2.5). 50-stage hard cap with truncation marker (reviews 1.3, 2.3). Constrains stage `meta` to safe types: numbers, booleans, ≤64-char strings, arrays thereof. Helper validates before write.

4. **Thread model_version + requested-temperature** through `callLocalLlm` (Ollama) + `enhancedGenerate` + `runAgent`:
   - **model_version contract** (review 3.3): prefer immutable manifest digest when provider returns it; fall back to tag. Helper interface distinguishes `modelName` (tag) from `modelVersion` (immutable).
   - **temperature contract** (review 3.2): log **requested** temperature everywhere. Ollama does not echo the actual runtime temperature in its `/api/generate` response. "Requested" is the precise evidentiary quality we can guarantee.

5. **Update 4 call sites** to use the helper, populating all 3 new fields.

**Pattern cited:** `writeAuditLog` helper at `apps/api/src/utils/audit.ts` (same never-block semantic). Extraction-to-shared pattern matches BUG-035's `verifyRecordingConsent` at `shared/recordingConsent.ts`.

## 4. Alternatives considered + rejected

| Alternative | Rejected because |
|---|---|
| Store everything in `metadata` JSONB | Unqueryable — cannot `SELECT * WHERE temperature > 0.5` for QA investigation. First-class columns matter for audit-query ergonomics. |
| Single migration adds column + backfills via `NOW()` + `'unknown'` | Poisons the audit trail with fake provenance. NULL is honest. |
| Accept `meta: Record<string, unknown>` without constraints | Creates a PHI-spill surface (review 3.4). A developer passes `{transcript: "Jane Doe..."}`; audit table becomes a second unredacted PHI store, regressing BUG-216's redaction work. |
| Silent audit failure (log + swallow) | Violates HIPAA 164.312(b) "examine" requirement (review 3.5). Silent loss hollows out the trail. |
| Compute temperature digest from prompt inputs | Over-engineered; requested temperature is the atomic field an auditor needs. |
| Add `prompt_hash` column in this commit | Scope creep — full prompt-capture reproducibility is BUG-282's concern. BUG-037 is determinism-inputs + execution-trace. |

## 5. Reviewer refinement trail

**Round 1 — three independent reviews, converging on ~5 blockers + governance items.**

**Review 3 (hard blockers):**
- **3.1** APP citation WRONG — proposal said "APP 11.2 transparency"; verified against OAIC: **APP 11.1** is security (reasonable steps against unauthorised access/modification), **APP 11.2** is destruction/de-identification. Fixed throughout.
- **3.2** "Actual temperature" contradicted residual risk. Ollama's `/api/generate` response doesn't echo the temperature parameter; logging **requested** temperature is the only defensible quality. Reworded everywhere.
- **3.3** `model_version` underspecified. Explicit contract: digest-preferred; tag-fallback with documented caveat. Helper separates `modelName` (tag) from `modelVersion` (ideally digest).
- **3.4** `meta?: Record<string, unknown>` is a PHI-spill surface. Constrained shape: numbers, booleans, ≤64-char strings, arrays thereof. PipelineTracker validates before write; rejects PHI field-name patterns.
- **3.5** Non-blocking audit incomplete. Added structured-failure path: logger.error with identifiers + `audit_log` secondary write with `operation='LLM_AUDIT_WRITE_FAILED'` + ops counter.

**Review 2 (governance tightening):**
- **2.1** Diagnosis now names both failure modes (determinism + execution trace).
- **2.2** Explicit "llm_interactions is canonical audit source" declaration.
- **2.3** 50-stage cap on pipeline with truncation marker.
- **2.4** Structured-failure metric path (combined with 3.5).
- **2.5** Stage-name constants exported.
- **2.6** Backward-compat tests added.
- **2.7/2.8** "Reproducibility" softened to "prerequisite for reproducibility."

**Review 1 (tactical, not blocking):**
- **1.1** Fire-and-forget semantics — helper returns Promise<void> but all .catch() inside; callers may await or not; no caller delays HTTP response.
- **1.2** Ollama digest — covered by blocker 3.3.
- **1.3** Pipeline meta size — 50-stage cap + meta shape validation.
- **1.4** Temperature constraint range [0, 2] documented; review required if non-Ollama provider added.

**Step 6 "prompt_hash" mention removed** (Review 3 internal-contradiction spot) — BUG-282 tracks full prompt-capture.

**State-field convention clarified** (Review 3) — catalogue row written `state: fixed` ONLY at commit time; during proposal, no row exists yet.

No fabricated-authority events this round — all reviewer claims grep-verifiable or grounded in OAIC / HIPAA source.

## 6. Implementation outline

**Files touched:**
1. **New migration** `apps/api/migrations/20260421000001_llm_interactions_audit_fields.ts` — ADD COLUMN model_version TEXT, temperature NUMERIC(5,3), pipeline JSONB; CHECK constraint temperature ∈ [0, 2].
2. **New** `apps/api/src/shared/recordLlmInteraction.ts` — canonical writer with PHI-safe meta validation + failure-path metric/outbox.
3. **New** `apps/api/src/shared/pipelineTracker.ts` — `PipelineTracker` class + `PIPELINE_STAGES` constants + 50-stage cap + meta shape validator.
4. `apps/api/src/utils/audit.ts` — add `'LLM_AUDIT_WRITE_FAILED'` to AuditAction union for the failure-path secondary write.
5. `apps/api/src/mcp/localLlmAgent.ts` — extend `LlmResponse` with `modelVersion` (from Ollama response; falls back to tag) + `requestedTemperature`.
6. `apps/api/src/mcp/aiEnhancer.ts` — `enhancedGenerate` returns the same three fields.
7. `apps/api/src/mcp/ambientProcessor.ts` — instantiate `PipelineTracker`; wrap pass1/pass2/pass3/hallucination_check/save; call `recordLlmInteraction` with pipeline.
8. `apps/api/src/features/llm/llmRoutes.ts` — /agent uses `recordLlmInteraction`.
9. `apps/api/src/features/documents/documentService.ts` — uses `recordLlmInteraction`.
10. `apps/api/src/mcp/trainingPipeline.ts` — uses `recordLlmInteraction`.
11. **New** `apps/api/tests/integration/llmInteractionsAuditFields.int.test.ts` — 9 tests.
12. `apps/api/src/db/schema-snapshot.json` — regenerated via `npm run db:snapshot`.
13. Docs: catalogue (BUG-037 + BUG-282 + BUG-283) + fix-registry row + this plan doc.

## 7. Tests

`apps/api/tests/integration/llmInteractionsAuditFields.int.test.ts` — **9 tests** against live Postgres:

1. **Migration smoke** — introspect schema; `model_version`, `temperature`, `pipeline` columns exist with correct types.
2. **CHECK constraint** — INSERT with `temperature = 3.5` → Postgres rejects.
3. **Helper happy path** — `recordLlmInteraction({...})` writes a row with all 3 new fields populated correctly.
4. **Ambient flow end-to-end** — trigger ambient processing (mocked LLM), assert pipeline jsonb has ordered stages (pass1, pass2, pass3, hallucination_check, save in that order).
5. **/agent flow** — mocked runAgent returns model_version; audit row has it.
6. **Non-blocking failure** — mock dbAdmin to throw on insert; handler response still succeeds; logger.error + secondary audit_log row with `operation='LLM_AUDIT_WRITE_FAILED'` exists.
7. **Backward-compat (legacy call-site omits new fields)** — `recordLlmInteraction({...only-legacy-fields})` — row inserts with NULL new fields.
8. **documentService write** — trigger documentService generation (mocked Ollama), audit row has model_version + temperature + pipeline (document_generate stage).
9. **Meta PHI safety** — `PipelineTracker.track('pass1', fn, { given_name: 'Jane' })` → meta is REJECTED (thrown or sanitized); audit row does NOT contain 'Jane'.

**Red-first:** pre-migration, tests 1-8 FAIL (columns don't exist, helper doesn't exist); test 9 FAILs (no validator). Post-fix: 9/9 PASS.

## 8. Verification trace

- **Clinician questions an AI-drafted note 3 weeks later** → SELECT llm_interactions WHERE id=X → `model_version` (digest), `temperature` (requested), `pipeline` (ordered stages) all populated → forensic reconstruction pathway open.
- **Model upgraded mid-deploy** (llama3:70b pulled with new digest) → new rows carry new digest; old rows keep old digest; upgrade boundary queryable.
- **Scribe hallucination check fires and blocks save** → pipeline jsonb has `{stage: 'hallucination_check', success: false}` as final entry; `save` stage absent → auditor sees which stage blocked.
- **Requested temperature drift** — rows carry the requested value per call; task-config changes are observable over time.
- **Non-blocking semantics** — DB write failure during audit → clinical flow unaffected; logger.error fires with identifiers; `audit_log` row `operation='LLM_AUDIT_WRITE_FAILED'` written best-effort.
- **PHI safety on meta** — attempt to pass `{given_name: 'Jane'}` in stage meta → rejected by PipelineTracker validator before helper is called; audit table remains PHI-clean.
- **Pipeline size** — 60-stage pipeline → truncated at 50 with final marker `{stage: 'truncated', count: 60}`; JSONB size bounded.

## 9. Residual risk

- **Pre-existing rows** have NULL model_version/temperature/pipeline. No backfill — historical digests are not knowable retrospectively; NULL is honest.
- **Requested ≠ actual temperature** — Ollama does not echo the runtime temperature. The logged value is the REQUESTED one. Rare model-server overrides would not be captured; acceptable documented limitation.
- **Third-party LLMs** (HuggingFace, cloud) return version differently. Helper accepts `modelVersion?: string`; each provider wires it from their response shape. Scope: Ollama first.
- **Pipeline meta PHI safety is validator-based, not type-enforced at compile time** — a determined developer could bypass by passing `{meta: JSON.parse('{"given_name": "Jane"}')}`. Validator catches field names matching the PHI set from BUG-216. BUG-216's PHI_FIELDS union is the source of truth.
- **Audit-write failure path** — secondary `audit_log` write can ALSO fail if the DB is down. In that case logger.error is the only trace. BUG-283 (S2 B-9) tracks a proper out-of-DB outbox (Redis list + reconcile job).
- **Full prompt reproducibility** — prompt text + system prompt + input hash are NOT in scope. BUG-282 (S1 A-3) tracks this follow-up.
- **model_version may be tag-only** for Ollama versions that don't expose the digest via `/api/generate`. Helper documents the fallback; call-site annotation flags tag-only rows.
- **"No new follow-up bugs anticipated"** (Review 2.7 framing) — softened. Filing BUG-282 + BUG-283 now.

## 10. CAB / change-control notes

- BUG-037 promoted from plan-table reference to full YAML row (state: `fixed` at commit time; `planned` during proposal).
- **BUG-282** (S1 A-3) — prompt + transcript provenance for full reproducibility.
- **BUG-283** (S2 B-9) — out-of-DB audit-failure outbox (Redis list + reconcile).
- Migration is additive (3 nullable columns + 1 CHECK constraint); down() drops the constraint first then the columns.
- Snapshot regeneration required per CLAUDE.md §12.3.

## 11. QA agent verdicts

- **L1 static:** PASS (tsc × 3 workspaces clean; fix-registry + migration-convention + row-iface-drift + code-columns + snapshot-freshness guards green).
- **L2 narrative:** PASS (this plan doc + catalogue YAML + fix-registry row all present with red-first/post-fix trace).
- **L3 code judgement:** PASS — APPROVED. Findings:
  - Structural fix not band-aid; four divergent inserts collapsed to one vetted helper.
  - `is_ai_draft`/hallucination-check/consent-gate (pre-existing clinical guardrails) intact.
  - Non-blocking: T7 confirms audit-failure does not throw to the clinical caller.
  - Minor flag: `exportTrainingData` now emits empty `input:` for BUG-037-era feedback rows (tracked under BUG-282 raw-text envelope migration). Non-blocking clinical safety; ML-training fidelity regression.
  - Minor flag: pre-existing `console.error/log` in localLlmAgent:267,271 not touched by this PR. Adjacent debt.
- **L4 clinical safety:** PASS — APPROVED. Verdict: "AI-assisted clinical documentation is MORE safe than before."
  - All 4 call sites pass a concrete human staff_id (traceability intact).
  - Append-only respected; hallucination-check + consent-gate + patient-relationship gate unchanged.
  - Graceful degradation verified (T7 — failure observable, clinical flow unblocked).
  - Residual: top-level `metadata` string-length bound not mechanically enforced (PipelineTracker has the bound; top-level helper checks PHI field names only). All current callers are safe by inspection; tracked as follow-up.
  - Residual: /agent `direct-tool` path writes `temperature: null` / `model_version` via registry fallback. Honest but loses path-distinguisher for the auditor. Follow-up.
- **L5 architecture:** REQUEST_CHANGES → ABSORBED → PASS. Findings absorbed in final commit:
  1. **Tier 4.4 ollamaModelRegistry integration (Standard 3/4)** — recordLlmInteraction now calls `ollamaModelRegistry.getModelVersion(args.modelName)` when the caller doesn't supply an explicit `sha256:` digest. Digest-preferred contract is now functionally implemented, not aspirational. T6 assertion updated to `/^llama3\.2@/` to match the `name@digest` shape.
  2. **Failure path reuses `writeAuditLog` (Standard 3)** — inline `audit_log` insert replaced with `writeAuditLog({ clinicId, actorId, action: 'LLM_AUDIT_WRITE_FAILED', tableName, recordId, newValues })`. Column-compat + UUID-safety logic lives in exactly one place.
  3. **`dbAdmin` usage documented (Standard 1)** — header comment now states this matches the `writeAuditLog` pattern (audit writes use dbAdmin consistently across the codebase). `/agent` request-context use is explicit, not accidental; every row carries `clinic_id` so tenant isolation is preserved at read time via the RLS-scoped read-path proxy.
  4. **Minor hygiene** — helper function `describeType` (was `t_or_object`) hoisted above `assertMetaIsSafe`; duplicate `from '../utils/logger'` imports merged.
  5. **Not absorbed (scope-deferred)** — consolidating recordLlmInteraction with llmService.writeLlmInteraction into a single writer was raised by L5 but would require refactoring the `/api/v1/llm/interactions` endpoint's response shape. Both writers now stamp `model_version` via the same registry, so they diverge only in return type (DTO vs id). Consolidation tracked as a Sprint B-7 structural task (follow-up).
