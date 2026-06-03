import 'dotenv/config';
import { createHash } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { appPoolRaw, clearPoolMonitor, dbAdmin } from '../src/db/db';
import { ensureClinicalNoteConsent } from '../src/shared/recordingConsent';

interface ClinicRow {
  id: string;
  name: string;
}

interface PatientRow {
  id: string;
  given_name: string;
  family_name: string;
  date_of_birth: string;
  emr_number?: string | null;
}

interface StaffRow {
  id: string;
  given_name: string;
  family_name: string;
  email: string;
  role: string;
  discipline?: string | null;
  discipline_name?: string | null;
  prescriber_number?: string | null;
}

interface TeamRow {
  id: string;
  name: string;
}

interface Roles {
  consultantPsychiatrist: StaffRow;
  juniorMedical: StaffRow;
  keyClinicians: StaffRow[];
  messageParticipants: StaffRow[];
}

const CLINIC_NAME = process.env.NOAH_DEMO_CLINIC_NAME ?? 'Soham Health';
const PATIENT_GIVEN_NAME = 'Noah';
const PATIENT_FAMILY_NAME = 'Bennett';
const DEMO_MARKER = '[Noah Demo]';
const DEMO_SOURCE_TYPE = 'demo_noah_seed';
const SPECIALTY_CODE = 'mental_health';

