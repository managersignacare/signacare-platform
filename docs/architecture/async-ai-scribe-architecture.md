# Async AI/Scribe Architecture For Long Psychiatric Interviews

Signacare must not rely on one browser HTTP request to transcribe and summarise
long psychiatric interviews. A 45-60 minute interview can outlive browser tabs,
reverse-proxy request limits, App Service restarts, and Ollama inference
timeouts. The enterprise path is asynchronous: accept the recording/transcript,
queue the clinical AI work, persist progress/result state, and let the UI poll
or subscribe to progress.

## Target Flow

1. The recorder submits long recordings to `POST /api/v1/llm/ambient-note/jobs`.
   The API verifies module access, staff-patient relationship, and recording
   consent before storing the audio artefact in the configured Blob Storage
   backend. The upload snapshots the proof-gated audio-retention policy into
   `ai_job_runs.audio_retention_policy` so cleanup behaviour cannot drift if a
   clinic setting changes while the job is running.
2. The API creates a durable `ai_job_runs` row, enqueues BullMQ work in
   `ai-jobs`, and returns `202` plus a `jobId`. The row stores a minimal
   `queue_payload` so worker startup can reconcile queued AI rows if the
   process crashes between DB admission and BullMQ admission. Generic text AI
   jobs continue to use `POST /api/v1/ai/jobs` and are covered by the same
   queue-admission recovery contract.
3. BullMQ stores the work item in Redis with staff, clinic, patient, model, and
   audio storage context. BullMQ is transport only: clinician-facing status,
   readback, and recovery never expose Redis queue return values directly.
4. `aiWorker` processes the job, rechecking ambient patient relationship and
   non-revoked consent at pickup time before any transcription or LLM call.
   The initial upload still uses the stricter consent TTL; pickup/readback use
   a non-expiring active-consent check so 60-minute interviews do not fail just
   because post-processing finishes after the attestation window.
5. The worker persists stage/progress/result state to `ai_job_runs` and
   publishes `ai-job-progress`, `ai-job-complete`, and
   `ai-job-failed` events over Redis/SSE.
6. The UI listens through `useEventStream()` and can fall back to
   `GET /api/v1/ai/jobs/:id`. Patient summary and formulation jobs surface in
   a full async AI jobs dashboard with status filtering, detail inspection,
   output preview, and apply-result recovery so a clinician can recover
   completed output after a browser disconnect.
7. Completed outputs are stored in `ai_job_runs.result_json` /
   `ai_job_runs.result_text` before the browser is told the job is complete.
   Browser disconnects must not lose the note.

The existing synchronous `/api/v1/llm/clinical-ai` path is acceptable for short
structured prompts and smoke tests. It is not the gold-standard path for
hour-long scribe workflows or CPU-heavy patient summaries. Patient-detail
Maudsley summary and clinical-formulation generation use `POST /api/v1/ai/jobs`.
The job work is durable as soon as the API returns `202`; the patient Summary
tab lists recent scoped jobs and can apply completed output after Azure/client
`499` disconnects or browser reloads.

## Existing Repo Building Blocks

- `apps/api/src/features/llm/llmRoutes.ts` exposes
  `POST /api/v1/llm/ambient-note/jobs` for long-recording async scribe uploads.
- `apps/api/src/features/llm/aiJobRoutes.ts` exposes `POST /api/v1/ai/jobs`,
  `GET /api/v1/ai/jobs/:id`, and `GET /api/v1/ai/jobs`.
- `apps/api/src/features/llm/aiJobStore.ts` persists durable job state in
  `ai_job_runs`, including consent linkage, validation truth, and audio cleanup
  proof.
- `apps/api/src/jobs/workers/aiWorker.ts` processes BullMQ jobs and emits
  progress/completion/failure events. The worker runs the same hallucination
  detector as the synchronous scribe path before exposing async ambient output,
  and reconciles orphaned queued AI rows at startup.
- `apps/web/src/shared/hooks/useEventStream.ts` already knows
  `ai-job-progress`, `ai-job-complete`, and `ai-job-failed`.
- `apps/web/src/shared/services/llmAmbientApi.ts` exposes
  `queueAmbientNote()`, `waitForAmbientNoteJob()`, `listAiJobs()`, and
  `extractAmbientResultFromJobStatus()` so long interviews do not hold one
  browser request open and completed jobs can be recovered.
- Azure Linux deployment uses Redis for BullMQ and Blob Storage for persisted
  artefacts, so the async path works with the active deployment topology.

## External Scribe Parity Closure

