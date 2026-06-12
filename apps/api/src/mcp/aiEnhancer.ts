/**
 * AI Output Enhancement Layer
 *
 * Strategies to improve LLM output quality:
 * 1. RAG Context Enrichment — auto-load structured patient data before generation
 * 2. Few-Shot Examples — include example outputs in system prompts
 * 3. Multi-Pass Refinement — generate draft, then refine with a second pass
 * 4. Structured Templates — enforce section headers and format compliance
 * 5. Post-Processing — clean up, validate required sections, format consistency
 */

import { routeTextGeneration, resolveLockedRuntimeSelection } from '../features/llm/modelRouter/modelRouter'
import { resolveClinicalActionAlias } from '../features/llm/modelRouter/clinicalPromptCatalog'
import { db, rlsStore } from '../db/db'
import { logger } from '../utils/logger'
import type { PatientRow } from '../features/patients/patientRepository'
import type { AuthContext } from '@signacare/shared'
import { requirePatientRelationship } from '../shared/authGuards'

type DateLike = string | Date | null

interface ContextContactRow {
  given_name?: string | null
  family_name?: string | null
  relationship?: string | null
  phone_mobile?: string | null
  is_emergency_contact?: boolean | null
  is_carer?: boolean | null
  has_consent?: boolean | null
}

interface ContextEpisodeRow {
  status?: string | null
  episode_type?: string | null
  team?: string | null
  start_date?: DateLike
  end_date?: DateLike
  primary_diagnosis?: string | null
  closure_reason?: string | null
}

interface ContextMedicationRow {
  medication_name?: string | null
  dose?: string | null
  frequency?: string | null
  route?: string | null
  indication?: string | null
  is_lai?: boolean | null
  is_s8?: boolean | null
  is_clozapine?: boolean | null
  prescribed_at?: DateLike
  ceased_at?: DateLike
  ceased_reason?: string | null
}

interface ContextAlertRow {
  title?: string | null
  alert_type_name?: string | null
  severity?: string | null
  notes?: string | null
  is_active?: boolean | null
  resolved_at?: DateLike
}

interface ContextNoteRow {
  created_at: string | Date
  note_type?: string | null
  note_category?: string | null
  author_name?: string | null
  assessment_html?: string | null
  content_html?: string | null
  plan_html?: string | null
  is_signed?: boolean | null
}

interface ContextRiskAssessmentRow {
  created_at: string | Date
  risk_self?: string | null
  risk_others?: string | null
  risk_vulnerability?: string | null
  summary?: string | null
}

interface ContextLegalOrderRow {
  order_type_name?: string | null
  status?: string | null
  startdate?: DateLike
  enddate?: DateLike
  tribunal_date?: DateLike
}

interface ContextPathologyRow {
  test_name?: string | null
  collected_at?: DateLike
  value?: string | null
  unit?: string | null
  flag?: string | null
  reference_range?: string | null
}

interface ContextAppointmentRow {
  start_time: string | Date
  appointment_type?: string | null
  clinician_name?: string | null
  status?: string | null
}

interface ContextReferralRow {
  referral_type?: string | null
  referrer_name?: string | null
  status?: string | null
  created_at?: DateLike
  reason?: string | null
}

interface ContextClinicalReviewRow {
  review_date?: DateLike
  review_type?: string | null
  reviewer_name?: string | null
  summary?: string | null
  notes?: string | null
}

type PatientContextRows = [
  PatientRow | null,
  ContextContactRow[],
  ContextEpisodeRow[],
  ContextMedicationRow[],
  ContextMedicationRow[],
  ContextAlertRow[],
  ContextNoteRow[],
  ContextLegalOrderRow[],
  ContextRiskAssessmentRow[],
  ContextPathologyRow[],
  ContextAppointmentRow[],
  ContextReferralRow[],
  ContextClinicalReviewRow[],
]