function seedUuid(seed: string): string {
  const hex = createHash('sha256').update(seed).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function isoAt(date: string, hourUtc = 2, minute = 0): string {
  const hh = String(hourUtc).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return new Date(`${date}T${hh}:${mm}:00.000Z`).toISOString();
}

function plusMinutes(isoTimestamp: string, minutes: number): string {
  const base = new Date(isoTimestamp).getTime();
  return new Date(base + minutes * 60_000).toISOString();
}

function addDays(dateIso: string, days: number): string {
  const base = new Date(`${dateIso}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

function compareIsoDates(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function formatClinicalReviewContent(input: {
  context: string;
  lifeEvents?: string[];
  symptoms: string[];
  mentalStateExam: string[];
  medications: string[];
  plan: string[];
}): string {
  const sections: string[] = [
    `${DEMO_MARKER} ${input.context}`,
  ];

  if ((input.lifeEvents ?? []).length > 0) {
    sections.push(
      '',
      'Life events / psychosocial context:',
      ...input.lifeEvents!.map((line) => `- ${line}`),
    );
  }

  sections.push(
    '',
    'Symptoms and functional update:',
    ...input.symptoms.map((line) => `- ${line}`),
    '',
    'Mental status examination (MSE):',
    ...input.mentalStateExam.map((line) => `- ${line}`),
    '',
    'Medication / prescribing update:',
    ...input.medications.map((line) => `- ${line}`),
    '',
    'Management plan:',
    ...input.plan.map((line) => `- ${line}`),
  );

  return sections.join('\n');
}

type MedicationStatus = 'active' | 'ceased';
interface MedicationTimelineEntry {
  seedId: string;
  episodeId: string;
  drugLabel: string;
  genericName: string;
  dose: string;
  doseUnit: string;
  route: string;
  frequency: string;
  indication: string;
  startDate: string;
  endDate: string | null;
  status: MedicationStatus;
  reasonForCessation?: string | null;
  isPrn?: boolean;
  notes: string;
}

interface PrescriptionTimelineEntry {
  seedId: string;
  episodeId: string;
  medicationSeedId: string;
  prescriberRole: 'consultant' | 'junior';
  genericName: string;
  brandName: string;
  dose: string;
  route: string;
  frequency: string;
  directions: string;
  quantity: number;
  repeats: number;
  prescriptionType: 'standard';
  status: 'active' | 'dispensed' | 'cancelled';
  prescribedDate: string;
  expiresAt: string;
  cancellationReason?: string;
  notes: string;
}

async function resolveClinic(): Promise<ClinicRow> {
  const clinic = (await dbAdmin('clinics')
    .where({ name: CLINIC_NAME, is_active: true })
    .whereNull('deleted_at')
    .first('id', 'name')) as ClinicRow | undefined;

  if (!clinic) {
    throw new Error(`Clinic "${CLINIC_NAME}" not found.`);
  }

  return clinic;
}

async function resolvePatient(clinicId: string): Promise<PatientRow> {
  const row = (await dbAdmin('patients')
    .where({ clinic_id: clinicId })
    .whereNull('deleted_at')
    .whereRaw('LOWER(given_name) = ?', [PATIENT_GIVEN_NAME.toLowerCase()])
    .whereRaw('LOWER(family_name) = ?', [PATIENT_FAMILY_NAME.toLowerCase()])
    .orderBy('updated_at', 'desc')
    .first('id', 'given_name', 'family_name', 'date_of_birth', 'emr_number')) as
    | PatientRow
    | undefined;

  if (!row) {
    throw new Error(
      `Patient "${PATIENT_GIVEN_NAME} ${PATIENT_FAMILY_NAME}" not found in ${CLINIC_NAME}. Run seed-demo-patient-registrations first.`,
    );
  }

  return row;
}

async function resolveTeams(clinicId: string): Promise<{ acisTeamId: string | null; communityTeamId: string | null }> {
  const rows = (await dbAdmin('org_units')
    .where({ clinic_id: clinicId, is_active: true })
    .select('id', 'name')
    .orderBy('sort_order', 'asc')) as TeamRow[];

  const acis = rows.find((r) => r.name.toLowerCase().includes('acis'))?.id ?? null;
  const community = rows.find((r) => r.name.toLowerCase().includes('cct'))?.id
    ?? rows.find((r) => r.name.toLowerCase().includes('community'))?.id
    ?? rows[0]?.id
    ?? null;

  return { acisTeamId: acis, communityTeamId: community };
}

async function backfillStaffDisciplineCache(clinicId: string): Promise<void> {
  await dbAdmin.raw(
    `
      UPDATE staff AS s
      SET discipline = d.name,
          updated_at = GREATEST(s.updated_at, now())
      FROM professional_disciplines AS d
      WHERE s.clinic_id = ?
        AND s.deleted_at IS NULL
        AND s.discipline IS NULL
        AND s.discipline_id IS NOT NULL
        AND d.clinic_id = s.clinic_id
        AND d.id::text = s.discipline_id::text
    `,
    [clinicId],
  );
}

async function resolveRoles(clinicId: string): Promise<Roles> {
  const staff = (await dbAdmin('staff as s')
    .leftJoin(
      'professional_disciplines as d',
      dbAdmin.raw('d.id::text = s.discipline_id and d.clinic_id = s.clinic_id'),
    )
    .where({ 's.clinic_id': clinicId, 's.is_active': true })
    .whereNull('s.deleted_at')
    .select(
      's.id',
      's.given_name',
      's.family_name',
      's.email',
      's.role',
      's.discipline',
      's.prescriber_number',
      'd.name as discipline_name',
    )
    .orderBy('s.email', 'asc')) as StaffRow[];

  const clinicianRows = staff.filter((s) => s.role === 'clinician');
  const psychiatryRows = clinicianRows.filter((s) =>
    (s.discipline_name ?? '').toLowerCase().includes('psychiatry'),
  );
  const prescriberPsychiatry = psychiatryRows.filter((s) => Boolean(s.prescriber_number));
  const nonPsychClinicians = clinicianRows.filter(
    (s) => !(s.discipline_name ?? '').toLowerCase().includes('psychiatry'),
  );
  const operationalLeads = staff.filter((s) => s.role === 'admin' || s.role === 'manager');

  const consultantPsychiatrist = prescriberPsychiatry[0] ?? psychiatryRows[0];
  const juniorMedical = prescriberPsychiatry[1] ?? psychiatryRows[1] ?? consultantPsychiatrist;
  const keyClinicians = nonPsychClinicians.slice(0, 3);

  if (!consultantPsychiatrist || !juniorMedical || keyClinicians.length === 0) {
    throw new Error(
      'Insufficient staff mix for Noah demo seed. Ensure Soham clinic has psychiatry + non-psychiatry clinicians seeded.',
    );
  }

  const participants = [
    consultantPsychiatrist,
    juniorMedical,
    ...keyClinicians,
    ...operationalLeads.slice(0, 2),
  ];
  const deduped = Array.from(new Map(participants.map((s) => [s.id, s])).values());

  return {
    consultantPsychiatrist,
    juniorMedical,
    keyClinicians,
    messageParticipants: deduped,
  };
}

async function ensureLegalOrderTypeId(): Promise<string> {
  const existing = await dbAdmin('legal_order_types')
    .where((qb) =>
      qb.whereRaw('LOWER(code) like ?', ['%cto%'])
        .orWhereRaw('LOWER(name) like ?', ['%community treatment order%']))
    .first('id');
  if (existing?.id) return String(existing.id);

  const id = seedUuid('noah-demo-legal-order-type-cto');
  const now = new Date().toISOString();
  await dbAdmin('legal_order_types')
    .insert({
      id,
      code: 'cto',
      name: 'Community Treatment Order',
      jurisdiction: 'VIC',
      max_duration_days: 180,
      requires_tribunal: true,
      is_active: true,
      created_at: now,
      updated_at: now,
    })
    .onConflict('id')
    .merge({
      code: 'cto',
      name: 'Community Treatment Order',
      jurisdiction: 'VIC',
      max_duration_days: 180,
      requires_tribunal: true,
      is_active: true,
      updated_at: now,
    });
  return id;
}

async function cleanupStaleRows(clinicId: string, patientId: string): Promise<void> {
  const demoThreads = await dbAdmin('message_threads')
    .where({ clinic_id: clinicId, patient_id: patientId })
    .whereILike('subject', `${DEMO_MARKER}%`)
    .select('id');
  const demoThreadIds = demoThreads.map((r) => String(r.id));
  if (demoThreadIds.length > 0) {
    await dbAdmin('message_thread_participants').whereIn('thread_id', demoThreadIds).del();
    await dbAdmin('messages').whereIn('thread_id', demoThreadIds).del();
    await dbAdmin('message_threads').whereIn('id', demoThreadIds).del();
  }

  const demoEscalations = await dbAdmin('escalations')
    .where({ clinic_id: clinicId, patient_id: patientId })
    .whereILike('title', `${DEMO_MARKER}%`)
    .select('id');
  const demoEscalationIds = demoEscalations.map((r) => String(r.id));
  if (demoEscalationIds.length > 0) {
    await dbAdmin('escalation_events').whereIn('escalation_id', demoEscalationIds).del();
    await dbAdmin('escalations').whereIn('id', demoEscalationIds).del();
  }

  await dbAdmin('structured_observations')
    .where({ clinic_id: clinicId, patient_id: patientId })
    .whereILike('notes', `%${DEMO_MARKER}%`)
    .del();
  await dbAdmin('clinical_reviews')
    .where({ clinic_id: clinicId, patient_id: patientId })
    .whereILike('summary', `%${DEMO_MARKER}%`)
    .del();
  await dbAdmin('correspondence_letters')
    .where({ clinic_id: clinicId, patient_id: patientId })
    .andWhere((qb) => qb.whereILike('subject', `${DEMO_MARKER}%`).orWhereILike('notes', `%${DEMO_MARKER}%`))
    .del();
  await dbAdmin('clinical_notes')
    .where({ clinic_id: clinicId, patient_id: patientId, source_type: DEMO_SOURCE_TYPE })
    .del();
  await dbAdmin('appointments')
    .where({ clinic_id: clinicId, patient_id: patientId })
    .whereILike('notes', `%${DEMO_MARKER}%`)
    .del();
  await dbAdmin('prescriptions')
    .where({ clinic_id: clinicId, patient_id: patientId })
    .whereILike('notes', `%${DEMO_MARKER}%`)
    .del();
  await dbAdmin('patient_medications')
    .where({ clinic_id: clinicId, patient_id: patientId })
    .whereILike('notes', `%${DEMO_MARKER}%`)
    .del();
  await dbAdmin('legal_orders')
    .where({ clinic_id: clinicId, patient_id: patientId })
    .whereILike('notes', `%${DEMO_MARKER}%`)
    .del();
  await dbAdmin('diagnoses')
    .where({ clinic_id: clinicId, patient_id: patientId })
    .whereILike('notes', `%${DEMO_MARKER}%`)
    .del();
  await dbAdmin('episodes')
    .where({ clinic_id: clinicId, patient_id: patientId })
    .whereILike('title', `${DEMO_MARKER}%`)
    .del();
}

async function seedNoahTimeline(): Promise<{ outputPath: string; reviewCount: number; appointmentCount: number; noteCount: number }> {
  const clinic = await resolveClinic();
  const patient = await resolvePatient(clinic.id);
  await backfillStaffDisciplineCache(clinic.id);
  const roles = await resolveRoles(clinic.id);
  const teams = await resolveTeams(clinic.id);
  const legalOrderTypeId = await ensureLegalOrderTypeId();
  const consentId = await ensureClinicalNoteConsent({
    clinicId: clinic.id,
    patientId: patient.id,
    clinicianId: roles.consultantPsychiatrist.id,
  });

  await cleanupStaleRows(clinic.id, patient.id);

  const nowIso = new Date().toISOString();
  const mainEpisodeId = seedUuid(`${clinic.id}:noah:episode:main`);
  const maniaEpisodeId = seedUuid(`${clinic.id}:noah:episode:mania-2022`);
  const depressionEpisodeId = seedUuid(`${clinic.id}:noah:episode:depression-2024`);

  const [keyClinicianA, keyClinicianB, keyClinicianC] = roles.keyClinicians;

  await dbAdmin('episodes')
    .insert([
      {
        id: mainEpisodeId,
        patient_id: patient.id,
        clinic_id: clinic.id,
        title: `${DEMO_MARKER} Community Continuing Care Episode`,
        episode_type: 'cct',
        status: 'open',
        presenting_problem: 'Longitudinal bipolar disorder management with relapse prevention focus.',
        primary_diagnosis: 'Bipolar affective disorder — manic and depressive episodes',
        start_date: '2021-06-10',
        team_id: teams.communityTeamId,
        primary_clinician_id: roles.consultantPsychiatrist.id,
        key_worker_id: keyClinicianA?.id ?? roles.juniorMedical.id,
        specialty_code: SPECIALTY_CODE,
        lock_version: 1,
        created_at: nowIso,
        updated_at: nowIso,
      },
      {
        id: maniaEpisodeId,
        patient_id: patient.id,
        clinic_id: clinic.id,
        title: `${DEMO_MARKER} Acute Manic Relapse (ACIS)`,
        episode_type: 'acis',
        status: 'closed',
        presenting_problem: 'Acute manic relapse with insomnia, disinhibition, and financial vulnerability.',
        primary_diagnosis: 'Bipolar affective disorder — current manic episode',
        start_date: '2022-02-20',
        end_date: '2022-06-20',
        closure_reason: 'stabilised',
        closure_summary: 'Stabilised after ACIS outreach, medication optimisation, and CTO period.',
        team_id: teams.acisTeamId ?? teams.communityTeamId,
        primary_clinician_id: roles.consultantPsychiatrist.id,
        key_worker_id: roles.juniorMedical.id,
        specialty_code: SPECIALTY_CODE,
        lock_version: 1,
        created_at: nowIso,
        updated_at: nowIso,
      },
      {
        id: depressionEpisodeId,
        patient_id: patient.id,
        clinic_id: clinic.id,
        title: `${DEMO_MARKER} Depressive Relapse Episode`,
        episode_type: 'cct',
        status: 'closed',
        presenting_problem: 'Moderate-severe depressive relapse with withdrawal and low motivation.',
        primary_diagnosis: 'Bipolar affective disorder — current depressive episode',
        start_date: '2024-08-12',
        end_date: '2024-11-30',
        closure_reason: 'stabilised',
        closure_summary: 'Mood improved with stepped supports, behavioural activation, and medication review.',
        team_id: teams.communityTeamId,
        primary_clinician_id: roles.consultantPsychiatrist.id,
        key_worker_id: keyClinicianB?.id ?? keyClinicianA?.id ?? roles.juniorMedical.id,
        specialty_code: SPECIALTY_CODE,
        lock_version: 1,
        created_at: nowIso,
        updated_at: nowIso,
      },
    ])
    .onConflict('id')
    .merge([
      'title',
      'episode_type',
      'status',
      'presenting_problem',
      'primary_diagnosis',
      'start_date',
      'end_date',
      'closure_reason',
      'closure_summary',
      'team_id',
      'primary_clinician_id',
      'key_worker_id',
      'updated_at',
    ]);

  await dbAdmin('diagnoses')
    .insert({
      id: seedUuid(`${clinic.id}:noah:diagnosis:bipolar`),
      clinic_id: clinic.id,
      patient_id: patient.id,
      episode_id: mainEpisodeId,
      created_by_id: roles.consultantPsychiatrist.id,
      icd_code: 'F31.6',
      description: 'Bipolar affective disorder with both manic and depressive episodes',
      diagnosed_date: '2021-06-10',
      status: 'active',
      is_primary: true,
      notes: `${DEMO_MARKER} Longitudinal diagnosis carried across relapse episodes.`,
      created_at: nowIso,
      updated_at: nowIso,
    })
    .onConflict('id')
    .merge([
      'description',
      'status',
      'is_primary',
      'notes',
      'updated_at',
    ]);

  const medicationTimeline: MedicationTimelineEntry[] = [
    {
      seedId: 'med-lithium-450',
      episodeId: mainEpisodeId,
      drugLabel: 'Lithium Carbonate',
      genericName: 'Lithium carbonate',
      dose: '450',
      doseUnit: 'mg',
      route: 'oral',
      frequency: 'BD',
      indication: 'Mood stabilisation for bipolar affective disorder',
      startDate: '2021-06-15',
      endDate: null,
      status: 'active',
      notes: `${DEMO_MARKER} Core long-term mood stabiliser.`,
    },
    {
      seedId: 'med-quetiapine-300',
      episodeId: mainEpisodeId,
      drugLabel: 'Quetiapine XR',
      genericName: 'Quetiapine',
      dose: '300',
      doseUnit: 'mg',
      route: 'oral',
      frequency: 'Nocte',
      indication: 'Sleep and mood support during early stabilisation',
      startDate: '2021-06-16',
      endDate: '2022-03-12',
      status: 'ceased',
      reasonForCessation: 'Insufficient control of escalating manic symptoms',
      notes: `${DEMO_MARKER} Ceased during manic escalation treatment transition.`,
    },
    {
      seedId: 'med-valproate-500',
      episodeId: maniaEpisodeId,
      drugLabel: 'Sodium Valproate',
      genericName: 'Sodium valproate',
      dose: '500',
      doseUnit: 'mg',
      route: 'oral',
      frequency: 'BD',
      indication: 'Adjunct mood stabilisation for acute mania',
      startDate: '2022-03-10',
      endDate: '2024-09-05',
      status: 'ceased',
      reasonForCessation: 'Tremor and weight gain; transitioned to lamotrigine regimen',
      notes: `${DEMO_MARKER} Introduced in ACIS phase and later stepped down.`,
    },
    {
      seedId: 'med-olanzapine-10',
      episodeId: maniaEpisodeId,
      drugLabel: 'Olanzapine',
      genericName: 'Olanzapine',
      dose: '10',
      doseUnit: 'mg',
      route: 'oral',
      frequency: 'Nocte',
      indication: 'Acute manic symptom containment',
      startDate: '2022-03-15',
      endDate: '2022-07-10',
      status: 'ceased',
      reasonForCessation: 'Sedation and metabolic side-effect risk after stabilisation',
      notes: `${DEMO_MARKER} Short-course antipsychotic during acute phase.`,
    },
    {
      seedId: 'med-diazepam-5-prn',
      episodeId: maniaEpisodeId,
      drugLabel: 'Diazepam',
      genericName: 'Diazepam',
      dose: '5',
      doseUnit: 'mg',
      route: 'oral',
      frequency: 'TDS PRN',
      indication: 'Short-term agitation and severe insomnia support',
      startDate: '2022-03-15',
      endDate: '2022-04-30',
      status: 'ceased',
      reasonForCessation: 'Acute agitation resolved',
      isPrn: true,
      notes: `${DEMO_MARKER} Time-limited PRN during ACIS escalation.`,
    },
    {
      seedId: 'med-metformin-500',
      episodeId: mainEpisodeId,
      drugLabel: 'Metformin',
      genericName: 'Metformin',
      dose: '500',
      doseUnit: 'mg',
      route: 'oral',
      frequency: 'BD',
      indication: 'Metabolic risk management related to psychotropics',
      startDate: '2023-09-06',
      endDate: null,
      status: 'active',
      notes: `${DEMO_MARKER} Added after metabolic review.`,
    },
    {
      seedId: 'med-lurasidone-40',
      episodeId: depressionEpisodeId,
      drugLabel: 'Lurasidone',
      genericName: 'Lurasidone hydrochloride',
      dose: '40',
      doseUnit: 'mg',
      route: 'oral',
      frequency: 'Nocte with food',
      indication: 'Bipolar depression treatment',
      startDate: '2024-09-01',
      endDate: null,
      status: 'active',
      notes: `${DEMO_MARKER} Introduced during depressive relapse.`,
    },
    {
      seedId: 'med-lamotrigine-100',
      episodeId: depressionEpisodeId,
      drugLabel: 'Lamotrigine',
      genericName: 'Lamotrigine',
      dose: '100',
      doseUnit: 'mg',
      route: 'oral',
      frequency: 'Mane',
      indication: 'Bipolar depression maintenance augmentation',
      startDate: '2024-09-10',
      endDate: null,
      status: 'active',
      notes: `${DEMO_MARKER} Titrated after valproate step-down.`,
    },
    {
      seedId: 'med-melatonin-2',
      episodeId: mainEpisodeId,
      drugLabel: 'Melatonin MR',
      genericName: 'Melatonin',
      dose: '2',
      doseUnit: 'mg',
      route: 'oral',
      frequency: 'Nocte PRN',
      indication: 'Circadian rhythm support and relapse prevention',
      startDate: '2025-08-18',
      endDate: null,
      status: 'active',
      isPrn: true,
      notes: `${DEMO_MARKER} Added after sleep destabilisation and DNA period.`,
    },
  ];

  const medicationIdByKey = new Map<string, string>();
  for (const medication of medicationTimeline) {
    const medicationId = seedUuid(`${clinic.id}:noah:medication:${medication.seedId}`);
    medicationIdByKey.set(medication.seedId, medicationId);
    await dbAdmin('patient_medications')
      .insert({
        id: medicationId,
        clinic_id: clinic.id,
        patient_id: patient.id,
        episode_id: medication.episodeId,
        drug_label: medication.drugLabel,
        generic_name: medication.genericName,
        dose: medication.dose,
        dose_unit: medication.doseUnit,
        route: medication.route,
        frequency: medication.frequency,
        indication: medication.indication,
        start_date: medication.startDate,
        end_date: medication.endDate,
        status: medication.status,
        reason_for_cessation: medication.reasonForCessation ?? null,
        is_regular: !medication.isPrn,
        is_prn: Boolean(medication.isPrn),
        is_lai: false,
        source: 'manual',
        prescribed_by_staff_id: roles.consultantPsychiatrist.id,
        recorded_by_staff_id: roles.juniorMedical.id,
        prescribed_by_specialty_code: SPECIALTY_CODE,
        notes: medication.notes,
        lock_version: 1,
        created_at: isoAt(medication.startDate, 2, 0),
        updated_at: isoAt(medication.endDate ?? medication.startDate, 2, 5),
      })
      .onConflict('id')
      .merge([
        'episode_id',
        'drug_label',
        'generic_name',
        'dose',
        'dose_unit',
        'route',
        'frequency',
        'indication',
        'start_date',
        'end_date',
        'status',
        'reason_for_cessation',
        'is_regular',
        'is_prn',
        'notes',
        'updated_at',
      ]);
  }

  const prescriptionTimeline: PrescriptionTimelineEntry[] = [
    {
      seedId: 'rx-2021-lithium-init',
      episodeId: mainEpisodeId,
      medicationSeedId: 'med-lithium-450',
      prescriberRole: 'consultant',
      genericName: 'Lithium carbonate',
      brandName: 'Lithicarb',
      dose: '450mg',
      route: 'oral',
      frequency: 'BD',
      directions: 'Take 450mg twice daily with fluid. Monitor serum lithium and renal/thyroid profile.',
      quantity: 60,
      repeats: 5,
      prescriptionType: 'standard',
      status: 'dispensed',
      prescribedDate: '2021-06-15',
      expiresAt: '2022-06-15',
      notes: `${DEMO_MARKER} Initiation prescription during first community intake.`,
    },
    {
      seedId: 'rx-2021-quetiapine-init',
      episodeId: mainEpisodeId,
      medicationSeedId: 'med-quetiapine-300',
      prescriberRole: 'junior',
      genericName: 'Quetiapine',
      brandName: 'Seroquel XR',
      dose: '300mg',
      route: 'oral',
      frequency: 'Nocte',
      directions: 'Take 300mg nightly for sleep and mood stabilisation.',
      quantity: 30,
      repeats: 3,
      prescriptionType: 'standard',
      status: 'cancelled',
      prescribedDate: '2021-06-16',
      expiresAt: '2022-06-16',
      cancellationReason: 'Superseded by acute-phase medication optimisation in 2022 manic relapse.',
      notes: `${DEMO_MARKER} Ceased when acute manic escalation occurred.`,
    },
    {
      seedId: 'rx-2022-valproate-init',
      episodeId: maniaEpisodeId,
      medicationSeedId: 'med-valproate-500',
      prescriberRole: 'consultant',
      genericName: 'Sodium valproate',
      brandName: 'Epilim',
      dose: '500mg',
      route: 'oral',
      frequency: 'BD',
      directions: 'Take 500mg twice daily; monitor LFTs and tremor profile.',
      quantity: 60,
      repeats: 5,
      prescriptionType: 'standard',
      status: 'dispensed',
      prescribedDate: '2022-03-10',
      expiresAt: '2023-03-10',
      notes: `${DEMO_MARKER} Added during ACIS escalation.`,
    },
    {
      seedId: 'rx-2022-olanzapine-init',
      episodeId: maniaEpisodeId,
      medicationSeedId: 'med-olanzapine-10',
      prescriberRole: 'consultant',
      genericName: 'Olanzapine',
      brandName: 'Zyprexa',
      dose: '10mg',
      route: 'oral',
      frequency: 'Nocte',
      directions: 'Take 10mg nightly during acute manic phase.',
      quantity: 30,
      repeats: 2,
      prescriptionType: 'standard',
      status: 'cancelled',
      prescribedDate: '2022-03-15',
      expiresAt: '2023-03-15',
      cancellationReason: 'Sedation and metabolic burden after manic symptoms stabilised.',
      notes: `${DEMO_MARKER} Short-course antipsychotic ceased post-stabilisation.`,
    },
    {
      seedId: 'rx-2022-diazepam-prn',
      episodeId: maniaEpisodeId,
      medicationSeedId: 'med-diazepam-5-prn',
      prescriberRole: 'junior',
      genericName: 'Diazepam',
      brandName: 'Valium',
      dose: '5mg',
      route: 'oral',
      frequency: 'TDS PRN',
      directions: 'Use up to TDS PRN for severe agitation/insomnia for short-term crisis period only.',
      quantity: 20,
      repeats: 0,
      prescriptionType: 'standard',
      status: 'cancelled',
      prescribedDate: '2022-03-15',
      expiresAt: '2022-09-15',
      cancellationReason: 'No longer clinically indicated after ACIS de-escalation.',
      notes: `${DEMO_MARKER} PRN sedation strategy during acute phase only.`,
    },
    {
      seedId: 'rx-2023-metformin-init',
      episodeId: mainEpisodeId,
      medicationSeedId: 'med-metformin-500',
      prescriberRole: 'junior',
      genericName: 'Metformin',
      brandName: 'Diabex',
      dose: '500mg',
      route: 'oral',
      frequency: 'BD',
      directions: 'Take 500mg twice daily with meals for metabolic risk mitigation.',
      quantity: 60,
      repeats: 5,
      prescriptionType: 'standard',
      status: 'dispensed',
      prescribedDate: '2023-09-06',
      expiresAt: '2024-09-06',
      notes: `${DEMO_MARKER} Added following antipsychotic/metabolic review.`,
    },
    {
      seedId: 'rx-2024-lurasidone-init',
      episodeId: depressionEpisodeId,
      medicationSeedId: 'med-lurasidone-40',
      prescriberRole: 'consultant',
      genericName: 'Lurasidone hydrochloride',
      brandName: 'Latuda',
      dose: '40mg',
      route: 'oral',
      frequency: 'Nocte with food',
      directions: 'Take with evening meal; monitor mood trajectory and akathisia.',
      quantity: 30,
      repeats: 5,
      prescriptionType: 'standard',
      status: 'dispensed',
      prescribedDate: '2024-09-01',
      expiresAt: '2025-09-01',
      notes: `${DEMO_MARKER} Added for bipolar depressive relapse.`,
    },
    {
      seedId: 'rx-2024-lamotrigine-titration',
      episodeId: depressionEpisodeId,
      medicationSeedId: 'med-lamotrigine-100',
      prescriberRole: 'consultant',
      genericName: 'Lamotrigine',
      brandName: 'Lamictal',
      dose: '100mg',
      route: 'oral',
      frequency: 'Mane',
      directions: 'Titrated to 100mg daily with rash-monitoring education.',
      quantity: 30,
      repeats: 5,
      prescriptionType: 'standard',
      status: 'dispensed',
      prescribedDate: '2024-09-10',
      expiresAt: '2025-09-10',
      notes: `${DEMO_MARKER} Added as valproate was stepped down.`,
    },
    {
      seedId: 'rx-2024-valproate-stop',
      episodeId: depressionEpisodeId,
      medicationSeedId: 'med-valproate-500',
      prescriberRole: 'consultant',
      genericName: 'Sodium valproate',
      brandName: 'Epilim',
      dose: '500mg',
      route: 'oral',
      frequency: 'BD',
      directions: 'Ceased under consultant direction.',
      quantity: 0,
      repeats: 0,
      prescriptionType: 'standard',
      status: 'cancelled',
      prescribedDate: '2024-09-05',
      expiresAt: '2025-09-05',
      cancellationReason: 'Tremor and weight gain; replaced with lamotrigine strategy.',
      notes: `${DEMO_MARKER} Cancellation reflects deliberate treatment transition.`,
    },
    {
      seedId: 'rx-2025-melatonin-init',
      episodeId: mainEpisodeId,
      medicationSeedId: 'med-melatonin-2',
      prescriberRole: 'junior',
      genericName: 'Melatonin',
      brandName: 'Circadin',
      dose: '2mg',
      route: 'oral',
      frequency: 'Nocte PRN',
      directions: 'Take nocte PRN to re-establish circadian rhythm during stress periods.',
      quantity: 30,
      repeats: 3,
      prescriptionType: 'standard',
      status: 'dispensed',
      prescribedDate: '2025-08-18',
      expiresAt: '2026-08-18',
      notes: `${DEMO_MARKER} Added after DNA and sleep destabilisation period.`,
    },
    {
      seedId: 'rx-2026-lithium-renewal',
      episodeId: mainEpisodeId,
      medicationSeedId: 'med-lithium-450',
      prescriberRole: 'consultant',
      genericName: 'Lithium carbonate',
      brandName: 'Lithicarb',
      dose: '450mg',
      route: 'oral',
      frequency: 'BD',
      directions: 'Continue 450mg BD; maintain quarterly lithium level and renal/thyroid surveillance.',
      quantity: 60,
      repeats: 5,
      prescriptionType: 'standard',
      status: 'active',
      prescribedDate: '2026-02-03',
      expiresAt: '2027-02-03',
      notes: `${DEMO_MARKER} Current active maintenance prescription.`,
    },
    {
      seedId: 'rx-2026-lamotrigine-renewal',
      episodeId: mainEpisodeId,
      medicationSeedId: 'med-lamotrigine-100',
      prescriberRole: 'consultant',
      genericName: 'Lamotrigine',
      brandName: 'Lamictal',
      dose: '100mg',
      route: 'oral',
      frequency: 'Mane',
      directions: 'Continue 100mg mane for bipolar depression relapse prevention.',
      quantity: 30,
      repeats: 5,
      prescriptionType: 'standard',
      status: 'active',
      prescribedDate: '2026-02-03',
      expiresAt: '2027-02-03',
      notes: `${DEMO_MARKER} Current active maintenance prescription.`,
    },
  ];

  const prescriberByRole: Record<'consultant' | 'junior', string> = {
    consultant: roles.consultantPsychiatrist.id,
    junior: roles.juniorMedical.id,
  };

  for (const rx of prescriptionTimeline) {
    const prescriptionId = seedUuid(`${clinic.id}:noah:prescription:${rx.seedId}`);
    const medicationId = medicationIdByKey.get(rx.medicationSeedId);
    if (!medicationId) {
      throw new Error(`Missing medication id for prescription seed seedId: ${rx.seedId}`);
    }
    const prescribedAt = isoAt(rx.prescribedDate, 2, 30);
    const isCancelled = rx.status === 'cancelled';
    await dbAdmin('prescriptions')
      .insert({
        id: prescriptionId,
        clinic_id: clinic.id,
        patient_id: patient.id,
        episode_id: rx.episodeId,
        prescribed_by_staff_id: prescriberByRole[rx.prescriberRole],
        patient_medication_id: medicationId,
        generic_name: rx.genericName,
        brand_name: rx.brandName,
        dose: rx.dose,
        route: rx.route,
        frequency: rx.frequency,
        directions: rx.directions,
        quantity: rx.quantity,
        repeats: rx.repeats,
        is_s8: rx.genericName.toLowerCase().includes('diazepam'),
        prescription_type: rx.prescriptionType,
        status: rx.status,
        is_electronic: true,
        prescribed_date: rx.prescribedDate,
        expires_at: rx.expiresAt,
        cancellation_reason: isCancelled ? (rx.cancellationReason ?? 'Superseded by reviewed treatment plan.') : null,
        cancelled_at: isCancelled ? prescribedAt : null,
        cancelled_by_staff_id: isCancelled ? prescriberByRole[rx.prescriberRole] : null,
        notes: rx.notes,
        created_at: prescribedAt,
        updated_at: prescribedAt,
      })
      .onConflict('id')
      .merge([
        'episode_id',
        'patient_medication_id',
        'generic_name',
        'brand_name',
        'dose',
        'route',
        'frequency',
        'directions',
        'quantity',
        'repeats',
        'status',
        'prescribed_date',
        'expires_at',
        'cancellation_reason',
        'cancelled_at',
        'cancelled_by_staff_id',
        'notes',
        'updated_at',
      ]);
  }

  const activeMedicationSnapshotForDate = (date: string): string[] =>
    medicationTimeline
      .filter((medication) => compareIsoDates(medication.startDate, date) <= 0)
      .filter((medication) => !medication.endDate || compareIsoDates(medication.endDate, date) >= 0)
      .map((medication) => `${medication.drugLabel} ${medication.dose}${medication.doseUnit} ${medication.frequency}`);

  const medicationChangesForPeriod = (startDate: string, endDate: string): string[] => {
    const changes: string[] = [];
    for (const medication of medicationTimeline) {
      if (compareIsoDates(medication.startDate, startDate) >= 0 && compareIsoDates(medication.startDate, endDate) <= 0) {
        changes.push(`Started ${medication.drugLabel} ${medication.dose}${medication.doseUnit} (${medication.frequency}) on ${medication.startDate}.`);
      }
      if (medication.endDate && compareIsoDates(medication.endDate, startDate) >= 0 && compareIsoDates(medication.endDate, endDate) <= 0) {
        changes.push(
          `Ceased ${medication.drugLabel} on ${medication.endDate}${medication.reasonForCessation ? ` (${medication.reasonForCessation})` : ''}.`,
        );
      }
    }
    return changes;
  };

  const appointmentRows = [
    { seedId: 'a-2021-06-15', date: '2021-06-15', hourUtc: 1, clinicianId: keyClinicianA?.id ?? roles.juniorMedical.id, episodeId: mainEpisodeId, status: 'completed', type: 'initial', notes: `${DEMO_MARKER} Initial continuing-care intake appointment.` },
    { seedId: 'a-2021-07-06', date: '2021-07-06', hourUtc: 1, clinicianId: roles.juniorMedical.id, episodeId: mainEpisodeId, status: 'completed', type: 'follow_up', notes: `${DEMO_MARKER} Early medication titration review.` },
    { seedId: 'a-2021-07-27', date: '2021-07-27', hourUtc: 1, clinicianId: roles.juniorMedical.id, episodeId: mainEpisodeId, status: 'no_show', type: 'follow_up', notes: `${DEMO_MARKER} Missed appointment during housing transition.` },
    { seedId: 'a-2022-03-01', date: '2022-03-01', hourUtc: 0, clinicianId: keyClinicianA?.id ?? roles.juniorMedical.id, episodeId: maniaEpisodeId, status: 'completed', type: 'assessment', notes: `${DEMO_MARKER} Weekly ACIS review week 1.` },
    { seedId: 'a-2022-03-08', date: '2022-03-08', hourUtc: 0, clinicianId: roles.juniorMedical.id, episodeId: maniaEpisodeId, status: 'completed', type: 'follow_up', notes: `${DEMO_MARKER} Weekly ACIS review week 2.` },
    { seedId: 'a-2022-03-15', date: '2022-03-15', hourUtc: 0, clinicianId: roles.consultantPsychiatrist.id, episodeId: maniaEpisodeId, status: 'completed', type: 'clinical_review', notes: `${DEMO_MARKER} Weekly ACIS review week 3.` },
    { seedId: 'a-2022-03-22', date: '2022-03-22', hourUtc: 0, clinicianId: keyClinicianB?.id ?? keyClinicianA?.id ?? roles.juniorMedical.id, episodeId: maniaEpisodeId, status: 'completed', type: 'follow_up', notes: `${DEMO_MARKER} Weekly ACIS review week 4.` },
    { seedId: 'a-2022-03-29', date: '2022-03-29', hourUtc: 0, clinicianId: roles.consultantPsychiatrist.id, episodeId: maniaEpisodeId, status: 'completed', type: 'clinical_review', notes: `${DEMO_MARKER} Weekly ACIS review week 5.` },
    { seedId: 'a-2023-02-10', date: '2023-02-10', hourUtc: 2, clinicianId: keyClinicianA?.id ?? roles.juniorMedical.id, episodeId: mainEpisodeId, status: 'completed', type: 'follow_up', notes: `${DEMO_MARKER} Return-to-work support follow-up.` },
    { seedId: 'a-2023-09-05', date: '2023-09-05', hourUtc: 2, clinicianId: roles.consultantPsychiatrist.id, episodeId: mainEpisodeId, status: 'completed', type: 'clinical_review', notes: `${DEMO_MARKER} Consultant review — maintenance phase.` },
    { seedId: 'a-2024-08-19', date: '2024-08-19', hourUtc: 1, clinicianId: keyClinicianB?.id ?? roles.juniorMedical.id, episodeId: depressionEpisodeId, status: 'completed', type: 'assessment', notes: `${DEMO_MARKER} Depressive relapse intake.` },
    { seedId: 'a-2024-08-26', date: '2024-08-26', hourUtc: 1, clinicianId: roles.juniorMedical.id, episodeId: depressionEpisodeId, status: 'completed', type: 'follow_up', notes: `${DEMO_MARKER} Weekly review — week 2 depressive relapse.` },
    { seedId: 'a-2024-09-02', date: '2024-09-02', hourUtc: 1, clinicianId: roles.consultantPsychiatrist.id, episodeId: depressionEpisodeId, status: 'completed', type: 'clinical_review', notes: `${DEMO_MARKER} Weekly review — week 3 depressive relapse.` },
    { seedId: 'a-2024-09-09', date: '2024-09-09', hourUtc: 1, clinicianId: keyClinicianC?.id ?? keyClinicianA?.id ?? roles.juniorMedical.id, episodeId: depressionEpisodeId, status: 'completed', type: 'follow_up', notes: `${DEMO_MARKER} Weekly review — week 4 depressive relapse.` },
    { seedId: 'a-2024-09-16', date: '2024-09-16', hourUtc: 1, clinicianId: roles.consultantPsychiatrist.id, episodeId: depressionEpisodeId, status: 'completed', type: 'clinical_review', notes: `${DEMO_MARKER} Weekly review — week 5 depressive relapse.` },
    { seedId: 'a-2025-01-20', date: '2025-01-20', hourUtc: 2, clinicianId: keyClinicianA?.id ?? roles.juniorMedical.id, episodeId: mainEpisodeId, status: 'completed', type: 'follow_up', notes: `${DEMO_MARKER} Recovery consolidation review.` },
    { seedId: 'a-2025-08-11', date: '2025-08-11', hourUtc: 2, clinicianId: roles.juniorMedical.id, episodeId: mainEpisodeId, status: 'no_show', type: 'follow_up', notes: `${DEMO_MARKER} Missed appointment during family stress period.` },
    { seedId: 'a-2025-08-18', date: '2025-08-18', hourUtc: 2, clinicianId: keyClinicianB?.id ?? keyClinicianA?.id ?? roles.juniorMedical.id, episodeId: mainEpisodeId, status: 'completed', type: 'follow_up', notes: `${DEMO_MARKER} Engagement re-established after DNA.` },
    { seedId: 'a-2026-02-03', date: '2026-02-03', hourUtc: 2, clinicianId: roles.consultantPsychiatrist.id, episodeId: mainEpisodeId, status: 'completed', type: 'clinical_review', notes: `${DEMO_MARKER} Annual consultant-led treatment planning review.` },
  ];

  for (const appointment of appointmentRows) {
    const start = isoAt(appointment.date, appointment.hourUtc, 0);
    const end = plusMinutes(start, 50);
    await dbAdmin('appointments')
      .insert({
        id: seedUuid(`${clinic.id}:noah:appointment:${appointment.seedId}`),
        clinic_id: clinic.id,
        patient_id: patient.id,
        clinician_id: appointment.clinicianId,
        staff_id: appointment.clinicianId,
        episode_id: appointment.episodeId,
        start_time: start,
        end_time: end,
        appointment_start: start,
        appointment_end: end,
        duration_minutes: 50,
        status: appointment.status,
        type: appointment.type,
        notes: appointment.notes,
        reminder_scheduled: true,
        reminder_sent: appointment.status !== 'no_show',
        reminder_sent_at: appointment.status !== 'no_show' ? plusMinutes(start, -60) : null,
        specialty_code: SPECIALTY_CODE,
        created_at: start,
        updated_at: start,
      })
      .onConflict('id')
      .merge([
        'status',
        'type',
        'notes',
        'start_time',
        'end_time',
        'appointment_start',
        'appointment_end',
        'duration_minutes',
        'updated_at',
      ]);
  }

  const noteTemplates = [
    {
      seedId: 'n-2021-intake',
      date: '2021-06-15',
      hourUtc: 3,
      episodeId: mainEpisodeId,
      authorId: keyClinicianA?.id ?? roles.juniorMedical.id,
      noteType: 'intake',
      noteCategory: 'assessment',
      title: 'Initial psychosocial assessment',
      content: formatClinicalReviewContent({
        context: 'Initial intake completed with full biopsychosocial formulation and bipolar relapse signature mapping.',
        lifeEvents: [
          'Recent employment disruption and relocation increased stress load.',
          'Family remains supportive but reports uncertainty around early warning signs.',
        ],
        symptoms: [
          'History of alternating periods of elevated mood and prolonged low mood.',
          'Current sleep instability with delayed sleep onset and early waking.',
          'Intermittent anxiety about finances and housing security.',
        ],
        mentalStateExam: [
          'Appearance neat; rapport cooperative and reflective.',
          'Speech normal rate/volume; thought form coherent and goal directed.',
          'Mood described as "up and down"; affect mildly labile but congruent.',
          'No psychotic symptoms observed; no active suicidal intent or plan.',
          'Insight fair; motivated to engage in relapse prevention.',
        ],
        medications: [
          'Lithium carbonate 450mg BD initiated as foundational mood stabiliser.',
          'Quetiapine XR 300mg nocte started for sleep and mood support.',
          'Education provided on adherence, side effects, and serum monitoring.',
        ],
        plan: [
          'Weekly key-clinician follow-up for first month with shared warning-sign tracker.',
          'Baseline physical health checks + pathology (FBC, U&E, TFT, fasting lipids/glucose).',
          'Family-inclusive safety plan completed with crisis pathways documented.',
        ],
      }),
      contactMeta: { team: 'CCT', contactMedium: 'Face-to-face', durationMin: 70, planType: 'initial_assessment' },
    },
    {
      seedId: 'n-2021-message-1',
      date: '2021-07-05',
      hourUtc: 3,
      episodeId: mainEpisodeId,
      authorId: keyClinicianA?.id ?? roles.juniorMedical.id,
      noteType: 'message',
      noteCategory: 'correspondence',
      title: 'Patient message — sleep hygiene reminder',
      content:
        `${DEMO_MARKER} SMS reminder sent reinforcing bedtime routine, caffeine reduction, and early warning signs to contact team.`,
      isReportableContact: false,
      contactMeta: null,
    },
    {
      seedId: 'n-2022-week-1',
      date: '2022-03-01',
      hourUtc: 3,
      episodeId: maniaEpisodeId,
      authorId: keyClinicianA?.id ?? roles.juniorMedical.id,
      noteType: 'progress',
      noteCategory: 'weekly-review',
      title: 'Weekly review 1 (ACIS): manic escalation',
      content: formatClinicalReviewContent({
        context: 'ACIS week 1 review captured clear manic escalation requiring intensive outreach.',
        lifeEvents: [
          'Family reported sudden increase in impulsive spending and interpersonal conflict.',
          'Patient missed routine follow-up the previous week and disengaged from phone check-ins.',
        ],
        symptoms: [
          'Sleep reduced to under 3 hours/night with no daytime fatigue.',
          'Pressured speech, grandiose future plans, and increased goal-directed activity.',
          'Marked behavioural disinhibition with financial vulnerability.',
        ],
        mentalStateExam: [
          'Appearance animated and overfamiliar; psychomotor activity increased.',
          'Speech pressured and difficult to interrupt.',
          'Mood elevated/irritable; affect expansive and labile.',
          'Thought content grandiose; no fixed persecutory delusions disclosed.',
          'Insight significantly reduced into illness-related change.',
        ],
        medications: [
          'Valproate 500mg BD commenced to augment mood stabilisation.',
          'Lithium continued; urgent serum lithium level arranged.',
          'PRN diazepam discussed for short-term agitation/sleep restoration.',
        ],
        plan: [
          'Activate daily ACIS home/outreach contacts with carer collateral.',
          'Escalation pathway opened for consultant review within 24 hours.',
          'Financial harm-reduction measures initiated with family support.',
        ],
      }),
      contactMeta: { team: 'ACIS', contactMedium: 'Face-to-face', durationMin: 60, planType: 'weekly_review' },
    },
    {
      seedId: 'n-2022-week-2',
      date: '2022-03-08',
      hourUtc: 3,
      episodeId: maniaEpisodeId,
      authorId: roles.juniorMedical.id,
      noteType: 'review',
      noteCategory: 'weekly-review',
      title: 'Weekly review 2 (JMO): medication response check',
      content: formatClinicalReviewContent({
        context: 'JMO week 2 review focused on early medication response and evening agitation control.',
        symptoms: [
          'Sleep modestly improved but still fragmented (around 4 hours).',
          'Evening agitation and irritability persist with verbal conflict at home.',
          'No self-harm behaviour or active suicidal intent reported.',
        ],
        mentalStateExam: [
          'Psychomotor activity still elevated though less disorganised than week 1.',
          'Speech remains increased in rate but more redirectable.',
          'Thought form tangential at times; no command hallucinations elicited.',
          'Judgement partially impaired in relation to spending decisions.',
        ],
        medications: [
          'Valproate up-titration tolerated; no acute adverse effects.',
          'Diazepam PRN used sparingly for severe evening agitation.',
          'Lithium level pending; adherence supported through carer-supervised dosing.',
        ],
        plan: [
          'Continue daily ACIS monitoring and medication supervision.',
          'Maintain low-stimulation home environment and sleep-protection plan.',
          'Consultant review to determine legal framework and longer-term containment.',
        ],
      }),
      contactMeta: { team: 'ACIS', contactMedium: 'Face-to-face', durationMin: 50, planType: 'weekly_review' },
    },
    {
      seedId: 'n-2022-week-3',
      date: '2022-03-15',
      hourUtc: 3,
      episodeId: maniaEpisodeId,
      authorId: roles.consultantPsychiatrist.id,
      noteType: 'clinical_review',
      noteCategory: 'weekly-review',
      title: 'Weekly review 3 (Consultant): CTO initiated',
      content: formatClinicalReviewContent({
        context: 'Consultant week 3 review determined need for CTO due sustained impaired insight and harm risk.',
        symptoms: [
          'Continued expansive mood, reduced insight, and ongoing risky financial decisions.',
          'Partial reduction in behavioural intensity but persistent treatment ambivalence.',
          'Family burden remains high; conflict episodes occurring most evenings.',
        ],
        mentalStateExam: [
          'Overfamiliar interaction style with intermittent irritability when challenged.',
          'Thought content grandiose, with minimisation of consequences.',
          'No frank hallucinations observed; risk remains primarily behavioural and functional.',
          'Capacity for treatment decision-making fluctuating during interview.',
        ],
        medications: [
          'Olanzapine 10mg nocte commenced for acute manic containment.',
          'Lithium and valproate continued with close side-effect and pathology monitoring.',
          'PRN diazepam retained for short-term containment only.',
        ],
        plan: [
          'Community Treatment Order commenced to support adherence and reduce foreseeable harm.',
          'Continue ACIS daily contact with shared risk threshold for emergency transfer.',
          'Review CTO conditions with patient/family and provide rights information.',
        ],
      }),
      contactMeta: { team: 'ACIS', contactMedium: 'Case conference', durationMin: 55, planType: 'weekly_review' },
    },
    {
      seedId: 'n-2022-week-4',
      date: '2022-03-22',
      hourUtc: 3,
      episodeId: maniaEpisodeId,
      authorId: keyClinicianB?.id ?? keyClinicianA?.id ?? roles.juniorMedical.id,
      noteType: 'progress',
      noteCategory: 'weekly-review',
      title: 'Weekly review 4 (Key clinician): functional recovery focus',
      content: formatClinicalReviewContent({
        context: 'Key clinician week 4 review documented early functional recovery and carer planning.',
        symptoms: [
          'Sleep extended to 5-6 hours/night with reduced night-time pacing.',
          'Irritability episodes reduced in frequency; improved day structure tolerance.',
          'Residual impulsive spending urges but improved ability to delay decisions.',
        ],
        mentalStateExam: [
          'Speech less pressured; thought form increasingly linear.',
          'Affect brighter but less labile; mood still elevated above baseline.',
          'Insight partially improving with acknowledgement of recent consequences.',
        ],
        medications: [
          'Current regimen tolerated with mild daytime sedation only.',
          'No extrapyramidal features or acute safety concerns identified.',
          'Medication chart reviewed with patient and carer.',
        ],
        plan: [
          'Begin graded routine (sleep anchors, spending limits, daily activity schedule).',
          'Maintain ACIS support with progressive step-down if stability holds.',
          'Carer respite and family support services linked to reduce burden.',
        ],
      }),
      contactMeta: { team: 'ACIS', contactMedium: 'Home visit', durationMin: 65, planType: 'weekly_review' },
    },
    {
      seedId: 'n-2022-week-5',
      date: '2022-03-29',
      hourUtc: 3,
      episodeId: maniaEpisodeId,
      authorId: roles.consultantPsychiatrist.id,
      noteType: 'clinical_review',
      noteCategory: 'weekly-review',
      title: 'Weekly review 5 (Consultant): de-escalation plan',
      content: formatClinicalReviewContent({
        context: 'Consultant week 5 review supported transition from crisis cadence to planned step-down.',
        symptoms: [
          'Marked reduction in pressured speech and behavioural disinhibition.',
          'Sleep consolidated to approximately 6 hours/night.',
          'No current suicidal or violent ideation; risk profile improving.',
        ],
        mentalStateExam: [
          'Mood still mildly elevated but closer to premorbid baseline.',
          'Thought form coherent; no psychotic content elicited today.',
          'Insight improved, with patient acknowledging role of medication and structure.',
        ],
        medications: [
          'Olanzapine and valproate continued short-term with weekly side-effect review.',
          'Lithium remains core long-term mood stabiliser.',
          'Planned taper of PRN diazepam as agitation resolves.',
        ],
        plan: [
          'Reduce ACIS contacts to alternate days with rapid re-escalation triggers documented.',
          'Continue CTO conditions and family-inclusive monitoring.',
          'Schedule handover toward routine CCT follow-up once stability sustained.',
        ],
      }),
      contactMeta: { team: 'ACIS', contactMedium: 'Face-to-face', durationMin: 50, planType: 'weekly_review' },
    },
    {
      seedId: 'n-2023-life-event',
      date: '2023-02-10',
      hourUtc: 3,
      episodeId: mainEpisodeId,
      authorId: keyClinicianA?.id ?? roles.juniorMedical.id,
      noteType: 'progress',
      noteCategory: 'psychosocial',
      title: 'Life event review: return to work stress',
      content: formatClinicalReviewContent({
        context: 'Post-acute community review linked return-to-work stress to relapse-prevention planning.',
        lifeEvents: [
          'Started part-time work after prolonged recovery period.',
          'Balancing transport and family expectations increased stress load.',
        ],
        symptoms: [
          'Mood broadly stable with mild anticipatory anxiety before shifts.',
          'No manic acceleration or major depressive symptoms currently reported.',
          'Energy variable on work days; sleep mostly stable.',
        ],
        mentalStateExam: [
          'Calm and cooperative; speech and thought form within normal limits.',
          'Affect reactive and appropriate; no psychotic phenomena elicited.',
          'Insight good, actively identifying personal relapse signatures.',
        ],
        medications: [
          'Lithium maintained; valproate continued at stable dose.',
          'No significant adverse effects limiting function this quarter.',
        ],
        plan: [
          'Implement pacing strategy for rostered shifts and recovery days.',
          'Continue mood/sleep diary with early-warning escalation thresholds.',
          'Review in 4 weeks with key clinician and reinforce family communication plan.',
        ],
      }),
      contactMeta: { team: 'CCT', contactMedium: 'Telehealth', durationMin: 45, planType: 'ongoing_review' },
    },
    {
      seedId: 'n-2023-physical',
      date: '2023-09-05',
      hourUtc: 4,
      episodeId: mainEpisodeId,
      authorId: roles.juniorMedical.id,
      noteType: 'physical_health',
      noteCategory: 'physical-health',
      title: 'Physical health review',
      content: formatClinicalReviewContent({
        context: 'Quarterly physical-health review completed with GP-linked metabolic monitoring plan.',
        symptoms: [
          'No cardiometabolic red flags reported by patient.',
          'Intermittent daytime fatigue attributed to workload and sleep variability.',
        ],
        mentalStateExam: [
          'Euthymic presentation with intact concentration and judgement.',
          'No acute mood or psychotic symptoms identified during review.',
        ],
        medications: [
          'Metformin 500mg BD commenced for psychotropic-associated metabolic risk mitigation.',
          'Lithium and valproate continued with routine pathology surveillance.',
        ],
        plan: [
          'Repeat fasting metabolic profile and waist/BMI in 12 weeks.',
          'Share updated plan with GP; continue coordinated prescribing surveillance.',
          'Reinforce exercise and nutrition goals with measurable weekly targets.',
        ],
      }),
      contactMeta: { team: 'CCT', contactMedium: 'Face-to-face', durationMin: 40, planType: 'physical_health' },
    },
    {
      seedId: 'n-2024-week-1',
      date: '2024-08-19',
      hourUtc: 3,
      episodeId: depressionEpisodeId,
      authorId: keyClinicianB?.id ?? keyClinicianA?.id ?? roles.juniorMedical.id,
      noteType: 'assessment',
      noteCategory: 'weekly-review',
      title: 'Weekly review 1: depressive relapse',
      content: formatClinicalReviewContent({
        context: 'Depressive relapse week 1 review identified acute psychosocial precipitants and reduced function.',
        lifeEvents: [
          'Recent relationship separation and housing instability within prior month.',
          'Reduced social supports and disrupted daily structure.',
        ],
        symptoms: [
          'Marked anergia, social withdrawal, reduced appetite, and guilt rumination.',
          'Passive hopelessness reported without active self-harm plan.',
          'Sleep fragmented with early-morning waking and reduced motivation.',
        ],
        mentalStateExam: [
          'Presentation slowed with reduced spontaneous speech.',
          'Mood subjectively "flat and heavy"; affect constricted and tearful at times.',
          'Thought form logical but pessimistic; no psychotic symptoms elicited.',
          'Insight preserved and help-seeking maintained.',
        ],
        medications: [
          'Lithium and valproate adherence confirmed.',
          'Medication strategy flagged for consultant-led bipolar depression review.',
        ],
        plan: [
          'Commence weekly MDT cadence (key clinician, JMO, consultant).',
          'Daily behavioural activation micro-goals and safety check-ins initiated.',
          'Family/carer invited into relapse-support discussions with patient consent.',
        ],
      }),
      contactMeta: { team: 'CCT', contactMedium: 'Face-to-face', durationMin: 60, planType: 'weekly_review' },
    },
    {
      seedId: 'n-2024-week-2',
      date: '2024-08-26',
      hourUtc: 3,
      episodeId: depressionEpisodeId,
      authorId: roles.juniorMedical.id,
      noteType: 'review',
      noteCategory: 'weekly-review',
      title: 'Weekly review 2 (JMO): treatment intensification',
      content: formatClinicalReviewContent({
        context: 'JMO week 2 review implemented bipolar depression pharmacological intensification.',
        symptoms: [
          'Persistent low mood and reduced appetite; concentration remains poor.',
          'Sleep remains fragmented; daytime fatigue increasing functional burden.',
          'No psychotic symptoms or manic switch features observed.',
        ],
        mentalStateExam: [
          'Psychomotor slowing present; eye contact intermittent.',
          'Speech low volume but coherent and goal directed.',
          'Passive death wishes intermittently reported, no intent/plan disclosed.',
        ],
        medications: [
          'Lurasidone 40mg nocte initiated for bipolar depressive symptoms.',
          'Lithium continued with serum level review requested.',
          'Valproate continuation reviewed pending consultant decision.',
        ],
        plan: [
          'Refresh safety plan with emergency contacts and after-hours pathways.',
          'Continue weekly face-to-face reviews with interim phone welfare checks.',
          'Escalate to consultant if suicidal ideation or functional decline worsens.',
        ],
      }),
      contactMeta: { team: 'CCT', contactMedium: 'Telehealth', durationMin: 45, planType: 'weekly_review' },
    },
    {
      seedId: 'n-2024-week-3',
      date: '2024-09-02',
      hourUtc: 3,
      episodeId: depressionEpisodeId,
      authorId: roles.consultantPsychiatrist.id,
      noteType: 'clinical_review',
      noteCategory: 'weekly-review',
      title: 'Weekly review 3 (Consultant): risk and medication review',
      content: formatClinicalReviewContent({
        context: 'Consultant week 3 review balanced risk mitigation with targeted medication transition.',
        symptoms: [
          'Low mood persistent with intrusive hopeless cognitions.',
          'Intermittent thoughts that life is not worth living; no active suicidal planning.',
          'Motivation and social engagement remain significantly reduced.',
        ],
        mentalStateExam: [
          'Affect restricted; thought form intact with depressive themes.',
          'No psychotic symptoms; no signs of manic activation on current regimen.',
          'Judgement preserved for help-seeking; insight into relapse remains good.',
        ],
        medications: [
          'Lamotrigine titration commenced to support bipolar depressive recovery.',
          'Planned valproate step-down due tremor/weight concerns documented.',
          'Lurasidone continued with tolerability monitoring.',
        ],
        plan: [
          'Maintain collaborative means-restriction plan and frequent carer check-ins.',
          'Continue weekly consultant oversight until sustained symptom improvement.',
          'Introduce psychologist referral for CBT-focused relapse work once energy permits.',
        ],
      }),
      contactMeta: { team: 'CCT', contactMedium: 'Face-to-face', durationMin: 55, planType: 'weekly_review' },
    },
    {
      seedId: 'n-2024-week-4',
      date: '2024-09-09',
      hourUtc: 3,
      episodeId: depressionEpisodeId,
      authorId: keyClinicianC?.id ?? keyClinicianA?.id ?? roles.juniorMedical.id,
      noteType: 'progress',
      noteCategory: 'weekly-review',
      title: 'Weekly review 4 (Key clinician): behavioural activation',
      content: formatClinicalReviewContent({
        context: 'Key clinician week 4 review emphasised behavioural activation and social reconnection.',
        symptoms: [
          'Mood remains low but patient reports modest increase in daytime activation.',
          'Improved adherence to meal schedule and morning routine.',
          'Anxiety spikes before social contact persist but are manageable.',
        ],
        mentalStateExam: [
          'Speech less slowed than prior week; thought content still depressive but less hopeless.',
          'Affect slightly broader with occasional spontaneous humour.',
          'No psychotic symptoms; risk remains moderate and improving.',
        ],
        medications: [
          'Lamotrigine titration proceeding without rash or major adverse effects.',
          'Valproate taper discussed and understood by patient.',
          'Lurasidone adherence consistent.',
        ],
        plan: [
          'Continue graded activity schedule (walks, structured meals, social contact steps).',
          'Coordinate occupational-therapy functional assessment for routine-building supports.',
          'Maintain weekly MDT review until sustained stability confirmed.',
        ],
      }),
      contactMeta: { team: 'CCT', contactMedium: 'Home visit', durationMin: 60, planType: 'weekly_review' },
    },
    {
      seedId: 'n-2024-week-5',
      date: '2024-09-16',
      hourUtc: 3,
      episodeId: depressionEpisodeId,
      authorId: roles.consultantPsychiatrist.id,
      noteType: 'clinical_review',
      noteCategory: 'weekly-review',
      title: 'Weekly review 5 (Consultant): transition to maintenance',
      content: formatClinicalReviewContent({
        context: 'Consultant week 5 review approved step-down from acute depressive relapse cadence.',
        symptoms: [
          'Subjective mood improving; anhedonia reduced and engagement increasing.',
          'Sleep pattern stabilising with fewer early morning wakings.',
          'Risk downgraded from high to moderate based on sustained containment.',
        ],
        mentalStateExam: [
          'Affect more reactive; speech and psychomotor activity closer to baseline.',
          'Thought content future-oriented with improved problem-solving capacity.',
          'No suicidal plan/intent and no psychotic symptoms identified.',
        ],
        medications: [
          'Valproate ceased due side-effect burden and transition strategy.',
          'Lamotrigine and lurasidone retained as core bipolar depression regimen.',
          'Lithium maintained as long-term mood stabiliser.',
        ],
        plan: [
          'Transition to routine CCT cadence with clear rapid re-escalation triggers.',
          'Formal psychologist and occupational-therapy linkages actioned for recovery phase.',
          'Continue family-inclusive relapse prevention planning and 91-day review cycle.',
        ],
      }),
      contactMeta: { team: 'CCT', contactMedium: 'Face-to-face', durationMin: 50, planType: 'weekly_review' },
    },
    {
      seedId: 'n-2025-message-2',
      date: '2025-01-22',
      hourUtc: 4,
      episodeId: mainEpisodeId,
      authorId: keyClinicianA?.id ?? roles.juniorMedical.id,
      noteType: 'message',
      noteCategory: 'correspondence',
      title: 'Patient message — relapse signature check-in',
      content:
        `${DEMO_MARKER} Secure message sent prompting weekly mood/sleep tracker upload and reminder for upcoming consultant review.`,
      isReportableContact: false,
      contactMeta: null,
    },
    {
      seedId: 'n-2025-dna-1',
      date: '2025-08-11',
      hourUtc: 4,
      episodeId: mainEpisodeId,
      authorId: roles.juniorMedical.id,
      noteType: 'contact',
      noteCategory: 'dna',
      title: 'Did not attend scheduled review',
      content:
        `${DEMO_MARKER} Noah did not attend planned follow-up. Welfare check attempted; voicemail left and carer contacted.`,
      didNotAttend: true,
      appointmentId: seedUuid(`${clinic.id}:noah:appointment:a-2025-08-11`),
      contactMeta: { team: 'CCT', contactMedium: 'Phone', durationMin: 15, planType: 'dna_follow_up' },
    },
    {
      seedId: 'n-2026-summary',
      date: '2026-02-03',
      hourUtc: 4,
      episodeId: mainEpisodeId,
      authorId: roles.consultantPsychiatrist.id,
      noteType: 'clinical_review',
      noteCategory: 'review',
      title: 'Consultant longitudinal review',
      content: formatClinicalReviewContent({
        context: 'Five-year consultant longitudinal review completed with integrated relapse-prevention update.',
        lifeEvents: [
          'Major episodes linked to psychosocial destabilisation periods (2022 mania, 2024 depression).',
          'Current functioning improved with stable housing, structured routine, and family collaboration.',
        ],
        symptoms: [
          'No current manic or major depressive syndrome.',
          'Occasional stress-related sleep dysregulation responsive to early intervention plan.',
          'Sustained engagement with services and self-monitoring tools.',
        ],
        mentalStateExam: [
          'Euthymic presentation, congruent affect, coherent thought form.',
          'No psychotic phenomena, no suicidal or violent ideation.',
          'Insight and judgement good; strong treatment alliance maintained.',
        ],
        medications: [
          'Active regimen: lithium 450mg BD, lamotrigine 100mg mane, lurasidone 40mg nocte, metformin 500mg BD, melatonin PRN.',
          'Medication history reflects valproate and acute-phase antipsychotic step-down after stabilisation.',
        ],
        plan: [
          'Continue 91-day multidisciplinary review cadence with quarterly physical health surveillance.',
          'Maintain psychologist and OT linkages for functional resilience and relapse prevention.',
          'Preserve rapid ACIS escalation protocol if early manic/depressive warning signs recur.',
        ],
      }),
      contactMeta: { team: 'CCT', contactMedium: 'Face-to-face', durationMin: 55, planType: 'longitudinal_review' },
    },
  ];

  for (const template of noteTemplates) {
    const createdAt = isoAt(template.date, template.hourUtc, 0);
    await dbAdmin('clinical_notes')
      .insert({
        id: seedUuid(`${clinic.id}:noah:note:${template.seedId}`),
        clinic_id: clinic.id,
        patient_id: patient.id,
        consent_id: consentId,
        episode_id: template.episodeId,
        author_id: template.authorId,
        appointment_id: template.appointmentId ?? null,
        title: template.title,
        note_type: template.noteType,
        note_category: template.noteCategory,
        source_type: DEMO_SOURCE_TYPE,
        note_date_time: createdAt,
        note_date: template.date,
        content: template.content,
        status: 'signed',
        is_draft: false,
        is_signed: true,
        is_reportable_contact: template.isReportableContact ?? true,
        contact_meta: template.contactMeta ? JSON.stringify(template.contactMeta) : null,
        foi_exempt: false,
        did_not_attend: template.didNotAttend ?? false,
        is_ai_draft: false,
        signed_at: createdAt,
        signed_by_id: template.authorId,
        lock_version: 1,
        created_at: createdAt,
        updated_at: createdAt,
      })
      .onConflict('id')
      .merge([
        'title',
        'content',
        'status',
        'did_not_attend',
        'appointment_id',
        'note_category',
        'contact_meta',
        'updated_at',
      ]);
  }

  const reviewRows: Array<{ date: string; authorId: string; episodeId: string; reviewIndex: number }> = [];
  const reviewCursor = new Date('2021-09-01T12:00:00.000Z');
  let reviewIndex = 1;
  const reviewAuthors = [
    keyClinicianA?.id ?? roles.juniorMedical.id,
    roles.juniorMedical.id,
    roles.consultantPsychiatrist.id,
    keyClinicianB?.id ?? keyClinicianA?.id ?? roles.juniorMedical.id,
  ];

  while (reviewCursor <= new Date('2026-04-30T12:00:00.000Z')) {
    const date = reviewCursor.toISOString().slice(0, 10);
    const phaseEpisodeId =
      date >= '2022-02-20' && date <= '2022-06-20'
        ? maniaEpisodeId
        : date >= '2024-08-12' && date <= '2024-11-30'
          ? depressionEpisodeId
          : mainEpisodeId;
    const authorId = reviewAuthors[(reviewIndex - 1) % reviewAuthors.length]!;
    reviewRows.push({ date, authorId, episodeId: phaseEpisodeId, reviewIndex });
    reviewCursor.setUTCDate(reviewCursor.getUTCDate() + 91);
    reviewIndex += 1;
  }

  for (let index = 0; index < reviewRows.length; index += 1) {
    const review = reviewRows[index]!;
    const createdAt = isoAt(review.date, 5, 0);
    const periodStart = addDays(review.date, -90);
    const previousReviewDate = index > 0 ? reviewRows[index - 1]!.date : addDays(review.date, -91);
    const medicationChanges = medicationChangesForPeriod(periodStart, review.date);
    const currentMedications = activeMedicationSnapshotForDate(review.date);

    const phase =
      compareIsoDates(review.date, '2022-02-20') >= 0 && compareIsoDates(review.date, '2022-06-20') <= 0
        ? 'mania-relapse'
        : compareIsoDates(review.date, '2024-08-12') >= 0 && compareIsoDates(review.date, '2024-11-30') <= 0
          ? 'depressive-relapse'
          : 'maintenance';

    const phaseNarrative =
      phase === 'mania-relapse'
        ? {
            symptoms: [
              'This quarter was dominated by manic symptoms (reduced sleep, impulsivity, elevated/irritable mood) requiring ACIS intensity.',
              'Functional and financial risk escalated before improving through structured containment.',
            ],
            mse: [
              'Early-quarter MSE showed pressured speech, reduced insight, and expansive affect; end-quarter MSE demonstrated partial remittance.',
              'No persistent psychotic phenomena at quarter close.',
            ],
            plan: [
              'Sustain ACIS-to-CCT step-down with clear relapse/escalation thresholds.',
              'Continue legal-order informed adherence supports while insight consolidates.',
            ],
          }
        : phase === 'depressive-relapse'
          ? {
              symptoms: [
                'Quarter characterised by depressive relapse with anergia, social withdrawal, and passive hopelessness.',
                'Progressive improvement followed medication optimisation and behavioural activation supports.',
              ],
              mse: [
                'MSE trajectory shifted from psychomotor slowing/constricted affect toward broader affective range.',
                'Risk remained dynamic but moved from high to moderate with no active suicidal plan.',
              ],
              plan: [
                'Maintain weekly-to-fortnightly review taper with explicit deterioration triggers.',
                'Embed psychologist/OT functional recovery supports alongside medication adherence monitoring.',
              ],
            }
          : {
              symptoms: [
                'Overall maintenance phase with no sustained manic or major depressive syndrome.',
                'Intermittent stress-linked sleep or anxiety fluctuations were managed early without full relapse.',
              ],
              mse: [
                'MSE predominantly euthymic, coherent, and future-oriented across contacts.',
                'Insight and adherence remained strong; no psychotic features observed.',
              ],
              plan: [
                'Continue relapse-prevention workbook, family check-ins, and rapid access pathways.',
                'Preserve quarterly physical health and medication surveillance schedule.',
              ],
            };

    const content = formatClinicalReviewContent({
      context: `91-day review ${review.reviewIndex} covering ${periodStart} to ${review.date} (previous review ${previousReviewDate}).`,
      symptoms: [
        ...phaseNarrative.symptoms,
        'Sleep pattern, engagement, and risk formulation were reviewed across all MDT contacts in this period.',
      ],
      mentalStateExam: [
        ...phaseNarrative.mse,
        'Cognitive function and judgement remained adequate for collaborative planning at review completion.',
      ],
      medications: [
        ...(medicationChanges.length > 0
          ? medicationChanges
          : ['No medication additions or cessations were required in this 90-day window.']),
        `Active medication list at review: ${currentMedications.join('; ') || 'None recorded.'}`,
      ],
      plan: [
        ...phaseNarrative.plan,
        'Next 91 days: continue MDT follow-up cadence, monitor risk/side effects, and adjust intensity according to presentation change.',
      ],
    });

    await dbAdmin('clinical_notes')
      .insert({
        id: seedUuid(`${clinic.id}:noah:91day-note:${review.reviewIndex}`),
        clinic_id: clinic.id,
        patient_id: patient.id,
        consent_id: consentId,
        episode_id: review.episodeId,
        author_id: review.authorId,
        title: `91-Day Review ${review.reviewIndex}`,
        note_type: 'review',
        note_category: '91-day-review',
        source_type: DEMO_SOURCE_TYPE,
        note_date_time: createdAt,
        note_date: review.date,
        content,
        status: 'signed',
        is_draft: false,
        is_signed: true,
        is_reportable_contact: true,
        contact_meta: JSON.stringify({
          planType: '91_day_review',
          team: 'CCT',
          contactMedium: 'Face-to-face',
          durationMin: 60,
        }),
        foi_exempt: false,
        did_not_attend: false,
        is_ai_draft: false,
        signed_at: createdAt,
        signed_by_id: review.authorId,
        lock_version: 1,
        created_at: createdAt,
        updated_at: createdAt,
      })
      .onConflict('id')
      .merge([
        'title',
        'content',
        'updated_at',
      ]);

    await dbAdmin('clinical_reviews')
      .insert({
        id: seedUuid(`${clinic.id}:noah:91day-review:${review.reviewIndex}`),
        clinic_id: clinic.id,
        patient_id: patient.id,
        episode_id: review.episodeId,
        reviewed_by_id: review.authorId,
        review_type: '91-day',
        review_date: review.date,
        summary: `${DEMO_MARKER} 91-day review ${review.reviewIndex} (${periodStart} to ${review.date}) summarised trajectory, medication changes, risk evolution, and MDT response.`,
        recommendations: `Maintain active regimen (${currentMedications.join('; ') || 'none'}) with next-quarter focus on early warning-sign response, physical health monitoring, and coordinated psychologist/OT/GP linkage as clinically indicated.`,
        status: 'completed',
        created_at: createdAt,
        updated_at: createdAt,
      })
      .onConflict('id')
      .merge([
        'summary',
        'recommendations',
        'status',
        'updated_at',
      ]);
  }

  const observationRows = [
    { seedId: 'obs-2021-09', date: '2021-09-02', staffId: roles.juniorMedical.id, notes: 'Baseline metabolic screen completed.', values: { bp: '124/78', weightKg: 82, bmi: 26.3, hba1c: '5.4%' } },
    { seedId: 'obs-2022-04', date: '2022-04-12', staffId: roles.juniorMedical.id, notes: 'During ACIS phase: hydration and sleep restoration monitored.', values: { bp: '132/84', weightKg: 84, sleepHours: 5 } },
    { seedId: 'obs-2022-10', date: '2022-10-21', staffId: roles.juniorMedical.id, notes: 'Post-acute recovery metabolic recheck.', values: { bp: '126/80', weightKg: 83, lipidPanel: 'within target' } },
    { seedId: 'obs-2023-06', date: '2023-06-23', staffId: roles.juniorMedical.id, notes: 'Quarterly physical health check with GP coordination.', values: { bp: '122/76', weightKg: 81, ecg: 'normal' } },
    { seedId: 'obs-2024-09', date: '2024-09-18', staffId: roles.juniorMedical.id, notes: 'Depressive phase review: appetite and activity decline tracked.', values: { bp: '118/74', weightKg: 78, appetite: 'reduced' } },
    { seedId: 'obs-2025-03', date: '2025-03-17', staffId: roles.juniorMedical.id, notes: 'Routine metabolic monitoring and exercise plan review.', values: { bp: '121/79', weightKg: 80, activityMinutesPerWeek: 120 } },
    { seedId: 'obs-2026-02', date: '2026-02-10', staffId: roles.juniorMedical.id, notes: 'Annual physical check during stable maintenance period.', values: { bp: '120/76', weightKg: 79, hba1c: '5.3%', lipids: 'optimal' } },
  ];

  for (const observation of observationRows) {
    const observedAt = isoAt(observation.date, 4, 30);
    await dbAdmin('structured_observations')
      .insert({
        id: seedUuid(`${clinic.id}:noah:observation:${observation.seedId}`),
        clinic_id: clinic.id,
        patient_id: patient.id,
        staff_id: observation.staffId,
        observation_type: 'physical_health',
        location: 'Community clinic',
        mood: null,
        behaviour: null,
        risk_concerns: null,
        sleep_quality: null,
        values: JSON.stringify(observation.values),
        notes: `${DEMO_MARKER} ${observation.notes}`,
        observed_at: observedAt,
        created_at: observedAt,
        escalation_required: false,
        escalation_notes: null,
      })
      .onConflict('id')
      .merge([
        'values',
        'notes',
        'observed_at',
      ]);
  }

  await dbAdmin('legal_orders')
    .insert({
      id: seedUuid(`${clinic.id}:noah:legal-order:cto-2022`),
      clinic_id: clinic.id,
      patient_id: patient.id,
      episode_id: maniaEpisodeId,
      order_type_id: legalOrderTypeId,
      order_number: 'CTO-2022-0047',
      start_date: '2022-03-15',
      expires_at: isoAt('2022-09-15', 0, 0),
      review_date: '2022-06-15',
      status: 'expired',
      issuing_authority: 'Victorian Mental Health Tribunal',
      conditions: 'Community medication adherence, weekly clinical review, and immediate ACIS contact if relapse markers emerge.',
      notes: `${DEMO_MARKER} CTO used during acute manic phase to support adherence and safety.`,
      auto_flagged: false,
      created_by_staff_id: roles.consultantPsychiatrist.id,
      lock_version: 1,
      created_at: isoAt('2022-03-15', 1, 0),
      updated_at: isoAt('2022-09-15', 1, 0),
    })
    .onConflict('id')
    .merge([
      'status',
      'notes',
      'review_date',
      'expires_at',
      'updated_at',
    ]);

  const escalationId = seedUuid(`${clinic.id}:noah:escalation:acis-2022`);
  await dbAdmin('escalations')
    .insert({
      id: escalationId,
      clinic_id: clinic.id,
      patient_id: patient.id,
      episode_id: maniaEpisodeId,
      raised_by_id: roles.consultantPsychiatrist.id,
      assigned_to_id: roles.juniorMedical.id,
      acknowledged_by_id: roles.juniorMedical.id,
      resolved_by_id: roles.consultantPsychiatrist.id,
      type: 'clinical_escalation',
      severity: 'emergency',
      title: `${DEMO_MARKER} ACIS escalation during acute manic relapse`,
      description: JSON.stringify({
        situation: 'Escalating manic symptoms with reduced sleep and impulsive behaviour.',
        background: 'Known bipolar affective disorder; recent treatment disengagement and rapid deterioration.',
        assessment: 'High functional risk and reduced insight; urgent intensive community response required.',
        recommendation: 'Activate ACIS daily outreach, commence CTO pathway, and schedule consultant review within 24h.',
        assignedTeam: 'ACIS',
      }),
      status: 'resolved',
      resolution: 'Stabilised with ACIS outreach, medication adherence, and CTO-supported follow-up.',
      acknowledged_at: isoAt('2022-03-15', 2, 45),
      resolved_at: isoAt('2022-03-18', 5, 0),
      created_at: isoAt('2022-03-15', 2, 30),
      updated_at: isoAt('2022-03-18', 5, 0),
      lock_version: 1,
    })
    .onConflict('id')
    .merge([
      'status',
      'description',
      'resolution',
      'acknowledged_at',
      'resolved_at',
      'updated_at',
    ]);

  const escalationEvents = [
    { seedId: 'created', eventType: 'created', actorId: roles.consultantPsychiatrist.id, notes: 'Escalation created for immediate ACIS activation.', timestamp: isoAt('2022-03-15', 2, 31) },
    { seedId: 'ack', eventType: 'acknowledged', actorId: roles.juniorMedical.id, notes: 'ACIS intake accepted; outreach commenced.', timestamp: isoAt('2022-03-15', 2, 46) },
    { seedId: 'progress', eventType: 'in_progress', actorId: keyClinicianA?.id ?? roles.juniorMedical.id, notes: 'Daily home visits in progress with carer coordination.', timestamp: isoAt('2022-03-16', 3, 0) },
    { seedId: 'resolved', eventType: 'resolved', actorId: roles.consultantPsychiatrist.id, notes: 'Risk reduced; step-down to planned follow-up.', timestamp: isoAt('2022-03-18', 5, 0) },
  ];
  for (const event of escalationEvents) {
    await dbAdmin('escalation_events')
      .insert({
        id: seedUuid(`${escalationId}:event:${event.seedId}`),
        escalation_id: escalationId,
        actor_id: event.actorId,
        event_type: event.eventType,
        notes: `${DEMO_MARKER} ${event.notes}`,
        created_at: event.timestamp,
        updated_at: event.timestamp,
      })
      .onConflict('id')
      .merge([
        'notes',
        'updated_at',
      ]);
  }

  const threadId = seedUuid(`${clinic.id}:noah:message-thread:care-coordination`);
  const threadCreatedAt = isoAt('2024-09-01', 6, 0);
  await dbAdmin('message_threads')
    .insert({
      id: threadId,
      clinic_id: clinic.id,
      created_by_id: roles.consultantPsychiatrist.id,
      patient_id: patient.id,
      subject: `${DEMO_MARKER} MDT coordination — depressive relapse`,
      last_message_at: isoAt('2024-09-18', 6, 30),
      created_at: threadCreatedAt,
      updated_at: isoAt('2024-09-18', 6, 30),
    })
    .onConflict('id')
    .merge([
      'subject',
      'last_message_at',
      'updated_at',
    ]);

  for (const participant of roles.messageParticipants) {
    await dbAdmin('message_thread_participants')
      .insert({
        id: seedUuid(`${threadId}:participant:${participant.id}`),
        thread_id: threadId,
        user_id: participant.id,
        last_read_at: null,
        created_at: threadCreatedAt,
        updated_at: threadCreatedAt,
      })
      .onConflict('id')
      .merge(['updated_at']);
  }

  const threadMessages = [
    {
      seedId: 'm1',
      senderId: roles.consultantPsychiatrist.id,
      timestamp: isoAt('2024-09-01', 6, 0),
      body: 'Please prioritise weekly mood/risk check-ins and confirm engagement with behavioural activation plan.',
    },
    {
      seedId: 'm2',
      senderId: keyClinicianB?.id ?? keyClinicianA?.id ?? roles.juniorMedical.id,
      timestamp: isoAt('2024-09-04', 6, 15),
      body: 'Completed home visit. Appetite low, sleep fragmented, but patient accepted daily routine worksheet.',
    },
    {
      seedId: 'm3',
      senderId: roles.juniorMedical.id,
      timestamp: isoAt('2024-09-09', 6, 20),
      body: 'Medication change tolerated. No emergent side effects; planning repeat labs in 2 weeks.',
    },
    {
      seedId: 'm4',
      senderId: roles.consultantPsychiatrist.id,
      timestamp: isoAt('2024-09-18', 6, 30),
      body: 'Risk now moderate, continue current cadence and keep family/carer communications active.',
    },
  ];

  for (const message of threadMessages) {
    await dbAdmin('messages')
      .insert({
        id: seedUuid(`${threadId}:message:${message.seedId}`),
        thread_id: threadId,
        sender_id: message.senderId,
        clinic_id: clinic.id,
        content: JSON.stringify({
          body: `${DEMO_MARKER} ${message.body}`,
          subject: `${DEMO_MARKER} MDT coordination — depressive relapse`,
          patientId: patient.id,
          isUrgent: false,
        }),
        is_read: false,
        created_at: message.timestamp,
        updated_at: message.timestamp,
      })
      .onConflict('id')
      .merge(['content', 'updated_at']);
  }

  const letterRows = [
    {
      seedId: 'l-2021-gp-intake',
      date: '2021-06-20',
      episodeId: mainEpisodeId,
      authorId: roles.consultantPsychiatrist.id,
      recipientName: 'Dr Benjamin Reid',
      recipientEmail: 'benjamin.reid@gp.demo.local',
      letterType: 'gp-update',
      subject: 'Initial psychiatric assessment summary',
      body: 'Confirmed bipolar affective disorder history with mixed polarity. Shared initial treatment and monitoring plan.',
      sentVia: 'secure_email',
    },
    {
      seedId: 'l-2022-acis-escalation',
      date: '2022-03-16',
      episodeId: maniaEpisodeId,
      authorId: roles.consultantPsychiatrist.id,
      recipientName: 'Dr Benjamin Reid',
      recipientEmail: 'benjamin.reid@gp.demo.local',
      letterType: 'gp-update',
      subject: 'Acute manic escalation and CTO commencement',
      body: 'Patient entered ACIS pathway with CTO supports due to high-risk manic deterioration. Requested GP physical-health co-monitoring.',
      sentVia: 'secure_email',
    },
    {
      seedId: 'l-2023-recovery',
      date: '2023-02-14',
      episodeId: mainEpisodeId,
      authorId: roles.juniorMedical.id,
      recipientName: 'Dr Benjamin Reid',
      recipientEmail: 'benjamin.reid@gp.demo.local',
      letterType: 'gp-update',
      subject: 'Recovery phase progress update',
      body: 'Mood stabilised with improved psychosocial functioning and return-to-work planning. Continue shared metabolic monitoring.',
      sentVia: 'secure_email',
    },
    {
      seedId: 'l-2024-depressive-relapse',
      date: '2024-09-03',
      episodeId: depressionEpisodeId,
      authorId: roles.consultantPsychiatrist.id,
      recipientName: 'Dr Benjamin Reid',
      recipientEmail: 'benjamin.reid@gp.demo.local',
      letterType: 'gp-update',
      subject: 'Depressive relapse care plan and risk posture',
      body: 'Relapse triggered by relationship breakdown and housing stress. Weekly MDT cadence commenced; risk currently moderate with active supports.',
      sentVia: 'secure_email',
    },
    {
      seedId: 'l-2024-psychology-referral',
      date: '2024-09-12',
      episodeId: depressionEpisodeId,
      authorId: roles.consultantPsychiatrist.id,
      recipientName: 'Harbour Psychology Service',
      recipientEmail: 'intake@harbourpsychology.demo.local',
      letterType: 'referral',
      subject: 'Psychology referral — CBT and relapse prevention',
      body: 'Referral for structured CBT targeting bipolar depression relapse signatures, behavioural activation, and cognitive restructuring. Please coordinate progress updates with MDT.',
      sentVia: 'secure_email',
    },
    {
      seedId: 'l-2024-ot-referral',
      date: '2024-09-19',
      episodeId: depressionEpisodeId,
      authorId: keyClinicianB?.id ?? keyClinicianA?.id ?? roles.juniorMedical.id,
      recipientName: 'City OT Recovery Program',
      recipientEmail: 'referrals@cityot.demo.local',
      letterType: 'referral',
      subject: 'Occupational therapy referral — routine and community re-engagement',
      body: 'Referral requested for graded routine-building, executive-function supports, and community participation goals following depressive relapse phase.',
      sentVia: 'secure_email',
    },
    {
      seedId: 'l-2025-family-support',
      date: '2025-08-20',
      episodeId: mainEpisodeId,
      authorId: keyClinicianA?.id ?? roles.juniorMedical.id,
      recipientName: 'Grace Bennett (Carer)',
      recipientEmail: 'grace.bennett@demo.local',
      letterType: 'carer-update',
      subject: 'Family support and escalation plan update',
      body: 'Provided updated relapse-warning checklist and direct pathways for after-hours ACIS contact if concern escalates.',
      sentVia: 'email',
    },
    {
      seedId: 'l-2026-annual-summary',
      date: '2026-02-04',
      episodeId: mainEpisodeId,
      authorId: roles.consultantPsychiatrist.id,
      recipientName: 'Dr Benjamin Reid',
      recipientEmail: 'benjamin.reid@gp.demo.local',
      letterType: 'gp-update',
      subject: 'Five-year longitudinal treatment summary',
      body: 'Shared 5-year overview including manic and depressive relapse management, CTO history, ACIS escalation episode, and current maintenance plan.',
      sentVia: 'secure_email',
    },
  ];

  for (const letter of letterRows) {
    const createdAt = isoAt(letter.date, 7, 0);
    await dbAdmin('correspondence_letters')
      .insert({
        id: seedUuid(`${clinic.id}:noah:letter:${letter.seedId}`),
        patient_id: patient.id,
        clinic_id: clinic.id,
        episode_id: letter.episodeId,
        author_id: letter.authorId,
        recipient_name: letter.recipientName,
        recipient_email: letter.recipientEmail,
        letter_type: letter.letterType,
        subject: `${DEMO_MARKER} ${letter.subject}`,
        body: letter.body,
        content: letter.body,
        status: 'sent',
        notes: `${DEMO_MARKER} Generated for longitudinal demo dataset.`,
        sent_via: letter.sentVia,
        created_at: createdAt,
        sent_at: plusMinutes(createdAt, 20),
      })
      .onConflict('id')
      .merge([
        'subject',
        'body',
        'content',
        'status',
        'sent_via',
        'sent_at',
      ]);
  }

  const outDir = path.resolve(__dirname, '..', '..', '..', 'docs', 'demo');
  const outPath = path.join(outDir, 'noah-bennett-longitudinal-demo.md');
  await mkdir(outDir, { recursive: true });
  const documentLines = [
    '# Noah Bennett Longitudinal Demo Data',
    '',
    '> Generated demo-only longitudinal history for clinical walkthroughs.',
    '',
    `Generated at: ${new Date().toISOString()}`,
    `Clinic: ${clinic.name}`,
    `Patient: ${patient.given_name} ${patient.family_name} (${patient.emr_number ?? 'UR pending'})`,
    '',
    'Dataset includes:',
    '- 3 episodes spanning 2021–2026 (community, acute manic ACIS phase, depressive relapse phase)',
    '- Bipolar diagnosis record (manic + depressive course)',
    '- Weekly review notes across acute phases by key clinician, junior medical staff, and consultant psychiatrist',
    '- 91-day clinical review cadence (clinical notes + clinical review records)',
    '- Medication timeline with active + ceased records and linked prescription history',
    '- Appointments including did-not-attend events',
    '- Physical health monitoring observations',
    '- CTO legal-order episode during manic escalation',
    '- ACIS escalation record with lifecycle events',
    '- Message notes, internal MDT thread messages, and GP/carer/allied-health correspondence letters',
    '',
    'Marker:',
    `- All seeded records are tagged with \`${DEMO_MARKER}\` and/or source type \`${DEMO_SOURCE_TYPE}\` for safe cleanup/reseed.`,
    '',
  ];
  await writeFile(outPath, `${documentLines.join('\n')}\n`, 'utf8');

  const reviewCount = reviewRows.length;
  return {
    outputPath: outPath,
    reviewCount,
    appointmentCount: appointmentRows.length,
    noteCount: noteTemplates.length + reviewRows.length,
  };
}

seedNoahTimeline()
  .then(async (result) => {
    console.log(JSON.stringify(result, null, 2));
    clearPoolMonitor();
    await dbAdmin.destroy();
    await appPoolRaw.destroy();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(err);
    clearPoolMonitor();
    await dbAdmin.destroy();
    await appPoolRaw.destroy();
    process.exit(1);
  });
