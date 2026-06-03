// apps/api/src/features/clinical-notes/noteSnippets.ts
//
// S7.2 — Clinical note quick-insert snippets.
//
// Backs the keyboard macros in NoteEditor (Alt+Shift+<key>) that let a
// clinician pull formatted summaries of the active patient's clinical
// data directly into the note they are writing, without switching tabs
// or copy-pasting from another screen.
//
// Types supported:
//   pathology   latest 5 pathology results (name, value, unit, date, flag)
//   risk        latest risk assessment (severity + domains)
//   outcomes    latest HoNOS / K10 / LSP-16 scores with occasion
//   vitals      latest physical health vitals (BP, HR, temp, SpO2, weight)
//   meds        active medications list (name, dose, frequency, route)
//   allergies   active allergies + severity
//
// Each snippet is produced as plain-text markdown with headings and a
// trailing blank line so it inserts cleanly into the SOAP textareas. No
// HTML — the SOAP fields are plain <textarea>, not rich text.
//
// Provenance: every snippet ends with a citation line showing the record
// IDs and fetch timestamp so a clinical note that was built from
// macro-inserted content is still traceable back to its sources.
//
// Fix Registry: SNIP1 (snippet types enumerated), SNIP2 (provenance
// footer present), SNIP3 (RLS-scoped query per section).

import { db } from '../../db/db';

export type SnippetType = 'pathology' | 'risk' | 'outcomes' | 'vitals' | 'meds' | 'allergies';

export const SNIPPET_TYPES: readonly SnippetType[] = [
  'pathology',
  'risk',
  'outcomes',
  'vitals',
  'meds',
  'allergies',
] as const;

export interface NoteSnippet {
  type: SnippetType;
  text: string;
  recordCount: number;
  fetchedAt: string;
}

function ts(d: Date | string | null | undefined): string {
  if (!d) return 'unknown';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return 'unknown';
  return date.toISOString().slice(0, 10);
}

function citation(type: SnippetType, ids: string[], fetchedAt: string): string {
  if (ids.length === 0) return `\n\n_Source: ${type} (no records) — fetched ${fetchedAt}_`;
  const short = ids.slice(0, 5).map((id) => id.slice(0, 8)).join(', ');
  const more = ids.length > 5 ? ` +${ids.length - 5} more` : '';
  return `\n\n_Source: ${type} [${short}${more}] — fetched ${fetchedAt}_`;
}

// ─── Individual snippet builders ───────────────────────────────────────────

async function buildPathologySnippet(clinicId: string, patientId: string): Promise<NoteSnippet> {
  const rows = await db('pathology_results')
    .where({ clinic_id: clinicId, patient_id: patientId })
    .orderBy('result_date', 'desc')
    .limit(5)
    .select('id', 'test_name', 'result_value', 'result_unit', 'reference_range', 'abnormal_flag', 'result_date');
  const fetchedAt = new Date().toISOString();
  if (rows.length === 0) {
    return {
      type: 'pathology',
      text: '**Pathology:** No results on file.',
      recordCount: 0,
      fetchedAt,
    };
  }
  const lines = rows.map((r) => {
    const flag = r.abnormal_flag ? ` (${r.abnormal_flag})` : '';
    const unit = r.result_unit ? ` ${r.result_unit}` : '';
    const range = r.reference_range ? ` [ref ${r.reference_range}]` : '';
    return `- ${r.test_name}: ${r.result_value ?? '—'}${unit}${range}${flag} — ${ts(r.result_date)}`;
  });
  return {
    type: 'pathology',
    text: `**Pathology (latest 5):**\n${lines.join('\n')}${citation('pathology', rows.map((r) => r.id), fetchedAt)}`,
    recordCount: rows.length,
    fetchedAt,
  };
}

// USER-A.3 absorb-1: (a) episode-scoped when episodeId is supplied;
// (b) schema-drift fix — pre-absorb code selected `severity` and
// `domains` which do not exist on risk_assessments. The real columns
// are `overall_risk_level` + 5 boolean risk-class flags
// (suicide_risk / self_harm_risk / harm_to_others_risk /
// absconding_risk / vulnerability_risk). The pre-existing `.catch(
// () => emptySnippet(t))` at buildNoteSnippets silently swallowed the
// Postgres column-does-not-exist error so every Alt+Shift+R rendered
// `**risk:** _unable to load — see logs_` with no visible failure.
// This absorb corrects the columns, computes a comma-joined "domains"
// string from the risk-class booleans, and adds the episodeId filter
// so cross-episode risk data doesn't leak into an in-progress note.
async function buildRiskSnippet(
  clinicId: string,
  patientId: string,
  episodeId: string | null,
): Promise<NoteSnippet> {
  const q = db('risk_assessments')
    .where({ clinic_id: clinicId, patient_id: patientId })
    .whereNull('deleted_at')
    .orderBy('assessment_date', 'desc');
  if (episodeId) q.where({ episode_id: episodeId });
  const row = await q.first(
    'id', 'overall_risk_level', 'assessment_date', 'risk_narrative',
    'suicide_risk', 'self_harm_risk', 'harm_to_others_risk',
    'absconding_risk', 'vulnerability_risk',
  );
  const fetchedAt = new Date().toISOString();
  if (!row) {
    const scope = episodeId ? ' in this episode' : '';
    return { type: 'risk', text: `**Risk:** No assessment on file${scope}.`, recordCount: 0, fetchedAt };
  }
  const domains = [
    row.suicide_risk ? 'suicide' : null,
    row.self_harm_risk ? 'self-harm' : null,
    row.harm_to_others_risk ? 'harm-to-others' : null,
    row.absconding_risk ? 'absconding' : null,
    row.vulnerability_risk ? 'vulnerability' : null,
  ].filter((d): d is string => d !== null).join(', ') || 'n/a';
  const narrative = row.risk_narrative ? String(row.risk_narrative).slice(0, 300) : 'n/a';
  return {
    type: 'risk',
    text: `**Risk (${ts(row.assessment_date)}):** severity=${row.overall_risk_level ?? '—'}; domains=${domains}.\n${narrative}${citation('risk', [row.id], fetchedAt)}`,
    recordCount: 1,
    fetchedAt,
  };
}

