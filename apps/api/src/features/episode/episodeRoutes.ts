import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { episodeController } from './episodeController';
import { authMiddleware } from '../../middleware/authMiddleware';
import { requireModuleRead } from '../../middleware/moduleAccessMiddleware';
import { MODULE_KEYS } from '../../shared/moduleKeys';
import { tenantMiddleware } from '../../middleware/tenantMiddleware';
import { db } from '../../db/db';
import { resolveTeamNames, resolveStaffNames } from '../../utils/nameResolver';
import logger from '../../utils/logger';
import { workflowEvents } from '../workflows/workflowEvents';
import { enqueueWorkflowOutbox } from '../workflows/workflowOutbox';
import { AppError } from '../../shared/errors';
import { createTaskInternal } from '../tasks/taskService';

const router = Router();

router.use(authMiddleware, tenantMiddleware);
router.use(requireModuleRead(MODULE_KEYS.EPISODES));

router.get('/patient/:patientId', episodeController.listForPatient);

// Bulk reassignment helpers — must be before /:id catch-all
//
// Audit Tier 3.6 (HIGH-D6) — these two cross-team roster endpoints
// previously let any clinician in the clinic read the patient roster
// of a different team or clinician. Now gated: admin / superadmin / a
// clinician reading their own schedule may call /patients-by-clinician;
// /patients-by-team requires admin or membership in the requested team
// via staff_team_assignments. Everything else → 403 NOT_TEAM_MEMBER.
const BYPASS_ROLES_FOR_ROSTER = new Set(['admin', 'superadmin']);

interface ClinicalRoleRow {
  id: string;
  clinic_id: string;
  name: string | null;
  is_active?: boolean;
  sort_order?: number | null;
  created_at?: string | Date;
  updated_at?: string | Date;
}

interface StaffRoleAssignmentLookupRow {
  id: string;
  staff_id: string;
  clinical_role_id: string;
}

interface EpisodeAllocationMdtRoleRow {
  staff_id: string;
  role_name: string | null;
  staff_name: string | null;
  start_date: string | null;
  updated_at: string | Date | null;
}

interface MedicationSummaryRow {
  drug_label: string | null;
  dose: string | null;
  taper_schedule: unknown | null;
}

interface ClinicalNoteSummaryRow {
  note_type: string | null;
  title: string | null;
  content: string | null;
  structured_fields: unknown | null;
  contact_meta: unknown | null;
}

const IsoDateTimeLikeSchema = z.union([z.string(), z.date()]).transform((value) => (
  value instanceof Date ? value.toISOString() : value
));

const EpisodeRosterItemResponseSchema = z.object({
  patientId: z.string().uuid(),
  givenName: z.string().nullable(),
  familyName: z.string().nullable(),
  emrNumber: z.string().nullable(),
  episodeId: z.string().uuid(),
  team: z.string().nullable().optional(),
  primaryClinicianId: z.string().nullable().optional(),
});

const EpisodeRosterResponseSchema = z.array(EpisodeRosterItemResponseSchema);

const EpisodeAllocateAckResponseSchema = z.object({
  ok: z.literal(true),
  episodeId: z.string().uuid(),
});

const EpisodeAllocationResponseSchema = z.object({
  episodeId: z.string().uuid(),
  orgUnitId: z.string().uuid().nullable(),
  teamName: z.string().nullable(),
  primaryClinicianId: z.string().nullable(),
  mdt: z.array(z.object({
    staff_id: z.string().uuid(),
    role_name: z.string().nullable(),
    staff_name: z.string().nullable(),
  })),
});

const EpisodeDischargeSummaryResponseSchema = z.object({
  content: z.string(),
});

const EpisodeOkResponseSchema = z.object({
  ok: z.literal(true),
});

const EpisodeDischargeSummaryReadResponseSchema = z.union([
  z.object({
    discharge_summary_content: z.string().nullable(),
    discharge_vetting_status: z.string().nullable(),
    discharge_vetted_by_id: z.string().uuid().nullable(),
    discharge_vetted_at: IsoDateTimeLikeSchema.nullable(),
    discharge_signature: z.string().nullable(),
  }),
  z.object({}),
]);

function parseJsonbRecord(value: unknown): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function mapDischargeSummaryNoteToResponse(row: ClinicalNoteSummaryRow) {
  return {
    noteType: row.note_type,
    title: row.title,
    content: row.content,
    structuredFields: parseJsonbRecord(row.structured_fields),
    contactMeta: parseJsonbRecord(row.contact_meta),
  };
}

