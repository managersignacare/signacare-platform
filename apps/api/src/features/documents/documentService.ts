// apps/api/src/features/documents/documentService.ts
import { db } from '../../db/db';
import { randomUUID } from 'crypto';
import type { AuthContext, RoutedModelExecution } from '@signacare/shared';
import { AppError } from '../../shared/errors';
import { logger } from '../../utils/logger';
import { DOCUMENT_TEMPLATES, type DocumentType } from './documentTemplates';
import { PIPELINE_STAGES, type PipelineStage } from '../../shared/pipelineTracker';
import { appendClinicalContextToPrompt, buildClinicalContext } from '../llm/context/buildClinicalContext';
import { recordClinicalContextLlmInteraction } from '../llm/context/contextAuditWriter';
import {
  resolveLockedRuntimeSelection,
  routeTextGeneration,
  type LockedAiRuntimeSelection,
} from '../llm/modelRouter/modelRouter';

export interface GenerateDocumentDTO {
  patientId: string;
  documentType: DocumentType;
  /** Optional free-text context the clinician wants to include (e.g. hearing date, clinician names) */
  additionalContext?: string;
}

export interface GeneratedDocument {
  documentType: DocumentType;
  patientId: string;
  content: string;
  generatedAt: string;
}

// ── Patient data assembly ─────────────────────────────────────────────────────

async function buildPatientContext(clinicId: string, patientId: string): Promise<string> {
  const patient = await db('patients')
    .where({ id: patientId, clinic_id: clinicId })
    .whereNull('deleted_at')
    .first() as Record<string, unknown> | undefined;

  if (!patient) throw new AppError('Patient not found', 404, 'PATIENT_NOT_FOUND');

  const lines: string[] = [
    '=== PATIENT DEMOGRAPHICS ===',
    `Full name: ${patient['given_name'] ?? ''} ${patient['family_name'] ?? ''}`.trim(),
    patient['preferred_name'] ? `Preferred name: ${patient['preferred_name']}` : '',
    `Date of birth: ${patient['date_of_birth'] ?? '[unknown]'}`,
    `Gender: ${patient['gender'] ?? '[not recorded]'}`,
    `Pronouns: ${patient['pronouns'] ?? '[not recorded]'}`,
    `MRN / UR number: ${patient['emr_number'] ?? '[not assigned]'}`,
    '',
    '=== CONTACT & ADDRESS ===',
    `Mobile: ${patient['phone_mobile'] ?? '[not recorded]'}`,
    `Address: ${[patient['address_line1'], patient['suburb'], patient['state'], patient['postcode']].filter(Boolean).join(', ') || '[not recorded]'}`,
    `Email: ${patient['email_primary'] ?? '[not recorded]'}`,
    '',
    '=== CULTURAL & BACKGROUND ===',
    `ATSI status: ${patient['atsi_status'] ?? '[not recorded]'}`,
    `Interpreter required: ${patient['interpreter_required'] ? `Yes — ${patient['interpreter_language'] ?? 'language not specified'}` : 'No'}`,
    '',
    '=== NEXT OF KIN ===',
    `Name: ${patient['nok_name'] ?? '[not recorded]'}`,
    `Relationship: ${patient['nok_relationship'] ?? '[not recorded]'}`,
    `Phone: ${patient['nok_phone'] ?? '[not recorded]'}`,
    '',
    '=== GP / REFERRING PROVIDER ===',
    `GP name: ${patient['gp_name'] ?? '[not recorded]'}`,
    `Practice: ${patient['gp_practice'] ?? '[not recorded]'}`,
    `GP phone: ${patient['gp_phone'] ?? '[not recorded]'}`,
    `GP email: ${patient['gp_email'] ?? '[not recorded]'}`,
    `Provider number: ${patient['gp_provider_number'] ?? '[not recorded]'}`,
  ].filter(line => line !== null && line !== undefined);

  // Current medications
  const meds = await db('patient_medications')
    .where({ patient_id: patientId, clinic_id: clinicId })
    .whereNull('end_date')
    .whereNull('deleted_at')
    .orderBy('drug_label') as Record<string, unknown>[];

  lines.push('', '=== CURRENT MEDICATIONS ===');
  if (meds.length === 0) {
    lines.push('[No current medications recorded]');
  } else {
    meds.forEach(m => {
      lines.push(`- ${m['drug_label']} ${m['dose'] ?? ''} ${m['route'] ?? ''} ${m['frequency'] ?? ''}`.trim());
      if (m['indication']) lines.push(`  Indication: ${m['indication']}`);
    });
  }

  // Support persons / contacts
  const contacts = await db('patient_contacts')
    .where({ patient_id: patientId, clinic_id: clinicId })
    .whereNull('deleted_at') as Record<string, unknown>[];

  lines.push('', '=== SUPPORT PERSONS / CONTACTS ===');
  if (contacts.length === 0) {
    lines.push('[No support persons recorded]');
  } else {
    contacts.forEach(c => {
      const name = [c['given_name'], c['family_name']].filter(Boolean).join(' ') || '[name not recorded]';
      const roles = [
        c['is_emergency_contact'] ? 'Emergency Contact' : '',
        c['is_carer'] ? 'Carer' : '',
        c['has_consent'] ? 'Consent to Share' : '',
      ].filter(Boolean).join(', ');
      lines.push(`- ${name} (${c['relationship'] ?? 'relationship not recorded'})${roles ? ` — ${roles}` : ''}`);
      if (c['phone_mobile']) lines.push(`  Phone: ${c['phone_mobile']}`);
    });
  }

  // Most recent clinical notes (up to 3)
  const notes = await db('clinical_notes')
    .where({ patient_id: patientId, clinic_id: clinicId })
    .whereNull('deleted_at')
    .orderBy('created_at', 'desc')
    .limit(3) as Record<string, unknown>[];

  lines.push('', '=== RECENT CLINICAL NOTES (most recent 3) ===');
  if (notes.length === 0) {
    lines.push('[No clinical notes recorded]');
  } else {
    notes.forEach((n, i) => {
      const date = String(n['created_at'] ?? '').slice(0, 10);
      lines.push(`\n--- Note ${i + 1} (${date}) ---`);
      if (n['assessment_html']) {
        lines.push('Assessment:');
        lines.push(stripHtml(n['assessment_html'] as string));
      }
      if (n['plan_html']) {
        lines.push('Plan:');
        lines.push(stripHtml(n['plan_html'] as string));
      }
    });
  }

  // MHA orders (relevant for tribunal reports)
  const mhaOrders = await db('legal_orders')
    .where({ patient_id: patientId, clinic_id: clinicId })
    .orderBy('start_date', 'desc')
    .limit(5)
    .catch(err => { logger.warn({ err }, 'MHA orders query failed'); return []; }) as Record<string, unknown>[];

  if (mhaOrders.length > 0) {
    lines.push('', '=== MENTAL HEALTH ACT HISTORY ===');
    mhaOrders.forEach(o => {
      const start = String(o['commenced_at'] ?? '').slice(0, 10);
      const end = o['expired_at'] ? String(o['expired_at']).slice(0, 10) : 'current';
      lines.push(`- ${o['order_type'] ?? 'Order'}: ${start} to ${end} (${o['setting'] ?? 'setting unknown'})`);
    });
  }

  return lines.join('\n');
}