// USER-A.3 (A-5-USER Sub-cluster A): episode-scoped when episodeId is
// supplied. Pre-fix this query only filtered by clinic_id + patient_id,
// so composing a note inside Episode B surfaced outcome measures from
// Episode A — cross-episode PHI leakage into the note-in-progress
// (APP 11 segmentation concern). When episodeId is absent the builder
// falls back to the legacy patient-wide query for backward compatibility
// with the small number of callers that don't bind a note to an episode
// (e.g. pre-episode intake flows).
async function buildOutcomesSnippet(
  clinicId: string,
  patientId: string,
  episodeId: string | null,
): Promise<NoteSnippet> {
  const q = db('outcome_measures')
    .where({ clinic_id: clinicId, patient_id: patientId })
    .orderBy('created_at', 'desc')
    .limit(5)
    .select('id', 'template_name', 'total_score', 'collection_occasion', 'created_at');
  if (episodeId) q.where({ episode_id: episodeId });
  const rows = await q;
  const fetchedAt = new Date().toISOString();
  if (rows.length === 0) {
    const scope = episodeId ? ' in this episode' : '';
    return { type: 'outcomes', text: `**Outcomes:** No scores on file${scope}.`, recordCount: 0, fetchedAt };
  }
  const lines = rows.map((r) => `- ${r.template_name}: ${r.total_score ?? '—'} (${r.collection_occasion ?? 'n/a'}) — ${ts(r.created_at)}`);
  const header = episodeId ? '**Outcome measures (latest 5, this episode):**' : '**Outcome measures (latest 5):**';
  return {
    type: 'outcomes',
    text: `${header}\n${lines.join('\n')}${citation('outcomes', rows.map((r) => r.id), fetchedAt)}`,
    recordCount: rows.length,
    fetchedAt,
  };
}

async function buildVitalsSnippet(clinicId: string, patientId: string): Promise<NoteSnippet> {
  const row = await db('physical_health_measurements')
    .where({ clinic_id: clinicId, patient_id: patientId })
    .orderBy('measured_at', 'desc')
    .first();
  const fetchedAt = new Date().toISOString();
  if (!row) {
    return { type: 'vitals', text: '**Vitals:** No measurements on file.', recordCount: 0, fetchedAt };
  }
  const bits: string[] = [];
  if (row.systolic_bp && row.diastolic_bp) bits.push(`BP ${row.systolic_bp}/${row.diastolic_bp}`);
  if (row.heart_rate) bits.push(`HR ${row.heart_rate}`);
  if (row.temperature) bits.push(`Temp ${row.temperature}°C`);
  if (row.spo2) bits.push(`SpO₂ ${row.spo2}%`);
  if (row.respiratory_rate) bits.push(`RR ${row.respiratory_rate}`);
  if (row.weight_kg) bits.push(`Wt ${row.weight_kg}kg`);
  if (row.bmi) bits.push(`BMI ${row.bmi}`);
  const header = bits.length > 0 ? bits.join(', ') : 'no measurable values';
  return {
    type: 'vitals',
    text: `**Vitals (${ts(row.measured_at)}):** ${header}.${citation('vitals', [row.id], fetchedAt)}`,
    recordCount: 1,
    fetchedAt,
  };
}