function mapDischargeSummaryMedicationToResponse(row: MedicationSummaryRow) {
  return {
    medicationName: row.drug_label,
    dose: row.dose,
    taperSchedule: parseJsonbRecord(row.taper_schedule),
  };
}

router.get('/patients-by-clinician/:clinicianId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user;
    const role = user?.role ?? '';
    if (!BYPASS_ROLES_FOR_ROSTER.has(role) && user?.id !== req.params.clinicianId) {
      throw new AppError(
        'Only admins may read another clinician\'s roster',
        403,
        'NOT_OWN_ROSTER',
      );
    }
    const rows = await db('episodes')
      .join('patients', 'patients.id', 'episodes.patient_id')
      .where({
        'episodes.primary_clinician_id': req.params.clinicianId,
        'episodes.status': 'open',
        'episodes.clinic_id': req.clinicId,
      })
      .whereNull('episodes.deleted_at')
      .where('patients.clinic_id', req.clinicId)
      .whereNull('patients.deleted_at')
      .distinctOn('patients.id')
      .select(
        'patients.id as patientId',
        'patients.given_name as givenName',
        'patients.family_name as familyName',
        'patients.emr_number as emrNumber',
        'episodes.id as episodeId',
        'episodes.team_id as team',
      )
      .orderBy([{ column: 'patients.id' }, { column: 'patients.family_name', order: 'asc' }]);
    await resolveTeamNames(rows, 'team');
    res.json(EpisodeRosterResponseSchema.parse(rows));
  } catch (err) { next(err); }
});

router.get('/patients-by-team/:team', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user;
    const role = user?.role ?? '';
    if (!BYPASS_ROLES_FOR_ROSTER.has(role)) {
      if (!user?.id) {
        throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');
      }
      const membership = await db('staff_team_assignments')
        .where({ clinic_id: req.clinicId, staff_id: user.id, org_unit_id: req.params.team, is_active: true })
        .first();
      if (!membership) {
        throw new AppError(
          'Only team members or admins may read this team\'s roster',
          403,
          'NOT_TEAM_MEMBER',
        );
      }
    }
    const rows = await db('episodes')
      .join('patients', 'patients.id', 'episodes.patient_id')
      .where({
        'episodes.team_id': req.params.team,
        'episodes.status': 'open',
        'episodes.clinic_id': req.clinicId,
      })
      .whereNull('episodes.deleted_at')
      .where('patients.clinic_id', req.clinicId)
      .whereNull('patients.deleted_at')
      .distinctOn('patients.id')
      .select(
        'patients.id as patientId',
        'patients.given_name as givenName',
        'patients.family_name as familyName',
        'patients.emr_number as emrNumber',
        'episodes.id as episodeId',
        'episodes.team_id as team',
        'episodes.primary_clinician_id as primaryClinicianId',
      )
      .orderBy([{ column: 'patients.id' }, { column: 'patients.family_name', order: 'asc' }]);
    await resolveTeamNames(rows, 'team');
    await resolveStaffNames(rows, 'primaryClinicianId');
    res.json(EpisodeRosterResponseSchema.parse(rows));
  } catch (err) { next(err); }
});

router.get('/:id', episodeController.getById);
router.post('/', episodeController.create);
router.put('/:id', episodeController.update);
router.post('/:id/close', episodeController.close);

// Allocate team & MDT to an episode
const AllocateSchema = z.object({
  orgUnitId: z.string().uuid(),
  primaryClinicianId: z.string().uuid().optional(),
  consultantId: z.string().uuid().optional(),
  juniorMedicalId: z.string().uuid().optional(),
  clinicalSpecialistId: z.string().uuid().optional(),
  keyWorkerId: z.string().uuid().optional(),
  // Tolerate empty / partially-filled rows that the UI may have added
  // but the user never populated. We strip them server-side so a stray
  // blank row never blocks a valid allocation save.
  additionalMdt: z
    .array(
      z.object({
        role: z.string().optional().nullable(),
        staffId: z.string().optional().nullable(),
      }),
    )
    .optional()
    .transform((rows) =>
      (rows ?? [])
        .filter((r): r is { role: string; staffId: string } =>
          !!r.role && r.role.trim().length > 0 && !!r.staffId && r.staffId.trim().length > 0,
        )
        .map((r) => ({ role: r.role.trim(), staffId: r.staffId })),
    ),
});