function buildFailedExecution(
  alias: (typeof DOCUMENT_TEMPLATES)[DocumentType]['alias'],
  runtimeSelection: LockedAiRuntimeSelection,
): RoutedModelExecution {
  return {
    alias,
    backend: runtimeSelection.backend,
    modelName: 'unknown',
    modelVersion: 'unknown',
    deployment: null,
    localStyleAdapterModelName: runtimeSelection.localStyleAdapterModelName,
  };
}

// ── Main service ──────────────────────────────────────────────────────────────

export async function generateDocument(
  auth: AuthContext,
  dto: GenerateDocumentDTO,
): Promise<GeneratedDocument> {
  const template = DOCUMENT_TEMPLATES[dto.documentType];
  if (!template) {
    throw new AppError(`Unknown document type: ${dto.documentType}`, 400, 'VALIDATION_ERROR');
  }

  const runtimeSelection = await resolveLockedRuntimeSelection(auth.clinicId);
  const legacyPatientContext = await buildPatientContext(auth.clinicId, dto.patientId);
  const clinicalContext = await buildClinicalContext({
    auth,
    documentType: template.contextDocumentType,
    patientId: dto.patientId,
  });

  const baseUserMessage = [
    'Please generate the document using the patient data below.',
    '',
    '=== PATIENT DOCUMENT DATA ===',
    legacyPatientContext,
    dto.additionalContext ? `\n=== ADDITIONAL CONTEXT FROM CLINICIAN ===\n${dto.additionalContext}` : '',
  ].filter(Boolean).join('\n');
  const prompt = appendClinicalContextToPrompt(baseUserMessage, clinicalContext.renderedPrompt);

  const documentTemperature = 0.2;
  const startMs = Date.now();

  logger.info({
    action: 'document_generate_start',
    documentType: dto.documentType,
    patientId: dto.patientId,
    clinicId: auth.clinicId,
    routedAlias: template.alias,
    runtimeBackend: runtimeSelection.backend,
  });

  let routed;
  try {
    routed = await routeTextGeneration({
      clinicId: auth.clinicId,
      runtimeSelection,
      alias: template.alias,
      prompt,
      system: template.systemPrompt,
      temperature: documentTemperature,
      maxTokens: template.maxTokens,
      action: 'letter',
    });
  } catch (err) {
    const latencyMs = Date.now() - startMs;
    const failedPipeline: PipelineStage[] = [{
      stage: PIPELINE_STAGES.DOCUMENT_GENERATE,
      startedAt: new Date(startMs).toISOString(),
      durationMs: latencyMs,
      success: false,
      meta: { documentType: dto.documentType, routedAlias: template.alias },
    }];
    await recordClinicalContextLlmInteraction({
      clinicId: auth.clinicId,
      userId: auth.staffId,
      patientId: dto.patientId,
      feature: `document_${dto.documentType}`,
      execution: buildFailedExecution(template.alias, runtimeSelection),
      promptText: `${template.systemPrompt}\n\n${prompt}`,
      outputText: '',
      pipeline: failedPipeline,
      temperature: documentTemperature,
      latencyMs,
      success: false,
      errorCode: 'AI_SERVICE_UNAVAILABLE',
      consentId: null,
      contextEnvelope: clinicalContext.envelope,
      cachedPromptTokens: null,
      promptPrefixHash: null,
      metadata: {
        versionSource: runtimeSelection.backend === 'azure_openai' ? 'provider' : 'tag',
        documentType: dto.documentType,
        legacyDocumentContextIncluded: true,
        legacyDocumentContextLength: legacyPatientContext.length,
      },
    });
    logger.error({
      err,
      action: 'document_generate_error',
      documentType: dto.documentType,
      clinicId: auth.clinicId,
      routedAlias: template.alias,
      runtimeBackend: runtimeSelection.backend,
    });
    throw new AppError(
      'AI document generation failed. Please check that the configured clinical AI backend is available.',
      503,
      'AI_SERVICE_UNAVAILABLE',
    );
  }

  const content = routed.text;
  const promptTokens = routed.promptTokens ?? 0;
  const completionTokens = routed.completionTokens ?? 0;
  const latencyMs = Date.now() - startMs;
  logger.info({
    action: 'document_generate_complete',
    documentType: dto.documentType,
    latencyMs,
    promptTokens,
    completionTokens,
    routedAlias: routed.execution.alias,
    routedBackend: routed.execution.backend,
    modelName: routed.execution.modelName,
  });

  const pipeline: PipelineStage[] = [{
    stage: PIPELINE_STAGES.DOCUMENT_GENERATE,
    startedAt: new Date(startMs).toISOString(),
    durationMs: latencyMs,
    success: true,
    meta: {
      documentType: dto.documentType,
      routedAlias: routed.execution.alias,
      routedBackend: routed.execution.backend,
    },
  }];
  await recordClinicalContextLlmInteraction({
    clinicId: auth.clinicId,
    userId: auth.staffId,
    patientId: dto.patientId,
    feature: `document_${dto.documentType}`,
    execution: routed.execution,
    temperature: documentTemperature,
    pipeline,
    promptTokens,
    completionTokens,
    cachedPromptTokens: routed.cachedPromptTokens,
    promptPrefixHash: routed.promptPrefixHash,
    latencyMs,
    success: true,
    promptText: `${template.systemPrompt}\n\n${prompt}`,
    outputText: content,
    consentId: null,
    contextEnvelope: clinicalContext.envelope,
    metadata: {
      versionSource: routed.execution.backend === 'azure_openai' ? 'provider' : 'tag',
      documentType: dto.documentType,
      legacyDocumentContextIncluded: true,
      legacyDocumentContextLength: legacyPatientContext.length,
    },
  });

  // Auto-create ABF contact record for document generation (awaited so the
  // contact record is visible by the time the client refreshes; failures are
  // logged inside createAutoContactRecord and do not fail the parent request).
  try {
    const { createAutoContactRecord } = await import('../contacts/autoContactRecord');
    await createAutoContactRecord({
      clinicId: auth.clinicId,
      patientId: dto.patientId,
      staffId: auth.staffId,
      sourceType: 'correspondence',
      sourceId: randomUUID(),
      contactType: 'Non-face-to-face — Clinical documentation',
      briefSummary: `AI-generated ${dto.documentType.replace(/_/g, ' ')}`,
    });
  } catch { /* already logged internally */ }

  return {
    documentType: dto.documentType,
    patientId: dto.patientId,
    content,
    generatedAt: new Date().toISOString(),
  };
}

export function listDocumentTypes() {
  return Object.values(DOCUMENT_TEMPLATES).map(t => ({
    type: t.type,
    name: t.name,
    description: t.description,
  }));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}
