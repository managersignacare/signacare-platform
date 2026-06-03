// apps/web/src/features/patients/components/notes/noteMacros.ts
//
// Keyboard macro expansion for clinical notes.
//
// Clinicians type one of the trigger sequences below followed by a
// space (or commit it via the "Insert" buttons above the textarea)
// and the helper fetches live patient data and inserts a formatted
// block in place of the trigger:
//
//   /labs      → most recent pathology entries
//   /vitals    → latest vitals + metabolic flowsheet reading
//   /meds      → current active medications + insulin regimen
//   /problems  → active problem list
//
// All fetches go through the existing apiClient endpoints — no new
// backend surface required:
//   - GET /patients/:id/pathology
//   - GET /nursing-assessments?patientId=:id&assessmentType=physical_tracking&limit=1
//   - GET /medications/patients/:id/medications
//   - GET /internal-medicine/patients/:id/problems?clinicalStatus=active
//
// Naming conventions (CLAUDE.md §1.5 + naming-conventions guard):
//   apiClient calls use relative paths only — no /api/v1/ prefix and
//   no leading slash.
import { apiClient } from '../../../../shared/services/apiClient'

export type MacroId = 'labs' | 'vitals' | 'meds' | 'problems'

export const MACRO_IDS: MacroId[] = ['labs', 'vitals', 'meds', 'problems']

export const MACRO_LABEL: Record<MacroId, string> = {
  labs: 'Labs',
  vitals: 'Vitals',
  meds: 'Medications',
  problems: 'Problems',
}

export const MACRO_TRIGGER: Record<MacroId, string> = {
  labs: '/labs',
  vitals: '/vitals',
  meds: '/meds',
  problems: '/problems',
}

interface PathologyReport {
  id: string
  filename?: string
  label?: string
  createdAt?: string
  result?: string | null
}

interface VitalsRow {
  id?: string
  scores?: Record<string, unknown>
  total_score?: number
  totalScore?: number
  created_at?: string
  createdAt?: string
}

interface MedicationRow {
  id: string
  medicationName?: string
  drugLabel?: string
  genericName?: string | null
  dose?: string
  frequency?: string
  status?: string
  category?: string | null
  prescribedBySpecialty?: string | null
}

interface ProblemRow {
  id: string
  display: string
  code: string
  codeSystem: string
  clinicalStatus: string
  severity?: string | null
  isChronic: boolean
}

function fmtDate(d?: string | null): string {
  if (!d) return '—'
  try { return new Date(d).toLocaleDateString('en-AU') } catch { return d }
}

// ── /labs ─────────────────────────────────────────────────────────────────

async function expandLabs(patientId: string): Promise<string> {
  try {
    const r = await apiClient.get<{ reports: PathologyReport[] }>(`patients/${patientId}/pathology`)
    const reports = (r.reports ?? []).slice(0, 8)
    if (reports.length === 0) return '=== LABS ===\n  (no pathology results on file)\n'
    const lines = reports.map((p) => {
      const label = (p.label ?? p.filename ?? 'Pathology').replace(/^Pathology:\s*/, '')
      return `  • ${label} — ${fmtDate(p.createdAt)}`
    })
    return `=== LABS (most recent ${reports.length}) ===\n${lines.join('\n')}\n`
  } catch {
    return '=== LABS ===\n  (failed to load pathology — check connection)\n'
  }
}

// ── /vitals ───────────────────────────────────────────────────────────────

async function expandVitals(patientId: string): Promise<string> {
  try {
    const r = await apiClient.get<{ data?: VitalsRow[] } | VitalsRow[]>(
      'nursing-assessments',
      { patientId, assessmentType: 'physical_tracking', limit: 1 },
    )
    const rows: VitalsRow[] = Array.isArray(r) ? r : (r.data ?? [])
    const latest = rows[0]
    if (!latest) return '=== VITALS ===\n  (no vitals recorded yet)\n'
    const s: Record<string, unknown> = latest.scores ?? {}
    const get = (k: string): string => {
      const v = s[k]
      if (v == null || v === '') return '—'
      return String(v)
    }
    const recordedAt = fmtDate((latest.created_at ?? latest.createdAt) as string | undefined)
    return [
      `=== VITALS (recorded ${recordedAt}) ===`,
      `  Weight (kg):       ${get('weight')}`,
      `  Height (cm):       ${get('height')}`,
      `  BMI:               ${s.bmi ?? '—'}`,
      `  BP (mmHg):         ${get('bpSystolic')}/${get('bpDiastolic')}`,
      `  Heart rate (bpm):  ${get('heartRate')}`,
      `  Waist circ (cm):   ${get('waistCircumference')}`,
      `  Blood glucose:     ${get('bloodGlucose')}`,
      '',
    ].join('\n')
  } catch {
    return '=== VITALS ===\n  (failed to load vitals — check connection)\n'
  }
}