router.post('/:id/allocate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const clinicId = req.clinicId;
    const episodeId = req.params.id;
    const parseResult = AllocateSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new AppError(
        'Validation failed',
        400,
        'VALIDATION_ERROR',
        parseResult.error.flatten(),
      );
    }
    const dto = parseResult.data;

    // BUG-EPISODE-MDT-SAVE-RACE (S2) 2026-05-06: wrap the deactivate-then-
    // insert MDT save sequence in a transaction + acquire an advisory lock
    // keyed by (clinic_id, org_unit_id). Without this, two simultaneous
    // POST /episodes/:id/allocate calls for the same team interleaved as
    // T1-deactivate → T2-deactivate → T1-INSERT → T2-INSERT, both
    // independently reading "no active assignments" after deactivation,
    // both inserting their own MDT rows — final state was the UNION of
    // both clinicians' submitted MDTs (duplicate active role rows). Now
    // serialized per (clinic_id, org_unit_id): cross-team saves don't
    // block each other; same-team concurrent saves serialize on the lock
    // and last-writer-wins cleanly.
    //
    // Lock key uses hashtext() to map the (clinic_id, org_unit_id) string
    // pair to a 32-bit int for pg_advisory_xact_lock. Hash collisions are
    // possible but harmless (false-sharing causes brief over-serialization,
    // not incorrect unlocking). Lock auto-releases on transaction
    // commit/rollback. CLAUDE.md §2.1 mandate honored: every query inside
    // the transaction uses trx, not db.
    //
    // Workflow event emission stays OUTSIDE the transaction (post-commit
    // side effect; failure should not roll back the MDT save).
    const episode = await db.transaction(async (trx) => {
      // Acquire advisory xact lock keyed by (clinic_id, org_unit_id).
      await trx.raw(
        "SELECT pg_advisory_xact_lock(hashtext(? || ':' || ?))",
        [clinicId, dto.orgUnitId],
      );

      // Update episode with team and clinician
      await trx('episodes')
        .where({ id: episodeId, clinic_id: clinicId })
        .whereNull('episodes.deleted_at')
        .update({
          team_id: dto.orgUnitId,
          primary_clinician_id: dto.primaryClinicianId ?? null,
          updated_at: new Date(),
        });

      // Assign patient to team — upsert to prevent race condition
      const ep = await trx('episodes').where({ id: episodeId, clinic_id: clinicId }).whereNull('episodes.deleted_at').first();
      if (ep?.patient_id) {
        // Tier 2.3 — patient_team_assignments has no clinic_id column.
        // Tenancy is scoped via the patient_id FK to patients (which is
        // clinic-scoped + RLS-enforced). Writing clinic_id here was a
        // pre-R2 ghost-column drift silently dropped by Postgres.
        await trx('patient_team_assignments')
          .insert({
            id: trx.raw('gen_random_uuid()'),
            patient_id: ep.patient_id,
            org_unit_id: dto.orgUnitId,
            primary_clinician_id: dto.primaryClinicianId ?? null,
            is_active: true,
            created_at: new Date(),
            updated_at: new Date(),
          })
          .onConflict(['patient_id', 'org_unit_id'])
          .merge({
            primary_clinician_id: dto.primaryClinicianId ?? trx.raw('patient_team_assignments.primary_clinician_id'),
            is_active: true,
            updated_at: new Date(),
          });
      }

      // Store MDT role assignments — clear old ones first, then insert new
      const today = new Date().toISOString().split('T')[0];

      // Deactivate all existing role assignments for this org unit (MDT reset).
      // BUG-STAFF-SETTINGS-CLINIC-ID-FILTER (S1) 2026-05-06: clinic_id filter
      // added per CLAUDE.md §1.3 (app-layer first-line-of-defence) +
      // migration 20260701000054 (clinic_id NOT NULL on staff_role_assignments).
      // BUG-EPISODE-MDT-SAVE-RACE (S2) 2026-05-06 absorb of L4 cycle-1: also
      // set end_date = today on the deactivate transition to preserve
      // effective-dating semantics (start_date + end_date are designed to
      // support point-in-time queries for AHPRA Standard 8 record-keeping
      // and coronial review). Setting is_active=false without end_date
      // would leave the row's effective range open-ended despite logical
      // termination — silent corruption of the temporal audit trail.
      await trx('staff_role_assignments')
        .where({ clinic_id: clinicId, org_unit_id: dto.orgUnitId, role_type: 'additional' })
        .update({ is_active: false, end_date: today, updated_at: new Date() });

      // Build full MDT list: fixed roles + additional
      const mdtRoles = [
        { staffId: dto.consultantId, roleName: 'Consultant Psychiatrist' },
        { staffId: dto.juniorMedicalId, roleName: 'Psychiatry Registrar' },
        { staffId: dto.clinicalSpecialistId, roleName: 'Senior Clinician' },
        { staffId: dto.keyWorkerId, roleName: 'Key Clinician' },
      ].filter(r => r.staffId);

      // Add the additionalMdt entries
      if (dto.additionalMdt?.length) {
        for (const a of dto.additionalMdt) {
          if (a.staffId && a.role) {
            mdtRoles.push({ staffId: a.staffId, roleName: a.role });
          }
        }
      }

      // Batch: preload all clinical roles for this clinic to avoid N+1.
      // Defensive: a clinical_roles row whose `name` column is NULL would
      // crash the .toLowerCase() loop with "Cannot read properties of
      // undefined (reading 'toLowerCase')" / 'trim'. We coerce to '' here
      // so a single bad seed row never blocks an MDT save.
      const allRoles = await trx<ClinicalRoleRow>('clinical_roles').where({ clinic_id: clinicId });
      const roleMap = new Map<string, ClinicalRoleRow>();
      for (const cr of allRoles) {
        const name = typeof cr.name === 'string' ? cr.name : '';
        roleMap.set(name.toLowerCase(), cr);
      }

      // Batch: preload existing assignments for this org unit
      const existingAssignments = await trx('staff_role_assignments')
        .where({ clinic_id: clinicId, org_unit_id: dto.orgUnitId })
        .select('staff_id', 'clinical_role_id', 'id') as StaffRoleAssignmentLookupRow[];
      const assignmentKey = (staffId: string, roleId: string) => `${staffId}:${roleId}`;
      const assignmentMap = new Map(existingAssignments.map((a) => [assignmentKey(a.staff_id, a.clinical_role_id), a]));

      for (const r of mdtRoles) {
        // Find role by ILIKE match on preloaded roles. Same defensive
        // coercion as above — a NULL `name` in the DB cannot be allowed
        // to crash the find().
        const wantedLower = (r.roleName ?? '').toLowerCase();
        let role = allRoles.find((cr) => {
          const haveLower = (typeof cr.name === 'string' ? cr.name : '').toLowerCase();
          if (haveLower.length === 0 || wantedLower.length === 0) return false;
          return haveLower.includes(wantedLower) || wantedLower.includes(haveLower);
        });
        if (!role) {
          // BUG-CLINICAL-ROLES-DUPLICATE-AUTOCREATE (S3): serialize
          // first-use role creation per (clinic_id, role_name) so two
          // concurrent org-unit saves cannot create duplicate roles.
          await trx.raw(
            "SELECT pg_advisory_xact_lock(hashtext(? || ':clinical_role:' || lower(?)))",
            [clinicId, r.roleName],
          );
          const lockedExisting = await trx<ClinicalRoleRow>('clinical_roles')
            .where({ clinic_id: clinicId, name: r.roleName })
            .first();
          const [newRole] = lockedExisting
            ? [lockedExisting]
            : await trx('clinical_roles')
              .insert({
                id: trx.raw('gen_random_uuid()'),
                clinic_id: clinicId,
                name: r.roleName,
                created_at: new Date(),
                updated_at: new Date(),
              })
              .returning(['id', 'clinic_id', 'name', 'is_active', 'sort_order', 'created_at', 'updated_at']);
          if (newRole) {
            role = newRole as ClinicalRoleRow;
            allRoles.push(role);
          }
        }
        if (role && r.staffId) {
          const existing = assignmentMap.get(assignmentKey(r.staffId, role.id));
          if (existing) {
            await trx('staff_role_assignments')
              .where({ id: existing.id, clinic_id: clinicId })
              .update({ is_active: true, updated_at: new Date() });
          } else {
            await trx('staff_role_assignments').insert({
              id: trx.raw('gen_random_uuid()'),
              clinic_id: clinicId,
              staff_id: r.staffId,
              org_unit_id: dto.orgUnitId,
              clinical_role_id: role.id,
              role_type: 'additional',
              start_date: today,
              is_active: true,
              created_at: new Date(),
              updated_at: new Date(),
            });
          }
        }
      }

      return ep;
    });

    // Emit workflow event post-commit. Emission failure must be observable
    // and recoverable; we enqueue to workflow outbox as a fallback.
    try {
      if (!workflowEvents.hasListenersFor('episode_opened')) {
        throw new Error('No workflow listener registered for episode_opened');
      }
      workflowEvents.emitWorkflow('episode_opened', { clinicId, patientId: episode?.patient_id, episodeId });
    } catch (err) {
      logger.error(
        { err, clinicId, episodeId, kind: 'episode_workflow_emit_failed' },
        'Failed to emit episode_opened workflow event; queued for retry',
      );
      await enqueueWorkflowOutbox({
        event: 'episode_opened',
        data: { clinicId, patientId: episode?.patient_id, episodeId },
        source: 'episodeRoutes.allocate',
        reason: 'emit_failed',
      });
    }

    res.json(EpisodeAllocateAckResponseSchema.parse({ ok: true, episodeId }));
  } catch (err) {
    // Log with full context so a future MDT-save crash can be diagnosed
    // from a single line in the API log instead of a screenshot from
    // the user. We still pass to the global error middleware.
    const e = err as Error;
    logger.error(
      { err: e, episodeId: req.params.id, clinicId: req.clinicId, kind: 'episode_allocate_crash' },
      'Episode allocation handler crashed',
    );
    next(err);
  }
});

