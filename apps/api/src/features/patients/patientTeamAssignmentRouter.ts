import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import type { Knex } from 'knex';
import { z } from 'zod';
import { db } from '../../db/db';
import { buildAuthContext } from '../../shared/buildAuthContext';
import { requirePermission } from '../../shared/authGuards';
import { AppError } from '../../shared/errors';

const TeamAssignmentPatchSchema = z.object({
  referralStatus: z.enum(['new', 'in_review', 'accepted', 'rejected']).optional(),
  isActive: z.boolean().optional(),
});

const TeamAssignmentPatchResponseSchema = z.object({
  ok: z.literal(true),
  assignmentId: z.string().uuid(),
});

const TeamAssignmentListResponseSchema = z.object({
  assignments: z.array(
    z.object({
      assignment_id: z.string().nullable(),
      assignmentId: z.string().nullable(),
      patient_id: z.string(),
      given_name: z.string().nullable(),
      family_name: z.string().nullable(),
      emr_number: z.string().nullable(),
      org_unit_id: z.string().nullable(),
      org_unit_name: z.string().nullable(),
      primary_clinician_id: z.string().nullable(),
      referral_status: z.string().nullable(),
      is_active: z.boolean(),
      episode_id: z.string().nullable(),
      open_episode_id: z.string().nullable(),
      open_episode_team_id: z.string().nullable(),
      open_episode_primary_clinician_id: z.string().nullable(),
      open_episode_key_worker_id: z.string().nullable(),
      effective_primary_clinician_id: z.string().nullable(),
      effective_clinician_name: z.string(),
      key_worker_id: z.string().nullable(),
      key_worker_name: z.string(),
      mdt: z.array(z.record(z.string(), z.unknown())),
    }).passthrough(),
  ),
});

export const patientTeamAssignmentRouter = Router();

