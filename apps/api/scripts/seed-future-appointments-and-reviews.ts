import 'dotenv/config';
import { createHash } from 'crypto';
import { appPoolRaw, clearPoolMonitor, dbAdmin, rlsStore } from '../src/db/db';

type ClinicRow = {
  id: string;
  name: string;
};

type StaffRow = {
  id: string;
  role: string;
};

type EpisodePatientRow = {
  episode_id: string;
  patient_id: string;
  patient_name: string;
  start_date: string | null;
  updated_at: string;
  primary_clinician_id: string | null;
};

type AppointmentStatus =
  | 'scheduled'
  | 'confirmed'
  | 'arrived'
  | 'in_session'
  | 'completed'
  | 'cancelled'
  | 'no_show'
  | 'rescheduled';

type AppointmentType =
  | 'initial'
  | 'follow_up'
  | 'assessment'
  | 'telehealth'
  | 'group'
  | 'clinical_review';

type Scenario = {
  key: string;
  label: string;
  focus: string;
  participant: 'patient_only' | 'patient_with_family';
  offsetDays: number;
  status: AppointmentStatus;
  type: AppointmentType;
  durationMinutes: number;
  withSecondaryClinician?: boolean;
  telehealth?: boolean;
};

type SeedOutcome = {
  skippedReason?: string;
  patients: number;
  inserted: number;
};

const CLINIC_NAME_FILTER = process.env.DEMO_CASES_CLINIC_NAME?.trim() || '';
const MARKER = '[DEMO-DIVERSE-APPOINTMENTS]';
const MAX_PATIENTS_PER_CLINIC = Number(process.env.DEMO_APPOINTMENT_MAX_PATIENTS ?? 12);

const SCENARIOS: Scenario[] = [
  {
    key: 'past-initial-assessment',
    label: 'Initial Assessment',
    focus: 'Initial psychiatric assessment',
    participant: 'patient_only',
    offsetDays: -330,
    status: 'completed',
    type: 'initial',
    durationMinutes: 60,
  },
  {
    key: 'past-psychology-assessment',
    label: 'Psychology Appointment',
    focus: 'Psychological formulation and therapy planning',
    participant: 'patient_only',
    offsetDays: -250,
    status: 'completed',
    type: 'assessment',
    durationMinutes: 50,
    withSecondaryClinician: true,
  },
  {
    key: 'past-family-review',
    label: 'Family Review',
    focus: 'Family-inclusive care review and psychoeducation',
    participant: 'patient_with_family',
    offsetDays: -205,
    status: 'completed',
    type: 'group',
    durationMinutes: 60,
  },
  {
    key: 'past-mha-review',
    label: 'MHA Review',
    focus: 'Mental Health Act review and legal-order status check',
    participant: 'patient_only',
    offsetDays: -155,
    status: 'completed',
    type: 'clinical_review',
    durationMinutes: 45,
  },
  {
    key: 'past-linkage',
    label: 'Linkage Appointment',
    focus: 'Community linkage with psychosocial supports',
    participant: 'patient_only',
    offsetDays: -110,
    status: 'completed',
    type: 'follow_up',
    durationMinutes: 40,
    withSecondaryClinician: true,
  },
  {
    key: 'past-no-show',
    label: 'Review Follow-up (DNA)',
    focus: 'Follow-up review',
    participant: 'patient_only',
    offsetDays: -70,
    status: 'no_show',
    type: 'follow_up',
    durationMinutes: 30,
  },
  {
    key: 'past-review',
    label: 'Clinical Review',
    focus: 'Routine psychiatric review',
    participant: 'patient_only',
    offsetDays: -28,
    status: 'completed',
    type: 'follow_up',
    durationMinutes: 40,
  },
  {
    key: 'future-upcoming-review',
    label: 'Upcoming Review',
    focus: 'Routine key-clinician follow-up',
    participant: 'patient_only',
    offsetDays: 10,
    status: 'confirmed',
    type: 'follow_up',
    durationMinutes: 40,
  },
  {
    key: 'future-family-review',
    label: 'Family Review',
    focus: 'Family-inclusive review',
    participant: 'patient_with_family',
    offsetDays: 26,
    status: 'scheduled',
    type: 'group',
    durationMinutes: 50,
  },
  {
    key: 'future-psychology',
    label: 'Psychology Appointment',
    focus: 'Psychology intervention review',
    participant: 'patient_only',
    offsetDays: 45,
    status: 'scheduled',
    type: 'assessment',
    durationMinutes: 50,
    withSecondaryClinician: true,
  },
  {
    key: 'future-mha-review',
    label: 'MHA Review',
    focus: 'Mental Health Act review checkpoint',
    participant: 'patient_only',
    offsetDays: 74,
    status: 'scheduled',
    type: 'clinical_review',
    durationMinutes: 45,
  },
  {
    key: 'future-linkage',
    label: 'Linkage Appointment',
    focus: 'External service linkage and care coordination',
    participant: 'patient_only',
    offsetDays: 110,
    status: 'scheduled',
    type: 'follow_up',
    durationMinutes: 40,
    withSecondaryClinician: true,
  },
  {
    key: 'future-telehealth',
    label: 'Telehealth Psychiatric Review',
    focus: 'Telehealth psychiatric review',
    participant: 'patient_only',
    offsetDays: 165,
    status: 'scheduled',
    type: 'telehealth',
    durationMinutes: 40,
  },
  {
    key: 'future-next-year-review',
    label: 'Next-Year Clinical Review',
    focus: 'Longer-horizon longitudinal review',
    participant: 'patient_only',
    offsetDays: 320,
    status: 'scheduled',
    type: 'clinical_review',
    durationMinutes: 45,
  },
];