// Get allocation details for an episode
router.get('/:id/allocation', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const clinicId = req.clinicId;
    const episodeId = req.params.id;

    const episode = await db('episodes').where({ id: episodeId, clinic_id: clinicId }).whereNull('episodes.deleted_at').first();
    if (!episode) throw new AppError('Not found', 404, 'NOT_FOUND');

    // team_id is a UUID reference to org_units
    const orgUnitId: string | null = episode.team_id ?? null;

    // Get MDT from staff role assignments for this team.
    // Deduplicate by (staff_id, role_name) so repeated allocation flows
    // cannot render the same clinician-role twice in the episode banner.
    const mdtRolesRaw = orgUnitId ? await db('staff_role_assignments')
      .join('clinical_roles', 'clinical_roles.id', 'staff_role_assignments.clinical_role_id')
      .join('staff', 'staff.id', 'staff_role_assignments.staff_id')
      .where('staff_role_assignments.org_unit_id', orgUnitId)
      .where('staff_role_assignments.clinic_id', clinicId)
      .where('staff_role_assignments.is_active', true)
      .where((qb) =>
        qb
          .whereNull('staff_role_assignments.end_date')
          .orWhere('staff_role_assignments.end_date', '>=', new Date().toISOString().slice(0, 10)),
      )
      .orderBy('staff_role_assignments.updated_at', 'desc')
      .orderBy('staff_role_assignments.start_date', 'desc')
      .select(
        'staff_role_assignments.staff_id',
        'clinical_roles.name as role_name',
        db.raw("staff.given_name || ' ' || staff.family_name as staff_name"),
        'staff_role_assignments.start_date',
        'staff_role_assignments.updated_at',
      ) as EpisodeAllocationMdtRoleRow[] : [];

    const seenMdtKeys = new Set<string>();
    const mdtRoles = mdtRolesRaw.filter((row) => {
      const key = `${row.staff_id}:${(row.role_name ?? '').trim().toLowerCase()}`;
      if (seenMdtKeys.has(key)) return false;
      seenMdtKeys.add(key);
      return true;
    });

    // Resolve team name from org_units
    let teamName: string | null = null;
    if (orgUnitId) {
      const unit = await db('org_units').where({ id: orgUnitId, clinic_id: clinicId }).first();
      teamName = unit?.name ?? null;
    }

    res.json(EpisodeAllocationResponseSchema.parse({
      episodeId,
      orgUnitId,
      teamName,
      primaryClinicianId: episode.primary_clinician_id ?? null,
      mdt: mdtRoles,
    }));
  } catch (err) { next(err); }
});

