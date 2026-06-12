#!/usr/bin/env tsx
/**
 * Linux deployment hardening contract.
 *
 * Pins the operational controls that protect staging/prod parity:
 * long-running AI/scribe architecture, authenticated clinical smoke policy,
 * observability proof, and database release-control evidence.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..', '..');

function read(relPath: string): string {
  return readFileSync(resolve(ROOT, relPath), 'utf8');
}

function exists(relPath: string): boolean {
  return existsSync(resolve(ROOT, relPath));
}

function has(source: string, pattern: RegExp | string): boolean {
  return typeof pattern === 'string' ? source.includes(pattern) : pattern.test(source);
}

const violations: string[] = [];

function requireFile(relPath: string): void {
  if (!exists(relPath)) violations.push(`${relPath}: required file is missing`);
}

function requirePattern(relPath: string, pattern: RegExp | string, reason: string): void {
  if (!exists(relPath)) {
    violations.push(`${relPath}: required file is missing`);
    return;
  }
  if (!has(read(relPath), pattern)) violations.push(`${relPath}: ${reason}`);
}

requireFile('docs/architecture/async-ai-scribe-architecture.md');
requireFile('docs/operations/runbooks/database-release-controls.md');
requireFile('deploy/azure/deploy-ai-runtime-services.sh');
requireFile('deploy/azure/verify-database-release-controls.sh');
requireFile('apps/api/entrypoint.sh');
requireFile('apps/api/migrations/20260701000102_async_ai_job_runs.ts');
requireFile('apps/api/src/features/llm/aiJobStore.ts');
requireFile('apps/api/src/features/llm/ambientNoteAsyncJobRoute.ts');
requireFile('apps/api/src/mcp/scribeAudioRetention.ts');
requireFile('apps/api/tests/unit/asyncAiRuntimeBehavior.test.ts');
requireFile('apps/web/src/features/patients/components/detail/tabs/ClinicalAiJobsDashboard.tsx');
requireFile('apps/web/src/features/patients/components/notes/AmbientScribeConsentDialog.tsx');

for (const stalePath of [
  'deploy/azure/enable-ai-runtime.sh',
  'deploy/azure/ai-runtime-compose.template.yml',
  'docs/guides/azure-dev-test-deployment.md',
]) {
  if (exists(stalePath)) violations.push(`${stalePath}: stale deployment artifact must be removed`);
}

const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };
const scripts = packageJson.scripts ?? {};

if (!/scripts\/guards\/check-linux-deployment-hardening-contract\.ts/.test(scripts['guard:linux-deployment-hardening-contract'] ?? '')) {
  violations.push('package.json: missing guard:linux-deployment-hardening-contract script');
}
if (!(scripts['guard:architecture-boundaries'] ?? '').includes('guard:linux-deployment-hardening-contract')) {
  violations.push('package.json: guard:architecture-boundaries must include guard:linux-deployment-hardening-contract');
}
if (!(scripts['guard:claude-discipline'] ?? '').includes('guard:linux-deployment-hardening-contract')) {
  violations.push('package.json: guard:claude-discipline must include guard:linux-deployment-hardening-contract');
}

const asyncDocChecks: Array<[RegExp | string, string]> = [
  ['60 minute', 'async scribe architecture must explicitly cover 60-minute psychiatric interviews'],
  ['POST /api/v1/llm/ambient-note/jobs', 'async scribe architecture must document the long-recording upload endpoint'],
  ['POST /api/v1/ai/jobs', 'async scribe architecture must use the queued AI job endpoint'],
  ['GET /api/v1/ai/jobs/:id', 'async scribe architecture must document polling fallback'],
  ['ai_job_runs', 'async scribe architecture must document durable job persistence'],
  ['queue_payload', 'async AI architecture must document queue-admission reconciliation payloads'],
  ['reconciles queued AI rows', 'async AI architecture must document interrupted queue-admission recovery'],
  ['BullMQ', 'async scribe architecture must name the queue backend'],
  ['ai-job-progress', 'async scribe architecture must document progress SSE events'],
  ['ai-job-complete', 'async scribe architecture must document completion SSE events'],
  ['ai-job-failed', 'async scribe architecture must document failure SSE events'],
  ['Browser disconnects must not lose the note', 'async scribe architecture must fail closed on browser disconnects'],
  ['full async AI jobs dashboard', 'async AI architecture must document full dashboard recovery UI for non-scribe clinical jobs'],
  ['stamps `audio_deleted_at` as proof', 'async AI architecture must document DB-backed blob audio retention deletion proof'],
  ['ADR evidence + clinical safety review evidence', 'async AI architecture must document proof-gated retained-audio exceptions'],
];
for (const [pattern, reason] of asyncDocChecks) {
  requirePattern('docs/architecture/async-ai-scribe-architecture.md', pattern, reason);
}

const aiRouteChecks: Array<[RegExp | string, string]> = [
  ['POST /api/v1/ai/jobs', 'AI job route must retain the async submit endpoint documentation'],
  ['res.status(202).json', 'AI job submit route must acknowledge queued work without blocking'],
  ['AiJobSubmitResponseSchema', 'AI job submit response must be schema-backed'],
  ['AiJobStatusResponseSchema', 'AI job status response must be schema-backed'],
  ['getAiJobRunForStaff', 'AI job status route must read durable job state as the canonical source'],
  ['listAiJobRunsForStaff', 'AI job list route must read durable job state as the canonical source'],
  ['AI_JOB_NOT_FOUND', 'AI job status errors must use canonical AppError middleware codes'],
  ['AI_JOB_LIST_SCOPE_REQUIRED', 'AI job list route must require an explicit action scope'],
  ['AI_JOB_LIST_PATIENT_REQUIRED', 'AI job list route must require patient scope for clinical actions'],
  ['AI_JOB_LIST_ERROR', 'AI job list errors must use canonical AppError middleware codes'],
  ['AsyncAiActionSchema', 'AI job submit route must restrict action dispatch to an explicit allowlist'],
  ['requireRoles([\'clinician\', \'admin\', \'superadmin\'])', 'AI job route must be role-gated'],
  ['requireModuleRead(MODULE_KEYS.AI)', 'AI job route must be AI-module gated'],
  ['authorizeAiRequest', 'AI job submit route must pass through AI policy authorization'],
  ['requirePatientRelationship', 'ambient AI jobs must retain relationship enforcement'],
  ['assertAiJobReadAccess', 'AI job status route must re-authorize durable PHI reads'],
  ['verifyRecordingConsentStillActive', 'AI job status route must deny ambient readback after consent revocation without re-expiring long interviews'],
];
for (const [pattern, reason] of aiRouteChecks) {
  requirePattern('apps/api/src/features/llm/aiJobRoutes.ts', pattern, reason);
}

const ambientAsyncRouteChecks: Array<[RegExp | string, string]> = [
  ['ambient-note/jobs', 'LLM routes must expose the async ambient upload endpoint'],
  ['AmbientNoteJobQueuedResponseSchema', 'async ambient upload response must be schema-backed'],
  ['AMBIENT_NOTE_RECORDING_QUEUED', 'async ambient upload must write an audit row'],
  ['blobStorage.put', 'async ambient upload must persist audio before queueing'],
  ['blobStorage.delete', 'async ambient upload must clean orphan audio if queue admission fails'],
  ['queueAccepted', 'async ambient upload cleanup must distinguish accepted queue jobs from orphan uploads'],
  ['createAiJobRun', 'async ambient upload must create durable job state before queueing'],
  ['consentId: dto.consentId', 'async ambient upload must persist consent linkage on the durable job'],
  ['const audioRetentionPolicy = await getRetentionForClinic', 'async ambient upload must snapshot proof-gated audio retention policy'],
  ['audioRetentionPolicy,', 'async ambient upload must persist the retention-policy snapshot into durable job state'],
  ['aiJobQueue.add', 'async ambient upload must enqueue BullMQ work'],
];
for (const [pattern, reason] of ambientAsyncRouteChecks) {
  requirePattern('apps/api/src/features/llm/ambientNoteAsyncJobRoute.ts', pattern, reason);
}
requirePattern(
  'apps/api/src/features/llm/llmRoutes.ts',
  'registerAmbientNoteAsyncJobRoute(router)',
  'LLM route index must register the async ambient upload route',
);

const workerChecks: Array<[RegExp | string, string]> = [
  ['AI_QUEUE_NAME = \'ai-jobs\'', 'AI worker must retain the canonical BullMQ queue name'],
  ['recoverOrphanedQueuedAiJobs', 'AI worker must reconcile queued AI rows that missed BullMQ admission'],
  ['queue_recovered', 'AI worker must persist proof when queue-admission reconciliation recovers a job'],
  ['attempts: row.action === \'ambient-audio\' ? 1 : 2', 'AI worker must preserve retry budget for recovered generic clinical AI jobs'],
  ['status: \'retrying\'', 'AI worker must not mark retryable attempt failures as terminal failed state'],
  ['function aiJobErrorCode', 'AI worker must preserve meaningful HttpError codes such as consent revocation'],
  ['recheckAmbientPatientRelationshipAtPickup', 'AI worker must recheck ambient relationship at pickup'],
  ['ambient-audio', 'AI worker must support queued ambient audio jobs'],
  ['updateAiJobRun', 'AI worker must persist durable job state'],
  ['resolveAmbientAudioStorage(parsed.audioStorageBackend)', 'AI worker must load persisted audio artefacts through the recorded blob backend'],
  ['verifyRecordingConsentStillActive', 'AI worker must recheck non-revoked recording consent at processing time without re-expiring long interviews'],
  ['detectScribeHallucinations', 'AI worker must apply scribe hallucination detection before exposing async ambient output'],
  ['cleanupAmbientAudioIfImmediate', 'AI worker must cleanup async ambient audio under retention policy'],
  ['isScribeAudioRetention(params.audioRetentionPolicy)', 'AI worker cleanup must prefer the queued retention-policy snapshot'],
  ['await storage.delete(params.audioStorageKey)', 'AI worker must delete async ambient audio through the recorded blob backend when immediate retention applies'],
  ['validationValid: validation.valid', 'AI worker must persist real validation state instead of inferring it from error state'],
  ['failedAt: null', 'AI worker completion must clear stale retry failure timestamps'],
  ['errorCode: null', 'AI worker completion must clear stale retry error code'],
  ['errorMessage: null', 'AI worker completion must clear stale retry error message'],
  ['ai-job-progress', 'AI worker must publish progress events'],
  ['ai-job-complete', 'AI worker must publish completion events'],
  ['ai-job-failed', 'AI worker must publish failure events'],
];
for (const [pattern, reason] of workerChecks) {
  requirePattern('apps/api/src/jobs/workers/aiWorker.ts', pattern, reason);
}

const aiJobStoreChecks: Array<[RegExp | string, string]> = [
  ['createAiJobRun', 'AI job store must create durable jobs'],
  ['updateAiJobRun', 'AI job store must persist progress/results/failures'],
  ['getAiJobRunForStaff', 'AI job store must scope status reads to current staff'],
  ['listAiJobRunsForStaff', 'AI job store must scope list reads to current staff'],
  ['withTenantContext', 'AI job store must enforce tenant context'],
  ['outputHash', 'AI job store must hash generated output for provenance'],
  ['failedAt?: Date | null', 'AI job store must support clearing stale failure timestamps after successful retry'],
];
for (const [pattern, reason] of aiJobStoreChecks) {
  requirePattern('apps/api/src/features/llm/aiJobStore.ts', pattern, reason);
}

const aiJobMigrationChecks: Array<[RegExp | string, string]> = [
  ['ai_job_runs', 'AI job migration must create the durable job table'],
  ['result_json', 'AI job migration must persist structured result payloads'],
  ['queue_payload', 'AI job migration must persist minimal queue payload for admission reconciliation'],
  ['retrying', 'AI job migration must allow non-terminal retrying state'],
  ['audio_storage_key', 'AI job migration must persist uploaded audio references'],
  ['consent_id', 'AI job migration must link ambient jobs to recording consent rows'],
  ['validation_valid', 'AI job migration must persist explicit validation truth'],
  ['audio_deleted_at', 'AI job migration must persist audio cleanup proof'],
  ['audio_retention_policy', 'AI job migration must persist the applied retention policy'],
  ['FORCE ROW LEVEL SECURITY', 'AI job migration must force RLS'],
  ['rls_ai_job_runs_tenant', 'AI job migration must define tenant RLS policy'],
];
for (const [pattern, reason] of aiJobMigrationChecks) {
  requirePattern('apps/api/migrations/20260701000102_async_ai_job_runs.ts', pattern, reason);
}
const retentionProofMigrationChecks: Array<[RegExp | string, string]> = [
  ['clinic_settings_scribe_audio_retention_proof_check', 'scribe audio retention migration must enforce proof-gated non-immediate retention'],
  ['scribe_audio_retention_adr IS NOT NULL', 'scribe audio retention migration must require ADR evidence'],
  ['scribe_audio_retention_clinical_review IS NOT NULL', 'scribe audio retention migration must require clinical safety review evidence'],
  ['scribe_audio_retention_approved_by_staff_id IS NOT NULL', 'scribe audio retention migration must require approver identity'],
  ['scribe_audio_retention_approved_at IS NOT NULL', 'scribe audio retention migration must require approval timestamp'],
];
for (const [pattern, reason] of retentionProofMigrationChecks) {
  requirePattern('apps/api/migrations/20260701000103_scribe_audio_retention_proof.ts', pattern, reason);
}

const ambientWebChecks: Array<[RegExp | string, string]> = [
  ['queueAmbientNote', 'web ambient client must expose async queue submission'],
  ['waitForAmbientNoteJob', 'web ambient client must expose polling fallback'],
  ['listAiJobs', 'web ambient client must list durable jobs for browser-disconnect recovery'],
  ['extractAmbientResultFromJobStatus', 'web ambient client must expose durable payload extraction for recovery'],
  ['AmbientNoteJobTimeoutError', 'web ambient client must fail visibly instead of spinning forever'],
  ['AMBIENT_NOTE_JOB_TIMEOUT_MS', 'web ambient client must allow long psychiatric interview polling windows'],
];
for (const [pattern, reason] of ambientWebChecks) {
  requirePattern('apps/web/src/shared/services/llmAmbientApi.ts', pattern, reason);
}

const ambientRecorderChecks: Array<[RegExp | string, string]> = [
  ['AmbientAiJobsDashboard', 'ambient recorder must render the full async scribe jobs dashboard'],
];
for (const [pattern, reason] of ambientRecorderChecks) {
  requirePattern('apps/web/src/features/patients/components/notes/AmbientAiRecorder.tsx', pattern, reason);
}
const ambientRecorderRunnerChecks: Array<[RegExp | string, string]> = [
  ['VITE_SCRIBE_ASYNC_AMBIENT', 'ambient recorder must have an explicit async-scribe rollout switch'],
  ['queueAmbientNote', 'ambient recorder must queue long recordings asynchronously'],
  ['waitForAmbientNoteJob', 'ambient recorder must poll queued long recordings'],
  ['Async Scribe Jobs Dashboard', 'ambient recorder must point timeout recovery copy to the full dashboard'],
];
for (const [pattern, reason] of ambientRecorderRunnerChecks) {
  requirePattern('apps/web/src/features/patients/components/notes/useAmbientScribeJobRunner.ts', pattern, reason);
}
requirePattern(
  'apps/web/src/features/patients/components/notes/AmbientRecorderControls.tsx',
  'The server-side job will continue if this browser disconnects',
  'ambient recorder must tell clinicians browser disconnects do not cancel jobs',
);
const ambientDashboardChecks: Array<[RegExp | string, string]> = [
  ['Async Scribe Jobs Dashboard', 'ambient dashboard must have a full visible dashboard title'],
  ['Status filter', 'ambient dashboard must support status filtering'],
  ['llmAmbientApi.getAiJobStatus', 'ambient dashboard must inspect durable job state'],
  ['Output preview', 'ambient dashboard must preview completed durable payloads'],
  ['Apply as AI draft', 'ambient dashboard must apply completed durable output only as a clinician-reviewed draft'],
  ['statusLabel', 'ambient dashboard must map internal queue states to clinician-friendly labels'],
];
for (const [pattern, reason] of ambientDashboardChecks) {
  requirePattern('apps/web/src/features/patients/components/notes/AmbientAiJobsDashboard.tsx', pattern, reason);
}
const ambientConsentDialogChecks: Array<[RegExp | string, string]> = [
  ['durable asynchronous transcription', 'ambient consent dialog must disclose durable async processing'],
  ['server-side async processing', 'ambient consent dialog must disclose server-side async upload processing'],
  ['audio-retention setting', 'ambient consent dialog must disclose the clinic audio-retention setting'],
  ['clinician review before the output enters the clinical record', 'ambient consent dialog must disclose clinician-review requirement'],
];
for (const [pattern, reason] of ambientConsentDialogChecks) {
  requirePattern('apps/web/src/features/patients/components/notes/AmbientScribeConsentDialog.tsx', pattern, reason);
}

const clinicalAiWebChecks: Array<[RegExp | string, string]> = [
  ['queueClinicalAiJob', 'clinical AI client must expose explicit queue submission so callers retain job id'],
  ['listAiJobs', 'clinical AI client must list durable jobs for browser-disconnect recovery'],
  ['ClinicalAiJobTimeoutError', 'clinical AI client must surface durable job id on timeout'],
  ['activeJobId: summaryBuckets.activeJobId', 'patient summary UI must retain the queued summary job id'],
  ['activeJobId: formulationBuckets.activeJobId', 'patient summary UI must retain the queued formulation job id'],
  ['const applyCompletedJob = useCallback', 'patient summary UI must allow applying completed durable clinical AI output'],
  ['status.patientId && status.patientId !== patientId', 'patient summary UI must prevent cross-patient async job application'],
];
for (const [pattern, reason] of clinicalAiWebChecks.slice(0, 3)) {
  requirePattern('apps/web/src/shared/services/llmAiJobsApi.ts', pattern, reason);
}
for (const [pattern, reason] of clinicalAiWebChecks.slice(3)) {
  requirePattern('apps/web/src/features/patients/components/detail/tabs/useClinicalSummaryJobs.ts', pattern, reason);
}
requirePattern(
  'apps/web/src/features/patients/components/detail/tabs/ClinicalAiJobsDashboard.tsx',
  'Async AI Jobs Dashboard',
  'patient summary UI must render a full async AI jobs dashboard',
);
requirePattern(
  'apps/web/src/features/patients/components/detail/tabs/ClinicalAiJobsDashboard.tsx',
  'Status filter',
  'patient async AI jobs dashboard must support status filtering',
);
requirePattern(
  'apps/web/src/features/patients/components/detail/tabs/ClinicalAiJobsDashboard.tsx',
  'llmAiJobsApi.getAiJobStatus',
  'patient async AI jobs dashboard must inspect durable job details',
);
requirePattern(
  'apps/web/src/features/patients/components/detail/tabs/ClinicalAiJobsDashboard.tsx',
  'Output preview',
  'patient async AI jobs dashboard must expose completed output preview',
);
requirePattern(
  'apps/web/src/features/patients/components/detail/tabs/ClinicalAiJobsDashboard.tsx',
  'statusLabel',
  'patient async AI jobs dashboard must map internal queue states to clinician-friendly labels',
);

const scribeRetentionChecks: Array<[RegExp | string, string]> = [
  ['purgeExpiredAsyncScribeAudioBlobs', 'scribe retention module must purge DB-tracked async scribe blobs'],
  ['where({ action: \'ambient-audio\' })', 'scribe retention purge must scope to async ambient audio jobs'],
  ['whereNull(\'audio_deleted_at\')', 'scribe retention purge must only delete audio without deletion proof'],
  ['whereIn(\'status\', [\'completed\', \'failed\', \'cancelled\'])', 'scribe retention purge must not delete queued or processing audio before worker pickup'],
  ['await storage.delete(row.audio_storage_key)', 'scribe retention purge must delete through the recorded blob backend'],
  ['audio_deleted_at: now', 'scribe retention purge must stamp deletion proof'],
  ['buildBlobStorageForBackend', 'scribe retention purge must support rows stored on non-active blob backend'],
];
for (const [pattern, reason] of scribeRetentionChecks) {
  requirePattern('apps/api/src/mcp/scribeAudioRetention.ts', pattern, reason);
}
requirePattern(
  'apps/api/src/jobs/schedulers/audioRetentionScheduler.ts',
  'purgeExpiredAsyncScribeAudioBlobs',
  'audio retention scheduler must invoke async scribe blob retention cleanup',
);
requirePattern(
  'apps/api/tests/unit/asyncAiRuntimeBehavior.test.ts',
  'purgeExpiredAsyncScribeAudioBlobs(now)',
  'async AI runtime must have behavioral coverage for expired blob audio retention cleanup',
);
requirePattern(
  'apps/api/tests/unit/asyncAiRuntimeBehavior.test.ts',
  'failed_at: null',
  'async AI runtime must have behavioral coverage for clearing stale retry failure fields',
);

const smokeChecks: Array<[RegExp | string, string]> = [
  ['SMOKE_REQUIRE_AUTHENTICATED_CHECKS', 'smoke must make authenticated clinical checks explicitly optional/required'],
  ['SMOKE_REQUIRE_OBSERVABILITY', 'smoke must have an observability proof switch'],
  ['check_observability_config', 'smoke must verify observability App Service settings'],
  ['APPLICATIONINSIGHTS_CONNECTION_STRING', 'smoke must require Application Insights setting'],
  ['OTEL_EXPORTER_OTLP_ENDPOINT', 'smoke must require OTEL endpoint setting'],
  ['SLACK_WEBHOOK_SECURITY', 'smoke must require security alert webhook setting'],
  ['SLACK_WEBHOOK_OPS', 'smoke must require ops alert webhook setting'],
  ['/api/v1/auth/csrf', 'authenticated AI smoke must fetch CSRF token'],
  ['X-CSRF-Token', 'authenticated AI smoke must send CSRF token'],
];
for (const [pattern, reason] of smokeChecks) {
  requirePattern('deploy/azure/post-deploy-smoke.sh', pattern, reason);
}

const workflowChecks: Array<[RegExp | string, string]> = [
  ['deploy-ai-runtime-services.sh', 'Azure deploy must use the dedicated AI runtime service deployer'],
  ['Validate smoke credential policy', 'Azure deploy must fail prod when smoke credentials are missing'],
  ['Validate database release-control proof', 'Azure deploy must run the database release-control proof gate'],
  ['Validate deployment slot topology', 'Azure deploy must fail closed when the deployment slot topology is missing'],
  ['Wait for API readiness on deployment target', 'Azure deploy must gate image rollout on API readiness after startup migrations'],
  ['Smoke test deployment slot', 'Azure deploy must prove the deployment slot before traffic cutover'],
  ['Swap deployment slot into live site', 'Azure deploy must use slot swap for traffic cutover'],
  ['Post-swap smoke test on live site', 'Azure deploy must prove the live site after slot swap'],
  ['DB_RELEASE_CONTROLS_REQUIRED', 'Azure deploy must make DB release controls environment-gated'],
  ['DB_STAGING_CLONE_MIGRATION_PROOF', 'Azure deploy must require staging clone migration proof'],
  ['DB_EXPAND_CONTRACT_PROOF', 'Azure deploy must require expand/contract proof'],
  ['DB_RESTORE_DRILL_PROOF', 'Azure deploy must require restore drill proof'],
  ['DB_ROLLBACK_REHEARSAL_PROOF', 'Azure deploy must require rollback rehearsal proof'],
  ['SMOKE_REQUIRE_OBSERVABILITY', 'Azure deploy must pass observability policy into smoke'],
  ['SMOKE_AZURE_API_APP_NAME', 'Azure deploy smoke must identify the API App Service for app-setting proof'],
];
for (const [pattern, reason] of workflowChecks) {
  requirePattern('.github/workflows/azure-deploy.yml', pattern, reason);
}

const aiRuntimeScriptChecks: Array<[RegExp | string, string]> = [
  ['AI_RUNTIME_PROD_APPROVED', 'AI runtime deployer must fail closed for production until reviewed topology evidence exists'],
  ['require_digest_ref AI_OLLAMA_IMAGE', 'AI runtime deployer must require immutable Ollama image digests'],
  ['require_digest_ref AI_WHISPER_IMAGE', 'AI runtime deployer must require immutable Whisper image digests'],
  ['config access-restriction add', 'AI runtime deployer must restrict direct public access'],
  ['config access-restriction remove', 'AI runtime deployer must be idempotent when refreshing access restrictions'],
  ['SIGNACARE_OLLAMA_MODEL_MANIFEST_SHA256', 'AI runtime deployer must stamp model manifest proof into API metadata'],
  ['SIGNACARE_WHISPER_MODEL_SHA256', 'AI runtime deployer must stamp Whisper model proof into API metadata'],
];
for (const [pattern, reason] of aiRuntimeScriptChecks) {
  requirePattern('deploy/azure/deploy-ai-runtime-services.sh', pattern, reason);
}

const dbScriptChecks: Array<[RegExp | string, string]> = [
  ['DB_STAGING_CLONE_MIGRATION_PROOF', 'database release-control script must require staging clone migration proof'],
  ['DB_EXPAND_CONTRACT_PROOF', 'database release-control script must require expand/contract proof'],
  ['DB_RESTORE_DRILL_PROOF', 'database release-control script must require restore drill proof'],
  ['DB_ROLLBACK_REHEARSAL_PROOF', 'database release-control script must require rollback rehearsal proof'],
  ['[[ "$ENV_NAME" == "prod" ]]', 'database release-control script must default prod to fail-closed'],
];
for (const [pattern, reason] of dbScriptChecks) {
  requirePattern('deploy/azure/verify-database-release-controls.sh', pattern, reason);
}

const dbRunbookChecks: Array<[RegExp | string, string]> = [
  ['staging-clone database', 'database runbook must include staging clone migration testing'],
  ['expand/contract', 'database runbook must document expand/contract enforcement'],
  ['restore-drill', 'database runbook must document restore drill proof'],
  ['migrate:rehearsal', 'database runbook must document rollback rehearsal'],
];
for (const [pattern, reason] of dbRunbookChecks) {
  requirePattern('docs/operations/runbooks/database-release-controls.md', pattern, reason);
}

const apiStartupChecks: Array<[RegExp | string, string]> = [
  ['dist/scripts/migrate.js', 'API startup hook must run compiled migrations before the server boots'],
  ['dist/src/index.js', 'API startup hook must launch the compiled server entry after migrations'],
];
for (const [pattern, reason] of apiStartupChecks) {
  requirePattern('apps/api/entrypoint.sh', pattern, reason);
}
requirePattern(
  'apps/api/Dockerfile',
  'ENTRYPOINT ["./entrypoint.sh"]',
  'API container must use the migration-aware startup entrypoint',
);

const privateLaneChecks: Array<[string, RegExp | string, string]> = [
  ['deploy/azure/modules/appservice.bicep', 'virtualNetworkSubnetId', 'App Service module must wire API apps into the delegated subnet for private-lane egress'],
  ['deploy/azure/modules/appservice.bicep', 'vnetRouteAllEnabled', 'App Service module must route API egress through the VNet for private-lane DNS resolution'],
  ['deploy/azure/main.bicep', 'enablePrivateNetwork: enablePrivateNetwork', 'Root Bicep must pass private-network state into the App Service module'],
  ['deploy/azure/main.bicep', "appSubnetId: enablePrivateNetwork ? networkPrivate!.outputs.appSubnetId : ''", 'Root Bicep must pass the delegated App Service subnet into the App Service module'],
  ['deploy/azure/parameters.staging.json', '"enablePrivateNetwork":  { "value": true }', 'Staging parameters must enable private-network topology'],
  ['deploy/azure/parameters.staging.json', '"enableAzureOpenAi":     { "value": true }', 'Staging parameters must enable the Azure OpenAI lane'],
];
for (const [relPath, pattern, reason] of privateLaneChecks) {
  requirePattern(relPath, pattern, reason);
}

if (violations.length > 0) {
  console.error('Linux deployment hardening contract failed:');
  for (const violation of violations) console.error(`  - ${violation}`);
  process.exit(1);
}

console.log('Linux deployment hardening contract passed.');
