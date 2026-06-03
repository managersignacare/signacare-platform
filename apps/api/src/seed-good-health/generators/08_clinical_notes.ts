import type { Knex } from 'knex';
import {
  MENTAL_HEALTH_CLINICS,
  TEAM_SLUGS,
  PATIENTS_PER_TEAM,
} from '../config/catalog';
import {
  clinicId,
  patientId,
  episodeId,
  staffId,
  noteId,
} from '../config/ids';
import { createRng, type SeededRng } from '../lib/rng';
import type { GeneratorResult } from './01_clinics';

// Phase 0.8 generator 08 — clinical notes (1600 rows total).
//
// Shape: 20 notes per patient × 80 patients = 1600.
//   - 8 notes on Episode 1 (the 2021 → 2022 historical episode)
//   - 12 notes on Episode 2 (the 2024 → open current episode)
//
// Authorship rotates through 9 clinical team members per team
// (team-lead, 2 registrars, psychologist, OT, SW, 2 nurses, case
// coordinator — the receptionist admin slot is excluded because it
// is not a clinical author). The rotation is per-patient-seeded
// so two patients on the same team see different author orderings
// without the rng stream cross-contaminating.
//
// Dates are distributed evenly across each episode's window with a
// small rng jitter (-2..+2 days) so the timeline looks realistic
// without colliding on a single date. Episode-1 notes all have
// status='signed' + is_signed=true. Episode-2 notes are signed
// except for the final (most recent) one which is drafted.
//
// Note types follow a weighted mix:
//   soap       40%
//   progress   30%
//   phone      15%
//   med_review 15%
//
// Contents are short templated stems — reseeds are trivially
// diffable and the master operator can read the notes without
// decoding rng output.

interface ClinicalNoteRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  episode_id: string;
  author_id: string;
  title: string | null;
  note_type: string;
  note_category: string | null;
  note_date: string;
  content: string;
  status: string;
  is_draft: boolean;
  is_signed: boolean;
  signed_at: string | null;
  signed_by: string | null;
  signed_by_id: string | null;
  is_reportable_contact: boolean;
}

export interface ClinicalNotesBuild {
  readonly rows: ClinicalNoteRow[];
}

const AUTHOR_SLUGS = [
  'team-lead',
  'registrar-1',
  'registrar-2',
  'psychologist',
  'ot',
  'social-worker',
  'nurse-1',
  'nurse-2',
  'case-coordinator',
] as const;

const EPISODE_1 = { start: new Date('2021-04-01'), end: new Date('2022-04-01') };
const EPISODE_2 = { start: new Date('2024-11-15'), end: new Date('2026-04-10') };

const NOTES_PER_EP1 = 8;
const NOTES_PER_EP2 = 12;

interface NoteTemplate {
  readonly type: string;
  readonly category: string;
  readonly weight: number;
  readonly render: (sessionNo: number) => { title: string; content: string };
}

const TEMPLATES: readonly NoteTemplate[] = [
  {
    type: 'soap',
    category: 'Routine review',
    weight: 40,
    render: (n) => ({
      title: `SOAP review — session ${n}`,
      content: `S: Patient reports mood improving, sleep 6–7h. Denies SI.
O: Affect brighter, good eye contact, speech normal rate and tone.
A: Depression improving on current regime, partial remission.
P: Continue meds, review in 4w, GP letter updated.`,
    }),
  },
  {
    type: 'progress',
    category: 'Progress note',
    weight: 30,
    render: (n) => ({
      title: `Progress note — session ${n}`,
      content: `Patient attended scheduled review. Reports improved sleep, mood stable, engaging with recovery plan. Agreed next review in 2 weeks.`,
    }),
  },
  {
    type: 'phone',
    category: 'Telephone contact',
    weight: 15,
    render: (n) => ({
      title: `Telephone contact — ${n}`,
      content: `Patient phoned. Brief check-in, reports no new concerns. Reminded of next appointment. Duration 15 min.`,
    }),
  },
  {
    type: 'med_review',
    category: 'Medication review',
    weight: 15,
    render: (n) => ({
      title: `Medication review — ${n}`,
      content: `Current medications reviewed. No adverse effects reported. Continue current regime. Bloods due at next review.`,
    }),
  },
];

function pickTemplate(rng: SeededRng): NoteTemplate {
  return rng.weighted(
    TEMPLATES.map((t) => ({ value: t, weight: t.weight })),
  );
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d.getTime());
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000));
}

function toIsoDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

function distributeDates(
  rng: SeededRng,
  window: { start: Date; end: Date },
  count: number,
): Date[] {
  const totalDays = daysBetween(window.start, window.end);
  const step = Math.max(1, Math.floor(totalDays / (count + 1)));
  const dates: Date[] = [];
  for (let i = 1; i <= count; i++) {
    const baseOffset = step * i;
    const jitter = rng.nextInt(-2, 2);
    dates.push(addDays(window.start, baseOffset + jitter));
  }
  return dates;
}

interface PatientContext {
  patientUuid: string;
  clinicIdValue: string;
  teamSlug: (typeof TEAM_SLUGS)[number];
  clinicSlug: string;
  patientSeed: string;
}

function buildNotesForPatient(ctx: PatientContext): ClinicalNoteRow[] {
  const rng = createRng(0xc10ca).fork(`notes.${ctx.patientSeed}`);
  const rows: ClinicalNoteRow[] = [];

  const ep1Uuid = episodeId(ctx.patientUuid, 1);
  const ep2Uuid = episodeId(ctx.patientUuid, 2);

  const ep1Dates = distributeDates(rng, EPISODE_1, NOTES_PER_EP1);
  const ep2Dates = distributeDates(rng, EPISODE_2, NOTES_PER_EP2);

  const pushNote = (
    episodeUuid: string,
    dateObj: Date,
    sequenceWithinPatient: number,
    sessionNumber: number,
    isLast: boolean,
  ): void => {
    const template = pickTemplate(rng);
    const authorSlug = AUTHOR_SLUGS[rng.nextInt(0, AUTHOR_SLUGS.length - 1)];
    const authorUuid = staffId(ctx.clinicSlug, `${ctx.teamSlug}.${authorSlug}`);
    const { title, content } = template.render(sessionNumber);
    const drafted = isLast;
    const signed = !drafted;
    const signedAt = signed ? dateObj.toISOString() : null;

    rows.push({
      id: noteId(ctx.patientUuid, sequenceWithinPatient),
      clinic_id: ctx.clinicIdValue,
      patient_id: ctx.patientUuid,
      episode_id: episodeUuid,
      author_id: authorUuid,
      title,
      note_type: template.type,
      note_category: template.category,
      note_date: toIsoDate(dateObj),
      content,
      status: signed ? 'signed' : 'draft',
      is_draft: drafted,
      is_signed: signed,
      signed_at: signedAt,
      signed_by: signed ? authorUuid : null,
      signed_by_id: signed ? authorUuid : null,
      is_reportable_contact: true,
    });
  };

  let seq = 0;
  for (let i = 0; i < ep1Dates.length; i++) {
    pushNote(ep1Uuid, ep1Dates[i], seq, i + 1, false);
    seq++;
  }
  for (let i = 0; i < ep2Dates.length; i++) {
    const isLast = i === ep2Dates.length - 1;
    pushNote(ep2Uuid, ep2Dates[i], seq, i + 1, isLast);
    seq++;
  }

  return rows;
}

export function buildClinicalNotes(): ClinicalNotesBuild {
  const rows: ClinicalNoteRow[] = [];

  for (const clinic of MENTAL_HEALTH_CLINICS) {
    const cid = clinicId(clinic.slug);
    for (const team of TEAM_SLUGS) {
      for (let i = 1; i <= PATIENTS_PER_TEAM; i++) {
        const pid = patientId(clinic.slug, team, i);
        rows.push(
          ...buildNotesForPatient({
            patientUuid: pid,
            clinicIdValue: cid,
            teamSlug: team,
            clinicSlug: clinic.slug,
            patientSeed: `${clinic.slug}.${team}.${i}`,
          }),
        );
      }
    }
  }

  return { rows };
}

async function upsertById<T extends { id: string }>(
  knex: Knex,
  table: string,
  rows: readonly T[],
): Promise<{ inserted: number; updated: number }> {
  let inserted = 0;
  let updated = 0;
  for (const row of rows) {
    const existing = await knex(table).where({ id: row.id }).first();
    if (existing) {
      await knex(table).where({ id: row.id }).update(row);
      updated++;
    } else {
      await knex(table).insert(row);
      inserted++;
    }
  }
  return { inserted, updated };
}

export async function runClinicalNotesStep(
  knex: Knex,
): Promise<GeneratorResult> {
  const { rows } = buildClinicalNotes();
  return upsertById(knex, 'clinical_notes', rows);
}