// ── Discharge Summary with Vetting (Feature 4) ──

// Generate discharge summary via AI
router.post('/:id/discharge-summary/generate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ep = await db('episodes')
      .where({ id: req.params.id, clinic_id: req.clinicId })
      .whereNull('deleted_at')
      .first();
    if (!ep) throw new AppError('Episode not found', 404, 'NOT_FOUND');

    // Gather context for AI
    // BUG-430: explicit clinic_id on every patient-scoped read (CLAUDE.md §1.3).
    const notes = await db('clinical_notes')
      .where({ patient_id: ep.patient_id, clinic_id: req.clinicId, episode_id: ep.id })
      .whereNull('deleted_at')
      .orderBy('created_at', 'desc')
      .limit(20)
      .select('note_type', 'title', 'content', 'structured_fields', 'contact_meta') as ClinicalNoteSummaryRow[];
    const patient = await db('patients')
      .where({ id: ep.patient_id, clinic_id: req.clinicId })
      .whereNull('deleted_at')
      .first();
    const meds = await db('patient_medications')
      .where({ patient_id: ep.patient_id, clinic_id: req.clinicId, status: 'active' })
      .whereNull('deleted_at')
      .select('drug_label', 'dose', 'taper_schedule') as MedicationSummaryRow[];

    const mappedNotes = notes.map(mapDischargeSummaryNoteToResponse);
    const mappedMeds = meds.map(mapDischargeSummaryMedicationToResponse);

    const context = `Patient: ${patient?.given_name} ${patient?.family_name}\nEpisode: ${ep.presenting_problem}\nDiagnosis: ${ep.primary_diagnosis ?? 'N/A'}\nMedications: ${mappedMeds.map((m) => `${m.medicationName ?? 'Unknown'} ${m.dose ?? ''}${Object.keys(m.taperSchedule).length > 0 ? ` (taper: ${JSON.stringify(m.taperSchedule)})` : ''}`).join(', ')}\nNotes: ${mappedNotes.map((n) => `[${n.noteType ?? 'note'}] ${n.title ?? 'Untitled'}: ${((n.content ?? JSON.stringify(n.structuredFields) ?? '').substring(0, 500))}`).join('\n')}`;

    // Try AI generation
    let content = '';
    try {
      const { clinicalAi } = await import('../../mcp/localLlmAgent');
      content = await clinicalAi.generateDischargeSummary(context);
    } catch (err) {
      logger.warn(
        { err, episodeId: req.params.id, clinicId: req.clinicId, kind: 'discharge_summary_ai_fallback' },
        'AI discharge summary generation failed; using deterministic fallback',
      );
      content = `[AI generation unavailable. Please write the discharge summary manually.]\n\nPatient: ${patient?.given_name} ${patient?.family_name}\nEpisode: ${ep.presenting_problem}\nDiagnosis: ${ep.primary_diagnosis ?? ''}\nMedications: ${mappedMeds.map((m) => m.medicationName).join(', ')}`;
    }

    await db('episodes')
      .where({ id: req.params.id, clinic_id: req.clinicId })
      .whereNull('deleted_at')
      .update({ discharge_summary_content: content, discharge_vetting_status: 'draft', updated_at: new Date() });
    res.json(EpisodeDischargeSummaryResponseSchema.parse({ content }));
  } catch (err) { next(err); }
});

