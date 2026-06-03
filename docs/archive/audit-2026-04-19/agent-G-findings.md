# Agent G — AI modules audit (COMPLETED)

## CRITICAL findings

**[CRIT-G1]** Scribe + Letters — Patient CONSENT missing. StreamingSession interface has no consentId field. Audio/transcript used with no documented consent trail. Mandatory for Australian Privacy Principles.

**[CRIT-G2]** Letter Generator — HIV / substance-use / mental-health data exposed in AI letter drafts without explicit clinician consent. loadPatientContext() retrieves sensitive fields indiscriminately.

**[CRIT-G3]** All AI modules — No model version locking. Ollama auto-upgrade changes clinical output silently. Store checkpoint hash + approval gate required.

## HIGH findings

**[HIGH-G1]** Scribe — No prevention of cross-clinician signing. Clinician A can sign note authored from Clinician B's session without "reviewed and adopted" flag. Add `reviewed_and_adopted_by_id` + UI confirmation.

**[HIGH-G2]** All AI — No kill switch. AI compromise has no emergency off. Need `clinic_feature_flags` table gating all routes.

**[HIGH-G3]** Scribe — Recording active indicator not implemented (visible + audio). Persistent red indicator required.

**[HIGH-G4]** AI Chat — Agent answers prescribing questions beyond scope. Input classifier needed to reject dosing/prescribing.

**[HIGH-G5]** Data residency — WHISPER_API_URL defaults to localhost:8080. Audio could go remote without enforcement. Block external URLs; startup validation.

## MEDIUM findings

**[MED-G1]** Scribe + Letters — is_ai_draft flag is DB-only. No visible "[AI-DRAFT — Pending review]" banner in notes/letters.

**[MED-G2]** Letter templates hardcoded as strings. No `letter_templates` table, no versioning, no audit.

**[MED-G3]** AI Chat responses missing "[⚠ Verify against guidelines]" disclaimer.

**[MED-G4]** Training export RBAC weak (requireRoles(['admin']) only). No separate audit gate on export.

## VERIFIED CORRECT (commit 908c13e)

- trainingPipeline.ts uses real schema (llm_interactions JOIN) ✓
- saveFeedback inserts llm_interactions row → ai_training_feedback with FK ✓
- No @query-col-exempt annotations ✓

## PRESENT (good)

- llm_interactions has model_name + user_id (per-clinician logging) ✓
- aiAgent.ts validates patient relationship via requirePatientRelationship() ✓
- loadPatientContext() filters by patient_id + clinic_id ✓
- Session idle timeout (5 min) in scribeStreaming ✓
- ai_training_feedback stores original_output + corrected_output (full audit) ✓

## AI Safety Register summary

| Severity | Risk type | Count |
|---|---|---|
| CRITICAL | Hallucination / data leakage / audit-gap | 3 |
| HIGH | Access / scope / residency | 5 |
| MEDIUM | Labelling / governance | 4 |

**Production prerequisites:** (1) consent flow scribe + letters; (2) model version locking; (3) sensitive-data gating; (4) kill switch; (5) on-prem data residency enforcement.
