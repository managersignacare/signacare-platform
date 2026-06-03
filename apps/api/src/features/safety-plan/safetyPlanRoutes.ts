/**
 * Safety Plan Routes (Stanley-Brown template)
 */
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/authMiddleware';
import { requireModuleRead } from '../../middleware/moduleAccessMiddleware';
import { MODULE_KEYS } from '../../shared/moduleKeys';
import { requireRoles } from '../../middleware/rbacMiddleware';
import { db } from '../../db/db';
import { AppError } from '../../shared/errors';
import { writeAuditLog } from '../../utils/audit';

const router = Router();
router.use(authMiddleware);
router.use(requireModuleRead(MODULE_KEYS.SAFETY_PLANS));
const ROLES = ['clinician', 'admin', 'superadmin'];

// Explicit column list for .returning() (Phase R3 / CLAUDE.md §1.7).
// Verified: safety_plans has only 7 columns. NO deleted_at (status
// transitions handle supersedure). The pre-R2 .whereNull('deleted_at')
// in the GET handler was a ghost-column query.
const SAFETY_PLAN_COLUMNS = [
  'id', 'patient_id', 'clinic_id', 'content', 'status',
  'created_at', 'updated_at',
] as const;

type JsonMap = Record<string, unknown>;

const PatientIdParamSchema = z.object({
  patientId: z.string().uuid(),
});

const SafetyPlanIdParamSchema = z.object({
  id: z.string().uuid(),
});

const CollaborationAttestationSchema = z.object({
  patientCollaborated: z.literal(true),
  attestationNote: z.string().trim().min(10).max(5000),
});

const SafetyPlanContentSchema = z.object({
  warning_signs: z.string().max(5000).optional().nullable(),
  coping_strategies: z.string().max(5000).optional().nullable(),
  people_for_distraction: z.string().max(5000).optional().nullable(),
  people_to_contact: z.string().max(5000).optional().nullable(),
  professionals_to_contact: z.string().max(5000).optional().nullable(),
  emergency_services: z.string().max(5000).optional().nullable(),
  making_environment_safe: z.string().max(5000).optional().nullable(),
  reasons_for_living: z.string().max(5000).optional().nullable(),
  plan_date: z.string().max(30).optional().nullable(),
  review_date: z.string().max(30).optional().nullable(),
}).strict();

const SAFETY_PLAN_FIELD_MAP = [
  { camel: 'warningSign', snake: 'warning_signs' },
  { camel: 'copingStrategies', snake: 'coping_strategies' },
  { camel: 'peopleForDistraction', snake: 'people_for_distraction' },
  { camel: 'peopleToContact', snake: 'people_to_contact' },
  { camel: 'professionalsToContact', snake: 'professionals_to_contact' },
  { camel: 'emergencyServices', snake: 'emergency_services' },
  { camel: 'makingEnvironmentSafe', snake: 'making_environment_safe' },
  { camel: 'reasonsForLiving', snake: 'reasons_for_living' },
  { camel: 'planDate', snake: 'plan_date' },
  { camel: 'reviewDate', snake: 'review_date' },
] as const;

const CreateSafetyPlanSchema = z.object({
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().optional().nullable(),
  warningSign: z.string().max(5000).optional().nullable(),
  copingStrategies: z.string().max(5000).optional().nullable(),
  peopleForDistraction: z.string().max(5000).optional().nullable(),
  peopleToContact: z.string().max(5000).optional().nullable(),
  professionalsToContact: z.string().max(5000).optional().nullable(),
  emergencyServices: z.string().max(5000).optional().nullable(),
  makingEnvironmentSafe: z.string().max(5000).optional().nullable(),
  reasonsForLiving: z.string().max(5000).optional().nullable(),
  planDate: z.string().max(30).optional().nullable(),
  reviewDate: z.string().max(30).optional().nullable(),
  content: SafetyPlanContentSchema.optional(),
  status: z.string().max(30).optional(),
  collaborationAttestation: CollaborationAttestationSchema.optional(),
});