// Submit discharge summary for consultant vetting
router.post('/:id/discharge-summary/submit', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { DischargeSummarySubmitSchema } = await import('@signacare/shared');
    const { content, consultantId } = DischargeSummarySubmitSchema.parse(req.body);
    await db('episodes').where({ id: req.params.id, clinic_id: req.clinicId }).whereNull('deleted_at').update({
      discharge_summary_content: content,
      discharge_vetting_status: 'pending_review',
      discharge_vetted_by_id: consultantId,
      updated_at: new Date(),
    });
    // Create a task for the consultant to review.
    // DB columns verified via psql \d tasks: assigned_by_id (not
    // created_by_id), task_type, status uses 'pending' (DB default), due_date.
    // Look up patient_id once so we can guard against an episode
    // that was deleted between submit and task creation.
    const submitEp = await db('episodes')
      .where({ id: req.params.id, clinic_id: req.clinicId })
      .whereNull('deleted_at')
      .first();
    if (!submitEp) throw new AppError('Episode not found', 404, 'NOT_FOUND');
    await createTaskInternal(req.clinicId, req.user!.id, {
      patientId: submitEp.patient_id,
      episodeId: req.params.id,
      assignedToId: consultantId,
      title: 'Review & Sign Discharge Summary',
      description: `Discharge summary for episode ${req.params.id} requires your signature.`,
      priority: 'high',
      taskType: 'discharge_review',
    })
    res.json(EpisodeOkResponseSchema.parse({ ok: true }));
  } catch (err) { next(err); }
});