patientTeamAssignmentRouter.get('/team-assignments', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const clinicId = req.clinicId;
    const assignmentRows = await db('patient_team_assignments as pta')
      .join('org_units as ou', 'ou.id', 'pta.org_unit_id')
      .join('patients as p', 'p.id', 'pta.patient_id')
      .leftJoin('staff as assignment_staff', function joinAssignmentStaff() {
        this.on('assignment_staff.id', '=', 'pta.primary_clinician_id')
          .andOn('assignment_staff.clinic_id', '=', db.raw('?', [clinicId]))
          .andOnNull('assignment_staff.deleted_at');
      })
      .where('ou.clinic_id', clinicId)
      .where('p.clinic_id', clinicId)
      .whereNull('p.deleted_at')
      .where(function onlyRelevantAssignments(this: Knex.QueryBuilder) {
        this.where('pta.is_active', true).orWhereNotNull('pta.referral_status');
      })
      .limit(5000)
      .select(
        'pta.id as assignment_id',
        'pta.patient_id',
        'p.given_name',
        'p.family_name',
        'p.emr_number',
        'pta.org_unit_id',
        'ou.name as org_unit_name',
        'pta.primary_clinician_id',
        'pta.referral_status',
        'pta.is_active',
        db.raw(
          `(SELECT e.id
            FROM episodes e
            WHERE e.patient_id = pta.patient_id
              AND e.clinic_id = ?
              AND e.status = 'open'
              AND e.deleted_at IS NULL
            ORDER BY e.created_at DESC
            LIMIT 1) as episode_id`,
          [clinicId],
        ),
        db.raw("COALESCE(assignment_staff.given_name || ' ' || assignment_staff.family_name, '') as clinician_name"),
      );

    type AssignmentRow = {
      assignment_id: string | null;
      patient_id: string;
      given_name: string | null;
      family_name: string | null;
      emr_number: string | null;
      org_unit_id: string | null;
      org_unit_name: string | null;
      primary_clinician_id: string | null;
      referral_status: string | null;
      is_active: boolean;
      episode_id: string | null;
      clinician_name: string;
    };

    type OpenEpisodeRow = {
      id: string;
      patient_id: string;
      given_name: string | null;
      family_name: string | null;
      emr_number: string | null;
      team_id: string | null;
      team_name: string | null;
      primary_clinician_id: string | null;
      key_worker_id: string | null;
      primary_clinician_name: string;
      key_worker_name: string;
    };

    const openEpisodeRows: OpenEpisodeRow[] = await db('episodes')
      .join('patients as open_episode_patient', 'open_episode_patient.id', 'episodes.patient_id')
      .leftJoin('org_units as open_episode_team', function joinOpenEpisodeTeam() {
        this.on('open_episode_team.id', '=', 'episodes.team_id')
          .andOn('open_episode_team.clinic_id', '=', db.raw('?', [clinicId]));
      })
      .leftJoin('staff as episode_primary_staff', function joinPrimaryStaff() {
        this.on('episode_primary_staff.id', '=', 'episodes.primary_clinician_id')
          .andOn('episode_primary_staff.clinic_id', '=', db.raw('?', [clinicId]))
          .andOnNull('episode_primary_staff.deleted_at');
      })
      .leftJoin('staff as episode_key_worker_staff', function joinKeyWorkerStaff() {
        this.on('episode_key_worker_staff.id', '=', 'episodes.key_worker_id')
          .andOn('episode_key_worker_staff.clinic_id', '=', db.raw('?', [clinicId]))
          .andOnNull('episode_key_worker_staff.deleted_at');
      })
      .where('episodes.clinic_id', clinicId)
      .where('episodes.status', 'open')
      .whereNull('episodes.deleted_at')
      .whereNull('open_episode_patient.deleted_at')
      .where('open_episode_patient.clinic_id', clinicId)
      .orderBy('episodes.created_at', 'desc')
      .select(
        'episodes.id',
        'episodes.patient_id',
        'open_episode_patient.given_name',
        'open_episode_patient.family_name',
        'open_episode_patient.emr_number',
        'episodes.team_id',
        'open_episode_team.name as team_name',
        'episodes.primary_clinician_id',
        'episodes.key_worker_id',
        db.raw("COALESCE(episode_primary_staff.given_name || ' ' || episode_primary_staff.family_name, '') as primary_clinician_name"),
        db.raw("COALESCE(episode_key_worker_staff.given_name || ' ' || episode_key_worker_staff.family_name, '') as key_worker_name"),
      );

    const rows: AssignmentRow[] = [...assignmentRows];
    const patientIdsWithAssignment = new Set<string>(rows.map((r) => r.patient_id));
    for (const episode of openEpisodeRows) {
      if (patientIdsWithAssignment.has(episode.patient_id)) continue;
      rows.push({
        assignment_id: null,
        patient_id: episode.patient_id,
        given_name: episode.given_name,
        family_name: episode.family_name,
        emr_number: episode.emr_number,
        org_unit_id: episode.team_id,
        org_unit_name: episode.team_name,
        primary_clinician_id: null,
        referral_status: null,
        is_active: true,
        episode_id: episode.id,
        clinician_name: '',
      });
      patientIdsWithAssignment.add(episode.patient_id);
    }

    const openEpisodeByPatient = new Map<string, OpenEpisodeRow>();
    for (const episode of openEpisodeRows) {
      if (!openEpisodeByPatient.has(episode.patient_id)) {
        openEpisodeByPatient.set(episode.patient_id, episode);
      }
    }

    const orgUnitIds = [
      ...new Set(
        rows
          .map((r) => r.org_unit_id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0),
      ),
    ];
    const mdtRows = orgUnitIds.length
      ? await db('staff_role_assignments as sra')
        .join('staff as mdt_staff', function joinMdtStaff() {
          this.on('mdt_staff.id', '=', 'sra.staff_id')
            .andOn('mdt_staff.clinic_id', '=', db.raw('?', [clinicId]))
            .andOnNull('mdt_staff.deleted_at');
        })
        .join('clinical_roles', 'clinical_roles.id', 'sra.clinical_role_id')
        .where('sra.is_active', true)
        .where('sra.clinic_id', clinicId)
        .whereIn('sra.org_unit_id', orgUnitIds)
        .select(
          'sra.org_unit_id',
          'sra.staff_id',
          db.raw("COALESCE(mdt_staff.given_name || ' ' || mdt_staff.family_name, '') as staff_name"),
          'clinical_roles.name as role_name',
          'sra.role_type',
        )
      : [];

    const mdtByUnit = new Map<string, Record<string, unknown>[]>();
    for (const m of mdtRows) {
      const key = m.org_unit_id;
      if (!mdtByUnit.has(key)) mdtByUnit.set(key, []);
      mdtByUnit.get(key)!.push({
        staff_id: m.staff_id,
        staff_name: m.staff_name,
        role_name: m.role_name,
      });
    }

    const enriched = rows.map((r) => {
      const openEpisode = openEpisodeByPatient.get(r.patient_id);
      const assignmentClinicianId =
        typeof r.primary_clinician_id === 'string'
        && typeof r.clinician_name === 'string'
        && r.clinician_name.trim().length > 0
          ? r.primary_clinician_id
          : null;
      const effectivePrimaryClinicianId =
        assignmentClinicianId
        ?? openEpisode?.primary_clinician_id
        ?? openEpisode?.key_worker_id
        ?? null;
      return {
        ...r,
        assignment_id: r.assignment_id ?? null,
        assignmentId: r.assignment_id ?? null,
        episode_id: r.episode_id ?? openEpisode?.id ?? null,
        open_episode_id: openEpisode?.id ?? null,
        open_episode_team_id: openEpisode?.team_id ?? null,
        open_episode_primary_clinician_id: openEpisode?.primary_clinician_id ?? null,
        open_episode_key_worker_id: openEpisode?.key_worker_id ?? null,
        effective_primary_clinician_id: effectivePrimaryClinicianId,
        effective_clinician_name:
          r.clinician_name
          || openEpisode?.primary_clinician_name
          || openEpisode?.key_worker_name
          || '',
        mdt: r.org_unit_id ? (mdtByUnit.get(r.org_unit_id) ?? []) : [],
        key_worker_id: openEpisode?.key_worker_id ?? null,
        key_worker_name: openEpisode?.key_worker_name ?? '',
      };
    });

    res.json(TeamAssignmentListResponseSchema.parse({
      assignments: enriched,
    }));
  } catch (err) {
    next(err);
  }
});