function seedUuid(seed: string): string {
  const hex = createHash('sha256').update(seed).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDays(baseDate: Date, days: number): Date {
  const next = new Date(baseDate);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function atUtcHour(date: Date, hour: number, minute = 0): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour, minute, 0, 0));
  return d.toISOString();
}

function plusMinutes(isoTimestamp: string, minutes: number): string {
  return new Date(new Date(isoTimestamp).getTime() + minutes * 60_000).toISOString();
}

async function resolveClinic(): Promise<ClinicRow> {
  if (CLINIC_NAME_FILTER) {
    const clinic = await dbAdmin('clinics')
      .where({ name: CLINIC_NAME_FILTER, is_active: true })
      .whereNull('deleted_at')
      .first('id', 'name') as ClinicRow | undefined;
    if (!clinic) {
      throw new Error(`Clinic "${CLINIC_NAME_FILTER}" not found.`);
    }
    return clinic;
  }

  const clinic = await dbAdmin('clinics')
    .where({ is_active: true })
    .whereNull('deleted_at')
    .orderBy('name', 'asc')
    .first('id', 'name') as ClinicRow | undefined;

  if (!clinic) {
    throw new Error('No active clinics found.');
  }
  return clinic;
}

async function resolveFallbackClinicianId(clinicId: string): Promise<string> {
  const clinician = await dbAdmin('staff')
    .where({ clinic_id: clinicId, is_active: true, role: 'clinician' })
    .whereNull('deleted_at')
    .orderBy('updated_at', 'desc')
    .first('id') as { id: string } | undefined;

  if (!clinician?.id) {
    throw new Error(`No active clinician found in clinic ${clinicId}.`);
  }
  return clinician.id;
}

async function resolveClinicians(clinicId: string): Promise<StaffRow[]> {
  const clinicians = await dbAdmin('staff')
    .where({ clinic_id: clinicId, is_active: true, role: 'clinician' })
    .whereNull('deleted_at')
    .orderBy('updated_at', 'desc')
    .select('id', 'role') as StaffRow[];

  return clinicians;
}