The Lyrebird/Heidi comparison gaps are now explicit Signacare contracts, not
aspirational roadmap text:

- Real-time in-visit documentation: `POST /api/v1/scribe/session/:id/realtime-draft`
  accepts current transcript/draft snapshots, verifies staff-patient access and
  recorded scribe consent, emits derived telemetry, and returns a stable lineage
  key. Raw in-visit draft text is not persisted by this proof endpoint.
- AU document generation: `POST /api/v1/scribe/session/:id/au-document` creates
  draft AU documents through the existing `letters` lifecycle, including GP
  referral letters, mental-health care plans, medical certificates, 291/court
  reports, MHA tribunal reports, discharge summaries, and after-visit summaries.
- Per-clinician style learning: `POST /api/v1/scribe/session/:id/style-feedback`
  requires explicit clinician opt-in and records edited-output feedback alongside
  the existing signed-note K-shot style adaptation path.
- Structured MSE citations: `MseStructuredSchema` requires citations for assessed
  domains and zero citations for not-assessed domains; the web MSE panel renders
  finding certainty plus evidence excerpts.
- Shared lineage-keying: `buildScribeArtifactLineageKey()` hashes canonical
  clinical text and stable identifiers so in-visit drafts, async jobs, letters,
  clinical notes, and post-sign artefacts can be reconciled without storing raw
  text in telemetry.
- Outcome telemetry: `POST /api/v1/scribe/session/:id/outcome-telemetry` records
  derived events such as partial draft generated, AU document draft created,
  feedback submitted, signed, exported, and edit/acceptance metrics. Telemetry
  is derived-only and never exposes BullMQ status or raw transcript text.

Deployment proof is also explicit. `GET /api/v1/scribe/capabilities` advertises
the six parity capabilities under the authenticated scribe module gate. The
Linux deploy smoke script checks that endpoint when
`SMOKE_REQUIRE_AI_SCRIBE_PARITY=true`; production defaults this requirement to
true before slot swap and after slot swap.

## Non-Negotiables

- Long psychiatric interviews use async jobs, not browser-blocking requests.
- Core async scribe processing remains non-inferential and must not import
  optional agentic scribe modules; agentic routes use neutral shared helpers and
  are guarded by `guard:scribe-agentic-isolation`.
- Audio/transcript artefacts are persisted before LLM summarisation starts.
- Queue admission is reconciled: queued AI rows with no BullMQ job are
  re-enqueued by worker startup using `ai_job_runs.queue_payload`.
- Non-final worker failures are persisted as `retrying`, not terminal
  `failed`, so UI polling does not abandon a job that BullMQ will retry.
- `ai_job_runs` is the canonical clinical job record. The API does not fall
  back to BullMQ return values for status, list, or completed-result readback.
- The worker rechecks staff/patient relationship at pickup time.
- The worker deletes queued audio under the clinic's immediate-delete retention
  policy on success, failure, consent-revoked paths, and unrecoverable
  queue-reconciliation failures.
- Lyrebird-style immediate-delete is the structural default. Non-immediate
  async scribe audio retention is an exception path. Required proof is
  ADR evidence + clinical safety review evidence + approver metadata; the
  database will not accept the setting without it.
- Non-immediate async scribe audio is not left to indefinite object retention:
  `audioRetentionScheduler` purges expired `ai_job_runs` blob artefacts through
  the configured Blob Storage backend and stamps `audio_deleted_at` as proof.
- Completed ambient job reads re-authorize the current staff/patient
  relationship and current non-revoked consent before returning PHI.
- Progress is observable through SSE and polling.
- Failed jobs remain inspectable for at least 24 hours.
- The UI must show queued/processing/failed/completed states and must not spin
  indefinitely after recording stops.
- Production deploys must prove AI runtime availability only when the AI runtime
  is enabled; staging canary AI smoke must use CSRF-aware authenticated calls.

## Staged Implementation Contract

Current state: the main ambient recorder keeps the synchronous endpoint for
short clips, but automatically uses the async upload/polling contract for
longer recordings. For production-grade 60-minute interviews, the required
contract is:

```text
recording persisted
  -> POST /api/v1/llm/ambient-note/jobs { audio, patientId, consentId, format }
  -> 202 { jobId, pollingUrl }
  -> worker startup reconciles queued AI rows if BullMQ admission was interrupted
  -> SSE ai-job-progress / poll GET /api/v1/ai/jobs/:id
  -> ai_job_runs stores transcript, structured note payload, validation state
  -> Async AI jobs dashboards recover completed clinical AI and ambient scribe output after disconnect
```