const UpdateSafetyPlanSchema = z.object({
  warningSign: z.string().max(5000).optional().nullable(),
  copingStrategies: z.string().max(5000).optional().nullable(),
  peopleForDistraction: z.string().max(5000).optional().nullable(),
  peopleToContact: z.string().max(5000).optional().nullable(),
  professionalsToContact: z.string().max(5000).optional().nullable(),
  emergencyServices: z.string().max(5000).optional().nullable(),
  makingEnvironmentSafe: z.string().max(5000).optional().nullable(),
  reasonsForLiving: z.string().max(5000).optional().nullable(),
  reviewDate: z.string().max(30).optional().nullable(),
  content: SafetyPlanContentSchema.optional(),
  collaborationAttestation: CollaborationAttestationSchema.optional(),
  status: z.string().max(30).optional(),
});

interface SafetyPlanRow {
  content?: unknown;
  created_at?: string | Date | null;
  status?: string;
  [key: string]: unknown;
}

function toJsonMap(value: unknown): JsonMap {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return typeof parsed === 'object' && parsed !== null ? parsed as JsonMap : {};
    } catch {
      return {};
    }
  }
  return typeof value === 'object' ? (value as JsonMap) : {};
}

function getMappedContentValue(
  dto: Record<string, unknown>,
  content: JsonMap,
  camel: string,
  snake: string,
): string | null | undefined {
  const direct = dto[camel];
  if (direct !== undefined) return (typeof direct === 'string' || direct === null) ? direct : undefined;
  const nested = content[snake];
  return (typeof nested === 'string' || nested === null) ? nested : undefined;
}

function buildSafetyPlanContent(
  existing: JsonMap,
  dto: Record<string, unknown>,
): JsonMap {
  const content = toJsonMap(dto.content);
  const next: JsonMap = { ...existing };
  for (const { camel, snake } of SAFETY_PLAN_FIELD_MAP) {
    const value = getMappedContentValue(dto, content, camel, snake);
    if (value !== undefined) next[snake] = value;
  }
  return next;
}

function upsertCollaborationAttestation(
  content: JsonMap,
  attestation: z.infer<typeof CollaborationAttestationSchema> | undefined,
  staffId: string,
): JsonMap {
  if (!attestation) return content;
  return {
    ...content,
    collaboration_attestation: {
      patient_collaborated: true,
      attestation_note: attestation.attestationNote,
      attested_by_staff_id: staffId,
      attested_at: new Date().toISOString(),
    },
  };
}

function hasValidCollaborationAttestation(content: JsonMap): boolean {
  const attestation = toJsonMap(content.collaboration_attestation);
  return (
    attestation.patient_collaborated === true
    && typeof attestation.attestation_note === 'string'
    && attestation.attestation_note.trim().length >= 10
    && typeof attestation.attested_by_staff_id === 'string'
    && attestation.attested_by_staff_id.trim().length > 0
    && typeof attestation.attested_at === 'string'
    && attestation.attested_at.trim().length > 0
  );
}

function assertCollaborationAttestationForStatus(status: string, content: JsonMap): void {
  if ((status === 'active' || status === 'signed') && !hasValidCollaborationAttestation(content)) {
    throw new AppError(
      'Safety plan activation/sign-off requires explicit patient-collaboration attestation',
      422,
      'SAFETY_PLAN_COLLAB_ATTESTATION_REQUIRED',
    );
  }
}

// GET /patient/:patientId
router.get('/patient/:patientId', requireRoles(ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { patientId } = PatientIdParamSchema.parse(req.params ?? {});
    // safety_plans has NO deleted_at (status enum handles supersedure).
    const rows = await db('safety_plans')
      .where({ patient_id: patientId, clinic_id: req.clinicId })
      .orderBy('created_at', 'desc');
    // Flatten JSONB content to top level for frontend
    const flattened = (rows as SafetyPlanRow[]).map((r) => {
      const c = toJsonMap(r.content);
      return {
        ...r,
        warning_signs: c.warning_signs ?? c.warningSign ?? null,
        coping_strategies: c.coping_strategies ?? c.copingStrategies ?? null,
        people_for_distraction: c.people_for_distraction ?? c.peopleForDistraction ?? null,
        people_to_contact: c.people_to_contact ?? c.peopleToContact ?? null,
        professionals_to_contact: c.professionals_to_contact ?? c.professionalsToContact ?? null,
        emergency_services: c.emergency_services ?? c.emergencyServices ?? 'Emergency: 000 | Lifeline: 13 11 14',
        making_environment_safe: c.making_environment_safe ?? c.makingEnvironmentSafe ?? null,
        reasons_for_living: c.reasons_for_living ?? c.reasonsForLiving ?? null,
        plan_date: c.plan_date ?? c.planDate ?? r.created_at,
        review_date: c.review_date ?? c.reviewDate ?? null,
        is_signed: r.status === 'signed',
      };
    });
    res.json(flattened);
  } catch (err) { next(err); }
});

