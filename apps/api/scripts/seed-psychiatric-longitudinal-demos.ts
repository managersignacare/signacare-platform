import 'dotenv/config';
import { createHash } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { appPoolRaw, clearPoolMonitor, dbAdmin, rlsStore } from '../src/db/db';
import { ensureClinicalNoteConsent } from '../src/shared/recordingConsent';

interface ClinicRow {
  id: string;
  name: string;
}

interface PatientRow {
  id: string;
  given_name: string;
  family_name: string;
  emr_number?: string | null;
}

interface StaffRow {
  id: string;
  given_name: string;
  family_name: string;
  role: string;
  discipline_name?: string | null;
  prescriber_number?: string | null;
}

interface Roles {
  consultantPsychiatrist: StaffRow;
  juniorMedical: StaffRow;
  keyClinicians: StaffRow[];
}

interface EpisodeSeed {
  key: string;
  title: string;
  episodeType: string;
  status: 'open' | 'closed';
  startDate: string;
  endDate?: string;
  presentingProblem: string;
  primaryDiagnosis: string;
  closureReason?: string;
  closureSummary?: string;
}

interface MedicationSeed {
  key: string;
  episodeKey: string;
  drugLabel: string;
  genericName: string;
  dose: string;
  doseUnit: string;
  route: string;
  frequency: string;
  indication: string;
  startDate: string;
  endDate?: string | null;
  status: 'active' | 'ceased';
  reasonForCessation?: string;
  notes: string;
}

interface PhaseNarrative {
  key: string;
  startDate: string;
  endDate: string;
  lifeEvents: string[];
  symptoms: string[];
  mse: string[];
  plan: string[];
}

interface CaseScenario {
  key: string;
  marker: string;
  patient: { givenName: string; familyName: string };
  diagnosisCode: string;
  diagnosisDescription: string;
  episodes: EpisodeSeed[];
  medications: MedicationSeed[];
  phases: PhaseNarrative[];
  gp: { name: string; email: string };
}

const CLINIC_NAME = process.env.DEMO_CASES_CLINIC_NAME ?? 'Soham Health';
const DEMO_SOURCE_TYPE = 'demo_psychiatric_longitudinal_seed';
const SPECIALTY_CODE = 'mental_health';
const START_DATE = '2021-05-01';
const END_DATE = '2026-04-30';