/** Strip leaked RAG context and refinement meta-commentary from LLM output */
function stripLeakedContext(text: string): string {
  let result = text

  // Strategy 1: Find known RAG section headers and truncate from the first one found
  const ragHeaders = [
    'DEMOGRAPHICS:', 'REFERENCE DATA:', 'ACTIVE EPISODES:', 'CURRENT MEDICATIONS:',
    'ACTIVE ALERTS:', 'RECENT NOTES (', 'LEGAL ORDERS:', '--- TASK ---', '--- USER INPUT ---',
  ]
  let earliestLeakIdx = result.length
  for (const header of ragHeaders) {
    const idx = result.indexOf(header)
    if (idx > 0 && idx < earliestLeakIdx) {
      // Only treat as leaked if it appears in the second half of the document
      // (to avoid stripping legitimate sections in clinical reports)
      if (idx > result.length * 0.3) {
        earliestLeakIdx = idx
      }
    }
  }
  if (earliestLeakIdx < result.length) {
    result = result.substring(0, earliestLeakIdx)
  }

  // Strategy 2: If there's a signature/date line, truncate anything that comes
  // more than 3 lines after it (the signature block itself may be 2-3 lines)
  const sigMatch = result.match(/Signature\s*:\s*[_\s]*.*Date\s*:\s*.+/i)
  if (sigMatch && sigMatch.index != null) {
    const afterSigStart = sigMatch.index + sigMatch[0].length
    const afterSig = result.substring(afterSigStart)
    // Allow up to 2 blank lines after signature, then truncate
    const keepAfterSig = afterSig.match(/^(\s*\n){0,3}/)
    result = result.substring(0, afterSigStart) + (keepAfterSig?.[0] ?? '')
  }

  // Strategy 3: Remove refinement commentary the LLM may add
  result = result.replace(/\n*(?:Note:|NB:|Disclaimer:|Please note that|IMPORTANT:)[\s\S]*$/i, '')
  result = result.replace(/\n*(?:The original document|This document|I have corrected|I've corrected|I have improved)[\s\S]*$/i, '')

  // Clean up excessive blank lines
  result = result.replace(/\n{3,}/g, '\n\n')
  return result.trim()
}

// ============ 1. RAG Context Enrichment ============

/**
 * BUG-281 (S1) — AuthContext-first signature per CLAUDE.md §13.
 * Gate on `requirePatientRelationship` before ANY patient-data read so
 * that non-HTTP callers (MCP tools, workers, WebSocket) cannot bypass
 * the handler-layer check. `auth.clinicId` replaces the previous
 * separate `clinicId` parameter — the guard ensures tenant scope.
 */
export async function loadPatientContext(auth: AuthContext, patientId: string): Promise<string>
export async function loadPatientContext(auth: AuthContext, patientId: string, options?: { episodeId?: string }): Promise<string>
export async function loadPatientContext(auth: AuthContext, patientId: string, options: { episodeId?: string } = {}): Promise<string> {
  await requirePatientRelationship(auth, patientId);
  const clinicId = auth.clinicId;
  const { episodeId } = options;
  const strip = (html: string) => (html ?? '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()

  // AI context reads are best-effort enrichment, not a source of truth.
  // When this helper runs under request-scoped RLS transactions (for example
  // through MCP tool flows), concurrent Promise.all reads on one trx client can
  // trigger overlapping-query warnings in pg. We therefore fail-safe to
  // sequential reads in that mode, while preserving parallel reads for
  // non-transaction callers.
  const logQueryFail = (table: string) => (err: unknown) => {
    logger.warn({ err, table, patientId, clinicId }, 'AI context: query failed — degraded to []');
    return [] as never[];
  };
  const queryPatient = () =>
    db('patients')
      .where({ id: patientId, clinic_id: clinicId })
      .first()
      .catch((err) => {
        logger.warn({ err, patientId, clinicId }, 'AI context: patients lookup failed')
        return null
      })
  const queryContacts = () =>
    db('patient_contacts')
      .where({ patient_id: patientId, clinic_id: clinicId })
      .whereNull('deleted_at')
      .limit(50)
      .catch(logQueryFail('patient_contacts')) // BUG-437 — llm-ctx-cap per-patient contacts
  const queryEpisodes = () =>
    db('episodes')
      .where({ patient_id: patientId, clinic_id: clinicId })
      .whereNull('deleted_at')
      .modify((query) => {
        if (episodeId) query.where('id', episodeId);
      })
      .orderBy('start_date', 'desc')
      .limit(50)
      .catch(logQueryFail('episodes')) // BUG-437 — llm-ctx-cap per-patient episodes
  const queryActiveMeds = () =>
    db('patient_medications')
      .where({ patient_id: patientId, clinic_id: clinicId, status: 'active' })
      .orderBy('created_at', 'desc')
      .limit(50)
      .catch(logQueryFail('patient_medications:active')) // BUG-437 — llm-ctx-cap per-patient active meds
  const queryCeasedMeds = () =>
    db('patient_medications')
      .where({ patient_id: patientId, clinic_id: clinicId, status: 'ceased' })
      .orderBy('updated_at', 'desc')
      .limit(15)
      .catch(logQueryFail('patient_medications:ceased'))
  const queryAlerts = () =>
    db('patient_alerts')
      .join('alert_types', 'alert_types.id', 'patient_alerts.alert_type_id')
      .where({ 'patient_alerts.patient_id': patientId })
      .select('patient_alerts.*', 'alert_types.name as alert_type_name')
      .orderBy('patient_alerts.created_at', 'desc')
      .limit(50)
      .catch(logQueryFail('patient_alerts')) // BUG-437 — llm-ctx-cap per-patient alerts
  const queryNotes = () =>
    db('clinical_notes')
      .where({ patient_id: patientId, clinic_id: clinicId })
      .whereNull('deleted_at')
      .modify((query) => {
        if (episodeId) query.where('episode_id', episodeId);
      })
      .orderBy('created_at', 'desc')
      .limit(15)
      .catch(logQueryFail('clinical_notes'))
  const queryLegal = () =>
    db('patient_legal_orders')
      // @fk-join-exempt: legacy schema has no explicit FK on patient_legal_orders.order_type_id; join remains canonical and clinic-scoped.
      .join('legal_order_type_configs', 'patient_legal_orders.order_type_id', 'legal_order_type_configs.id')
      .where({ 'patient_legal_orders.patient_id': patientId })
      .select('patient_legal_orders.*', 'legal_order_type_configs.name as order_type_name')
      .orderBy('patient_legal_orders.created_at', 'desc')
      .limit(50)
      .catch(logQueryFail('patient_legal_orders')) // BUG-437 — llm-ctx-cap per-patient legal orders
  const queryRiskAssessments = () =>
    db('risk_assessments')
      .where({ patient_id: patientId, clinic_id: clinicId })
      .whereNull('deleted_at')
      .modify((query) => {
        if (episodeId) query.where('episode_id', episodeId);
      })
      .orderBy('created_at', 'desc')
      .limit(3)
      .catch(logQueryFail('risk_assessments'))
  const queryPathology = () =>
    db('pathology_results')
      .where({ patient_id: patientId, clinic_id: clinicId })
      .orderBy('collected_at', 'desc')
      .limit(10)
      .catch(logQueryFail('pathology_results'))
  const queryAppointments = () =>
    db('appointments')
      .where({ patient_id: patientId, clinic_id: clinicId })
      .whereNull('deleted_at')
      .orderBy('start_time', 'desc')
      .limit(10)
      .catch(logQueryFail('appointments'))
  const queryReferrals = () =>
    db('referrals')
      .where({ patient_id: patientId, clinic_id: clinicId })
      .whereNull('deleted_at')
      .orderBy('created_at', 'desc')
      .limit(5)
      .catch(logQueryFail('referrals'))
  const queryClinicalReviews = () =>
    db('clinical_reviews')
      .where({ patient_id: patientId, clinic_id: clinicId })
      .modify((query) => {
        if (episodeId) query.where('episode_id', episodeId);
      })
      .orderBy('review_date', 'desc')
      .limit(3)
      .catch(logQueryFail('clinical_reviews'))

  const hasScopedTrx = !!rlsStore.getStore()
  const contextRows = hasScopedTrx
    ? [
      await queryPatient(),
      await queryContacts(),
      await queryEpisodes(),
      await queryActiveMeds(),
      await queryCeasedMeds(),
      await queryAlerts(),
      await queryNotes(),
      await queryLegal(),
      await queryRiskAssessments(),
      await queryPathology(),
      await queryAppointments(),
      await queryReferrals(),
      await queryClinicalReviews(),
    ]
    : await Promise.all([
      queryPatient(),
      queryContacts(),
      queryEpisodes(),
      queryActiveMeds(),
      queryCeasedMeds(),
      queryAlerts(),
      queryNotes(),
      queryLegal(),
      queryRiskAssessments(),
      queryPathology(),
      queryAppointments(),
      queryReferrals(),
      queryClinicalReviews(),
    ])
  const [
    patient, contacts, allEpisodes, activeMeds, ceasedMeds,
    alerts, notes, legal, riskAssessments, pathology,
    appointments, referrals, clinicalReviews,
  ] = contextRows as PatientContextRows

  const sections: string[] = []

  // ── Demographics + GP + NOK ──
  // Use the canonical PatientRow interface from patientRepository — any
  // drift between the DB schema and the code is caught at compile time.
  if (patient) {
    const p = patient as PatientRow
    const lines = [
      `Name: ${p.given_name} ${p.family_name}${p.preferred_name ? ` (prefers ${p.preferred_name})` : ''}`,
      `DOB: ${p.date_of_birth} | Gender: ${p.gender ?? 'Not recorded'} | Pronouns: ${p.pronouns ?? 'Not recorded'}`,
      `UR: ${p.emr_number} | IHI: ${p.ihi_number ?? 'Not recorded'} | Medicare: ${p.medicare_number ?? 'Not recorded'}`,
      `ATSI: ${p.atsi_status ?? 'Not recorded'} | Interpreter: ${p.interpreter_required ? `Yes (${p.interpreter_language ?? 'language not specified'})` : 'No'}`,
      `Address: ${[p.address_line1, p.suburb, p.state, p.postcode].filter(Boolean).join(', ') || 'Not recorded'}`,
      `Phone: ${p.phone_mobile ?? 'N/A'} | Email: ${p.email_primary ?? 'N/A'}`,
    ]
    if (p.gp_name) lines.push(`GP: ${p.gp_name} at ${p.gp_practice ?? 'unknown practice'} (Ph: ${p.gp_phone ?? 'N/A'})`)
    if (p.nok_name) lines.push(`NOK: ${p.nok_name} (${p.nok_relationship ?? 'relationship unknown'}, Ph: ${p.nok_phone ?? 'N/A'})`)
    sections.push(`DEMOGRAPHICS:\n${lines.join('\n')}`)
  }

  // ── Support Persons ──
  if (contacts.length) {
    sections.push(`SUPPORT PERSONS (${contacts.length}):\n${contacts.map((c) => {
      const name = [c.given_name, c.family_name].filter(Boolean).join(' ') || 'Unknown'
      const roles = [c.is_emergency_contact && 'Emergency Contact', c.is_carer && 'Carer', c.has_consent && 'Consent to Share'].filter(Boolean).join(', ')
      return `- ${name} (${c.relationship ?? 'unknown'})${roles ? ` — ${roles}` : ''} Ph: ${c.phone_mobile ?? 'N/A'}`
    }).join('\n')}`)
  }

  // ── Episodes (ALL, not just open) ──
  if (allEpisodes.length) {
    const open = allEpisodes.filter((e) => e.status === 'open')
    const closed = allEpisodes.filter((e) => e.status !== 'open')
    const epLines: string[] = []
    if (open.length) {
      epLines.push(`Active (${open.length}):`)
      open.forEach((e) => epLines.push(`  - ${e.episode_type ?? 'Unknown'} (${e.team ?? 'No team'}, opened ${e.start_date}) — Dx: ${e.primary_diagnosis ?? 'Not recorded'}`))
    }
    if (closed.length) {
      epLines.push(`Historical (${closed.length}):`)
      closed.slice(0, 5).forEach((e) => epLines.push(`  - ${e.episode_type ?? 'Unknown'} (${e.start_date} to ${e.end_date ?? 'unknown'}) — Dx: ${e.primary_diagnosis ?? 'Not recorded'}, Reason: ${e.closure_reason ?? 'N/A'}`))
    }
    sections.push(`EPISODES (${allEpisodes.length} total):\n${epLines.join('\n')}`)
  }

  // ── Current Medications ──
  if (activeMeds.length) {
    sections.push(`CURRENT MEDICATIONS (${activeMeds.length}):\n${activeMeds.map((m) =>
      `- ${m.medication_name} ${m.dose ?? ''} ${m.frequency ?? ''} (${m.route ?? 'unknown route'})` +
      `${m.is_lai ? ' [LAI]' : ''}${m.is_s8 ? ' [S8]' : ''}${m.is_clozapine ? ' [Clozapine]' : ''}` +
      `${m.indication ? ` — For: ${m.indication}` : ''}` +
      `${m.prescribed_at ? ` (since ${new Date(m.prescribed_at).toLocaleDateString('en-AU')})` : ''}`
    ).join('\n')}`)
  }

  // ── Ceased Medications ──
  if (ceasedMeds.length) {
    sections.push(`CEASED MEDICATIONS (${ceasedMeds.length}):\n${ceasedMeds.map((m) =>
      `- ${m.medication_name} ${m.dose ?? ''} — ceased ${m.ceased_at ? new Date(m.ceased_at).toLocaleDateString('en-AU') : 'unknown'}` +
      `${m.ceased_reason ? ` (${m.ceased_reason})` : ''}`
    ).join('\n')}`)
  }

  // ── Alerts (active AND resolved) ──
  if (alerts.length) {
    const active = alerts.filter((a) => a.is_active)
    const resolved = alerts.filter((a) => !a.is_active)
    const alertLines: string[] = []
    if (active.length) {
      alertLines.push(`Active (${active.length}):`)
      active.forEach((a) => alertLines.push(`  - ${a.title} [${a.alert_type_name}] (${a.severity}): ${(a.notes ?? '').substring(0, 200)}`))
    }
    if (resolved.length) {
      alertLines.push(`Resolved (${resolved.length}):`)
      resolved.slice(0, 5).forEach((a) => alertLines.push(`  - ${a.title} [${a.alert_type_name}] (resolved ${a.resolved_at ? new Date(a.resolved_at).toLocaleDateString('en-AU') : 'unknown'})`))
    }
    sections.push(`ALERTS & FLAGS (${alerts.length} total):\n${alertLines.join('\n')}`)
  }

  // ── Clinical Notes (more content) ──
  if (notes.length) {
    sections.push(`CLINICAL NOTES (last ${notes.length}):\n${notes.map((n) => {
      const date = new Date(n.created_at).toLocaleDateString('en-AU')
      const type = n.note_type ?? n.note_category ?? 'Note'
      const author = n.author_name ?? 'Unknown'
      const content = strip(n.assessment_html ?? n.content_html ?? n.plan_html ?? '')
      return `--- ${type} (${date}) by ${author} ${n.is_signed ? '[signed]' : '[draft]'} ---\n${content.substring(0, 500)}${content.length > 500 ? '...' : ''}`
    }).join('\n\n')}`)
  }

  // ── Risk Assessments ──
  if (riskAssessments.length) {
    sections.push(`RISK ASSESSMENTS (${riskAssessments.length}):\n${riskAssessments.map((r) => {
      const date = new Date(r.created_at).toLocaleDateString('en-AU')
      return `- ${date}: Self-harm: ${r.risk_self ?? 'N/A'} | Others: ${r.risk_others ?? 'N/A'} | Vulnerability: ${r.risk_vulnerability ?? 'N/A'}` +
        `${r.summary ? `\n  Summary: ${strip(r.summary).substring(0, 200)}` : ''}`
    }).join('\n')}`)
  }

  // ── Legal Orders ──
  if (legal.length) {
    sections.push(`LEGAL / MHA ORDERS (${legal.length}):\n${legal.map((l) =>
      `- ${l.order_type_name} (${l.status}) ${l.startdate ?? ''} to ${l.enddate ?? 'ongoing'}` +
      `${l.tribunal_date ? ` — Tribunal: ${l.tribunal_date}` : ''}`
    ).join('\n')}`)
  }

  // ── Pathology Results ──
  if (pathology.length) {
    sections.push(`PATHOLOGY RESULTS (last ${pathology.length}):\n${pathology.map((p) =>
      `- ${p.test_name ?? 'Unknown'} (${p.collected_at ? new Date(p.collected_at).toLocaleDateString('en-AU') : 'unknown'}): ${p.value ?? ''} ${p.unit ?? ''} [${p.flag ?? 'normal'}]${p.reference_range ? ` (ref: ${p.reference_range})` : ''}`
    ).join('\n')}`)
  }

  // ── Clinical Reviews ──
  if (clinicalReviews.length) {
    sections.push(`CLINICAL REVIEWS (${clinicalReviews.length}):\n${clinicalReviews.map((r) => {
      const date = r.review_date ? new Date(r.review_date).toLocaleDateString('en-AU') : 'unknown'
      return `- ${r.review_type ?? 'Review'} (${date}) by ${r.reviewer_name ?? 'unknown'}: ${strip(r.summary ?? r.notes ?? '').substring(0, 300)}`
    }).join('\n')}`)
  }

  // ── Appointments ──
  if (appointments.length) {
    const upcoming = appointments.filter((a) => new Date(a.start_time) > new Date())
    const past = appointments.filter((a) => new Date(a.start_time) <= new Date())
    const apptLines: string[] = []
    if (upcoming.length) {
      apptLines.push(`Upcoming (${upcoming.length}):`)
      upcoming.slice(0, 3).forEach((a) => apptLines.push(`  - ${new Date(a.start_time).toLocaleDateString('en-AU')} ${a.appointment_type ?? ''} with ${a.clinician_name ?? 'unknown'}`))
    }
    if (past.length) {
      apptLines.push(`Recent (${past.length}):`)
      past.slice(0, 5).forEach((a) => apptLines.push(`  - ${new Date(a.start_time).toLocaleDateString('en-AU')} ${a.appointment_type ?? ''} — ${a.status ?? 'unknown'}`))
    }
    sections.push(`APPOINTMENTS (${appointments.length}):\n${apptLines.join('\n')}`)
  }

  // ── Referrals ──
  if (referrals.length) {
    sections.push(`REFERRALS (${referrals.length}):\n${referrals.map((r) =>
      `- ${r.referral_type ?? 'Referral'} from ${r.referrer_name ?? 'unknown'} (${r.status ?? 'unknown'}, ${r.created_at ? new Date(r.created_at).toLocaleDateString('en-AU') : ''}): ${r.reason ?? ''}`
    ).join('\n')}`)
  }

  // ── Clinical Policies (configured in Org Settings) ──
  try {
    const policies = await db('clinical_policies')
      .where({ clinic_id: clinicId, is_active: true, available_to_llm: true })
      .orderBy('sort_order', 'asc')
    if (policies.length) {
      sections.push(`CLINICAL POLICIES (${policies.length}):\n${policies.map((p) => {
        const params = typeof p.parameters === 'string' ? JSON.parse(p.parameters) : (p.parameters ?? {})
        return `- ${p.name} [${p.rule_type}]: ${p.description ?? ''}` +
          `${params.intervalDays ? ` (every ${params.intervalDays} days)` : ''}` +
          `${p.llm_context ? `\n  Context: ${p.llm_context}` : ''}`
      }).join('\n')}`)
    }
  } catch { /* table may not exist yet */ }

  // ── AI Context Files (uploaded knowledge base) ──
  try {
    const contextFiles = await db('ai_context_files')
      .where({ clinic_id: clinicId, is_active: true, include_in_rag: true })
      .orderBy('priority', 'asc')
      .limit(10) // prevent context overflow
    for (const f of contextFiles) {
      // Truncate large files to ~2000 chars to stay within token budget
      const content = (f.content ?? '').substring(0, 2000)
      sections.push(`REFERENCE [${f.category}] — ${f.title}:\n${content}${(f.content ?? '').length > 2000 ? '\n[... truncated]' : ''}`)
    }
  } catch { /* table may not exist yet */ }

  return sections.join('\n\n')
}

// ============ 2. Few-Shot Examples ============

const FEW_SHOT_EXAMPLES: Record<string, string> = {
  maudsley: `
EXAMPLE OUTPUT (Maudsley Format):

LONGITUDINAL SUMMARY — [Patient Name]

IDENTIFYING INFORMATION:
[Age]-year-old [gender], referred by [source] on [date]. Currently under [service].

PRESENTING COMPLAINT:
[Current symptoms and concerns in patient's words]

PSYCHIATRIC HISTORY:
[Chronological history of episodes, admissions, treatments]

MEDICAL HISTORY:
[Relevant medical conditions, physical health]

SUBSTANCE USE:
[Alcohol, cannabis, other substances — pattern and impact]

FORENSIC HISTORY:
[Legal involvement, charges, orders]

FAMILY HISTORY:
[Psychiatric illness in family, family dynamics]

PERSONAL HISTORY:
[Developmental, educational, occupational, relationship history]

CURRENT MENTAL STATE:
[Appearance, behaviour, speech, mood, affect, thought form/content, perception, cognition, insight]

CURRENT MANAGEMENT:
[Medications, psychological interventions, social supports]

FORMULATION:
[Biopsychosocial formulation using 4P framework]

RISK ASSESSMENT:
[Risk to self, risk to others, vulnerability — current and historical]

PLAN:
[Short-term and medium-term management plan]`,

  isbar: `
EXAMPLE OUTPUT (ISBAR):

I — IDENTIFY:
"This is [clinician name], [role] at [service], calling about [Patient Name], DOB [date], UR [number]."

S — SITUATION:
"I am calling because [specific reason for handover/contact]. The patient is currently [location/status]."

B — BACKGROUND:
"[Patient] has a history of [key diagnoses]. Current medications include [list]. They were admitted/referred on [date] for [reason]. Recent notable events: [key changes]."

A — ASSESSMENT:
"My assessment is [clinical impression]. Key concerns are [specific concerns]. Mental state: [brief MSE]. Risk: [current risk level and factors]."

R — RECOMMENDATION:
"I recommend [specific actions needed]. Priority tasks: [urgent items]. Follow-up required: [timing and by whom]."`,

  'mhrt-report': `
EXAMPLE OUTPUT (MHRT Report):

MENTAL HEALTH REVIEW TRIBUNAL — CLINICAL REPORT

PATIENT DETAILS:
Name: [Full Name] | DOB: [Date] | UR: [Number]
Current Legal Status: [e.g. Treatment Order s.55 MH Act 2014]

CURRENT TREATING TEAM:
Psychiatrist: [Name] | Case Manager: [Name] | Service: [Name]

DIAGNOSIS:
Primary: [ICD-10 code and description]
Secondary: [if applicable]

HISTORY OF TREATMENT:
[Chronological summary of admissions, community treatment, medication trials]

CURRENT TREATMENT PLAN:
Medication: [Current medications with doses]
Psychological: [Current psychological interventions]
Social: [Social supports, accommodation, NDIS]

MENTAL STATE EXAMINATION:
[Current MSE findings]

RISK ASSESSMENT:
Risk to self: [Level and factors]
Risk to others: [Level and factors]
Vulnerability: [Level and factors]

TREATING TEAM OPINION:
[Whether the order should continue, be varied, or revoked, with clinical justification]

PATIENT'S VIEWS:
[Patient's expressed wishes regarding the order]

LEAST RESTRICTIVE ALTERNATIVE:
[Why current order is the least restrictive option, or what alternatives have been considered]`,

  formulation: `
EXAMPLE OUTPUT (4P Formulation):

BIOPSYCHOSOCIAL FORMULATION — [Patient Name]

PREDISPOSING FACTORS:
Biological: [genetics, neurodevelopment, physical health]
Psychological: [attachment, personality, cognitive style, trauma history]
Social: [childhood adversity, social disadvantage, cultural factors]

PRECIPITATING FACTORS:
Biological: [substance use, medication changes, physical illness]
Psychological: [life events, loss, conflict, perceived threats]
Social: [relationship breakdown, housing, employment, social isolation]

PERPETUATING FACTORS:
Biological: [ongoing substance use, treatment adherence, side effects]
Psychological: [cognitive patterns, avoidance, learned helplessness]
Social: [ongoing stressors, lack of support, systemic barriers]

PROTECTIVE FACTORS:
Biological: [treatment response, physical health, no substance use]
Psychological: [insight, motivation, coping skills, therapeutic alliance]
Social: [supportive relationships, stable housing, employment, cultural connection]

DIAGNOSTIC IMPRESSION:
[Primary and secondary diagnoses with ICD-10/DSM-5 codes]

TREATMENT IMPLICATIONS:
[How the formulation guides treatment planning]`,
}

// ============ 3. Multi-Pass Refinement ============

export async function generateWithRefinement(
  action: string,
  prompt: string,
  system: string,
  model?: string,
  clinicId?: string,
): Promise<{ text: string; model: string }> {
  // Pass 1: Generate draft
  const draft = await routeTextGeneration({
    clinicId,
    alias: resolveClinicalActionAlias(action as Parameters<typeof resolveClinicalActionAlias>[0]),
    prompt,
    system,
    requestedModel: model,
    action,
  })

  // Pass 2: Refine — check for completeness, accuracy, formatting
  const refinementPrompt = `Review and improve this clinical document. Fix any:
- Missing required sections
- Inconsistencies with the source data
- Formatting issues
- Vague or non-specific language
- Clinical terminology errors

If the document is already high quality, return it unchanged.

DOCUMENT TO REVIEW:
${draft.text}

ORIGINAL SOURCE DATA:
${prompt.substring(0, 1000)}

Return the improved document only, no commentary.`

  const refined = await routeTextGeneration({
    clinicId,
    alias: resolveClinicalActionAlias(action as Parameters<typeof resolveClinicalActionAlias>[0]),
    prompt: refinementPrompt,
    system: 'You are a clinical document quality reviewer. Improve the document while preserving clinical accuracy. Return only the improved document.',
    requestedModel: model,
    temperature: 0.1,
    action,
  })

  return {
    text: refined.text,
    model: refined.execution.modelName,
  }
}

// ============ 4. Structured Template Enforcement ============

const REQUIRED_SECTIONS: Record<string, string[]> = {
  maudsley: ['IDENTIFYING INFORMATION', 'PRESENTING COMPLAINT', 'PSYCHIATRIC HISTORY', 'CURRENT MENTAL STATE', 'CURRENT MANAGEMENT', 'RISK ASSESSMENT', 'PLAN'],
  isbar: ['IDENTIFY', 'SITUATION', 'BACKGROUND', 'ASSESSMENT', 'RECOMMENDATION'],
  formulation: ['PREDISPOSING', 'PRECIPITATING', 'PERPETUATING', 'PROTECTIVE'],
  letter: [],  // Letters/certificates vary too much in format to enforce sections
  discharge: ['DIAGNOSIS', 'ADMISSION', 'TREATMENT', 'MEDICATIONS AT DISCHARGE', 'FOLLOW-UP'],
  'mhrt-report': ['PATIENT DETAILS', 'DIAGNOSIS', 'CURRENT TREATMENT', 'MENTAL STATE', 'RISK ASSESSMENT', 'TREATING TEAM OPINION'],
}

export function validateSections(action: string, text: string): { valid: boolean; missing: string[] } {
  const required = REQUIRED_SECTIONS[action]
  if (!required) return { valid: true, missing: [] }
  const upper = text.toUpperCase()
  const missing = required.filter(s => !upper.includes(s.toUpperCase()))
  return { valid: missing.length === 0, missing }
}

// ============ 5. Enhanced Generate Function ============

export async function enhancedGenerate(opts: {
  action: string
  data: string
  patientId?: string
  episodeId?: string
  /**
   * BUG-281 — AuthContext-first per CLAUDE.md §13. REQUIRED when
   * `patientId` is set (patient-data read path); OPTIONAL when
   * `patientId` is omitted (no DB read, pure generation).
   */
  auth?: AuthContext
  /** @deprecated use `auth.clinicId` — retained for backwards-compat of non-patient callers only */
  clinicId?: string
  model?: string
  refine?: boolean
}): Promise<{ result: string; model: string; enriched: boolean; sections: { valid: boolean; missing: string[] } }> {
  let enrichedData = opts.data
  const effectiveClinicId = opts.auth?.clinicId ?? opts.clinicId

  // RAG: Auto-enrich with patient context if patientId provided. Must
  // carry an AuthContext so the gate in loadPatientContext can run.
  let enriched = false
  if (opts.patientId && opts.auth) {
    const context = await loadPatientContext(opts.auth, opts.patientId, { episodeId: opts.episodeId })
    if (context) {
      enrichedData = `REFERENCE DATA (use this information to fill in the document but do NOT include this raw data block in your output):\n${context}\n\n--- TASK ---\n${opts.data}`
      enriched = true
    }
  }

  // Add few-shot example if available
  const example = FEW_SHOT_EXAMPLES[opts.action]
  const exampleSuffix = example ? `\n\nFollow this format:\n${example}` : ''

  const fullPrompt = `${enrichedData}${exampleSuffix}`

  const COMPLEX_ACTIONS = new Set(['maudsley', 'mhrt-report', 'formulation', '91day', 'discharge'])
  let shouldRefine = opts.refine !== false && COMPLEX_ACTIONS.has(opts.action)

  // Dedicated Azure lanes can absorb the extra refinement pass. On the
  // local Ollama lane, long-form two-pass generation has proven brittle
  // under staging-sized CPU budgets, so prefer the single-pass route.
  if (shouldRefine && effectiveClinicId) {
    try {
      const runtimeSelection = await resolveLockedRuntimeSelection(effectiveClinicId)
      if (runtimeSelection.backend === 'local_ollama') {
        shouldRefine = false
      }
    } catch (err) {
      logger.warn(
        { err, clinicId: effectiveClinicId, action: opts.action },
        'AI enhancer runtime selection lookup failed; keeping default refinement behavior',
      )
    }
  }

  const ENHANCER_PROMPTS: Record<string, string> = {
    maudsley: 'You are a clinical documentation assistant generating Maudsley format summaries for Australian mental health services.',
    isbar: 'You are generating an ISBAR clinical handover summary.',
    formulation: 'You are generating a biopsychosocial formulation using the 4P framework.',
    letter: 'You are generating a professional clinical letter for Australian medical correspondence.',
    'mhrt-report': 'You are generating a Mental Health Review Tribunal (MHRT) clinical report under the Mental Health Act 2014 (Vic). This is a formal legal document for tribunal review. Include all required sections with clinical detail and professional language.',
    discharge: 'You are generating a comprehensive discharge summary for Australian public mental health services.',
    'risk-summary': 'You are generating a structured risk assessment for an Australian mental health patient.',
  }

  let result: string
  let usedModel = opts.model ?? 'default'
  if (shouldRefine) {
    const refined = await generateWithRefinement(
      opts.action,
      fullPrompt,
      ENHANCER_PROMPTS[opts.action] ?? '',
      opts.model,
      effectiveClinicId,
    )
    result = refined.text
    usedModel = refined.model
  } else {
    // Fast single-pass: use the system prompt directly
    const r = await routeTextGeneration({
      clinicId: effectiveClinicId,
      alias: resolveClinicalActionAlias(opts.action as Parameters<typeof resolveClinicalActionAlias>[0]),
      prompt: fullPrompt,
      system: ENHANCER_PROMPTS[opts.action] ?? undefined,
      requestedModel: opts.model,
      action: opts.action,
    })
    result = r.text
    usedModel = r.execution.modelName
  }

  // Post-process: strip any leaked RAG context or refinement notes
  result = stripLeakedContext(result)

  const sections = validateSections(opts.action, result)

  return {
    result,
    model: usedModel,
    enriched,
    sections,
  }
}