// POST /
router.post('/', requireRoles(ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dto = CreateSafetyPlanSchema.parse(req.body ?? {});
    const status = dto.status ?? 'active';
    let content = buildSafetyPlanContent({}, dto as unknown as Record<string, unknown>);
    content = {
      ...content,
      episode_id: dto.episodeId ?? null,
      author_id: req.user!.id,
      emergency_services: (content.emergency_services as string | null | undefined)
        ?? 'Emergency: 000 | Lifeline: 13 11 14 | Crisis Assessment Team',
      plan_date: (content.plan_date as string | null | undefined)
        ?? new Date().toISOString().slice(0, 10),
      review_date: (content.review_date as string | null | undefined) ?? null,
    };
    content = upsertCollaborationAttestation(content, dto.collaborationAttestation, req.user!.id);
    assertCollaborationAttestationForStatus(status, content);

    const [row] = await db('safety_plans').insert({
      clinic_id: req.clinicId,
      patient_id: dto.patientId,
      status,
      content,
    }).returning(SAFETY_PLAN_COLUMNS);
    await writeAuditLog({
      actorId: req.user!.id,
      clinicId: req.clinicId,
      action: 'CREATE',
      tableName: 'safety_plans',
      recordId: String(row.id),
      newData: {
        status,
        hasCollaborationAttestation: hasValidCollaborationAttestation(content),
      },
    });
    res.status(201).json(row);
  } catch (err) { next(err); }
});

// PATCH /:id
router.patch('/:id', requireRoles(ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = SafetyPlanIdParamSchema.parse(req.params ?? {});
    const dto = UpdateSafetyPlanSchema.parse(req.body ?? {});

    // Fetch existing row so we can merge content
    const existing = await db('safety_plans')
      .where({ id, clinic_id: req.clinicId })
      .first();
    if (!existing) { res.status(404).json({ error: 'Safety plan not found' }); return; }

    const updates: Record<string, unknown> = { updated_at: new Date() };
    const existingContent = toJsonMap(existing.content);
    let nextContent = buildSafetyPlanContent(existingContent, dto as unknown as Record<string, unknown>);
    nextContent = upsertCollaborationAttestation(nextContent, dto.collaborationAttestation, req.user!.id);

    const nextStatus = dto.status ?? (existing.status as string | undefined) ?? 'active';
    assertCollaborationAttestationForStatus(nextStatus, nextContent);

    if (JSON.stringify(nextContent) !== JSON.stringify(existingContent)) {
      updates.content = nextContent;
    }
    if (dto.status !== undefined) updates.status = dto.status;

    const [row] = await db('safety_plans').where({ id, clinic_id: req.clinicId }).update(updates).returning(SAFETY_PLAN_COLUMNS);
    await writeAuditLog({
      actorId: req.user!.id,
      clinicId: req.clinicId,
      action: 'UPDATE',
      tableName: 'safety_plans',
      recordId: id,
      newData: {
        status: row.status,
        hasCollaborationAttestation: hasValidCollaborationAttestation(nextContent),
      },
    });
    res.json(row);
  } catch (err) { next(err); }
});

// POST /:id/sign
router.post('/:id/sign', requireRoles(ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = SafetyPlanIdParamSchema.parse(req.params ?? {});
    const existing = await db('safety_plans')
      .where({ id, clinic_id: req.clinicId })
      .first();
    if (!existing) { res.status(404).json({ error: 'Safety plan not found' }); return; }

    const baseContent = toJsonMap(existing.content);
    assertCollaborationAttestationForStatus('signed', baseContent);
    const content = {
      ...baseContent,
      is_signed: true,
      signed_by_id: req.user!.id,
      signed_at: new Date(),
    };
    const [row] = await db('safety_plans')
      .where({ id, clinic_id: req.clinicId })
      .update({ content, status: 'signed', updated_at: new Date() })
      .returning(SAFETY_PLAN_COLUMNS);
    await writeAuditLog({
      actorId: req.user!.id,
      clinicId: req.clinicId,
      action: 'UPDATE',
      tableName: 'safety_plans',
      recordId: id,
      newData: {
        status: 'signed',
        signedBy: req.user!.id,
      },
    });
    res.json(row);
  } catch (err) { next(err); }
});

export default router;