function seedUuid(seed: string): string {
  const hex = createHash('sha256').update(seed).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function isoAt(date: string, hourUtc = 2, minute = 0): string {
  const hh = String(hourUtc).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return new Date(`${date}T${hh}:${mm}:00.000Z`).toISOString();
}

function addDays(dateIso: string, days: number): string {
  const base = new Date(`${dateIso}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

function plusMinutes(isoTimestamp: string, minutes: number): string {
  return new Date(new Date(isoTimestamp).getTime() + minutes * 60_000).toISOString();
}

function inRange(date: string, start: string, end: string): boolean {
  return date >= start && date <= end;
}

function formatReviewContent(input: {
  marker: string;
  context: string;
  lifeEvents: string[];
  symptoms: string[];
  mse: string[];
  medications: string[];
  plan: string[];
}): string {
  return [
    `${input.marker} ${input.context}`,
    '',
    'Life events / psychosocial context:',
    ...input.lifeEvents.map((line) => `- ${line}`),
    '',
    'Symptoms and functional update:',
    ...input.symptoms.map((line) => `- ${line}`),
    '',
    'Mental status examination (MSE):',
    ...input.mse.map((line) => `- ${line}`),
    '',
    'Medication / prescribing update:',
    ...input.medications.map((line) => `- ${line}`),
    '',
    'Management plan:',
    ...input.plan.map((line) => `- ${line}`),
  ].join('\n');
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

async function resolvePatient(clinicId: string, givenName: string, familyName: string): Promise<PatientRow> {
  const row = (await dbAdmin('patients')
    .where({ clinic_id: clinicId })
    .whereNull('deleted_at')
    .whereRaw('LOWER(given_name) = ?', [givenName.toLowerCase()])
    .whereRaw('LOWER(family_name) = ?', [familyName.toLowerCase()])
    .orderBy('updated_at', 'desc')
    .first('id', 'given_name', 'family_name', 'emr_number')) as PatientRow | undefined;
  if (!row) {
    throw new Error(`Patient "${givenName} ${familyName}" not found. Run seed-demo-patient-registrations first.`);
  }
  return row;
}

async function resolveClinicActorStaffId(clinicId: string): Promise<string> {
  const actor = await dbAdmin('staff')
    .where({ clinic_id: clinicId, is_active: true })
    .whereIn('role', ['admin', 'manager', 'clinician'])
    .whereNull('deleted_at')
    .orderByRaw("CASE role WHEN 'admin' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END")
    .orderBy('updated_at', 'desc')
    .first<{ id: string }>('id');

  if (!actor?.id) {
    throw new Error(`No active admin/manager/clinician actor available for clinic ${clinicId}.`);
  }
  return actor.id;
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

async function resolveRoles(clinicId: string): Promise<Roles> {
  const staff = (await dbAdmin('staff as s')
    .leftJoin('professional_disciplines as d', dbAdmin.raw('d.id::text = s.discipline_id and d.clinic_id = s.clinic_id'))
    .where({ 's.clinic_id': clinicId, 's.is_active': true })
    .whereNull('s.deleted_at')
    .select('s.id', 's.given_name', 's.family_name', 's.role', 's.prescriber_number', 'd.name as discipline_name')
    .orderBy('s.email', 'asc')) as StaffRow[];

  const clinicians = staff.filter((s) => s.role === 'clinician');
  const psychiatry = clinicians.filter((s) => (s.discipline_name ?? '').toLowerCase().includes('psychiatry'));
  const prescribers = psychiatry.filter((s) => Boolean(s.prescriber_number));
  const nonPsych = clinicians.filter((s) => !(s.discipline_name ?? '').toLowerCase().includes('psychiatry'));

  const consultantPsychiatrist = prescribers[0] ?? psychiatry[0] ?? clinicians[0];
  if (!consultantPsychiatrist) {
    throw new Error('No active clinicians found for longitudinal psychiatric demo seeding.');
  }
  const juniorMedical = prescribers[1]
    ?? psychiatry[1]
    ?? clinicians.find((c) => c.id !== consultantPsychiatrist.id)
    ?? consultantPsychiatrist;
  const nonPsychPool = nonPsych.length > 0
    ? nonPsych
    : clinicians.filter((c) => c.id !== consultantPsychiatrist.id && c.id !== juniorMedical.id);
  const keyClinicians = nonPsychPool.length > 0
    ? nonPsychPool.slice(0, 3)
    : [consultantPsychiatrist];

  return {
    consultantPsychiatrist,
    juniorMedical,
    keyClinicians,
  };
}

async function cleanupScenarioRows(clinicId: string, patientId: string, marker: string): Promise<void> {
  const threadIds = (await dbAdmin('message_threads')
    .where({ clinic_id: clinicId, patient_id: patientId })
    .whereILike('subject', `${marker}%`)
    .select('id'))
    .map((row) => String(row.id));
  if (threadIds.length > 0) {
    await dbAdmin('message_thread_participants').whereIn('thread_id', threadIds).del();
    await dbAdmin('messages').whereIn('thread_id', threadIds).del();
    await dbAdmin('message_threads').whereIn('id', threadIds).del();
  }

  await dbAdmin('structured_observations')
    .where({ clinic_id: clinicId, patient_id: patientId })
    .whereILike('notes', `%${marker}%`)
    .del();
  await dbAdmin('clinical_reviews')
    .where({ clinic_id: clinicId, patient_id: patientId })
    .whereILike('summary', `%${marker}%`)
    .del();
  await dbAdmin('correspondence_letters')
    .where({ clinic_id: clinicId, patient_id: patientId })
    .whereILike('subject', `${marker}%`)
    .del();
  await dbAdmin('clinical_notes')
    .where({ clinic_id: clinicId, patient_id: patientId, source_type: DEMO_SOURCE_TYPE })
    .del();
  await dbAdmin('appointments')
    .where({ clinic_id: clinicId, patient_id: patientId })
    .whereILike('notes', `%${marker}%`)
    .del();
  await dbAdmin('prescriptions')
    .where({ clinic_id: clinicId, patient_id: patientId })
    .whereILike('notes', `%${marker}%`)
    .del();
  await dbAdmin('patient_medications')
    .where({ clinic_id: clinicId, patient_id: patientId })
    .whereILike('notes', `%${marker}%`)
    .del();
  await dbAdmin('diagnoses')
    .where({ clinic_id: clinicId, patient_id: patientId })
    .whereILike('notes', `%${marker}%`)
    .del();
  await dbAdmin('episodes')
    .where({ clinic_id: clinicId, patient_id: patientId })
    .whereILike('title', `${marker}%`)
    .del();
}

function scenarioForDate(scenario: CaseScenario, date: string): PhaseNarrative {
  return scenario.phases.find((phase) => inRange(date, phase.startDate, phase.endDate)) ?? scenario.phases[scenario.phases.length - 1]!;
}

function buildScenarios(): CaseScenario[] {
  return [
    {
      key: 'schizophrenia',
      marker: '[Psych Demo:Schizophrenia]',
      patient: { givenName: 'Amelia', familyName: 'Dawson' },
      diagnosisCode: 'F20.0',
      diagnosisDescription: 'Schizophrenia with recurrent psychotic exacerbations and inter-episode negative symptoms.',
      episodes: [
        {
          key: 'main',
          title: '[Psych Demo:Schizophrenia] Community continuing care',
          episodeType: 'cct',
          status: 'open',
          startDate: '2021-05-20',
          presentingProblem: 'Relapse prevention, social recovery, and medication adherence support.',
          primaryDiagnosis: 'Schizophrenia',
        },
        {
          key: 'acute-2022',
          title: '[Psych Demo:Schizophrenia] Acute psychotic relapse',
          episodeType: 'acis',
          status: 'closed',
          startDate: '2022-01-18',
          endDate: '2022-05-30',
          presentingProblem: 'Paranoid delusions, command hallucinations, reduced sleep, and behavioural risk.',
          primaryDiagnosis: 'Schizophrenia, acute exacerbation',
          closureReason: 'stabilised',
          closureSummary: 'Stabilised with intensive outreach, antipsychotic optimisation, and step-down plan.',
        },
        {
          key: 'negative-2024',
          title: '[Psych Demo:Schizophrenia] Functional decline phase',
          episodeType: 'cct',
          status: 'closed',
          startDate: '2024-02-10',
          endDate: '2024-08-20',
          presentingProblem: 'Avolition, social withdrawal, and occupational impairment without frank positive symptoms.',
          primaryDiagnosis: 'Schizophrenia, negative-symptom predominant phase',
          closureReason: 'stabilised',
          closureSummary: 'Improved routine, supported employment, and structured psychosocial interventions.',
        },
      ],
      medications: [
        {
          key: 'risperidone-init',
          episodeKey: 'main',
          drugLabel: 'Risperidone',
          genericName: 'Risperidone',
          dose: '3',
          doseUnit: 'mg',
          route: 'oral',
          frequency: 'Nocte',
          indication: 'Psychosis relapse prevention',
          startDate: '2021-05-25',
          endDate: '2022-02-20',
          status: 'ceased',
          reasonForCessation: 'Transitioned to paliperidone LAI after acute relapse.',
          notes: '[Psych Demo:Schizophrenia] Oral foundation antipsychotic.',
        },
        {
          key: 'paliperidone-lai',
          episodeKey: 'acute-2022',
          drugLabel: 'Paliperidone LAI',
          genericName: 'Paliperidone',
          dose: '150',
          doseUnit: 'mg',
          route: 'IM',
          frequency: 'Monthly',
          indication: 'Long-acting relapse prevention',
          startDate: '2022-02-21',
          status: 'active',
          notes: '[Psych Demo:Schizophrenia] Maintenance LAI regimen.',
        },
        {
          key: 'metformin',
          episodeKey: 'main',
          drugLabel: 'Metformin',
          genericName: 'Metformin',
          dose: '500',
          doseUnit: 'mg',
          route: 'oral',
          frequency: 'BD',
          indication: 'Metabolic risk mitigation',
          startDate: '2022-09-01',
          status: 'active',
          notes: '[Psych Demo:Schizophrenia] Added for antipsychotic metabolic burden.',
        },
      ],
      phases: [
        {
          key: 'acute-psychosis',
          startDate: '2022-01-18',
          endDate: '2022-05-30',
          lifeEvents: ['Family conflict escalated before relapse.', 'Sleep collapsed to 2-3 hours per night.'],
          symptoms: ['Persecutory ideation and auditory hallucinations prominent.', 'Marked disorganisation and reduced judgement with high vulnerability.'],
          mse: ['Speech pressured and tangential with guarded affect.', 'Thought content paranoid; insight markedly reduced.'],
          plan: ['Daily ACIS contact and weekly consultant review.', 'LAI initiation with shared adherence plan and carer briefing.'],
        },
        {
          key: 'negative-phase',
          startDate: '2024-02-10',
          endDate: '2024-08-20',
          lifeEvents: ['Job loss and social isolation preceded decline.'],
          symptoms: ['Avolition, anhedonia, and reduced self-care predominated.', 'No persistent positive psychotic symptoms this phase.'],
          mse: ['Blunted affect and psychomotor slowing noted.', 'Thought form coherent with pessimistic cognitions.'],
          plan: ['Structured behavioural activation and OT linkage.', 'Continue LAI and weekly key-clinician functional coaching.'],
        },
        {
          key: 'maintenance',
          startDate: '2021-05-20',
          endDate: '2026-04-30',
          lifeEvents: ['Supported housing and gradual vocational re-engagement.'],
          symptoms: ['Residual anxiety and social withdrawal fluctuate with stress.', 'No sustained positive psychosis during stable windows.'],
          mse: ['Generally euthymic with coherent thought and partial insight.', 'Risk low-to-moderate with preserved help-seeking.'],
          plan: ['Maintain relapse signature monitoring and family-inclusive planning.', 'Quarterly physical-health checks and 91-day reviews.'],
        },
      ],
      gp: { name: 'Dr Harriet Collins', email: 'harriet.collins@gp.demo.local' },
    },
    {
      key: 'ocd',
      marker: '[Psych Demo:OCD]',
      patient: { givenName: 'Priya', familyName: 'Menon' },
      diagnosisCode: 'F42.2',
      diagnosisDescription: 'Obsessive-compulsive disorder with contamination, checking, and reassurance-seeking cycles.',
      episodes: [
        {
          key: 'main',
          title: '[Psych Demo:OCD] Community continuing care',
          episodeType: 'cct',
          status: 'open',
          startDate: '2021-04-12',
          presentingProblem: 'Obsessions/compulsions interfering with work, social function, and sleep.',
          primaryDiagnosis: 'Obsessive-compulsive disorder',
        },
        {
          key: 'flare-2022',
          title: '[Psych Demo:OCD] Severe contamination/checking flare',
          episodeType: 'cct',
          status: 'closed',
          startDate: '2022-07-01',
          endDate: '2022-12-12',
          presentingProblem: 'Compulsions >6h/day with severe distress and avoidance.',
          primaryDiagnosis: 'OCD severe exacerbation',
          closureReason: 'stabilised',
          closureSummary: 'Improved after high-intensity ERP, medication optimisation, and family accommodation reduction.',
        },
        {
          key: 'relapse-2025',
          title: '[Psych Demo:OCD] Relapse linked to occupational stress',
          episodeType: 'cct',
          status: 'closed',
          startDate: '2025-01-20',
          endDate: '2025-06-15',
          presentingProblem: 'Re-emergence of checking rituals and reassurance loops under workload pressure.',
          primaryDiagnosis: 'OCD relapse (checking subtype)',
          closureReason: 'stabilised',
          closureSummary: 'Recovered functional gains with booster ERP and stepped supports.',
        },
      ],
      medications: [
        {
          key: 'sertraline',
          episodeKey: 'main',
          drugLabel: 'Sertraline',
          genericName: 'Sertraline',
          dose: '200',
          doseUnit: 'mg',
          route: 'oral',
          frequency: 'Mane',
          indication: 'OCD symptom burden',
          startDate: '2021-04-15',
          status: 'active',
          notes: '[Psych Demo:OCD] Long-term SSRI maintenance.',
        },
        {
          key: 'risperidone-augment',
          episodeKey: 'flare-2022',
          drugLabel: 'Risperidone',
          genericName: 'Risperidone',
          dose: '1',
          doseUnit: 'mg',
          route: 'oral',
          frequency: 'Nocte',
          indication: 'Augmentation for severe obsessional distress',
          startDate: '2022-08-01',
          endDate: '2023-02-10',
          status: 'ceased',
          reasonForCessation: 'Stepped down after sustained ERP response.',
          notes: '[Psych Demo:OCD] Time-limited augmentation phase.',
        },
      ],
      phases: [
        {
          key: 'flare-2022',
          startDate: '2022-07-01',
          endDate: '2022-12-12',
          lifeEvents: ['Pandemic-related contamination fears intensified rituals.', 'Family accommodation of compulsions increased.'],
          symptoms: ['Compulsive checking and washing occupied most waking hours.', 'Marked avoidance of work and social settings.'],
          mse: ['Anxious affect, perseverative thought themes, intact reality testing.', 'No psychosis; insight partial but present.'],
          plan: ['Intensive ERP schedule with carer psychoeducation.', 'SSRI optimisation and short-term antipsychotic augmentation.'],
        },
        {
          key: 'relapse-2025',
          startDate: '2025-01-20',
          endDate: '2025-06-15',
          lifeEvents: ['Promotion-related workload pressure and perfectionism trigger.'],
          symptoms: ['Reassurance seeking and checking rituals escalated.', 'Sleep and concentration worsened due repetitive mental review.'],
          mse: ['Thought form coherent; obsessional intrusions distressing but ego-dystonic.', 'No self-harm intent or psychotic symptoms.'],
          plan: ['ERP booster with exposure hierarchy refresh.', 'Workplace pacing and sleep restoration plan.'],
        },
        {
          key: 'maintenance',
          startDate: '2021-04-12',
          endDate: '2026-04-30',
          lifeEvents: ['Consistent psychologist engagement and family accommodation reduction.'],
          symptoms: ['Residual intrusive thoughts occur under stress but are managed with ERP skills.', 'Function generally stable between flares.'],
          mse: ['Affect reactive, insight good, judgement preserved.', 'Risk low with sustained collaborative care.'],
          plan: ['Quarterly review cadence with relapse triggers tracked.', 'Continue SSRI and booster ERP as needed.'],
        },
      ],
      gp: { name: 'Dr Benjamin Reid', email: 'benjamin.reid@gp.demo.local' },
    },
    {
      key: 'bpd',
      marker: '[Psych Demo:BPD]',
      patient: { givenName: 'Thomas', familyName: 'Nguyen' },
      diagnosisCode: 'F60.31',
      diagnosisDescription: 'Borderline personality disorder with affective instability, interpersonal crises, and episodic self-harm risk.',
      episodes: [
        {
          key: 'main',
          title: '[Psych Demo:BPD] Community continuing care',
          episodeType: 'cct',
          status: 'open',
          startDate: '2021-03-05',
          presentingProblem: 'Affective instability, impulsivity, and recurrent relationship-triggered crises.',
          primaryDiagnosis: 'Borderline personality disorder',
        },
        {
          key: 'crisis-2022',
          title: '[Psych Demo:BPD] Acute emotional dysregulation crisis',
          episodeType: 'acis',
          status: 'closed',
          startDate: '2022-10-14',
          endDate: '2023-01-22',
          presentingProblem: 'Self-harm urges, interpersonal rupture, and repeated after-hours presentations.',
          primaryDiagnosis: 'BPD crisis with high acute risk',
          closureReason: 'stabilised',
          closureSummary: 'Stabilised with crisis containment, DBT-informed interventions, and coordinated outreach.',
        },
        {
          key: 'crisis-2025',
          title: '[Psych Demo:BPD] Recurrent crisis phase',
          episodeType: 'cct',
          status: 'closed',
          startDate: '2025-07-01',
          endDate: '2025-11-12',
          presentingProblem: 'Escalating emotional reactivity, sleep disturbance, and interpersonal conflict.',
          primaryDiagnosis: 'BPD relapse with affective dysregulation',
          closureReason: 'stabilised',
          closureSummary: 'Improved with DBT skills reinforcement and coordinated psychosocial supports.',
        },
      ],
      medications: [
        {
          key: 'lamotrigine',
          episodeKey: 'main',
          drugLabel: 'Lamotrigine',
          genericName: 'Lamotrigine',
          dose: '100',
          doseUnit: 'mg',
          route: 'oral',
          frequency: 'Mane',
          indication: 'Affective lability support',
          startDate: '2021-04-01',
          status: 'active',
          notes: '[Psych Demo:BPD] Mood-reactivity modulation.',
        },
        {
          key: 'quetiapine-prn',
          episodeKey: 'crisis-2022',
          drugLabel: 'Quetiapine',
          genericName: 'Quetiapine',
          dose: '50',
          doseUnit: 'mg',
          route: 'oral',
          frequency: 'Nocte PRN',
          indication: 'Crisis insomnia and distress containment',
          startDate: '2022-10-20',
          endDate: '2023-03-01',
          status: 'ceased',
          reasonForCessation: 'No longer required after crisis resolution.',
          notes: '[Psych Demo:BPD] Time-limited PRN support during crisis.',
        },
      ],
      phases: [
        {
          key: 'crisis-2022',
          startDate: '2022-10-14',
          endDate: '2023-01-22',
          lifeEvents: ['Relationship breakdown and housing uncertainty preceded crisis.', 'After-hours contacts and ACIS escalation required.'],
          symptoms: ['Affective lability with rapid shifts to despair/anger.', 'Self-harm urges with impulsive behaviour under interpersonal stress.'],
          mse: ['Intense affect, thought content abandonment-focused, no psychosis.', 'Risk elevated but engagement with safety planning retained.'],
          plan: ['Daily crisis check-ins and DBT distress-tolerance coaching.', 'Family/carer communication boundaries and safety plan refresh.'],
        },
        {
          key: 'crisis-2025',
          startDate: '2025-07-01',
          endDate: '2025-11-12',
          lifeEvents: ['Work conflict and carer burnout increased emotional volatility.'],
          symptoms: ['Escalating anger episodes and sleep collapse.', 'Functional disruption in work attendance and social supports.'],
          mse: ['Mood reactive and labile; thought process coherent though ruminative.', 'No command hallucinations; intermittent passive self-harm ideation.'],
          plan: ['Intensified DBT skills schedule and occupational support.', 'Weekly consultant risk review until sustained stabilisation.'],
        },
        {
          key: 'maintenance',
          startDate: '2021-03-05',
          endDate: '2026-04-30',
          lifeEvents: ['Ongoing psychotherapy engagement and improved social scaffolding.'],
          symptoms: ['Residual sensitivity to rejection and stress-linked insomnia.', 'Function improves with proactive skills use and structured follow-up.'],
          mse: ['Affect generally regulated between crises with preserved insight.', 'Risk low-to-moderate with robust help-seeking.'],
          plan: ['Maintain 91-day multidisciplinary review cycle.', 'Continue DBT-informed care and relapse-prevention pathways.'],
        },
      ],
      gp: { name: 'Dr Natalie Ford', email: 'natalie.ford@gp.demo.local' },
    },
    {
      key: 'gad',
      marker: '[Psych Demo:GAD]',
      patient: { givenName: 'Zara', familyName: 'Coleman' },
      diagnosisCode: 'F41.1',
      diagnosisDescription: 'Generalised anxiety disorder with recurrent somatic anxiety and insomnia during stress-load transitions.',
      episodes: [
        {
          key: 'main',
          title: '[Psych Demo:GAD] Community continuing care',
          episodeType: 'cct',
          status: 'open',
          startDate: '2021-07-05',
          presentingProblem: 'Persistent worry, insomnia, autonomic anxiety, and functional over-control.',
          primaryDiagnosis: 'Generalised anxiety disorder',
        },
        {
          key: 'flare-2023',
          title: '[Psych Demo:GAD] High-anxiety flare with work impairment',
          episodeType: 'cct',
          status: 'closed',
          startDate: '2023-02-10',
          endDate: '2023-07-12',
          presentingProblem: 'Escalation in panic-spectrum symptoms and avoidance of workplace responsibilities.',
          primaryDiagnosis: 'Generalised anxiety disorder exacerbation',
          closureReason: 'stabilised',
          closureSummary: 'Improved with CBT refresh, graded exposure, and medication optimisation.',
        },
        {
          key: 'relapse-2025',
          title: '[Psych Demo:GAD] Relapse during family-stress period',
          episodeType: 'cct',
          status: 'closed',
          startDate: '2025-04-01',
          endDate: '2025-09-20',
          presentingProblem: 'Insomnia, concentration collapse, and somatic anxiety under caregiving strain.',
          primaryDiagnosis: 'Generalised anxiety disorder relapse',
          closureReason: 'stabilised',
          closureSummary: 'Functional recovery after stepped multidisciplinary support and sleep restoration.',
        },
      ],
      medications: [
        {
          key: 'escitalopram',
          episodeKey: 'main',
          drugLabel: 'Escitalopram',
          genericName: 'Escitalopram',
          dose: '20',
          doseUnit: 'mg',
          route: 'oral',
          frequency: 'Mane',
          indication: 'Baseline anxiety control',
          startDate: '2021-07-08',
          status: 'active',
          notes: '[Psych Demo:GAD] Long-term SSRI maintenance regimen.',
        },
        {
          key: 'propranolol-prn',
          episodeKey: 'flare-2023',
          drugLabel: 'Propranolol',
          genericName: 'Propranolol',
          dose: '10',
          doseUnit: 'mg',
          route: 'oral',
          frequency: 'TDS PRN',
          indication: 'Autonomic anxiety and situational panic symptoms',
          startDate: '2023-03-01',
          endDate: '2024-01-15',
          status: 'ceased',
          reasonForCessation: 'Reduced panic frequency and stable CBT response.',
          notes: '[Psych Demo:GAD] Time-limited PRN support during flare period.',
        },
      ],
      phases: [
        {
          key: 'flare-2023',
          startDate: '2023-02-10',
          endDate: '2023-07-12',
          lifeEvents: ['Role change at work increased decision-load and perfectionism stress.', 'Parent medical illness increased caregiving burden.'],
          symptoms: ['Persistent worry, muscle tension, and early-morning waking.', 'Avoidance and reduced concentration impacted work productivity.'],
          mse: ['Anxious affect with intact thought form and no psychosis.', 'Insight preserved; judgement intact with high help-seeking.'],
          plan: ['Structured CBT sessions with graded exposure and behavioural experiments.', 'Sleep protocol and short-term PRN support.'],
        },
        {
          key: 'relapse-2025',
          startDate: '2025-04-01',
          endDate: '2025-09-20',
          lifeEvents: ['Family legal and financial stressors escalated baseline anxiety.'],
          symptoms: ['Somatic arousal and rumination recurred with sleep disruption.', 'Social withdrawal increased during high-worry weeks.'],
          mse: ['Speech coherent; mood anxious; no suicidal intent or psychotic symptoms.', 'Risk low with strong engagement in care planning.'],
          plan: ['Increase psychotherapy frequency and occupational pacing.', 'Reinforce relapse signatures and carer-inclusive review.'],
        },
        {
          key: 'maintenance',
          startDate: '2021-07-05',
          endDate: '2026-04-30',
          lifeEvents: ['Steady engagement with psychotherapy and self-management tools.'],
          symptoms: ['Residual worry under load but improved distress tolerance.', 'Function mostly stable outside flare windows.'],
          mse: ['Affect reactive, thought process linear, insight good.', 'Risk remains low with active support network.'],
          plan: ['Maintain quarterly review cadence and proactive sleep-health checks.', 'Continue medication + CBT booster strategy.'],
        },
      ],
      gp: { name: 'Dr Eliza Brown', email: 'eliza.brown@gp.demo.local' },
    },
    {
      key: 'schizoaffective',
      marker: '[Psych Demo:Schizoaffective]',
      patient: { givenName: 'Ethan', familyName: 'Patel' },
      diagnosisCode: 'F25.0',
      diagnosisDescription: 'Schizoaffective disorder (bipolar type) with episodic psychosis and affective instability.',
      episodes: [
        {
          key: 'main',
          title: '[Psych Demo:Schizoaffective] Community continuing care',
          episodeType: 'cct',
          status: 'open',
          startDate: '2021-08-15',
          presentingProblem: 'Relapse prevention for psychotic and affective symptom recurrence.',
          primaryDiagnosis: 'Schizoaffective disorder, bipolar type',
        },
        {
          key: 'acute-2022',
          title: '[Psych Demo:Schizoaffective] Acute mixed relapse',
          episodeType: 'acis',
          status: 'closed',
          startDate: '2022-11-01',
          endDate: '2023-03-25',
          presentingProblem: 'Persecutory ideation with mood elevation, reduced sleep, and impulsive behaviour.',
          primaryDiagnosis: 'Schizoaffective disorder mixed relapse',
          closureReason: 'stabilised',
          closureSummary: 'Stabilised via ACIS intensity, antipsychotic optimisation, and structured recovery planning.',
        },
        {
          key: 'depressive-2024',
          title: '[Psych Demo:Schizoaffective] Depressive and negative-symptom phase',
          episodeType: 'cct',
          status: 'closed',
          startDate: '2024-06-20',
          endDate: '2024-12-15',
          presentingProblem: 'Low drive, social withdrawal, and reduced functioning with residual psychotic vulnerability.',
          primaryDiagnosis: 'Schizoaffective depressive relapse',
          closureReason: 'stabilised',
          closureSummary: 'Improved with integrated psychosocial supports and medication continuation.',
        },
      ],
      medications: [
        {
          key: 'paliperidone-lai',
          episodeKey: 'main',
          drugLabel: 'Paliperidone LAI',
          genericName: 'Paliperidone',
          dose: '150',
          doseUnit: 'mg',
          route: 'IM',
          frequency: 'Monthly',
          indication: 'Psychosis relapse prevention',
          startDate: '2021-09-01',
          status: 'active',
          notes: '[Psych Demo:Schizoaffective] Core LAI maintenance treatment.',
        },
        {
          key: 'lithium',
          episodeKey: 'acute-2022',
          drugLabel: 'Lithium Carbonate',
          genericName: 'Lithium carbonate',
          dose: '450',
          doseUnit: 'mg',
          route: 'oral',
          frequency: 'BD',
          indication: 'Affective instability and relapse prevention',
          startDate: '2022-11-10',
          status: 'active',
          notes: '[Psych Demo:Schizoaffective] Added during mixed relapse and maintained.',
        },
        {
          key: 'quetiapine-prn',
          episodeKey: 'acute-2022',
          drugLabel: 'Quetiapine',
          genericName: 'Quetiapine',
          dose: '50',
          doseUnit: 'mg',
          route: 'oral',
          frequency: 'Nocte PRN',
          indication: 'Short-term sleep and agitation support',
          startDate: '2022-11-12',
          endDate: '2023-05-30',
          status: 'ceased',
          reasonForCessation: 'Acute mixed symptoms settled; no longer clinically required.',
          notes: '[Psych Demo:Schizoaffective] Short-term adjunctive PRN support.',
        },
      ],
      phases: [
        {
          key: 'acute-2022',
          startDate: '2022-11-01',
          endDate: '2023-03-25',
          lifeEvents: ['Sleep deprivation and occupational conflict preceded relapse.', 'Carer stress and reduced adherence consistency were identified.'],
          symptoms: ['Persecutory thoughts, distractibility, and elevated drive present together.', 'Impulsivity and reduced judgement increased vulnerability.'],
          mse: ['Affect expansive-irritable; thought content paranoid; no sustained orientation deficits.', 'Insight limited during peak intensity; engagement improved with outreach.'],
          plan: ['ACIS daily contact with weekly consultant review.', 'Reinforce LAI adherence and affective stabiliser monitoring.'],
        },
        {
          key: 'depressive-2024',
          startDate: '2024-06-20',
          endDate: '2024-12-15',
          lifeEvents: ['Housing transition and social disconnection preceded low-mood decline.'],
          symptoms: ['Anhedonia, avolition, and social withdrawal with residual suspiciousness.', 'Functioning in daily routine and work participation declined.'],
          mse: ['Mood depressed, psychomotor slowing present, thought form coherent.', 'No active suicidal intent; risk managed with close follow-up.'],
          plan: ['Increase psychosocial intensity and behavioural activation.', 'Continue LAI and mood-stabiliser with metabolic surveillance.'],
        },
        {
          key: 'maintenance',
          startDate: '2021-08-15',
          endDate: '2026-04-30',
          lifeEvents: ['Steady family engagement and structured community supports maintained.'],
          symptoms: ['Intermittent anxiety and sleep disruption under stress.', 'No sustained psychosis outside identified relapse windows.'],
          mse: ['Generally euthymic with coherent thought form between relapses.', 'Risk low-to-moderate with preserved help-seeking.'],
          plan: ['Maintain multidisciplinary relapse-signature monitoring.', 'Quarterly physical-health and medication review cycle.'],
        },
      ],
      gp: { name: 'Dr Kieran Singh', email: 'kieran.singh@gp.demo.local' },
    },
  ];
}

async function seedScenario(clinic: ClinicRow, roles: Roles, scenario: CaseScenario): Promise<{ reviews: number; appointments: number; notes: number }> {
  const patient = await resolvePatient(clinic.id, scenario.patient.givenName, scenario.patient.familyName);
  const consentId = await ensureClinicalNoteConsent({
    clinicId: clinic.id,
    patientId: patient.id,
    clinicianId: roles.consultantPsychiatrist.id,
  });
  await cleanupScenarioRows(clinic.id, patient.id, scenario.marker);

  const episodeIdByKey = new Map<string, string>();
  for (const episode of scenario.episodes) {
    const episodeId = seedUuid(`${clinic.id}:${scenario.key}:episode:${episode.key}`);
    episodeIdByKey.set(episode.key, episodeId);
    await dbAdmin('episodes').insert({
      id: episodeId,
      clinic_id: clinic.id,
      patient_id: patient.id,
      title: episode.title,
      episode_type: episode.episodeType,
      status: episode.status,
      presenting_problem: episode.presentingProblem,
      primary_diagnosis: episode.primaryDiagnosis,
      start_date: episode.startDate,
      end_date: episode.endDate ?? null,
      closure_reason: episode.closureReason ?? null,
      closure_summary: episode.closureSummary ?? null,
      primary_clinician_id: roles.consultantPsychiatrist.id,
      key_worker_id: roles.keyClinicians[0]!.id,
      specialty_code: SPECIALTY_CODE,
      lock_version: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  await dbAdmin('diagnoses').insert({
    id: seedUuid(`${clinic.id}:${scenario.key}:diagnosis:primary`),
    clinic_id: clinic.id,
    patient_id: patient.id,
    episode_id: episodeIdByKey.get('main')!,
    created_by_id: roles.consultantPsychiatrist.id,
    icd_code: scenario.diagnosisCode,
    description: scenario.diagnosisDescription,
    diagnosed_date: scenario.episodes[0]!.startDate,
    status: 'active',
    is_primary: true,
    notes: `${scenario.marker} Primary diagnosis for 5-year longitudinal demo.`,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  const medicationIdByKey = new Map<string, string>();
  for (const med of scenario.medications) {
    const medicationId = seedUuid(`${clinic.id}:${scenario.key}:medication:${med.key}`);
    medicationIdByKey.set(med.key, medicationId);
    await dbAdmin('patient_medications').insert({
      id: medicationId,
      clinic_id: clinic.id,
      patient_id: patient.id,
      episode_id: episodeIdByKey.get(med.episodeKey)!,
      drug_label: med.drugLabel,
      generic_name: med.genericName,
      dose: med.dose,
      dose_unit: med.doseUnit,
      route: med.route,
      frequency: med.frequency,
      indication: med.indication,
      start_date: med.startDate,
      end_date: med.endDate ?? null,
      status: med.status,
      reason_for_cessation: med.reasonForCessation ?? null,
      is_regular: true,
      is_prn: med.frequency.toLowerCase().includes('prn'),
      is_lai: med.route.toLowerCase() === 'im',
      source: 'manual',
      prescribed_by_staff_id: roles.consultantPsychiatrist.id,
      recorded_by_staff_id: roles.juniorMedical.id,
      prescribed_by_specialty_code: SPECIALTY_CODE,
      notes: med.notes,
      lock_version: 1,
      created_at: isoAt(med.startDate, 2, 0),
      updated_at: isoAt(med.endDate ?? med.startDate, 2, 5),
    });
  }

  for (const med of scenario.medications) {
    const rxDate = med.startDate;
    await dbAdmin('prescriptions').insert({
      id: seedUuid(`${clinic.id}:${scenario.key}:prescription:${med.key}`),
      clinic_id: clinic.id,
      patient_id: patient.id,
      episode_id: episodeIdByKey.get(med.episodeKey)!,
      prescribed_by_staff_id: roles.consultantPsychiatrist.id,
      patient_medication_id: medicationIdByKey.get(med.key)!,
      generic_name: med.genericName,
      brand_name: med.drugLabel,
      dose: `${med.dose}${med.doseUnit}`,
      route: med.route,
      frequency: med.frequency,
      directions: `${med.drugLabel} ${med.dose}${med.doseUnit} ${med.frequency} for ${med.indication}.`,
      quantity: 30,
      repeats: 5,
      is_s8: false,
      prescription_type: 'standard',
      status: med.status === 'active' ? 'active' : 'dispensed',
      is_electronic: true,
      prescribed_date: rxDate,
      expires_at: addDays(rxDate, 365),
      cancellation_reason: med.status === 'ceased' ? (med.reasonForCessation ?? 'Treatment transition') : null,
      cancelled_at: med.status === 'ceased' ? isoAt(med.endDate ?? rxDate, 2, 30) : null,
      cancelled_by_staff_id: med.status === 'ceased' ? roles.consultantPsychiatrist.id : null,
      notes: `${scenario.marker} Prescription seed.`,
      created_at: isoAt(rxDate, 2, 30),
      updated_at: isoAt(rxDate, 2, 30),
    });
  }

  let appointmentCount = 0;
  let noteCount = 0;
  const reviewAuthorCycle = [roles.keyClinicians[0]!.id, roles.juniorMedical.id, roles.consultantPsychiatrist.id, roles.keyClinicians[1]!.id];
  const startTs = new Date(`${START_DATE}T00:00:00.000Z`);
  const endTs = new Date(`${END_DATE}T00:00:00.000Z`);
  for (let index = 0, cursor = new Date(startTs); cursor <= endTs; index += 1, cursor.setUTCDate(cursor.getUTCDate() + 35)) {
    const date = cursor.toISOString().slice(0, 10);
    const phase = scenarioForDate(scenario, date);
    const isAcute = phase.key !== 'maintenance';
    const episodeKey = isAcute && phase.key.includes('2022') ? scenario.episodes[1]!.key : isAcute && scenario.episodes[2] ? scenario.episodes[2]!.key : 'main';
    const episodeId = episodeIdByKey.get(episodeKey) ?? episodeIdByKey.get('main')!;
    const authorId = reviewAuthorCycle[index % reviewAuthorCycle.length]!;
    const appointmentStatus = index % 9 === 0 ? 'no_show' : 'completed';
    const start = isoAt(date, 1, 0);

    await dbAdmin('appointments').insert({
      id: seedUuid(`${clinic.id}:${scenario.key}:appointment:${date}`),
      clinic_id: clinic.id,
      patient_id: patient.id,
      clinician_id: authorId,
      staff_id: authorId,
      episode_id: episodeId,
      start_time: start,
      end_time: plusMinutes(start, 50),
      appointment_start: start,
      appointment_end: plusMinutes(start, 50),
      duration_minutes: 50,
      status: appointmentStatus,
      type: isAcute ? 'clinical_review' : 'follow_up',
      notes: `${scenario.marker} ${isAcute ? 'High-intensity review' : 'Routine longitudinal review'}.`,
      reminder_scheduled: true,
      reminder_sent: appointmentStatus !== 'no_show',
      reminder_sent_at: appointmentStatus !== 'no_show' ? plusMinutes(start, -60) : null,
      specialty_code: SPECIALTY_CODE,
      created_at: start,
      updated_at: start,
    });
    appointmentCount += 1;

    const activeMeds = scenario.medications
      .filter((med) => med.startDate <= date && (!med.endDate || med.endDate >= date))
      .map((med) => `${med.drugLabel} ${med.dose}${med.doseUnit} ${med.frequency}`);

    const noteContent =
      appointmentStatus === 'no_show'
        ? `${scenario.marker} Did not attend scheduled review. Welfare check completed and follow-up rebooked.`
        : formatReviewContent({
            marker: scenario.marker,
            context: `Longitudinal review at ${date} (phase: ${phase.key}).`,
            lifeEvents: phase.lifeEvents,
            symptoms: phase.symptoms,
            mse: phase.mse,
            medications: activeMeds.length > 0 ? activeMeds : ['No active psychotropic medication documented.'],
            plan: phase.plan,
          });

    await dbAdmin('clinical_notes').insert({
      id: seedUuid(`${clinic.id}:${scenario.key}:note:${date}`),
      clinic_id: clinic.id,
      patient_id: patient.id,
      consent_id: consentId,
      episode_id: episodeId,
      author_id: authorId,
      appointment_id: seedUuid(`${clinic.id}:${scenario.key}:appointment:${date}`),
      title: appointmentStatus === 'no_show' ? 'Did not attend scheduled review' : 'Longitudinal psychiatric review',
      note_type: appointmentStatus === 'no_show' ? 'contact' : 'review',
      note_category: appointmentStatus === 'no_show' ? 'dna' : 'weekly-review',
      source_type: DEMO_SOURCE_TYPE,
      note_date_time: start,
      note_date: date,
      content: noteContent,
      status: 'signed',
      is_draft: false,
      is_signed: true,
      is_reportable_contact: appointmentStatus !== 'no_show',
      contact_meta: JSON.stringify({
        planType: appointmentStatus === 'no_show' ? 'dna_follow_up' : 'weekly_review',
        team: phase.key.includes('acute') ? 'ACIS' : 'CCT',
        contactMedium: appointmentStatus === 'no_show' ? 'Phone' : 'Face-to-face',
        durationMin: appointmentStatus === 'no_show' ? 15 : 55,
      }),
      did_not_attend: appointmentStatus === 'no_show',
      is_ai_draft: false,
      signed_at: start,
      signed_by_id: authorId,
      lock_version: 1,
      created_at: start,
      updated_at: start,
    });
    noteCount += 1;
  }

  let reviewCount = 0;
  for (let cursor = new Date(`${START_DATE}T00:00:00.000Z`), index = 1; cursor <= endTs; cursor.setUTCDate(cursor.getUTCDate() + 91), index += 1) {
    const date = cursor.toISOString().slice(0, 10);
    const phase = scenarioForDate(scenario, date);
    const episodeKey = phase.key === 'maintenance' ? 'main' : phase.key.includes('2022') ? scenario.episodes[1]!.key : scenario.episodes[2]!.key;
    const episodeId = episodeIdByKey.get(episodeKey) ?? episodeIdByKey.get('main')!;
    const authorId = reviewAuthorCycle[(index - 1) % reviewAuthorCycle.length]!;
    const createdAt = isoAt(date, 5, 0);
    const periodStart = addDays(date, -90);

    const medsDuringReview = scenario.medications
      .filter((med) => med.startDate <= date && (!med.endDate || med.endDate >= date))
      .map((med) => `${med.drugLabel} ${med.dose}${med.doseUnit} ${med.frequency}`);

    const content = formatReviewContent({
      marker: scenario.marker,
      context: `91-day review ${index} covering ${periodStart} to ${date}.`,
      lifeEvents: phase.lifeEvents,
      symptoms: [...phase.symptoms, 'Course trajectory and relapse markers were reviewed against prior quarter.'],
      mse: [...phase.mse, 'Risk profile and decision-making capacity reviewed and documented.'],
      medications: medsDuringReview.length > 0 ? medsDuringReview : ['No active medications in this window.'],
      plan: [...phase.plan, 'Continue 91-day multidisciplinary review and update care trajectory as presentation changes.'],
    });

    await dbAdmin('clinical_notes').insert({
      id: seedUuid(`${clinic.id}:${scenario.key}:91day-note:${index}`),
      clinic_id: clinic.id,
      patient_id: patient.id,
      consent_id: consentId,
      episode_id: episodeId,
      author_id: authorId,
      title: `91-Day Review ${index}`,
      note_type: 'review',
      note_category: '91-day-review',
      source_type: DEMO_SOURCE_TYPE,
      note_date_time: createdAt,
      note_date: date,
      content,
      status: 'signed',
      is_draft: false,
      is_signed: true,
      is_reportable_contact: true,
      contact_meta: JSON.stringify({ planType: '91_day_review', team: 'CCT', contactMedium: 'Face-to-face', durationMin: 60 }),
      did_not_attend: false,
      is_ai_draft: false,
      signed_at: createdAt,
      signed_by_id: authorId,
      lock_version: 1,
      created_at: createdAt,
      updated_at: createdAt,
    });

    await dbAdmin('clinical_reviews').insert({
      id: seedUuid(`${clinic.id}:${scenario.key}:91day-review:${index}`),
      clinic_id: clinic.id,
      patient_id: patient.id,
      episode_id: episodeId,
      reviewed_by_id: authorId,
      review_type: '91-day',
      review_date: date,
      summary: `${scenario.marker} 91-day review ${index}: trajectory across ${periodStart} to ${date}, including symptom polarity, MSE progression, and risk evolution.`,
      recommendations: `Maintain active regimen (${medsDuringReview.join('; ') || 'none'}) and update psychosocial interventions according to clinical change.`,
      status: 'completed',
      created_at: createdAt,
      updated_at: createdAt,
    });
    reviewCount += 1;
  }

  const observationDates = ['2021-10-01', '2022-05-20', '2023-03-15', '2024-09-10', '2026-02-01'];
  for (const obsDate of observationDates) {
    await dbAdmin('structured_observations').insert({
      id: seedUuid(`${clinic.id}:${scenario.key}:observation:${obsDate}`),
      clinic_id: clinic.id,
      patient_id: patient.id,
      staff_id: roles.juniorMedical.id,
      observation_type: 'physical_health',
      location: 'Community clinic',
      mood: null,
      behaviour: null,
      risk_concerns: null,
      sleep_quality: null,
      values: JSON.stringify({ bp: '122/78', weightKg: 76 + (obsDate.charCodeAt(3) % 6), bmi: 24 + (obsDate.charCodeAt(5) % 3) * 0.4 }),
      notes: `${scenario.marker} Quarterly physical health check.`,
      observed_at: isoAt(obsDate, 4, 0),
      created_at: isoAt(obsDate, 4, 0),
      escalation_required: false,
      escalation_notes: null,
    });
  }

  const threadId = seedUuid(`${clinic.id}:${scenario.key}:message-thread:coordination`);
  await dbAdmin('message_threads').insert({
    id: threadId,
    clinic_id: clinic.id,
    created_by_id: roles.consultantPsychiatrist.id,
    patient_id: patient.id,
    subject: `${scenario.marker} MDT coordination`,
    last_message_at: isoAt('2026-02-15', 6, 0),
    created_at: isoAt('2024-01-10', 6, 0),
    updated_at: isoAt('2026-02-15', 6, 0),
  });
  for (const participant of [roles.consultantPsychiatrist, roles.juniorMedical, ...roles.keyClinicians]) {
    await dbAdmin('message_thread_participants').insert({
      id: seedUuid(`${threadId}:${participant.id}`),
      thread_id: threadId,
      user_id: participant.id,
      last_read_at: null,
      created_at: isoAt('2024-01-10', 6, 0),
      updated_at: isoAt('2024-01-10', 6, 0),
    });
  }
  const messageRows = [
    { key: 'm1', date: '2024-01-10', sender: roles.consultantPsychiatrist.id, body: 'Please maintain weekly symptom and risk checks and update MDT if deterioration emerges.' },
    { key: 'm2', date: '2024-06-05', sender: roles.keyClinicians[0]!.id, body: 'Functional plan updated with OT and psychologist links; patient engagement remains strong.' },
    { key: 'm3', date: '2026-02-15', sender: roles.juniorMedical.id, body: 'Medication and physical health monitoring complete this quarter. No urgent concerns.' },
  ];
  for (const row of messageRows) {
    await dbAdmin('messages').insert({
      id: seedUuid(`${threadId}:${row.key}`),
      thread_id: threadId,
      sender_id: row.sender,
      clinic_id: clinic.id,
      content: JSON.stringify({ body: `${scenario.marker} ${row.body}`, patientId: patient.id }),
      is_read: false,
      created_at: isoAt(row.date, 6, 0),
      updated_at: isoAt(row.date, 6, 0),
    });
  }

  const letterDates = ['2022-03-01', '2024-09-01', '2026-03-01'];
  for (const letterDate of letterDates) {
    const createdAt = isoAt(letterDate, 7, 0);
    await dbAdmin('correspondence_letters').insert({
      id: seedUuid(`${clinic.id}:${scenario.key}:letter:${letterDate}`),
      patient_id: patient.id,
      clinic_id: clinic.id,
      episode_id: episodeIdByKey.get('main')!,
      author_id: roles.consultantPsychiatrist.id,
      recipient_name: scenario.gp.name,
      recipient_email: scenario.gp.email,
      letter_type: 'gp-update',
      subject: `${scenario.marker} GP longitudinal update`,
      body: `Five-year longitudinal update for ${patient.given_name} ${patient.family_name}: diagnosis trajectory, symptom pattern, treatment response, risk review, and next-quarter plan.`,
      content: `Five-year longitudinal update for ${patient.given_name} ${patient.family_name}.`,
      status: 'sent',
      notes: `${scenario.marker} Generated for longitudinal demo dataset.`,
      sent_via: 'secure_email',
      created_at: createdAt,
      sent_at: plusMinutes(createdAt, 15),
    });
  }

  return { reviews: reviewCount, appointments: appointmentCount, notes: noteCount };
}

async function main(): Promise<void> {
  const clinic = await resolveClinic();
  const actorStaffId = await resolveClinicActorStaffId(clinic.id);
  const scenarios = buildScenarios();

  const summaryRows = await runInClinicRlsContext(clinic.id, actorStaffId, async () => {
    const roles = await resolveRoles(clinic.id);
    const rows: string[] = [];
    for (const scenario of scenarios) {
      const patient = await resolvePatient(clinic.id, scenario.patient.givenName, scenario.patient.familyName);
      const seeded = await seedScenario(clinic, roles, scenario);
      rows.push(
        `- ${patient.given_name} ${patient.family_name} (${scenario.key}): ${seeded.notes} longitudinal notes, ${seeded.reviews} 91-day reviews, ${seeded.appointments} appointments.`,
      );
    }
    return rows;
  });

  const outputDir = path.resolve(__dirname, '..', '..', '..', 'docs', 'demo');
  const outputPath = path.join(outputDir, 'additional-psychiatric-longitudinal-demos.md');
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    outputPath,
    [
      '# Additional Psychiatric Longitudinal Demo Histories',
      '',
      '> Generated clinical demo-only records across 5-year timelines.',
      '',
      `Generated at: ${new Date().toISOString()}`,
      `Clinic: ${clinic.name}`,
      '',
      'Scenarios:',
      ...summaryRows,
      '',
      'Coverage includes:',
      '- Multi-year episodes with acute and maintenance phases',
      '- Repeated longitudinal clinical notes with symptom / MSE / medication / plan',
      '- 91-day review notes + clinical_reviews records',
      '- Medication and prescription history including active and ceased regimens',
      '- Appointment history including did-not-attend entries',
      '- MDT messages and GP correspondence letters',
      '- Structured physical-health observation checkpoints',
    ].join('\n'),
    'utf8',
  );

  // avoid idle handles in script execution environment
  clearPoolMonitor();
  await dbAdmin.destroy();
  await appPoolRaw.destroy();
  process.stdout.write(`Seed complete. Summary written to ${outputPath}\n`);
  process.exit(0);
}

main().catch(async (error) => {
  clearPoolMonitor();
  await dbAdmin.destroy();
  await appPoolRaw.destroy();
  process.stderr.write(`Failed to seed psychiatric longitudinal demos: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