// USER-A.3 absorb-1: episode-scoped when episodeId is supplied. Same
// APP 11 class as buildOutcomesSnippet — patient_medications.episode_id
// is present (verified via schema-snapshot + psql); pre-absorb the
// builder surfaced Episode A's active meds into a note composed in
// Episode B. Legacy caller path (episodeId=null) unchanged.
async function buildMedicationsSnippet(
  clinicId: string,
  patientId: string,
  episodeId: string | null,
): Promise<NoteSnippet> {
  const q = db('patient_medications')
    .where({ clinic_id: clinicId, patient_id: patientId, status: 'active' })
    .whereNull('deleted_at')
    .orderBy('start_date', 'desc')
    .limit(500); // BUG-437 — snippet-ceiling per-patient active meds
  if (episodeId) q.where({ episode_id: episodeId });
  const rows = await q.select('id', 'drug_label', 'dose', 'frequency', 'route');
  const fetchedAt = new Date().toISOString();
  if (rows.length === 0) {
    const scope = episodeId ? ' in this episode' : '';
    return { type: 'meds', text: `**Medications:** None active${scope}.`, recordCount: 0, fetchedAt };
  }
  const lines = rows.map((r) => `- ${r.drug_label} ${r.dose ?? ''} ${r.frequency ?? ''} ${r.route ?? ''}`.trim());
  const header = episodeId
    ? `**Active medications (${rows.length}, this episode):**`
    : `**Active medications (${rows.length}):**`;
  return {
    type: 'meds',
    text: `${header}\n${lines.join('\n')}${citation('meds', rows.map((r) => r.id), fetchedAt)}`,
    recordCount: rows.length,
    fetchedAt,
  };
}

async function buildAllergiesSnippet(clinicId: string, patientId: string): Promise<NoteSnippet> {
  const rows = await db('patient_allergies')
    .where({ clinic_id: clinicId, patient_id: patientId })
    .whereNull('deleted_at')
    .orderBy('recorded_at', 'desc')
    .limit(500) // BUG-437 — snippet-ceiling per-patient allergies
    .select('id', 'allergen', 'reaction', 'severity');
  const fetchedAt = new Date().toISOString();
  if (rows.length === 0) {
    return { type: 'allergies', text: '**Allergies:** NKDA (no known drug allergies).', recordCount: 0, fetchedAt };
  }
  const lines = rows.map((r) => `- ${r.allergen}: ${r.reaction ?? '—'} (${r.severity ?? 'unknown'})`);
  return {
    type: 'allergies',
    text: `**Allergies (${rows.length}):**\n${lines.join('\n')}${citation('allergies', rows.map((r) => r.id), fetchedAt)}`,
    recordCount: rows.length,
    fetchedAt,
  };
}

// ─── Public entry point ────────────────────────────────────────────────────

/**
 * Build one or more snippets for the active patient. `types` determines
 * which sections are fetched in parallel. Unknown types are silently
 * dropped so a typo in a frontend shortcut binding does not 400 the
 * whole request.
 */
export async function buildNoteSnippets(
  clinicId: string,
  patientId: string,
  types: SnippetType[],
  episodeId: string | null = null,
): Promise<NoteSnippet[]> {
  const known = types.filter((t): t is SnippetType => SNIPPET_TYPES.includes(t));
  const results = await Promise.all(
    known.map((t) => {
      switch (t) {
        case 'pathology':
          // pathology_results has no episode_id (labs span episodes — clinical reality)
          return buildPathologySnippet(clinicId, patientId).catch(() => emptySnippet(t));
        case 'risk':
          return buildRiskSnippet(clinicId, patientId, episodeId).catch(() => emptySnippet(t));
        case 'outcomes':
          return buildOutcomesSnippet(clinicId, patientId, episodeId).catch(() => emptySnippet(t));
        case 'vitals':
          // buildVitalsSnippet queries `physical_health_measurements` which
          // does NOT exist in the current schema. The `.catch` below masks
          // the resulting pg error and every Alt+Shift+V returns the
          // "unable to load" placeholder. This is a pre-existing bug, NOT
          // introduced here; tracked as BUG-346 (documented at the bottom
          // of this file). Episode-scoping is not meaningful until the
          // underlying table / rename is settled.
          return buildVitalsSnippet(clinicId, patientId).catch(() => emptySnippet(t));
        case 'meds':
          return buildMedicationsSnippet(clinicId, patientId, episodeId).catch(() => emptySnippet(t));
        case 'allergies':
          // patient_allergies is patient-level (allergies span episodes)
          return buildAllergiesSnippet(clinicId, patientId).catch(() => emptySnippet(t));
      }
    }),
  );
  return results;
}

function emptySnippet(type: SnippetType): NoteSnippet {
  return {
    type,
    text: `**${type}:** _unable to load — see logs_`,
    recordCount: 0,
    fetchedAt: new Date().toISOString(),
  };
}

// ─── Known follow-up bugs registered during USER-A.3 absorb-1 ─────
//
// BUG-345 — Consultant role-name SSoT. `'Consultant Psychiatrist'` is
//   duplicated as a string literal at 6+ backend sites + 1 frontend
//   site (PatientList.tsx consultantByPatient lookup). Should be
//   extracted to `@signacare/shared/clinicalRoles.ts` and surfaced
//   server-side on patient-team-assignments as `consultantName`.
//   Deferred from absorb-1 per L5 review — cross-cutting refactor
//   independent of PHI scope; bundling would widen blast radius.
//
// BUG-346 — `buildVitalsSnippet` queries `physical_health_measurements`
//   which does not exist in the current schema. Every Alt+Shift+V
//   returns the `unable to load` placeholder. Discovered during
//   absorb-1 review; pre-existing (not introduced by this commit).
//   Fix requires deciding the canonical vitals table
//   (measurements-style or vitals-style) and updating the builder.

