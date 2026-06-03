import { randomUUID } from 'crypto';
import type { Knex } from 'knex';
import type {
  AuthContext,
  PatientSummarySignoff,
  SignPatientSummaryDTO,
} from '@signacare/shared';
import { db } from '../../db/db';
import { AppError } from '../../shared/errors';
import {
  requireClinicalAccessRole,
  requirePatientRelationship,
} from '../../shared/authGuards';

const SECTION_LABELS: Record<PatientSummarySignoff['section'], string> = {
  longitudinal_summary: 'Longitudinal Summary',
  clinical_formulation: 'Clinical Formulation',
  life_chart: 'Life Chart',
  care_provision_summary: 'Care Provision Summary',
  diagnosis_summary: 'Diagnosis Summary',
};

interface SignoffRow {
  summary_section: PatientSummarySignoff['section'];
  signed_off_at: string | Date;
  signed_off_by_id: string;
  signed_off_by_name: string;
  review_due_date: string | Date;
  reminder_task_id: string | null;
}

function toDateOnly(d: Date): string {
  return d.toISOString().split('T')[0] ?? '';
}

function addMonths(base: Date, months: number): Date {
  const next = new Date(base);
  next.setMonth(next.getMonth() + months);
  return next;
}

function mapSignoffRow(row: SignoffRow): PatientSummarySignoff {
  return {
    section: row.summary_section,
    signedOffAt:
      row.signed_off_at instanceof Date
        ? row.signed_off_at.toISOString()
        : new Date(row.signed_off_at).toISOString(),
    signedOffById: row.signed_off_by_id,
    signedOffByName: row.signed_off_by_name,
    reviewDueDate:
      row.review_due_date instanceof Date
        ? toDateOnly(row.review_due_date)
        : String(row.review_due_date),
    reminderTaskId: row.reminder_task_id,
  };
}

async function assertConsultantAssignment(
  clinicId: string,
  patientId: string,
  staffId: string,
): Promise<void> {
  const consultantPsychiatristAssignment = await db('patient_team_assignments as pta')
    .join('org_units as ou', 'ou.id', 'pta.org_unit_id')
    .join('staff_role_assignments as sra', 'sra.org_unit_id', 'ou.id')
    .join('clinical_roles as cr', 'cr.id', 'sra.clinical_role_id')
    .where('pta.patient_id', patientId)
    .andWhere('pta.is_active', true)
    .andWhere('ou.clinic_id', clinicId)
    .andWhere('sra.staff_id', staffId)
    .andWhere('sra.is_active', true)
    // Restrict sign-off to consultant psychiatrist roles only.
    .whereILike('cr.name', '%consultant%')
    .where(function roleIsPsychiatrist() {
      this.whereILike('cr.name', '%psychiatrist%').orWhereILike('cr.name', '%psychiatry%');
    })
    .first('sra.id');

  if (!consultantPsychiatristAssignment) {
    throw new AppError(
      'Only an assigned consultant psychiatrist can sign off this summary.',
      403,
      'CONSULTANT_SIGNOFF_REQUIRED',
    );
  }
}

async function upsertReminderTask(
  trx: Knex.Transaction,
  auth: AuthContext,
  patientId: string,
  section: PatientSummarySignoff['section'],
  reviewDueDate: string,
  reminderTaskId: string | null,
): Promise<string> {
  const title = `Review ${SECTION_LABELS[section]} (Consultant Sign-off)`;
  const description = `${SECTION_LABELS[section]} requires consultant re-review by ${reviewDueDate}.`;

  if (reminderTaskId) {
    await trx('tasks')
      .where({ id: reminderTaskId, clinic_id: auth.clinicId })
      .update({
        assigned_to_id: auth.staffId,
        assigned_by_id: auth.staffId,
        patient_id: patientId,
        title,
        description,
        task_type: 'summary_review',
        priority: 'high',
        status: 'pending',
        due_date: reviewDueDate,
        completed_at: null,
        completed_by_id: null,
        updated_at: trx.fn.now(),
      });
    return reminderTaskId;
  }

  const nextTaskId = randomUUID();
  await trx('tasks').insert({
    id: nextTaskId,
    clinic_id: auth.clinicId,
    patient_id: patientId,
    assigned_to_id: auth.staffId,
    assigned_by_id: auth.staffId,
    title,
    description,
    task_type: 'summary_review',
    priority: 'high',
    status: 'pending',
    due_date: reviewDueDate,
    created_at: trx.fn.now(),
    updated_at: trx.fn.now(),
  });
  return nextTaskId;
}

async function fetchSignoffs(
  clinicId: string,
  patientId: string,
  query: Knex | Knex.Transaction = db,
): Promise<PatientSummarySignoff[]> {
  const rows = (await query('patient_summary_signoffs as pss')
    .leftJoin('staff as s', 's.id', 'pss.signed_off_by_id')
    .where('pss.clinic_id', clinicId)
    .andWhere('pss.patient_id', patientId)
    .select<SignoffRow[]>(
      'pss.summary_section',
      'pss.signed_off_at',
      'pss.signed_off_by_id',
      query.raw(
        "COALESCE(s.given_name || ' ' || s.family_name, '') as signed_off_by_name",
      ),
      'pss.review_due_date',
      'pss.reminder_task_id',
    )
    .orderBy('pss.summary_section', 'asc')) as SignoffRow[];

  return rows.map(mapSignoffRow);
}

export async function listPatientSummarySignoffs(
  auth: AuthContext,
  patientId: string,
): Promise<PatientSummarySignoff[]> {
  requireClinicalAccessRole(auth);
  await requirePatientRelationship(auth, patientId);
  return fetchSignoffs(auth.clinicId, patientId);
}

export async function signPatientSummary(
  auth: AuthContext,
  patientId: string,
  dto: SignPatientSummaryDTO,
): Promise<PatientSummarySignoff[]> {
  requireClinicalAccessRole(auth);
  await requirePatientRelationship(auth, patientId);
  await assertConsultantAssignment(auth.clinicId, patientId, auth.staffId);

  const now = new Date();
  const reviewDueDate = toDateOnly(addMonths(now, dto.reviewIntervalMonths));

  await db.transaction(async (trx) => {
    const existing = await trx('patient_summary_signoffs')
      .where({
        clinic_id: auth.clinicId,
        patient_id: patientId,
        summary_section: dto.section,
      })
      .first('reminder_task_id');

    const reminderTaskId = await upsertReminderTask(
      trx,
      auth,
      patientId,
      dto.section,
      reviewDueDate,
      (existing?.reminder_task_id as string | null) ?? null,
    );

    await trx('patient_summary_signoffs')
      .insert({
        id: randomUUID(),
        clinic_id: auth.clinicId,
        patient_id: patientId,
        summary_section: dto.section,
        signed_off_by_id: auth.staffId,
        signed_off_at: now,
        review_due_date: reviewDueDate,
        review_interval_months: dto.reviewIntervalMonths,
        reminder_task_id: reminderTaskId,
        created_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      })
      .onConflict(['patient_id', 'summary_section'])
      .merge({
        signed_off_by_id: auth.staffId,
        signed_off_at: now,
        review_due_date: reviewDueDate,
        review_interval_months: dto.reviewIntervalMonths,
        reminder_task_id: reminderTaskId,
        updated_at: trx.fn.now(),
        lock_version: trx.raw('patient_summary_signoffs.lock_version + 1'),
      });
  });

  return fetchSignoffs(auth.clinicId, patientId);
}