patientTeamAssignmentRouter.patch('/team-assignments/:assignmentId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { referralStatus, isActive } = TeamAssignmentPatchSchema.parse(req.body);
    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (referralStatus !== undefined) patch.referral_status = referralStatus;
    if (isActive !== undefined) patch.is_active = isActive;
    if (referralStatus === 'accepted') {
      patch.reviewed_by_id = req.user?.id;
      patch.reviewed_at = new Date();
    }

    const assignmentById = await db('patient_team_assignments')
      .where({ id: req.params.assignmentId })
      .whereExists(function scopedToClinic() {
        this.select(db.raw('1'))
          .from('patients as p')
          .whereRaw('p.id = patient_team_assignments.patient_id')
          .andWhere('p.clinic_id', req.clinicId)
          .whereNull('p.deleted_at');
      })
      .first('id', 'patient_id');

    const targetAssignment = assignmentById as { id: string; patient_id: string } | undefined;

    if (!targetAssignment?.id) {
      throw new AppError('Team assignment not found for this clinic', 404, 'NOT_FOUND');
    }

    requirePermission(buildAuthContext(req, targetAssignment.patient_id), 'patient:update');

    await db('patient_team_assignments')
      .where({ id: targetAssignment.id })
      .update(patch);

    res.json(TeamAssignmentPatchResponseSchema.parse({
      ok: true,
      assignmentId: targetAssignment.id,
    }));
  } catch (err) {
    next(err);
  }
});
