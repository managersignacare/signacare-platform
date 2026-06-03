/**
 * AI Job Worker — Processes LLM requests asynchronously via BullMQ
 *
 * Instead of blocking HTTP requests for 30-180 seconds, AI work is queued
 * and results are delivered via SSE (Server-Sent Events).
 *
 * Job types:
 *   - formulation, isbar, maudsley, admin-report, report-insight
 *   - handover-summary, medication-adherence, ect-summary, discharge
 *   - ambient (scribe post-processing)
 */

import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { logger } from '../../utils/logger';
// BUG-042 — canonical shutdown registry (static import per §9.6).
import { registerShutdownHook } from '../../shared/gracefulShutdown';
import { AppError } from '../../shared/errors';
import { dbAdmin } from '../../db/db';
import type { AuthContext } from '@signacare/shared';
import { requireClinicalAccessRole, requirePatientRelationship } from '../../shared/authGuards';

const AI_QUEUE_NAME = 'ai-jobs';

interface AiJobData {
  jobId: string;
  action: string;
  data: string;
  model?: string;
  patientId?: string;
  staffId?: string;
  clinicId?: string;
}

interface AiJobResult {
  jobId: string;
  action: string;
  result: string;
  model: string;
  validated: boolean;
  validationWarnings: string[];
  completedAt: string;
}

interface AmbientJobStaffRow {
  id: string;
  clinic_id: string;
  role: string;
  is_active: boolean;
  deleted_at: Date | string | null;
}

/**
 * BUG-331 — ambient jobs can sit in queue while staff relationships change.
 * Re-evaluate the current patient-relationship (and staff eligibility) at
 * pickup-time before any LLM processing starts.
 */
export async function recheckAmbientPatientRelationshipAtPickup(
  job: Pick<AiJobData, 'action' | 'patientId' | 'staffId' | 'clinicId'>,
): Promise<void> {
  if (job.action !== 'ambient') return;

  if (!job.patientId || !job.staffId || !job.clinicId) {
    throw new AppError(
      'Ambient jobs require patientId, staffId, and clinicId to enforce relationship checks',
      400,
      'AMBIENT_JOB_CONTEXT_INVALID',
    );
  }

  const staff = await dbAdmin('staff')
    .where({ id: job.staffId })
    .whereNull('deleted_at')
    .first<AmbientJobStaffRow>('id', 'clinic_id', 'role', 'is_active', 'deleted_at');

  if (!staff || staff.clinic_id !== job.clinicId || !staff.is_active) {
    throw new AppError(
      'Ambient job staff context is not active for this clinic',
      403,
      'AMBIENT_STAFF_CONTEXT_INVALID',
    );
  }

  const auth: AuthContext = {
    staffId: staff.id,
    clinicId: staff.clinic_id,
    role: staff.role,
    permissions: [],
    patientId: job.patientId,
  };

  requireClinicalAccessRole(auth);
  await requirePatientRelationship(auth, job.patientId);
}

// ── Validation rules for AI output ──
function validateAiOutput(action: string, output: string): { valid: boolean; warnings: string[] } {
  const warnings: string[] = [];

  // Check for empty output
  if (!output || output.trim().length < 10) {
    return { valid: false, warnings: ['Output is empty or too short'] };
  }

  // Check for hallucinated drug names (common LLM issue)
  const suspiciousDrugPatterns = /(\d{4,}\s*mg|\d{3,}\s*mcg|inject\s+\d{3,}\s*ml)/i;
  if (suspiciousDrugPatterns.test(output)) {
    warnings.push('Possible hallucinated drug dose detected — review carefully');
  }

  // Check for PII leakage patterns (other patient names/MRNs appearing in output)
  const mrnPattern = /EMR-\d{3,}/g;
  const mrnMatches = output.match(mrnPattern);
  if (mrnMatches && mrnMatches.length > 1) {
    warnings.push('Multiple MRN references detected — possible cross-patient data leak');
  }

  // Check for markdown artifacts that should have been stripped
  if (/^#{1,3}\s/m.test(output) || /\*\*[^*]+\*\*/g.test(output)) {
    // Strip markdown for clinical output
    warnings.push('Markdown formatting detected and will be stripped');
  }

  // Action-specific validation
  if (action === 'formulation' || action === '5p-formulation') {
    const requiredSections = ['presenting', 'predisposing', 'precipitating', 'perpetuating', 'protective'];
    const missing = requiredSections.filter(s => !output.toLowerCase().includes(s));
    if (missing.length > 2) {
      warnings.push(`Formulation may be incomplete — missing: ${missing.join(', ')}`);
    }
  }

  return { valid: true, warnings };
}

// Strip markdown from clinical output
function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^[-*]\s+/gm, '- ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim();
}