async function resolveTargetClinics(): Promise<ClinicRow[]> {
  if (CLINIC_NAME_FILTER) {
    return [await resolveClinic()];
  }

  return dbAdmin('clinics as c')
    .where({ 'c.is_active': true })
    .whereNull('c.deleted_at')
    .orderBy('c.name', 'asc')
    .select('c.id', 'c.name') as Promise<ClinicRow[]>;
}

async function resolveClinicActorStaffId(clinicId: string): Promise<string | null> {
  const actor = await dbAdmin('staff')
    .where({ clinic_id: clinicId, is_active: true })
    .whereIn('role', ['admin', 'manager', 'clinician'])
    .whereNull('deleted_at')
    .orderByRaw("CASE role WHEN 'admin' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END")
    .orderBy('updated_at', 'desc')
    .first<{ id: string }>('id');
  return actor?.id ?? null;
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

async function resolveOpenEpisodes(clinicId: string): Promise<EpisodePatientRow[]> {
  const rows = await dbAdmin('episodes as e')
    .join('patients as p', 'p.id', 'e.patient_id')
    .where('e.clinic_id', clinicId)
    .whereNull('e.deleted_at')
    .whereNull('p.deleted_at')
    .where('e.status', 'open')
    .select(
      'e.id as episode_id',
      'e.patient_id',
      dbAdmin.raw("TRIM(COALESCE(p.given_name, '') || ' ' || COALESCE(p.family_name, '')) as patient_name"),
      'e.start_date',
      'e.updated_at',
      'e.primary_clinician_id',
    ) as EpisodePatientRow[];

  // Use one open episode per patient (latest by start date, then updated_at)
  const byPatient = new Map<string, EpisodePatientRow>();
  for (const row of rows) {
    const existing = byPatient.get(row.patient_id);
    if (!existing) {
      byPatient.set(row.patient_id, row);
      continue;
    }
    const rowKey = `${row.start_date ?? ''}|${row.updated_at}`;
    const existingKey = `${existing.start_date ?? ''}|${existing.updated_at}`;
    if (rowKey > existingKey) {
      byPatient.set(row.patient_id, row);
    }
  }
  return Array.from(byPatient.values())
    .sort((a, b) => (a.patient_name || '').localeCompare(b.patient_name || ''))
    .slice(0, Math.max(1, MAX_PATIENTS_PER_CLINIC));
}

function attendanceStatusForAppointmentStatus(status: AppointmentStatus): 'required' | 'attended' | 'did_not_attend' | 'declined' {
  if (status === 'completed') return 'attended';
  if (status === 'no_show') return 'did_not_attend';
  if (status === 'cancelled') return 'declined';
  return 'required';
}

function stripUuid(value: string): string {
  return value.replace(/-/g, '').slice(0, 6);
}

function locationForScenario(scenario: Scenario): string {
  if (scenario.type === 'telehealth') return 'Telehealth';
  if (scenario.participant === 'patient_with_family') return 'Family Consultation Room';
  if (scenario.focus.toLowerCase().includes('linkage')) return 'Community Linkage Hub';
  if (scenario.focus.toLowerCase().includes('psychology')) return 'Psychology Room';
  return 'Clinic Room';
}

function patientResponseForScenario(scenario: Scenario): string {
  return scenario.participant === 'patient_with_family' ? 'family_present' : 'patient_only';
}

async function cleanupMarkerRows(clinicId: string): Promise<void> {
  const existingIds = (await dbAdmin('appointments')
    .where({ clinic_id: clinicId })
    .whereILike('notes', `%${MARKER}%`)
    .select('id'))
    .map((row) => String(row.id));

  if (existingIds.length === 0) return;

  await dbAdmin('appointment_attendees')
    .where({ clinic_id: clinicId })
    .whereIn('appointment_id', existingIds)
    .del();

  await dbAdmin('appointments')
    .where({ clinic_id: clinicId })
    .whereIn('id', existingIds)
    .del();
}

async function seedFutureAppointmentsAndReviews(): Promise<void> {
  const clinics = await resolveTargetClinics();
  const today = new Date();
  const nowIso = new Date().toISOString();

  const summaryLines: string[] = [];

  for (const clinic of clinics) {
    const actorStaffId = await resolveClinicActorStaffId(clinic.id);
    if (!actorStaffId) {
      summaryLines.push(`- ${clinic.name}: skipped (no active admin/manager/clinician actor).`);
      continue;
    }
    const outcome = await runInClinicRlsContext(clinic.id, actorStaffId, async (): Promise<SeedOutcome> => {
      const clinicians = await resolveClinicians(clinic.id);
      if (clinicians.length === 0) {
        return { skippedReason: 'no active clinicians', patients: 0, inserted: 0 };
      }

      const fallbackClinicianId = clinicians[0]?.id ?? (await resolveFallbackClinicianId(clinic.id));
      const episodes = await resolveOpenEpisodes(clinic.id);
      if (episodes.length === 0) {
        return { skippedReason: 'no open episodes/patients', patients: 0, inserted: 0 };
      }

      await cleanupMarkerRows(clinic.id);

      let inserted = 0;

      for (const [patientIndex, row] of episodes.entries()) {
        const primaryClinicianId = clinicians.some((c) => c.id === row.primary_clinician_id)
          ? (row.primary_clinician_id as string)
          : fallbackClinicianId;
        const primaryIndex = Math.max(
          0,
          clinicians.findIndex((c) => c.id === primaryClinicianId),
        );

        for (const [scenarioIndex, scenario] of SCENARIOS.entries()) {
          const scheduledDate = addDays(today, scenario.offsetDays);
          const hour = 8 + ((patientIndex + scenarioIndex) % 8);
          const minute = (scenarioIndex % 2) * 30;
          const startIso = atUtcHour(scheduledDate, hour, minute);
          const endIso = plusMinutes(startIso, scenario.durationMinutes);
          const dateLabel = toIsoDate(scheduledDate);

          const secondaryClinicianId = scenario.withSecondaryClinician && clinicians.length > 1
            ? clinicians[(primaryIndex + 1 + scenarioIndex) % clinicians.length]?.id ?? null
            : null;

          const appointmentId = seedUuid(`${clinic.id}:${row.episode_id}:diverse-appt:${scenario.key}:${dateLabel}`);
          const focusSuffix = scenario.participant === 'patient_with_family'
            ? 'Attendance: patient + family support.'
            : 'Attendance: patient.';
          const noteText = `${MARKER} ${scenario.label} — ${scenario.focus}. ${focusSuffix} Patient: ${row.patient_name}.`;

          let seededStartIso = startIso;
          let seededEndIso = endIso;
          let appointmentInserted = false;
          for (let attempt = 0; attempt < 8; attempt += 1) {
            const slotConflict = await dbAdmin('appointments')
              .where({
                clinic_id: clinic.id,
                clinician_id: primaryClinicianId,
                appointment_start: seededStartIso,
                appointment_end: seededEndIso,
              })
              .whereNull('deleted_at')
              .whereNotIn('status', ['cancelled', 'no_show'])
              .first('id');

            if (slotConflict?.id) {
              seededStartIso = plusMinutes(seededStartIso, 15);
              seededEndIso = plusMinutes(seededEndIso, 15);
              continue;
            }

            await dbAdmin('appointments')
              .insert({
                id: appointmentId,
                clinic_id: clinic.id,
                patient_id: row.patient_id,
                clinician_id: primaryClinicianId,
                staff_id: primaryClinicianId,
                episode_id: row.episode_id,
                start_time: seededStartIso,
                end_time: seededEndIso,
                appointment_start: seededStartIso,
                appointment_end: seededEndIso,
                duration_minutes: scenario.durationMinutes,
                status: scenario.status,
                type: scenario.type,
                appointment_type: scenario.type,
                mode: scenario.type === 'telehealth' ? 'telehealth' : 'in_person',
                location: locationForScenario(scenario),
                patient_response: patientResponseForScenario(scenario),
                notes: noteText,
                telehealth: Boolean(scenario.telehealth || scenario.type === 'telehealth'),
                telehealth_url: scenario.telehealth || scenario.type === 'telehealth'
                  ? `https://telehealth.demo.local/session/${stripUuid(appointmentId)}`
                  : null,
                reminder_scheduled: scenario.offsetDays >= 0,
                reminder_sent: scenario.offsetDays < 0 && scenario.status !== 'no_show',
                reminder_sent_at: scenario.offsetDays < 0 ? plusMinutes(seededStartIso, -60) : null,
                specialty_code: 'mental_health',
                created_at: nowIso,
                updated_at: nowIso,
              })
              .onConflict('id')
              .ignore();
            appointmentInserted = true;
            break;
          }
          if (!appointmentInserted) continue;

          const primaryAttendance = attendanceStatusForAppointmentStatus(scenario.status);
          await dbAdmin('appointment_attendees')
            .insert({
              id: seedUuid(`${appointmentId}:attendee:${primaryClinicianId}:primary`),
              clinic_id: clinic.id,
              appointment_id: appointmentId,
              staff_id: primaryClinicianId,
              role: 'primary',
              attendance_status: primaryAttendance,
              invited_at: plusMinutes(seededStartIso, -120),
              responded_at: scenario.offsetDays < 0 ? plusMinutes(seededStartIso, -90) : null,
              created_at: nowIso,
              updated_at: nowIso,
            })
            .onConflict(['appointment_id', 'staff_id'])
            .merge({
              role: 'primary',
              attendance_status: primaryAttendance,
              updated_at: nowIso,
            });

          if (secondaryClinicianId && secondaryClinicianId !== primaryClinicianId) {
            const coAttendance =
              primaryAttendance === 'declined'
                ? 'declined'
                : primaryAttendance === 'did_not_attend'
                  ? 'did_not_attend'
                  : primaryAttendance;
            await dbAdmin('appointment_attendees')
              .insert({
                id: seedUuid(`${appointmentId}:attendee:${secondaryClinicianId}:co`),
                clinic_id: clinic.id,
                appointment_id: appointmentId,
                staff_id: secondaryClinicianId,
                role: 'co_clinician',
                attendance_status: coAttendance,
                invited_at: plusMinutes(seededStartIso, -120),
                responded_at: scenario.offsetDays < 0 ? plusMinutes(seededStartIso, -90) : null,
                created_at: nowIso,
                updated_at: nowIso,
              })
              .onConflict(['appointment_id', 'staff_id'])
              .merge({
                role: 'co_clinician',
                attendance_status: coAttendance,
                updated_at: nowIso,
              });
          }

          inserted += 1;
        }
      }

      return { patients: episodes.length, inserted };
    });

    if (outcome.skippedReason) {
      summaryLines.push(`- ${clinic.name}: skipped (${outcome.skippedReason}).`);
      continue;
    }

    const markerTotal = await runInClinicRlsContext(clinic.id, actorStaffId, async () => {
      const row = await dbAdmin('appointments')
        .where({ clinic_id: clinic.id })
        .whereILike('notes', `%${MARKER}%`)
        .count('* as cnt')
        .first() as { cnt: string };
      return row.cnt;
    });

    summaryLines.push(
      `- ${clinic.name}: patients=${outcome.patients}, scenarios=${SCENARIOS.length}, inserted=${outcome.inserted}, marker-total=${markerTotal}`,
    );
  }

  process.stdout.write(
    [
      `Seed marker: ${MARKER}`,
      `Date range covered: ${SCENARIOS[0]?.offsetDays ?? -330}d to ${SCENARIOS[SCENARIOS.length - 1]?.offsetDays ?? 320}d around today.`,
      `Clinics processed: ${clinics.length}`,
      ...summaryLines,
    ].join('\n') + '\n',
  );
}

seedFutureAppointmentsAndReviews()
  .catch((error) => {
    process.stderr.write(`Failed to seed diverse appointments: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await dbAdmin.destroy();
    await appPoolRaw.destroy();
    clearPoolMonitor();
  });
