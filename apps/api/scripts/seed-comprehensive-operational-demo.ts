import 'dotenv/config';
import { createHash } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { appPoolRaw, clearPoolMonitor, db, dbAdmin, rlsStore } from '../src/db/db';

type ClinicRow = {
  id: string;
  name: string;
};

type PatientRow = {
  id: string;
  given_name: string;
  family_name: string;
  date_of_birth: string | null;
  emr_number: string | null;
  email_primary: string | null;
};

type TeamRow = {
  id: string;
  name: string;
  level: string;
};

type ClinicianRow = {
  id: string;
  given_name: string;
  family_name: string;
  prescriber_number: string | null;
};

type TeamMembershipRow = {
  staff_id: string;
  org_unit_id: string;
};

type EpisodeRow = {
  id: string;
  start_date: string;
  primary_clinician_id: string | null;
  team_id: string | null;
};

type LegalOrderTypeConfigRow = {
  id: string;
  name: string;
};

type ReferralStatus =
  | 'received'
  | 'under_review'
  | 'discussed'
  | 'accepted'
  | 'rejected'
  | 'redirected'
  | 'info_requested'
  | 'appointment_booked'
  | 'closed_no_response'
  | 'pending_clinician_review'
  | 'pending_broadcast';

const CLINIC_NAME = process.env.DEMO_CASES_CLINIC_NAME ?? 'Soham Health';
const MARKER = '[DEMO-COMPREHENSIVE-OPS]';
const SPECIALTY_CODE = 'mental_health';

const REFERRAL_STATUS_CYCLE: readonly ReferralStatus[] = [
  'received',
  'under_review',
  'discussed',
  'info_requested',
  'accepted',
  'appointment_booked',
  'pending_clinician_review',
  'pending_broadcast',
  'closed_no_response',
  'redirected',
];

const PRIMARY_DIAGNOSES = [
  'Bipolar affective disorder',
  'Schizoaffective disorder',
  'Schizophrenia',
  'Obsessive-compulsive disorder',
  'Generalised anxiety disorder',
  'Borderline personality disorder',
  'Major depressive disorder',
  'Post-traumatic stress disorder',
] as const;

const LAI_DRUGS = [
  { name: 'Paliperidone LAI', doseMg: '150', frequencyDays: 28 },
  { name: 'Risperidone LAI', doseMg: '37.5', frequencyDays: 14 },
  { name: 'Aripiprazole LAI', doseMg: '400', frequencyDays: 28 },
] as const;

const LEGAL_ORDER_LABELS = [
  'Community Treatment Order',
  'Inpatient Treatment Order',
  'Temporary Treatment Order',
] as const;

const DEMO_PATIENT_POOL = [
  { givenName: 'Amelia', familyName: 'Dawson', dob: '1980-01-01' },
  { givenName: 'Noah', familyName: 'Bennett', dob: '1981-02-02' },
  { givenName: 'Priya', familyName: 'Menon', dob: '1982-03-03' },
  { givenName: 'Thomas', familyName: 'Nguyen', dob: '1983-04-04' },
  { givenName: 'Zara', familyName: 'Coleman', dob: '1984-05-05' },
  { givenName: 'Ethan', familyName: 'Patel', dob: '1985-06-06' },
  { givenName: 'Leila', familyName: 'Hassan', dob: '1986-07-07' },
  { givenName: 'Marcus', familyName: 'Donovan', dob: '1987-08-08' },
  { givenName: 'Hannah', familyName: 'Reid', dob: '1988-09-09' },
  { givenName: 'Victor', familyName: 'Lam', dob: '1989-10-10' },
] as const;