// ── /meds ─────────────────────────────────────────────────────────────────

async function expandMeds(patientId: string): Promise<string> {
  try {
    const r = await apiClient.get<unknown>(`medications/patients/${patientId}/medications`)
    const list: MedicationRow[] = Array.isArray(r) ? (r as MedicationRow[]) : ((r as { data?: MedicationRow[] }).data ?? [])
    const active = list.filter((m) => m.status === 'active' || m.status === 'tapering')
    if (active.length === 0) return '=== MEDICATIONS ===\n  (no active medications)\n'
    const lines = active.map((m) => {
      const name = m.medicationName ?? m.drugLabel ?? m.genericName ?? '(unknown drug)'
      const dose = m.dose ? ` ${m.dose}` : ''
      const freq = m.frequency ? ` ${m.frequency}` : ''
      const tag = m.category ? `  [${m.category}]` : ''
      return `  • ${name}${dose}${freq}${tag}`
    })
    return `=== MEDICATIONS (active ${active.length}) ===\n${lines.join('\n')}\n`
  } catch {
    return '=== MEDICATIONS ===\n  (failed to load medications — check connection)\n'
  }
}

// ── /problems ─────────────────────────────────────────────────────────────

async function expandProblems(patientId: string): Promise<string> {
  try {
    const r = await apiClient.get<{ items: ProblemRow[] }>(
      `internal-medicine/patients/${patientId}/problems`,
      { clinicalStatus: 'active' },
    )
    const items = r.items ?? []
    if (items.length === 0) return '=== ACTIVE PROBLEMS ===\n  (no active problems)\n'
    const lines = items.map((p) => {
      const sev = p.severity ? ` (${p.severity})` : ''
      const chronic = p.isChronic ? ' [chronic]' : ''
      return `  • ${p.display} — ${p.codeSystem.toUpperCase()}: ${p.code}${sev}${chronic}`
    })
    return `=== ACTIVE PROBLEMS (${items.length}) ===\n${lines.join('\n')}\n`
  } catch {
    return '=== ACTIVE PROBLEMS ===\n  (failed to load problems — check connection)\n'
  }
}

const EXPANDERS: Record<MacroId, (patientId: string) => Promise<string>> = {
  labs: expandLabs,
  vitals: expandVitals,
  meds: expandMeds,
  problems: expandProblems,
}

/**
 * Async-expand a macro id into its formatted block. Used by the
 * "Insert" toolbar above the textarea AND by the inline trigger
 * detector below.
 */
export async function expandMacro(id: MacroId, patientId: string): Promise<string> {
  return EXPANDERS[id](patientId)
}

/**
 * Detect a trailing macro trigger (e.g. "/labs ") at `caret` in `text`.
 * Returns the matched macro id and the start offset of the trigger
 * (so the caller can splice it out and replace with the expansion),
 * or null if no trigger is present.
 *
 * The detector requires a trailing space because expansion is destructive:
 * we don't want to expand while the user is still typing "/labs" and
 * about to hit backspace.
 */
export function detectTrigger(
  text: string,
  caret: number,
): { id: MacroId; start: number; end: number } | null {
  if (caret < 2) return null
  // Trailing char must be a single space (the trigger commit).
  if (text[caret - 1] !== ' ') return null
  // Look back from caret-1 for a slash-prefixed token.
  let i = caret - 2
  while (i >= 0) {
    const c = text[i]
    if (c === '/') break
    // Trigger tokens are lowercase letters only.
    if (!/[a-z]/.test(c)) return null
    i--
    if (caret - 1 - i > 16) return null // bound the lookback
  }
  if (i < 0 || text[i] !== '/') return null
  const word = text.slice(i + 1, caret - 1)
  const id = MACRO_IDS.find((m) => m === (word as MacroId))
  if (!id) return null
  return { id, start: i, end: caret }
}