export function startAiWorker(redisUrl: string) {
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });

  const worker = new Worker<AiJobData, AiJobResult>(
    AI_QUEUE_NAME,
    async (job: Job<AiJobData>) => {
      const { jobId, action, data, model, staffId, clinicId } = job.data;
      const startTime = Date.now();

      logger.info({ jobId, action, staffId }, `AI job started: ${action}`);

      // Publish progress event
      await connection.publish(`ai-events:${clinicId}`, JSON.stringify({
        type: 'ai-job-progress',
        jobId,
        action,
        status: 'processing',
        staffId,
      }));

      try {
        await recheckAmbientPatientRelationshipAtPickup(job.data);

        // Import the LLM module dynamically to avoid circular deps
        const { clinicalAi } = await import('../../mcp/localLlmAgent');

        let result: string;
        switch (action) {
          case 'maudsley': result = await clinicalAi.generateMaudsleySummary(data, model); break;
          case 'isbar': result = await clinicalAi.generateISBAR(data, model); break;
          case 'formulation': result = await clinicalAi.generateFormulation(data, model); break;
          case '91day': result = await clinicalAi.generate91DayReview(data, model); break;
          case 'letter': result = await clinicalAi.generateLetter(data, 'GP letter', model); break;
          case 'ambient': result = await clinicalAi.processAmbientNotes(data, model); break;
          case 'admin-report': result = await clinicalAi.generateAdminReport(data, model); break;
          case 'discharge': result = await clinicalAi.generateDischargeSummary(data, model); break;
          case 'med-summary': result = await clinicalAi.generateMedSummary(data, model); break;
          default:
            // Generic action — route through admin-report with context
            result = await clinicalAi.generateAdminReport(
              `Context: ${action}\n\nAnalyse the following:\n\n${data}`,
              model
            );
        }

        // Validate output
        const validation = validateAiOutput(action, result);
        const cleanResult = stripMarkdown(result);

        const jobResult: AiJobResult = {
          jobId,
          action,
          result: cleanResult,
          model: model ?? 'default',
          validated: validation.valid,
          validationWarnings: validation.warnings,
          completedAt: new Date().toISOString(),
        };

        const durationMs = Date.now() - startTime;
        logger.info({ jobId, action, durationMs, warnings: validation.warnings.length }, `AI job completed: ${action}`);

        // Record AI provenance for regulatory compliance
        try {
          const crypto = await import('crypto');
          const knex = (await import('../../db/db')).db;
          await knex('ai_provenance').insert({
            id: crypto.randomUUID(),
            clinic_id: clinicId,
            job_id: jobId,
            action,
            output_hash: crypto.createHash('sha256').update(cleanResult).digest('hex'),
            output_length: cleanResult.length,
            model_name: model ?? 'llama3.2',
            model_version: 'latest',
            prompt_template_version: '1.0',
            patient_id: job.data.patientId || null,
            source_data_summary: data.substring(0, 500),
            validated: validation.valid,
            validation_warnings: validation.warnings,
            created_by_staff_id: staffId,
            created_at: new Date(),
          }).catch((err) => { logger.warn({ err, jobId: job.id, clinicId }, 'Non-blocking: AI provenance write failed'); });
        } catch (provenanceErr) { logger.warn({ err: provenanceErr, jobId: job.id, clinicId }, 'Non-blocking: AI provenance try/catch failed'); }

        // Publish completion event
        await connection.publish(`ai-events:${clinicId}`, JSON.stringify({
          type: 'ai-job-complete',
          ...jobResult,
          staffId,
          durationMs,
        }));

        return jobResult;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.error({ jobId, action, err }, `AI job failed: ${action}`);

        // Publish failure event
        await connection.publish(`ai-events:${clinicId}`, JSON.stringify({
          type: 'ai-job-failed',
          jobId,
          action,
          error: errMsg,
          staffId,
        }));

        throw err;
      }
    },
    {
      connection,
      concurrency: 2, // Process max 2 AI jobs simultaneously
      limiter: { max: 10, duration: 60_000 }, // Max 10 jobs per minute
    }
  );

  worker.on('error', (err) => {
    logger.error({ err }, 'AI worker error');
  });

  worker.on('failed', (job, err) => {
    logger.error(
      { jobId: job?.id, err, queue: AI_QUEUE_NAME, data: job?.data },
      'AI worker job failed',
    );
  });

  // BUG-042 — drain in-flight AI jobs before DB close. LLM generation
  // can take 30-180s; 20s is a cap within the 25s overall budget. A
  // job still running at the 20s mark is abandoned (re-queued for the
  // next pod). This is the least-bad option; extending budget past
  // 25s risks k8s SIGKILL before shutdown completes.
  registerShutdownHook({
    name: `bullmq-worker:${AI_QUEUE_NAME}`,
    priority: 60,
    timeoutMs: 20_000,
    handler: async () => { await worker.close(); },
  });

  logger.info('AI job worker started (concurrency: 2)');
  return worker;
}

export { AI_QUEUE_NAME };
export type { AiJobData, AiJobResult };
