import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..', '..');

function read(relPath: string): string {
  return readFileSync(resolve(ROOT, relPath), 'utf8');
}

describe('Async AI/Scribe Runtime v2 contract', () => {
  it('patient-scopes ambient recovery listing and returns patient identity for UI safety', () => {
    const route = read('src/features/llm/aiJobRoutes.ts');
    const store = read('src/features/llm/aiJobStore.ts');
    const webClient = read('../web/src/shared/services/llmAmbientApi.ts');
    const dashboard = read('../web/src/features/patients/components/notes/AmbientAiJobsDashboard.tsx');

    expect(route).toContain('AiJobListQuerySchema');
    expect(route).toContain('patientId: query.patientId');
    expect(route).toContain('action: query.action');
    expect(route).toContain('patientId: job.patient_id');
    expect(store).toContain('query.where({ patient_id: options.patientId })');
    expect(webClient).toContain("apiClient.get<{ jobs: AmbientAiJobSummary[] }>('ai/jobs', params)");
    expect(dashboard).toContain("llmAmbientApi.listAiJobs({ patientId, action: 'ambient-audio' })");
    expect(dashboard).toContain('belongs to a different patient');
  });

  it('does not expose BullMQ queue state as clinical AI job readback', () => {
    const route = read('src/features/llm/aiJobRoutes.ts');
    const guard = read('../../scripts/guards/check-linux-deployment-hardening-contract.ts');
    const docs = read('../../docs/architecture/async-ai-scribe-architecture.md');

    expect(route).not.toContain('Job.fromId(aiQueue');
    expect(route).not.toContain('getCompleted(');
    expect(route).not.toContain('getActive(');
    expect(route).not.toContain('getWaiting(');
    expect(route).not.toContain('assertBullMqJobAccess');
    expect(route).toContain('AI_JOB_LIST_SCOPE_REQUIRED');
    expect(route).toContain('AI_JOB_LIST_PATIENT_REQUIRED');
    expect(guard).not.toContain('assertBullMqJobAccess');
    expect(docs).toContain('BullMQ is transport only');
    expect(docs).toContain('does not fall');
    expect(docs).toContain('back to BullMQ return values');
  });

  it('dispatches all durable clinical async actions in the AI worker', () => {
    const worker = read('src/jobs/workers/aiWorker.ts');

    expect(worker).toContain("case 'register-summary':");
    expect(worker).toContain("case 'risk-summary':");
    expect(worker).toContain("case 'certificate':");
    expect(worker).toContain("case 'classify':");
  });

  it('uses action-aware module gates so scribe recovery does not require generic AI access', () => {
    const route = read('src/features/llm/aiJobRoutes.ts');

    expect(route).toContain("return action === 'ambient-audio' ? MODULE_KEYS.MEDICAL_SCRIBE : MODULE_KEYS.AI");
    expect(route).toContain('assertAiJobModuleRead');
    expect(route).not.toContain('router.use(requireModuleRead(MODULE_KEYS.AI))');
  });

  it('removes the stale generic ambient action from /ai/jobs submit', () => {
    const route = read('src/features/llm/aiJobRoutes.ts');
    const worker = read('src/jobs/workers/aiWorker.ts');

    const enumBlock = route.slice(route.indexOf('const AsyncAiActionSchema'), route.indexOf('const AiJobSubmitSchema'));
    expect(enumBlock).not.toContain("'ambient'");
    expect(worker).not.toContain("case 'ambient': result = await clinicalAi.processAmbientNotes");
  });

  it('remembers ambient audio before access recheck and deletes only after durable completion', () => {
    const worker = read('src/jobs/workers/aiWorker.ts');

    const payloadParseIndex = worker.indexOf('ambientPayload = JSON.parse(data) as AmbientAudioJobPayload');
    const relationshipRecheckIndex = worker.indexOf('const jobAuth = await recheckAmbientPatientRelationshipAtPickup(job.data)');
    const completedPersistIndex = worker.indexOf("status: 'completed'");
    const completedCleanupIndex = worker.indexOf("reason: 'completed'", completedPersistIndex);

    expect(payloadParseIndex).toBeGreaterThan(-1);
    expect(relationshipRecheckIndex).toBeGreaterThan(-1);
    expect(completedPersistIndex).toBeGreaterThan(-1);
    expect(completedCleanupIndex).toBeGreaterThan(-1);
    expect(payloadParseIndex).toBeLessThan(relationshipRecheckIndex);
    expect(completedPersistIndex).toBeLessThan(completedCleanupIndex);
  });

  it('keeps async summary/formulation generation on the enhanced patient-context path', () => {
    const worker = read('src/jobs/workers/aiWorker.ts');
    const web = read('../web/src/features/patients/components/detail/tabs/useClinicalSummaryJobs.ts');

    expect(worker).toContain('const jobAuth = await recheckAmbientPatientRelationshipAtPickup(job.data)');
    expect(worker).toContain('const { enhancedGenerate } = await import');
    expect(worker).toContain('patientId: job.data.patientId');
    expect(web).toContain('export function useClinicalSummaryJobs(');
    expect(web).toContain('llmAiJobsApi.queueClinicalAiJob');
    expect(web).toContain('llmAiJobsApi.getAiJobStatus');
    expect(web).toContain('const applyCompletedJob');
  });

  it('episode-scopes durable discharge jobs before enhanced context generation', () => {
    const aiRoute = read('src/features/llm/aiJobRoutes.ts');
    const worker = read('src/jobs/workers/aiWorker.ts');
    const enhancer = read('src/mcp/aiEnhancer.ts');
    const dischargeDialog = read('../web/src/features/patients/components/detail/tabs/EpisodesAuxPanels.tsx');

    expect(aiRoute).toContain('episodeId: z.string().uuid().optional()');
    expect(aiRoute).toContain('assertEpisodeBelongsToPatient');
    expect(aiRoute).toContain('.where({ id: episodeId, clinic_id: req.clinicId!, patient_id: patientId })');
    expect(aiRoute).toContain('episodeId,');
    expect(worker).toContain('episodeId?: string;');
    expect(worker).toContain('episodeId: row.queue_payload.episodeId');
    expect(worker).toContain('episodeId,');
    expect(enhancer).toContain('options: { episodeId?: string } = {}');
    expect(enhancer).toContain('const { episodeId } = options');
    expect(enhancer).toContain("if (episodeId) query.where('episode_id', episodeId);");
    expect(enhancer).toContain('episodeId: opts.episodeId');
    expect(dischargeDialog).toContain('episodeId,');
  });

  it('records queue-orphan audio deletion proof on queue admission failure', () => {
    const route = read('src/features/llm/ambientNoteAsyncJobRoute.ts');

    expect(route).toContain("audioRetentionPolicy: 'queue_orphan_deleted'");
    expect(route).toContain('audioDeletedAt: new Date()');
  });

  it('reconciles interrupted queue admission for durable AI rows', () => {
    const migration = read('migrations/20260701000102_async_ai_job_runs.ts');
    const aiRoute = read('src/features/llm/aiJobRoutes.ts');
    const ambientRoute = read('src/features/llm/ambientNoteAsyncJobRoute.ts');
    const worker = read('src/jobs/workers/aiWorker.ts');

    expect(migration).toContain("t.jsonb('queue_payload')");
    expect(migration).toContain('retrying');
    expect(aiRoute).toContain('queuePayload: jobData');
    expect(ambientRoute).toContain('queuePayload: payload');
    expect(worker).toContain('recoverOrphanedQueuedAiJobs');
    expect(worker).toContain("where({ status: 'queued' })");
    expect(worker).toContain("stage: 'queue_recovered'");
    expect(worker).toContain('recoveryQueue.add(row.action, jobData');
    expect(worker).toContain("attempts: row.action === 'ambient-audio' ? 1 : 2");
    expect(worker).toContain("status: 'retrying'");
    expect(worker).toContain('Async ambient recording cleanup failed during queue recovery failure');
  });

  it('does not leak stale retry errors into completed durable AI rows', () => {
    const store = read('src/features/llm/aiJobStore.ts');
    const worker = read('src/jobs/workers/aiWorker.ts');

    expect(store).toContain('failedAt?: Date | null');
    expect(store).toContain('if (patch.failedAt !== undefined) updates.failed_at = patch.failedAt');
    expect(worker).toContain('failedAt: null');
    expect(worker).toContain('errorCode: null');
    expect(worker).toContain('errorMessage: null');
  });

  it('preserves clinically meaningful HttpError codes such as consent revocation', () => {
    const worker = read('src/jobs/workers/aiWorker.ts');

    expect(worker).toContain('import { AppError, HttpError }');
    expect(worker).toContain('function aiJobErrorCode');
    expect(worker).toContain('if (err instanceof HttpError) return err.code');
  });

  it('enforces blob-backed async scribe audio retention instead of relying on indefinite object storage', () => {
    const retention = read('src/mcp/scribeAudioRetention.ts');
    const migration = read('migrations/20260701000103_scribe_audio_retention_proof.ts');
    const route = read('src/features/llm/ambientNoteAsyncJobRoute.ts');
    const settingsRoute = read('src/features/clinic-settings/clinicSettingsRoutes.ts');
    const scheduler = read('src/jobs/schedulers/audioRetentionScheduler.ts');
    const docs = read('../../docs/architecture/async-ai-scribe-architecture.md');
    const behaviorTest = read('tests/unit/asyncAiRuntimeBehavior.test.ts');

    expect(migration).toContain('clinic_settings_scribe_audio_retention_proof_check');
    expect(migration).toContain('scribe_audio_retention_adr IS NOT NULL');
    expect(migration).toContain('scribe_audio_retention_clinical_review IS NOT NULL');
    expect(settingsRoute).toContain('SCRIBE_AUDIO_RETENTION_PROOF_REQUIRED');
    expect(route).toContain('const audioRetentionPolicy = await getRetentionForClinic');
    expect(route).toContain('audioRetentionPolicy,');
    expect(retention).toContain('hasRetentionOverrideProof');
    expect(retention).toContain('purgeExpiredAsyncScribeAudioBlobs');
    expect(retention).toContain("where({ action: 'ambient-audio' })");
    expect(retention).toContain("whereNull('audio_deleted_at')");
    expect(retention).toContain("whereIn('status', ['completed', 'failed', 'cancelled'])");
    expect(retention).toContain('await storage.delete(row.audio_storage_key)');
    expect(retention).toContain('audio_deleted_at: now');
    expect(scheduler).toContain('purgeExpiredAsyncScribeAudioBlobs');
    expect(docs).toContain('stamps `audio_deleted_at` as proof');
    expect(behaviorTest).toContain('purgeExpiredAsyncScribeAudioBlobs(now)');
    expect(behaviorTest).toContain('lacks ADR and clinical safety review proof');
    expect(behaviorTest).toContain("whereIn).toHaveBeenCalledWith('status', ['completed', 'failed', 'cancelled'])");
    expect(behaviorTest).toContain("deleteSpy).toHaveBeenCalledWith('audio/2026/05/job-expired.webm')");
  });

  it('requires consent copy to disclose async upload and retention behavior', () => {
    const consentDialog = read('../web/src/features/patients/components/notes/AmbientScribeConsentDialog.tsx');

    expect(consentDialog).toContain('durable asynchronous transcription');
    expect(consentDialog).toContain('server-side async processing');
    expect(consentDialog).toContain('audio-retention setting');
    expect(consentDialog).toContain('clinician review before the output enters the clinical record');
  });
});
