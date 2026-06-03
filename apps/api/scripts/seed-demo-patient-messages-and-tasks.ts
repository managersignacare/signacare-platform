import 'dotenv/config';
import { createHash } from 'crypto';
import { clearPoolMonitor, dbAdmin } from '../src/db/db';

type ClinicRow = {
  id: string;
  name: string;
};

type StaffRow = {
  id: string;
  role: string;
  given_name: string;
  family_name: string;
};

type EpisodePatientRow = {
  episode_id: string;
  patient_id: string;
  patient_given_name: string;
  patient_family_name: string;
  primary_clinician_id: string | null;
};

const MARKER = '[DEMO-PATIENT-MESSAGES-TASKS]';
const CLINIC_NAME_HINT = (process.env.DEMO_CASES_CLINIC_NAME?.trim() || 'Soham').toLowerCase();
const MAX_PATIENTS_PER_CLINIC = Number(process.env.DEMO_MESSAGES_TASKS_MAX_PATIENTS ?? 10);

function seedUuid(seed: string): string {
  const hex = createHash('sha256').update(seed).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function plusDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function plusMinutes(base: Date, minutes: number): Date {
  const d = new Date(base);
  d.setUTCMinutes(d.getUTCMinutes() + minutes);
  return d;
}

async function resolveClinics(): Promise<ClinicRow[]> {
  const hinted = await dbAdmin('clinics as c')
    .whereRaw('lower(c.name) like ?', [`%${CLINIC_NAME_HINT}%`])
    .whereExists(
      dbAdmin('patients as p')
        .whereRaw('p.clinic_id = c.id')
        .whereNull('p.deleted_at'),
    )
    .select('c.id', 'c.name')
    .orderBy('c.name');

  if (hinted.length > 0) return hinted as ClinicRow[];

  const fallback = await dbAdmin('clinics as c')
    .whereExists(
      dbAdmin('patients as p')
        .whereRaw('p.clinic_id = c.id')
        .whereNull('p.deleted_at'),
    )
    .select('c.id', 'c.name')
    .orderBy('c.name')
    .limit(1);
  return fallback as ClinicRow[];
}

async function loadStaffByClinic(clinicId: string): Promise<StaffRow[]> {
  return dbAdmin('staff')
    .where({ clinic_id: clinicId })
    .whereNull('deleted_at')
    .select('id', 'role', 'given_name', 'family_name')
    .orderBy('given_name') as Promise<StaffRow[]>;
}

async function loadOpenEpisodesWithPatients(clinicId: string): Promise<EpisodePatientRow[]> {
  return dbAdmin('episodes as e')
    .join('patients as p', 'e.patient_id', 'p.id')
    .where('e.clinic_id', clinicId)
    .where('e.status', 'open')
    .whereNull('e.deleted_at')
    .whereNull('p.deleted_at')
    .select(
      'e.id as episode_id',
      'p.id as patient_id',
      'p.given_name as patient_given_name',
      'p.family_name as patient_family_name',
      'e.primary_clinician_id',
    )
    .orderBy('p.given_name') as Promise<EpisodePatientRow[]>;
}

async function cleanupMarkerData(clinicId: string): Promise<void> {
  const markerThreads = await dbAdmin('message_threads')
    .where({ clinic_id: clinicId })
    .where('subject', 'like', `${MARKER}%`)
    .select('id');

  const threadIds = markerThreads.map((r) => String(r.id));
  if (threadIds.length > 0) {
    await dbAdmin('messages').whereIn('thread_id', threadIds).del();
    await dbAdmin('message_thread_participants').whereIn('thread_id', threadIds).del();
    await dbAdmin('message_threads').whereIn('id', threadIds).del();
  }

  await dbAdmin('tasks')
    .where({ clinic_id: clinicId })
    .where((qb) => {
      qb.where('title', 'like', `${MARKER}%`).orWhere('notes', 'like', `${MARKER}%`);
    })
    .del();
}

function pickCoordinator(staffRows: StaffRow[]): StaffRow | undefined {
  return (
    staffRows.find((s) => s.role === 'admin')
    ?? staffRows.find((s) => s.role === 'manager')
    ?? staffRows.find((s) => s.role === 'clinician')
  );
}

async function seedClinic(clinic: ClinicRow): Promise<{ messages: number; tasks: number; patients: number }> {
  const staffRows = await loadStaffByClinic(clinic.id);
  const coordinator = pickCoordinator(staffRows);
  if (!coordinator) {
    return { messages: 0, tasks: 0, patients: 0 };
  }

  await cleanupMarkerData(clinic.id);

  const openEpisodes = await loadOpenEpisodesWithPatients(clinic.id);
  const candidateRows = Array.from(
    new Map(
      openEpisodes
        .filter((r) => r.primary_clinician_id !== null)
        .map((r) => [r.patient_id, r] as const),
    ).values(),
  ).slice(0, MAX_PATIENTS_PER_CLINIC);

  let messageCount = 0;
  let taskCount = 0;
  const now = new Date();

  for (let index = 0; index < candidateRows.length; index += 1) {
    const row = candidateRows[index]!;
    const clinician = staffRows.find((s) => s.id === row.primary_clinician_id) ?? coordinator;
    const threadId = seedUuid(`${MARKER}:${clinic.id}:thread:${row.patient_id}`);
    const threadCreatedAt = plusDays(now, -(index + 2));
    const threadUpdatedAt = plusMinutes(threadCreatedAt, 45);

    await dbAdmin('message_threads').insert({
      id: threadId,
      clinic_id: clinic.id,
      created_by_id: coordinator.id,
      patient_id: row.patient_id,
      subject: `${MARKER} Patient update — ${row.patient_given_name} ${row.patient_family_name}`,
      last_message_at: threadUpdatedAt.toISOString(),
      created_at: threadCreatedAt.toISOString(),
      updated_at: threadUpdatedAt.toISOString(),
    });

    const participantIds = Array.from(new Set([coordinator.id, clinician.id]));
    for (const participantId of participantIds) {
      await dbAdmin('message_thread_participants').insert({
        id: seedUuid(`${threadId}:participant:${participantId}`),
        thread_id: threadId,
        user_id: participantId,
        last_read_at: null,
        created_at: threadCreatedAt.toISOString(),
        updated_at: threadCreatedAt.toISOString(),
      });
    }

    const messageRows = [
      {
        seedKey: 'm1',
        senderId: coordinator.id,
        createdAt: threadCreatedAt,
        body: `Patient message (portal relay): ${row.patient_given_name} reports reduced sleep and requests an earlier review.`,
        urgent: true,
      },
      {
        seedKey: 'm2',
        senderId: coordinator.id,
        createdAt: plusMinutes(threadCreatedAt, 35),
        body: `Patient message (family call): Family noted increased irritability this week and asked for medication review.`,
        urgent: false,
      },
    ];

    for (const message of messageRows) {
      await dbAdmin('messages').insert({
        id: seedUuid(`${threadId}:message:${message.seedKey}`),
        thread_id: threadId,
        sender_id: message.senderId,
        clinic_id: clinic.id,
        content: JSON.stringify({
          body: `${MARKER} ${message.body}`,
          subject: `${MARKER} Patient update — ${row.patient_given_name} ${row.patient_family_name}`,
          patientId: row.patient_id,
          isUrgent: message.urgent,
        }),
        is_read: false,
        created_at: message.createdAt.toISOString(),
        updated_at: message.createdAt.toISOString(),
      });
      messageCount += 1;
    }

    const taskSpecs = [
      {
        key: 't1',
        title: `${MARKER} Review patient update`,
        description: `Review incoming patient/family updates for ${row.patient_given_name} ${row.patient_family_name} and document follow-up plan.`,
        dueDate: plusDays(now, index + 1),
        priority: 'high',
      },
      {
        key: 't2',
        title: `${MARKER} Patient follow-up call`,
        description: `Contact ${row.patient_given_name} ${row.patient_family_name} and confirm symptom/safety check before next appointment.`,
        dueDate: plusDays(now, index + 3),
        priority: 'medium',
      },
    ];

    for (const task of taskSpecs) {
      await dbAdmin('tasks').insert({
        id: seedUuid(`${MARKER}:${clinic.id}:${row.patient_id}:${task.key}`),
        clinic_id: clinic.id,
        patient_id: row.patient_id,
        episode_id: row.episode_id,
        assigned_to_id: clinician.id,
        assigned_by_id: coordinator.id,
        title: task.title,
        description: task.description,
        task_type: 'follow-up',
        priority: task.priority,
        status: 'pending',
        due_date: task.dueDate.toISOString(),
        completed_at: null,
        completed_by_id: null,
        notes: `${MARKER} demo task for clinician workflow`,
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      });
      taskCount += 1;
    }
  }

  return {
    messages: messageCount,
    tasks: taskCount,
    patients: candidateRows.length,
  };
}

async function main(): Promise<void> {
  const clinics = await resolveClinics();
  if (clinics.length === 0) {
    console.log('No clinics with patients found. Nothing seeded.');
    return;
  }

  let totalMessages = 0;
  let totalTasks = 0;
  for (const clinic of clinics) {
    const seeded = await seedClinic(clinic);
    totalMessages += seeded.messages;
    totalTasks += seeded.tasks;
    console.log(`Seeded ${clinic.name}: ${seeded.patients} patients, ${seeded.messages} messages, ${seeded.tasks} tasks.`);
  }
  console.log(`Done. ${totalMessages} messages + ${totalTasks} tasks created using marker ${MARKER}.`);
}

main()
  .catch((err) => {
    console.error('Demo patient message/task seeding failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await dbAdmin.destroy();
    clearPoolMonitor();
  });