function seedUuid(seed: string): string {
  const hex = createHash('sha256').update(seed).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function addDays(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isoAt(dateIso: string, hour = 2, minute = 0): string {
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return new Date(`${dateIso}T${hh}:${mm}:00.000Z`).toISOString();
}

function fullName(row: { given_name: string; family_name: string }): string {
  return `${row.given_name} ${row.family_name}`.trim();
}

function serviceRequestStatusForReferral(status: ReferralStatus): 'draft' | 'active' | 'revoked' | 'completed' {
  if (status === 'closed_no_response') return 'completed';
  if (status === 'rejected' || status === 'redirected') return 'revoked';
  if (status === 'pending_broadcast') return 'draft';
  return 'active';
}

function taskStatusForReferral(status: ReferralStatus): 'requested' | 'received' | 'accepted' | 'rejected' | 'in_progress' | 'completed' {
  switch (status) {
    case 'received':
      return 'received';
    case 'under_review':
    case 'discussed':
    case 'info_requested':
    case 'pending_clinician_review':
      return 'in_progress';
    case 'accepted':
      return 'accepted';
    case 'appointment_booked':
    case 'closed_no_response':
      return 'completed';
    case 'rejected':
    case 'redirected':
      return 'rejected';
    case 'pending_broadcast':
      return 'requested';
    default:
      return 'requested';
  }
}

async function runInClinicRlsContext<T>(clinicId: string, actorId: string, work: () => Promise<T>): Promise<T> {
  return appPoolRaw.transaction(async (trx) => {
    await trx.raw("SELECT set_config('app.clinic_id', ?, true)", [clinicId]);
    await trx.raw("SELECT set_config('app.user_id', ?, true)", [actorId]);
    return new Promise<T>((resolve, reject) => {
      rlsStore.run(trx, () => {
        work().then(resolve).catch(reject);
      });
    });
  });
}

async function resolveClinic(): Promise<ClinicRow> {
  const clinic = await dbAdmin('clinics')
    .where({ name: CLINIC_NAME, is_active: true })
    .whereNull('deleted_at')
    .first<ClinicRow>('id', 'name');

  if (!clinic) {
    throw new Error(`Clinic "${CLINIC_NAME}" not found.`);
  }
  return clinic;
}

async function resolveDemoPatients(clinicId: string): Promise<PatientRow[]> {
  const rows = await db('patients')
    .where({ clinic_id: clinicId, status: 'active' })
    .whereNull('deleted_at')
    .whereRaw('LOWER(COALESCE(email_primary, \'\')) LIKE ?', ['%@demo.local'])
    .orderBy('given_name', 'asc')
    .orderBy('family_name', 'asc')
    .select<PatientRow[]>('id', 'given_name', 'family_name', 'date_of_birth', 'emr_number', 'email_primary');

  if (rows.length > 0) return rows;

  const now = new Date().toISOString();
  for (const [index, person] of DEMO_PATIENT_POOL.entries()) {
    const id = seedUuid(`${MARKER}:patient:${person.givenName}:${person.familyName}:${person.dob}`);
    await db('patients')
      .insert({
        id,
        clinic_id: clinicId,
        given_name: person.givenName,
        family_name: person.familyName,
        preferred_name: person.givenName,
        date_of_birth: person.dob,
        gender: index % 2 === 0 ? 'female' : 'male',
        pronouns: index % 2 === 0 ? 'she/her' : 'he/him',
        email_primary: `${person.givenName}.${person.familyName}`.toLowerCase() + '@demo.local',
        phone_mobile: `04${String(10000000 + index).padStart(8, '0')}`,
        phone_home: `03${String(30000000 + index).padStart(8, '0')}`,
        address_line1: `${10 + index} Demo Street`,
        suburb: 'Melbourne',
        state: 'VIC',
        postcode: '3000',
        status: 'active',
        interpreter_required: false,
        sms_consent: true,
        created_at: now,
        updated_at: now,
      })
      .onConflict('id')
      .merge([
        'given_name',
        'family_name',
        'preferred_name',
        'email_primary',
        'phone_mobile',
        'phone_home',
        'status',
        'updated_at',
      ]);
  }

  const seededRows = await db('patients')
    .where({ clinic_id: clinicId, status: 'active' })
    .whereNull('deleted_at')
    .whereRaw('LOWER(COALESCE(email_primary, \'\')) LIKE ?', ['%@demo.local'])
    .orderBy('given_name', 'asc')
    .orderBy('family_name', 'asc')
    .select<PatientRow[]>('id', 'given_name', 'family_name', 'date_of_birth', 'emr_number', 'email_primary');
  if (seededRows.length > 0) return seededRows;

  return db('patients')
    .where({ clinic_id: clinicId, status: 'active' })
    .whereNull('deleted_at')
    .orderBy('updated_at', 'desc')
    .limit(10)
    .select<PatientRow[]>('id', 'given_name', 'family_name', 'date_of_birth', 'emr_number', 'email_primary');
}

async function resolveTeams(clinicId: string): Promise<TeamRow[]> {
  const teams = await db('org_units')
    .where({ clinic_id: clinicId, is_active: true })
    .orderBy('sort_order', 'asc')
    .select<TeamRow[]>('id', 'name', 'level');
  if (teams.length === 0) {
    throw new Error(`No active teams found in clinic ${clinicId}.`);
  }
  return teams;
}

async function resolveClinicians(clinicId: string): Promise<ClinicianRow[]> {
  const clinicians = await db('staff')
    .where({ clinic_id: clinicId, role: 'clinician', is_active: true })
    .whereNull('deleted_at')
    .orderBy('given_name', 'asc')
    .orderBy('family_name', 'asc')
    .select<ClinicianRow[]>('id', 'given_name', 'family_name', 'prescriber_number');

  if (clinicians.length === 0) {
    throw new Error(`No active clinicians found in clinic ${clinicId}.`);
  }
  return clinicians;
}

async function resolveCoordinator(clinicId: string): Promise<string> {
  const row =
    (await db('staff')
      .where({ clinic_id: clinicId, is_active: true, role: 'admin' })
      .whereNull('deleted_at')
      .first<{ id: string }>('id')) ??
    (await db('staff')
      .where({ clinic_id: clinicId, is_active: true, role: 'manager' })
      .whereNull('deleted_at')
      .first<{ id: string }>('id')) ??
    (await db('staff')
      .where({ clinic_id: clinicId, is_active: true, role: 'clinician' })
      .whereNull('deleted_at')
      .first<{ id: string }>('id'));

  if (!row?.id) throw new Error(`No active coordinator staff found in clinic ${clinicId}.`);
  return row.id;
}

async function resolveTeamMembership(clinicId: string): Promise<TeamMembershipRow[]> {
  return db('staff_team_assignments')
    .where({ clinic_id: clinicId, is_active: true })
    .whereNull('end_date')
    .select<TeamMembershipRow[]>('staff_id', 'org_unit_id');
}

async function resolveLegalOrderType(clinicId: string): Promise<LegalOrderTypeConfigRow> {
  const existing = await db('legal_order_type_configs')
    .where({ clinic_id: clinicId, is_active: true })
    .whereRaw('LOWER(name) LIKE ?', ['%treatment order%'])
    .orderBy('sort_order', 'asc')
    .first<LegalOrderTypeConfigRow>('id', 'name');
  if (existing) return existing;

  const created: LegalOrderTypeConfigRow = {
    id: seedUuid(`${MARKER}:${clinicId}:legal-order-type:cto`),
    name: LEGAL_ORDER_LABELS[0],
  };
  const now = new Date().toISOString();
  await db('legal_order_type_configs')
    .insert({
      id: created.id,
      clinic_id: clinicId,
      name: created.name,
      category: 'treatment',
      is_active: true,
      sort_order: 10,
      created_at: now,
      updated_at: now,
    })
    .onConflict('id')
    .merge(['name', 'updated_at']);
  return created;
}

async function ensureOpenEpisode(
  clinicId: string,
  patientId: string,
  teamId: string,
  clinicianId: string,
  index: number,
): Promise<EpisodeRow> {
  const existing = await db('episodes')
    .where({ clinic_id: clinicId, patient_id: patientId, status: 'open' })
    .whereNull('deleted_at')
    .orderBy('start_date', 'desc')
    .first<EpisodeRow>('id', 'start_date', 'primary_clinician_id', 'team_id');

  const todayIso = new Date().toISOString().slice(0, 10);
  if (existing) {
    await db('episodes')
      .where({ id: existing.id })
      .update({
        team_id: teamId,
        primary_clinician_id: clinicianId,
        key_worker_id: clinicianId,
        updated_at: new Date().toISOString(),
        lock_version: dbAdmin.raw('COALESCE(lock_version, 0) + 1'),
      });
    return {
      ...existing,
      team_id: teamId,
      primary_clinician_id: clinicianId,
    };
  }

  const episodeId = seedUuid(`${MARKER}:${clinicId}:episode:${patientId}`);
  const startDate = addDays(todayIso, -(90 + index * 37));
  await db('episodes')
    .insert({
      id: episodeId,
      clinic_id: clinicId,
      patient_id: patientId,
      title: `${MARKER} Community mental health care episode`,
      episode_type: 'cct',
      status: 'open',
      presenting_problem: 'Longitudinal mood/psychosis/anxiety symptom monitoring and multidisciplinary recovery support.',
      primary_diagnosis: PRIMARY_DIAGNOSES[index % PRIMARY_DIAGNOSES.length],
      start_date: startDate,
      team_id: teamId,
      primary_clinician_id: clinicianId,
      key_worker_id: clinicianId,
      specialty_code: SPECIALTY_CODE,
      lock_version: 1,
      created_at: isoAt(startDate, 1, 0),
      updated_at: isoAt(startDate, 1, 5),
    })
    .onConflict('id')
    .merge([
      'team_id',
      'primary_clinician_id',
      'key_worker_id',
      'presenting_problem',
      'primary_diagnosis',
      'updated_at',
    ]);

  return {
    id: episodeId,
    start_date: startDate,
    team_id: teamId,
    primary_clinician_id: clinicianId,
  };
}

async function upsertTeamAssignment(
  patientId: string,
  teamId: string,
  clinicianId: string,
): Promise<void> {
  const now = new Date().toISOString();
  await db('patient_team_assignments')
    .insert({
      id: seedUuid(`${MARKER}:team-assignment:${patientId}:${teamId}`),
      patient_id: patientId,
      org_unit_id: teamId,
      primary_clinician_id: clinicianId,
      is_active: true,
      created_at: now,
      updated_at: now,
      referral_status: 'accepted',
      reviewed_by_id: null,
      reviewed_at: null,
      referred_by_id: null,
      escalation_id: null,
      rejection_reason: null,
    })
    .onConflict(['patient_id', 'org_unit_id'])
    .merge({
      primary_clinician_id: clinicianId,
      is_active: true,
      updated_at: now,
      referral_status: 'accepted',
      rejection_reason: null,
    });
}

async function upsertReferrals(
  clinic: ClinicRow,
  patient: PatientRow,
  episodeId: string,
  assignedStaffId: string,
  createdById: string,
  index: number,
): Promise<number> {
  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);
  const primaryStatus = REFERRAL_STATUS_CYCLE[index % REFERRAL_STATUS_CYCLE.length]!;
  const historyStatus = index % 2 === 0 ? 'appointment_booked' : 'closed_no_response';
  const statuses: ReferralStatus[] = [primaryStatus, historyStatus];

  for (const [statusIndex, status] of statuses.entries()) {
    const referralDate = addDays(todayIso, -(40 + index * 11 + statusIndex * 20));
    const receivedAt = isoAt(referralDate, 9, 0);
    const statusChangedAt = isoAt(addDays(referralDate, 2 + statusIndex), 10, 0);
    const referralId = seedUuid(`${MARKER}:referral:${patient.id}:${statusIndex}`);
    const referralNumber = `REF-DEMO-${new Date(referralDate).getUTCFullYear()}-${String(index + 1).padStart(3, '0')}-${statusIndex + 1}`;
    const urgency = (['urgent', 'soon', 'routine', 'emergency'] as const)[(index + statusIndex) % 4]!;

    await db('referrals')
      .insert({
        id: referralId,
        clinic_id: clinic.id,
        patient_id: patient.id,
        referral_number: referralNumber,
        referral_date: referralDate,
        source: statusIndex === 0 ? 'gp' : 'hospital',
        from_service: statusIndex === 0 ? 'Primary Care' : 'Emergency Department',
        from_provider_name: statusIndex === 0 ? 'Dr Amelia Morgan' : 'ED Psychiatric Liaison',
        from_provider_phone: `03${String(70000000 + index * 10 + statusIndex).padStart(8, '0')}`,
        from_provider_email: statusIndex === 0 ? `amelia.morgan${index}@referral.demo.local` : `liaison${index}@hospital.demo.local`,
        from_provider_prescriber_no: `PR${String(610000 + index * 10 + statusIndex).padStart(7, '0')}`,
        referring_org: statusIndex === 0 ? 'Soham Family Practice' : 'Metro General Hospital',
        reason: `${MARKER} Referral for ${fullName(patient)} due to symptom escalation and need for multidisciplinary mental health follow-up.`,
        clinical_summary: 'Five-year trajectory includes recurrent symptom waves, medication reviews, and psychosocial stress-related relapse markers.',
        current_medications: 'See current medication tab; includes active psychotropic regimen with recent adherence review.',
        diagnosis_info: 'Primary psychiatric diagnosis documented in active episode with longitudinal evidence anchors.',
        urgency,
        status,
        status_changed_at: statusChangedAt,
        received_at: receivedAt,
        assigned_to_staff_id: assignedStaffId,
        linked_episode_id: episodeId,
        has_attachment: false,
        ocr_extracted: null,
        rejection_reason: status === 'rejected' ? 'Out-of-scope referral destination.' : null,
        redirect_to: status === 'redirected' ? 'Neighbourhood community service' : null,
        sla_due_date: addDays(referralDate, 7),
        sla_breached: false,
        internal_notes: `${MARKER} Seeded referral lifecycle stage for demo dashboards and intake queues.`,
        created_at: receivedAt,
        updated_at: statusChangedAt,
        referral_mode: 'team',
        target_clinician_id: assignedStaffId,
        distribution_mode: 'specific_clinician',
        distribution_speciality: SPECIALTY_CODE,
        accepted_by_staff_id: status === 'accepted' || status === 'appointment_booked' ? assignedStaffId : null,
        broadcast_at: status === 'pending_broadcast' ? receivedAt : null,
        reminder_sent_at: null,
        final_reminder_sent_at: null,
        auto_close_at: status === 'closed_no_response' ? statusChangedAt : null,
        feedback_sent_at: null,
        clarification_notes: status === 'info_requested' ? 'Awaiting additional medication history from referrer.' : null,
        created_by_staff_id: createdById,
        target_specialty_code: SPECIALTY_CODE,
        service_request_status: serviceRequestStatusForReferral(status),
        task_status: taskStatusForReferral(status),
        coordinator_id: createdById,
        triaged_at: status === 'under_review' || status === 'discussed' ? statusChangedAt : null,
        triaged_by: status === 'under_review' || status === 'discussed' ? createdById : null,
      })
      .onConflict('id')
      .merge([
        'status',
        'status_changed_at',
        'assigned_to_staff_id',
        'linked_episode_id',
        'urgency',
        'internal_notes',
        'updated_at',
        'service_request_status',
        'task_status',
      ]);
  }
  return statuses.length;
}

async function upsertLaiSchedule(
  clinicId: string,
  patientId: string,
  episodeId: string,
  prescriberId: string,
  index: number,
): Promise<boolean> {
  if (index % 2 !== 0) return false;
  const todayIso = new Date().toISOString().slice(0, 10);
  const regimen = LAI_DRUGS[index % LAI_DRUGS.length]!;
  const nextDueOffsets = [-9, -2, 3, 8, 16] as const;
  const nextDue = addDays(todayIso, nextDueOffsets[index % nextDueOffsets.length]!);
  const startDate = addDays(todayIso, -(400 + index * 17));
  const firstDueDate = addDays(startDate, regimen.frequencyDays);
  const scheduleId = seedUuid(`${MARKER}:lai:${patientId}`);

  await db('lai_schedules')
    .insert({
      id: scheduleId,
      clinic_id: clinicId,
      patient_id: patientId,
      episode_id: episodeId,
      drug_product_id: null,
      prescriber_staff_id: prescriberId,
      drug_name: regimen.name,
      dose_mg: regimen.doseMg,
      frequency_days: regimen.frequencyDays,
      injection_site: index % 2 === 0 ? 'deltoid_left' : 'gluteal_right',
      injection_technique: 'deep_im',
      needle_gauge: '21G',
      indication: 'Relapse prevention and adherence support',
      loading_dose_required: false,
      loading_doses_required: 0,
      loading_doses_given: 0,
      oral_overlap_required: false,
      oral_overlap_end_date: null,
      start_date: startDate,
      first_due_date: firstDueDate,
      next_due_date: nextDue,
      last_given_date: addDays(nextDue, -regimen.frequencyDays),
      end_date: null,
      baseline_aims_score: 1,
      last_aims_date: addDays(nextDue, -35),
      next_aims_due_date: addDays(nextDue, 42),
      status: 'active',
      notes: `${MARKER} LAI schedule seeded for dashboard/list due-date demonstrations.`,
      created_at: isoAt(startDate, 2, 0),
      updated_at: isoAt(todayIso, 2, 5),
      deleted_at: null,
    })
    .onConflict('id')
    .merge([
      'prescriber_staff_id',
      'drug_name',
      'dose_mg',
      'next_due_date',
      'last_given_date',
      'status',
      'notes',
      'updated_at',
      'episode_id',
    ]);
  return true;
}

async function upsertLegalOrder(
  clinicId: string,
  patientId: string,
  enteredById: string,
  orderTypeId: string,
  index: number,
): Promise<boolean> {
  if (index % 3 !== 0) return false;
  const todayIso = new Date().toISOString().slice(0, 10);
  const endOffsets = [-4, 4, 28, 62] as const;
  const endDate = addDays(todayIso, endOffsets[index % endOffsets.length]!);
  const startDate = addDays(endDate, -120);
  const reviewDate = addDays(startDate, 60);
  const orderId = seedUuid(`${MARKER}:legal-order:${patientId}`);

  await db('patient_legal_orders')
    .insert({
      id: orderId,
      patient_id: patientId,
      clinic_id: clinicId,
      order_type_id: orderTypeId,
      entered_by_id: enteredById,
      order_number: `MHA-${new Date(startDate).getUTCFullYear()}-${String(index + 1).padStart(4, '0')}`,
      start_date: startDate,
      end_date: endDate,
      review_date: reviewDate,
      next_application_date: addDays(endDate, -14),
      status: 'active',
      notes: `${MARKER} Seeded legal order for MHA list and expiring/expired alert coverage.`,
      ai_summary: null,
      created_at: isoAt(startDate, 5, 0),
      updated_at: isoAt(todayIso, 5, 5),
      lock_version: 1,
    })
    .onConflict('id')
    .merge([
      'end_date',
      'review_date',
      'next_application_date',
      'status',
      'notes',
      'updated_at',
    ]);
  return true;
}

async function upsertTasksAndMessages(
  clinicId: string,
  patient: PatientRow,
  episodeId: string,
  clinicianId: string,
  coordinatorId: string,
  index: number,
): Promise<{ tasks: number; messages: number }> {
  const todayIso = new Date().toISOString().slice(0, 10);
  const nowIso = new Date().toISOString();

  const taskRows = [
    {
      suffix: 'followup',
      title: `${MARKER} Follow-up review`,
      description: `Follow-up with ${fullName(patient)} regarding symptom trajectory and medication tolerability.`,
      dueDate: addDays(todayIso, (index % 3) - 1),
      status: 'pending',
      priority: 'high',
      assignedTo: clinicianId,
    },
    {
      suffix: 'team-work',
      title: `${MARKER} Team coordination`,
      description: `Coordinate family/carer communication and update care plan summary for ${fullName(patient)}.`,
      dueDate: addDays(todayIso, 3 + (index % 4)),
      status: 'open',
      priority: 'medium',
      assignedTo: index % 2 === 0 ? null : clinicianId,
    },
  ] as const;

  for (const [taskIndex, task] of taskRows.entries()) {
    await db('tasks')
      .insert({
        id: seedUuid(`${MARKER}:task:${patient.id}:${task.suffix}`),
        clinic_id: clinicId,
        patient_id: patient.id,
        episode_id: episodeId,
        assigned_to_id: task.assignedTo,
        assigned_by_id: coordinatorId,
        title: task.title,
        description: task.description,
        task_type: taskIndex === 0 ? 'review' : 'coordination',
        priority: task.priority,
        status: task.status,
        due_date: task.dueDate,
        completed_at: null,
        completed_by_id: null,
        notes: `${MARKER} Seeded task for dashboard cards and task lists.`,
        created_at: nowIso,
        updated_at: nowIso,
        lock_version: 1,
      })
      .onConflict('id')
      .merge([
        'assigned_to_id',
        'status',
        'due_date',
        'description',
        'updated_at',
      ]);
  }

  const threadId = seedUuid(`${MARKER}:thread:${patient.id}`);
  const threadCreatedAt = isoAt(addDays(todayIso, -(3 + index)), 7, 10);
  const lastMessageAt = isoAt(addDays(todayIso, -(1 + (index % 2))), 9, 0);
  await db('message_threads')
    .insert({
      id: threadId,
      clinic_id: clinicId,
      created_by_id: coordinatorId,
      patient_id: patient.id,
      subject: `${MARKER} Care coordination — ${fullName(patient)}`,
      last_message_at: lastMessageAt,
      created_at: threadCreatedAt,
      updated_at: lastMessageAt,
    })
    .onConflict('id')
    .merge(['subject', 'last_message_at', 'updated_at']);

  await db('message_thread_participants')
    .insert([
      {
        id: seedUuid(`${MARKER}:thread:${threadId}:participant:${coordinatorId}`),
        thread_id: threadId,
        user_id: coordinatorId,
        last_read_at: lastMessageAt,
        created_at: threadCreatedAt,
        updated_at: threadCreatedAt,
      },
      {
        id: seedUuid(`${MARKER}:thread:${threadId}:participant:${clinicianId}`),
        thread_id: threadId,
        user_id: clinicianId,
        last_read_at: null,
        created_at: threadCreatedAt,
        updated_at: threadCreatedAt,
      },
    ])
    .onConflict('id')
    .merge(['last_read_at', 'updated_at']);

  const messageRows = [
    {
      suffix: 'm1',
      body: 'Patient portal message: increased anxiety and sleep disturbance this week; requests earlier review.',
      when: isoAt(addDays(todayIso, -(2 + index)), 8, 30),
    },
    {
      suffix: 'm2',
      body: 'Family contact: requested update on medication plan and next appointment timing.',
      when: lastMessageAt,
    },
  ] as const;

  for (const row of messageRows) {
    await db('messages')
      .insert({
        id: seedUuid(`${MARKER}:thread:${threadId}:message:${row.suffix}`),
        thread_id: threadId,
        sender_id: coordinatorId,
        clinic_id: clinicId,
        content: JSON.stringify({
          body: `${MARKER} ${row.body}`,
          patientId: patient.id,
          isUrgent: row.suffix === 'm1',
        }),
        is_read: false,
        created_at: row.when,
        updated_at: row.when,
      })
      .onConflict('id')
      .merge(['content', 'updated_at']);
  }

  return { tasks: taskRows.length, messages: messageRows.length };
}

async function upsertContacts(
  clinicId: string,
  patientId: string,
  episodeId: string,
  staffId: string,
  teamName: string,
  index: number,
): Promise<number> {
  const todayIso = new Date().toISOString().slice(0, 10);
  const rows = [
    {
      suffix: 'face',
      date: addDays(todayIso, -(14 + index)),
      medium: 'Face-to-face',
      content: 'Symptom and function review completed with collaborative update to relapse signature plan.',
    },
    {
      suffix: 'phone',
      date: addDays(todayIso, -(8 + index)),
      medium: 'Phone',
      content: 'Medication adherence and side-effect check completed; no emergent safety concerns.',
    },
    {
      suffix: 'family',
      date: addDays(todayIso, -(3 + index)),
      medium: 'Video',
      content: 'Family-inclusive review to align support plan and early warning actions.',
    },
  ] as const;

  for (const row of rows) {
    await db('contact_records')
      .insert({
        id: seedUuid(`${MARKER}:contact:${patientId}:${row.suffix}`),
        patient_id: patientId,
        clinic_id: clinicId,
        episode_id: episodeId,
        staff_id: staffId,
        contact_type: 'clinical_review',
        contact_date: row.date,
        contact_time: null,
        duration_min: 45,
        location: 'Community clinic',
        contact_medium: row.medium,
        program: 'Mental Health',
        service_recipients: 'Patient/Family',
        is_reportable: true,
        team: teamName,
        num_providing: 1,
        num_receiving: 1,
        content: `${MARKER} ${row.content}`,
        template_id: null,
        status: 'completed',
        created_at: isoAt(row.date, 8, 0),
        updated_at: isoAt(row.date, 8, 5),
      })
      .onConflict('id')
      .merge(['contact_date', 'contact_medium', 'content', 'updated_at']);
  }
  return rows.length;
}

async function upsertLetter(
  clinicId: string,
  patient: PatientRow,
  episodeId: string,
  authorId: string,
  index: number,
): Promise<void> {
  const todayIso = new Date().toISOString().slice(0, 10);
  const letterDate = addDays(todayIso, -(20 + index * 3));
  const letterId = seedUuid(`${MARKER}:letter:${patient.id}`);
  await db('correspondence_letters')
    .insert({
      id: letterId,
      patient_id: patient.id,
      clinic_id: clinicId,
      episode_id: episodeId,
      author_id: authorId,
      recipient_name: 'Referring GP',
      recipient_email: `gp.${patient.id.slice(0, 8)}@demo.local`,
      letter_type: 'gp-update',
      subject: `${MARKER} Longitudinal care update`,
      content: `Longitudinal update for ${fullName(patient)} with symptom trajectory, risk posture, and next-step management plan.`,
      body: `Summary letter for ${fullName(patient)} covering recent appointments, medication plan, and multidisciplinary actions.`,
      status: 'sent',
      notes: `${MARKER} Seeded correspondence for letters/reports demonstration.`,
      sent_via: 'secure_email',
      created_at: isoAt(letterDate, 10, 0),
      sent_at: isoAt(letterDate, 10, 12),
      deleted_at: null,
      signature_data: null,
      signed_by_id: authorId,
      signed_at: isoAt(letterDate, 10, 10),
    })
    .onConflict('id')
    .merge(['content', 'body', 'status', 'notes', 'sent_at']);
}

async function run(): Promise<void> {
  const clinic = await resolveClinic();
  const actorId = seedUuid(`${MARKER}:seed-actor:${clinic.id}`);
  const summary = await runInClinicRlsContext(clinic.id, actorId, async () => {
    const patients = await resolveDemoPatients(clinic.id);
    const teams = await resolveTeams(clinic.id);
    const clinicians = await resolveClinicians(clinic.id);
    const coordinatorId = await resolveCoordinator(clinic.id);
    const teamMembership = await resolveTeamMembership(clinic.id);
    const legalOrderType = await resolveLegalOrderType(clinic.id);

    const cliniciansByTeam = new Map<string, ClinicianRow[]>();
    const clinicianById = new Map(clinicians.map((c) => [c.id, c]));
    for (const membership of teamMembership) {
      const clinician = clinicianById.get(membership.staff_id);
      if (!clinician) continue;
      const list = cliniciansByTeam.get(membership.org_unit_id) ?? [];
      list.push(clinician);
      cliniciansByTeam.set(membership.org_unit_id, list);
    }

    const prescribers = clinicians.filter((c) => Boolean(c.prescriber_number));
    const prescriberPool = prescribers.length > 0 ? prescribers : clinicians;

    let totalEpisodesTouched = 0;
    let totalAssignments = 0;
    let totalReferrals = 0;
    let totalLaiSchedules = 0;
    let totalLegalOrders = 0;
    let totalTasks = 0;
    let totalMessages = 0;
    let totalContacts = 0;
    let totalLetters = 0;

    for (const [index, patient] of patients.entries()) {
      const team = teams[index % teams.length]!;
      const teamClinicians = cliniciansByTeam.get(team.id) ?? [];
      const primaryClinician = (teamClinicians[index % Math.max(1, teamClinicians.length)] ?? clinicians[index % clinicians.length])!;
      const prescriber = prescriberPool[index % prescriberPool.length]!;

      const episode = await ensureOpenEpisode(clinic.id, patient.id, team.id, primaryClinician.id, index);
      totalEpisodesTouched += 1;

      await upsertTeamAssignment(patient.id, team.id, primaryClinician.id);
      totalAssignments += 1;

      if (teams.length > 1 && index % 4 === 0) {
        const additionalTeam = teams[(index + 1) % teams.length]!;
        const additionalClinicianList = cliniciansByTeam.get(additionalTeam.id) ?? clinicians;
        const additionalClinician = additionalClinicianList[(index + 1) % additionalClinicianList.length] ?? primaryClinician;
        await upsertTeamAssignment(patient.id, additionalTeam.id, additionalClinician.id);
        totalAssignments += 1;
      }

      totalReferrals += await upsertReferrals(
        clinic,
        patient,
        episode.id,
        primaryClinician.id,
        coordinatorId,
        index,
      );

      if (await upsertLaiSchedule(clinic.id, patient.id, episode.id, prescriber.id, index)) {
        totalLaiSchedules += 1;
      }

      if (await upsertLegalOrder(clinic.id, patient.id, coordinatorId, legalOrderType.id, index)) {
        totalLegalOrders += 1;
      }

      const taskMsg = await upsertTasksAndMessages(
        clinic.id,
        patient,
        episode.id,
        primaryClinician.id,
        coordinatorId,
        index,
      );
      totalTasks += taskMsg.tasks;
      totalMessages += taskMsg.messages;

      totalContacts += await upsertContacts(
        clinic.id,
        patient.id,
        episode.id,
        primaryClinician.id,
        team.name,
        index,
      );

      await upsertLetter(clinic.id, patient, episode.id, primaryClinician.id, index);
      totalLetters += 1;
    }

    return {
      patients: patients.length,
      openEpisodesTouched: totalEpisodesTouched,
      teamAssignments: totalAssignments,
      referrals: totalReferrals,
      laiSchedules: totalLaiSchedules,
      legalOrders: totalLegalOrders,
      tasks: totalTasks,
      messages: totalMessages,
      contacts: totalContacts,
      letters: totalLetters,
    };
  });

  const outputDir = path.resolve(__dirname, '..', '..', '..', 'docs', 'demo');
  const outputPath = path.join(outputDir, 'comprehensive-operational-demo-seed.md');
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    outputPath,
    [
      '# Comprehensive Operational Demo Seed',
      '',
      '> Deterministic demo-only operational data for dashboards, lists, and longitudinal care workflows.',
      '',
      `Generated at: ${new Date().toISOString()}`,
      `Clinic: ${clinic.name}`,
      `Marker: ${MARKER}`,
      `Patients processed: ${summary.patients}`,
      '',
      'Artifacts:',
      `- Open episodes touched: ${summary.openEpisodesTouched}`,
      `- Team assignments upserted: ${summary.teamAssignments}`,
      `- Referrals (mixed lifecycle stages): ${summary.referrals}`,
      `- Active LAI schedules seeded: ${summary.laiSchedules}`,
      `- Active legal orders seeded: ${summary.legalOrders}`,
      `- Tasks seeded: ${summary.tasks}`,
      `- Messages seeded: ${summary.messages}`,
      `- Contact records seeded: ${summary.contacts}`,
      `- Correspondence letters seeded: ${summary.letters}`,
    ].join('\n'),
    'utf8',
  );

  process.stdout.write(
    JSON.stringify(
      {
        clinic: clinic.name,
        marker: MARKER,
        ...summary,
        summaryDoc: outputPath,
      },
      null,
      2,
    ) + '\n',
  );
}

run()
  .catch((err) => {
    process.stderr.write(`Failed to seed comprehensive operational demo: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await dbAdmin.destroy();
    await appPoolRaw.destroy();
    clearPoolMonitor();
  });
