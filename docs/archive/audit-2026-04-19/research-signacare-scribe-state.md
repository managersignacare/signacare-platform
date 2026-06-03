# Signacare scribe current state inventory

## Files (15 total)

### Backend MCP (apps/api/src/mcp/)
- medicalScribe.ts — 3-pass pipeline (verbatim extraction → safety verification → RANZCP formatting)
- scribeStreaming.ts — WebSocket real-time audio + idle session cleanup (5min)
- scribeEnhancements.ts — After-visit summaries, referral letters, ICD-10-AM, MBS suggestions, QUEST, outcome measures
- ambientProcessor.ts — 3-pass pipeline wrapper with Whisper
- aiEnhancer.ts — RAG context, patient demographics, leaked-context stripping
- trainingPipeline.ts — feedback collection (llm_interactions JOIN ai_training_feedback) + JSONL export
- localLlmAgent.ts — Multi-model Ollama (Qwen 2.5, Llama 3.2, MentalLLaMA, EmoLLM)
- scribeSpecialties.ts — Psychiatry, child/adolescent, aged care, forensic, substance, perinatal prompts
- server/aiAgent.ts — MCP tool definitions + hallucination guards (numeric, hedging, UUID)
- server/mcpServer.ts — 30+ tool registry

### Integrations (apps/api/src/integrations/scribe/)
- promptGuard.ts — OWASP LLM01 14-pattern detection

### Routes (apps/api/src/features/llm/)
- scribeRoutes.ts — /preferences, /patient-summary, /icd10-suggest, /mbs-suggest, /referral-letter, /outcome-measures
- streamingTranscribeRoutes.ts — /stream-chunk, /stream-final
- llmRoutes.ts, llmTrainingRoutes.ts

### Web (apps/web/src/features/patients/components/notes/)
- scribeStreamingClient.ts — 5s batching + session ID + buffer flush
- AmbientAiRecorder.tsx — recording controls + consent checkbox + live transcript + formatting tabs
- MobileScribePage.tsx — phone-optimised single-tap record, QR launch

## Currently working end-to-end

**Path A: Streaming scribe** — MediaRecorder captures → 5s batching POST `/scribe/stream-chunk` → Whisper STT → live partial transcript → stop → POST `/scribe/stream-final` → 3-pass pipeline → structured note in `clinical_notes` with `is_ai_draft=true` → clinician edits → adopt saves feedback to `ai_training_feedback`.

**Path B: Post-generation enhancements** — patient summary, referral letter, ICD-10 suggest, MBS suggest, outcome measures extraction.

**Path C: Training export** — GET /llm/training/export → JSONL (for fine-tuning).

## Models + integrations

- LLM: Ollama local (Qwen 2.5 14b default, Llama 3.2 fallback); temp 0.2 (clinical accuracy)
- STT: Whisper (local via WHISPER_API_URL defaulting to localhost:8080) + optional Silero VAD client-side
- 99 languages supported in AmbientAiRecorder
- Specialty prompts: psychiatry / child / aged care / forensic / substance / perinatal
- No cloud API calls (local-only architecture)

## Database tables (4 active + 1 missing)

- `llm_interactions` — audit trail (feature, model_name, metadata JSONB)
- `ai_training_feedback` — clinician feedback (feedback_type, rating, corrected_output)
- `clinical_notes` — note storage (is_ai_draft, soap_*)
- `ai_context_files` — RAG docs
- `ai_modelfiles` — fine-tune config (present but unused)
- **MISSING:** `clinic_feature_flags` (no kill switch)

## Known gaps (from docs/audit-2026-04-19/FINDINGS.md)

### CRITICAL
- **CRIT-G1** No consent capture linked to session (StreamingSession has no consentId field)
- **CRIT-G2** Letters expose HIV/substance/MH without gating (aiEnhancer.ts:63-80 loads indiscriminately)
- **CRIT-G3** Model version not locked (no checkpoint hash in llm_interactions)

### HIGH
- **HIGH-G2** No AI feature kill switch (clinic_feature_flags table missing)
- **HIGH-G3** Scribe recording indicator missing (no UI affordance)
- **HIGH-G4** Data residency not enforced (WHISPER_API_URL defaults to localhost:8080, no validation)
- **HIGH-G5** AI Chat answers prescribing questions (no input classifier)

### MEDIUM
- `is_ai_draft` DB-only, no visible banner
- Letter templates hardcoded (no letter_templates table)
- AI Chat responses missing verify disclaimer

## Frontend integration points

- Web notes tab — AmbientAiRecorder opens full-screen recorder on record-button click
- Web mobile — MobileScribePage (QR-launch, phone-optimised)
- Sara (Flutter) — **no scribe UI yet** — listed in docs/audit-2026-04-19/agent-J-findings.md as missing CRITICAL
- All scribe routes gated by `requireModuleRead(MODULE_KEYS.MEDICAL_SCRIBE)`

## Module access gating

All scribe routes check `requireModuleRead(MODULE_KEYS.MEDICAL_SCRIBE)` (scribeRoutes.ts:85, streamingTranscribeRoutes.ts:25). Admins bypass; clinicians check `access_level='read'|'write'`.