// Consultant signs discharge summary
router.post('/:id/discharge-summary/sign', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { DischargeSummarySignSchema } = await import('@signacare/shared');
    const { signature } = DischargeSummarySignSchema.parse(req.body);
    const ep = await db('episodes')
      .where({ id: req.params.id, clinic_id: req.clinicId })
      .whereNull('deleted_at')
      .first();
    if (!ep) throw new AppError('Not found', 404, 'NOT_FOUND');
    if (ep.discharge_vetted_by_id !== req.user!.id) {
      throw new AppError('Only the assigned consultant can sign', 403, 'CONSULTANT_SIGN_REQUIRED');
    }
    await db('episodes').where({ id: req.params.id, clinic_id: req.clinicId }).whereNull('deleted_at').update({
      discharge_vetting_status: 'signed',
      discharge_vetted_at: new Date(),
      discharge_signature: signature ?? null,
      updated_at: new Date(),
    });
    res.json(EpisodeOkResponseSchema.parse({ ok: true }));
  } catch (err) { next(err); }
});

// Get discharge summary
router.get('/:id/discharge-summary', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ep = await db('episodes').where({ id: req.params.id, clinic_id: req.clinicId })
      .whereNull('deleted_at')
      .select('discharge_summary_content', 'discharge_vetting_status', 'discharge_vetted_by_id', 'discharge_vetted_at', 'discharge_signature')
      .first();
    res.json(EpisodeDischargeSummaryReadResponseSchema.parse(ep ?? {}));
  } catch (err) { next(err); }
});

// ── Close Episode with Vetting (Feature 6) ──

router.post('/:id/close-with-vetting', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { CloseWithVettingSchema } = await import('@signacare/shared');
    const { closureReason, consultantId } = CloseWithVettingSchema.parse(req.body);
    const ep = await db('episodes')
      .where({ id: req.params.id, clinic_id: req.clinicId })
      .whereNull('deleted_at')
      .first();
    if (!ep) throw new AppError('Not found', 404, 'NOT_FOUND');
    await db('episodes').where({ id: req.params.id, clinic_id: req.clinicId }).whereNull('deleted_at').update({
      status: 'onhold',
      closure_reason: closureReason ?? 'Pending consultant approval',
      closure_vetting_status: 'pending_review',
      closure_vetted_by_id: consultantId,
      updated_at: new Date(),
    });
    // Create task for consultant. Tasks schema: assigned_by_id (not
    // created_by_id), status 'pending' (not 'todo') — verified via
    // psql \d tasks. Same bug class as SD1 (tasks save broken).
    await createTaskInternal(req.clinicId, req.user!.id, {
      patientId: ep.patient_id,
      episodeId: req.params.id,
      assignedToId: consultantId,
      title: 'Sign Episode Closure',
      description: `Episode closure for "${ep.presenting_problem}" requires your signature.`,
      priority: 'high',
      taskType: 'closure_review',
    })
    res.json(EpisodeOkResponseSchema.parse({ ok: true }));
  } catch (err) { next(err); }
});

router.post('/:id/close-sign', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { CloseSignSchema } = await import('@signacare/shared');
    const { signature } = CloseSignSchema.parse(req.body);
    const ep = await db('episodes')
      .where({ id: req.params.id, clinic_id: req.clinicId })
      .whereNull('deleted_at')
      .first();
    if (!ep) throw new AppError('Not found', 404, 'NOT_FOUND');
    if (ep.closure_vetted_by_id !== req.user!.id) {
      throw new AppError('Only the assigned consultant can sign', 403, 'CONSULTANT_SIGN_REQUIRED');
    }
    await db('episodes').where({ id: req.params.id, clinic_id: req.clinicId }).whereNull('deleted_at').update({
      status: 'closed',
      end_date: new Date().toISOString().split('T')[0],
      closure_vetting_status: 'signed',
      closure_vetted_at: new Date(),
      closure_signature: signature ?? null,
      updated_at: new Date(),
    });
    res.json(EpisodeOkResponseSchema.parse({ ok: true }));
  } catch (err) { next(err); }
});

export { router as episodeRoutes };
export default router;
