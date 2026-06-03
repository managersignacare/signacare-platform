#!/usr/bin/env tsx
/**
 * BUG-280 — Retrospective audit of llm_interactions for pre-BUG-036
 * cross-patient contamination.
 *
 * ── Purpose ───────────────────────────────────────────────────────
 * Before BUG-036, 5 LLM endpoints accepted patient_id without
 * requirePatientRelationship. Any clinician could have triggered LLM
 * calls against any patient, producing llm_interactions rows where
 * user_id had no sanctioned care-relationship to patient_id at the
 * time of the call.
 *
 * This script IDENTIFIES CANDIDATE CONTAMINATION — rows where NO
 * sanctioned access path existed at llm_interactions.created_at. It
 * does NOT remediate, does NOT modify rows (audit_log + llm_interactions
 * are append-only per BUG-039), does NOT establish reportability under
 * the OAIC NDB scheme — that assessment is done by ops + legal.
 *
 * The audit SUPPORTS NDB assessment. Candidate rows are those that a
 * human reviewer must examine to determine whether an "eligible data
 * breach" occurred (unauthorised access likely to result in serious
 * harm). Only that assessment triggers the NDB notification obligation.
 *
 * ── Relationship model (mirrors requirePatientRelationship) ───────
 * A row is NOT candidate contamination if ANY of these held at
 * llm_interactions.created_at:
 *
 *  (1) BYPASS_ROLES — staff.role IN ('superadmin', 'admin').
 *      Note: staff.role is CURRENT state; we don't have role_history
 *      today so post-call role changes would be invisible. Residual.
 *  (2) Active break-glass session — break_glass_sessions row with
 *      staff_id = llm.user_id, status='approved', approved_at <=
 *      llm.created_at, (expires_at IS NULL OR expires_at >
 *      llm.created_at), (revoked_at IS NULL OR revoked_at >
 *      llm.created_at). Break-glass is session-wide, not
 *      patient-bound.
 *  (3) Open/active/admitted episode with staff as primary or key
 *      worker (non-deleted), created before the LLM call.
 *  (4) Team assignment (patient_team_assignments + staff_team_assignments
 *      joined by org_unit_id), both active, created before the LLM call.
 *  (5) Appointment attendance (appointment_attendees + appointments,
 *      not 'removed'), non-deleted appointment, created before the
 *      LLM call.
 *
 * Performance: every check uses EXISTS() — not LEFT JOIN (R1
 * absorption). The planner short-circuits on the first matching row.
 *
 * ── Output ────────────────────────────────────────────────────────
 * Writes timestamped findings to
 *   docs/audit-2026-04-19/findings/BUG-280-llm-interactions-contamination.md
 *
 * Fields:
 *   - total rows analysed
 *   - rows skipped (patient_id IS NULL — non-patient-specific LLM calls)
 *   - rows passing ≥1 check (legitimate)
 *   - rows failing all checks (candidate contamination)
 *   - per-clinic breakdown
 *   - per-staff breakdown (repeat-offender detection)
 *   - per-patient breakdown (affected patient count)
 *
 * ── Safety ────────────────────────────────────────────────────────
 * - Read-only. Never DELETE / UPDATE any row.
 * - Uses dbAdmin (bypasses RLS — necessary to cross-tenant-reconcile).
 * - SET statement_timeout = '10min' at session start.
 * - Prefers DB_READ_HOST replica if configured (fall back to primary).
 * - Dry-run by default — env AUDIT_WRITE_REPORT=true to append to
 *   findings; otherwise stdout only.
 *
 * Usage:
 *   cd apps/api
 *   npx tsx scripts/audit-llm-interactions-contamination.ts
 *   AUDIT_WRITE_REPORT=true npx tsx scripts/audit-llm-interactions-contamination.ts
 */

import { dbAdmin } from '../src/db/db';
// SSoT for BYPASS_ROLES — extracted to shared/authConstants.ts per
// BUG-280 L5 absorption so runtime authGuards + retrospective audit
// share a single list. Adding a role there takes effect in both
// places atomically.
import { BYPASS_ROLES } from '../src/shared/authConstants';
import * as fs from 'fs';
import * as path from 'path';

const REPORT_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'docs',
  'audit-2026-04-19',
  'findings',
  'BUG-280-llm-interactions-contamination.md',
);

/**
 * Core relationship check — mirrors requirePatientRelationship with
 * the addition of staff role bypass (applied separately below so we
 * can distinguish the reason PASSed).
 *
 * Returns true if ANY of the 4 non-role checks pass. Role bypass is
 * evaluated in the per-row loop because staff.role is a scalar lookup.
 */
async function hasRelationship(
  clinicId: string,
  userId: string,
  patientId: string,
  createdAt: Date,
): Promise<boolean> {
  // Check 2: Break-glass session active at time T (session-wide, not
  // patient-bound).
  const bgActive = await dbAdmin.raw<{ rows: Array<{ exists: boolean }> }>(
    `SELECT EXISTS (
      SELECT 1 FROM break_glass_sessions
      WHERE staff_id = ?
        AND clinic_id = ?
        AND status = 'approved'
        AND approved_at <= ?
        AND (expires_at IS NULL OR expires_at > ?)
        AND (revoked_at IS NULL OR revoked_at > ?)
    )`,
    [userId, clinicId, createdAt, createdAt, createdAt],
  );
  if (bgActive.rows[0]!.exists) return true;

  // Check 3: Open/active/admitted episode where staff is primary or
  // key worker.
  const episode = await dbAdmin.raw<{ rows: Array<{ exists: boolean }> }>(
    `SELECT EXISTS (
      SELECT 1 FROM episodes
      WHERE patient_id = ?
        AND clinic_id = ?
        AND status IN ('open', 'active', 'admitted')
        AND deleted_at IS NULL
        AND (primary_clinician_id = ? OR key_worker_id = ?)
        AND created_at <= ?
    )`,
    [patientId, clinicId, userId, userId, createdAt],
  );
  if (episode.rows[0]!.exists) return true;

  // Check 4: Team assignment.
  const team = await dbAdmin.raw<{ rows: Array<{ exists: boolean }> }>(
    `SELECT EXISTS (
      SELECT 1
        FROM patient_team_assignments pta
        JOIN staff_team_assignments sta ON sta.org_unit_id = pta.org_unit_id
       WHERE pta.patient_id = ?
         AND sta.staff_id = ?
         AND pta.is_active = true
         AND sta.is_active = true
         AND pta.created_at <= ?
         AND sta.created_at <= ?
         AND (sta.end_date IS NULL OR sta.end_date > ?::date)
    )`,
    [patientId, userId, createdAt, createdAt, createdAt],
  );
  if (team.rows[0]!.exists) return true;

  // Check 5: Appointment attendance.
  const appt = await dbAdmin.raw<{ rows: Array<{ exists: boolean }> }>(
    `SELECT EXISTS (
      SELECT 1
        FROM appointment_attendees aa
        JOIN appointments a ON a.id = aa.appointment_id
       WHERE a.patient_id = ?
         AND a.clinic_id = ?
         AND aa.staff_id = ?
         AND aa.attendance_status <> 'removed'
         AND a.deleted_at IS NULL
         AND a.created_at <= ?
    )`,
    [patientId, clinicId, userId, createdAt],
  );
  return appt.rows[0]!.exists;
}

interface Finding {
  interaction_id: string;
  clinic_id: string;
  user_id: string;
  patient_id: string;
  created_at: string;
  feature: string;
  reason: 'no_relationship' | 'no_patient_id_skip';
}

interface StaffRole {
  id: string;
  role: string;
}

async function main(): Promise<number> {
  console.log('BUG-280 — retrospective llm_interactions contamination audit');
  const writeReport = process.env.AUDIT_WRITE_REPORT === 'true';
  console.log(`  write_report: ${writeReport}`);

  // Set statement timeout for this session.
  await dbAdmin.raw(`SET statement_timeout = '10min'`);

  // Pre-load staff roles so we can apply BYPASS_ROLES without a
  // per-row query. role_history would be better; we have only current
  // state today (documented residual).
  const roles = await dbAdmin.raw<{ rows: StaffRole[] }>(
    'SELECT id, role FROM staff',
  );
  const staffRoleMap = new Map<string, string>(roles.rows.map((r) => [r.id, r.role]));
  console.log(`  staff loaded: ${staffRoleMap.size}`);

  // Stream the llm_interactions rows in created_at ORDER.
  const rows = await dbAdmin('llm_interactions')
    .select('id', 'clinic_id', 'user_id', 'patient_id', 'created_at', 'feature')
    .orderBy('created_at', 'asc');
  console.log(`  rows to analyse: ${rows.length}`);

  const findings: Finding[] = [];
  let skippedNoPatient = 0;
  let skippedNoUserId = 0;
  let legitimate = 0;

  for (const row of rows) {
    if (!row.patient_id) {
      skippedNoPatient++;
      continue;
    }
    if (!row.user_id) {
      skippedNoUserId++;
      continue;
    }
    const role = staffRoleMap.get(row.user_id);
    if (role && BYPASS_ROLES.has(role)) {
      legitimate++;
      continue;
    }
    const ok = await hasRelationship(
      row.clinic_id as string,
      row.user_id as string,
      row.patient_id as string,
      row.created_at as Date,
    );
    if (ok) {
      legitimate++;
      continue;
    }
    findings.push({
      interaction_id: row.id as string,
      clinic_id: row.clinic_id as string,
      user_id: row.user_id as string,
      patient_id: row.patient_id as string,
      created_at: (row.created_at as Date).toISOString(),
      feature: (row.feature as string) ?? '',
      reason: 'no_relationship',
    });
  }

  // Per-dimension breakdowns.
  const byClinic = new Map<string, number>();
  const byStaff = new Map<string, number>();
  const byPatient = new Map<string, number>();
  for (const f of findings) {
    byClinic.set(f.clinic_id, (byClinic.get(f.clinic_id) ?? 0) + 1);
    byStaff.set(f.user_id, (byStaff.get(f.user_id) ?? 0) + 1);
    byPatient.set(f.patient_id, (byPatient.get(f.patient_id) ?? 0) + 1);
  }

  const summary = `
## Run ${new Date().toISOString()}

- total_analysed:      ${rows.length}
- skipped_no_patient:  ${skippedNoPatient}
- skipped_no_user:     ${skippedNoUserId}
- legitimate:          ${legitimate}
- candidate_contamination: ${findings.length}

**Per-clinic breakdown:**
${
  byClinic.size === 0
    ? '(none)'
    : Array.from(byClinic.entries()).sort((a, b) => b[1] - a[1]).map(([c, n]) => `- ${c}: ${n}`).join('\n')
}

**Per-staff breakdown (top 20 repeat offenders):**
${
  byStaff.size === 0
    ? '(none)'
    : Array.from(byStaff.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([s, n]) => `- ${s}: ${n}`).join('\n')
}

**Per-patient breakdown (top 20 affected):**
${
  byPatient.size === 0
    ? '(none)'
    : Array.from(byPatient.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([p, n]) => `- ${p}: ${n}`).join('\n')
}

**Candidate contamination detail (CSV):**

\`\`\`csv
interaction_id,clinic_id,user_id,patient_id,created_at,feature,reason
${findings.map((f) => [f.interaction_id, f.clinic_id, f.user_id, f.patient_id, f.created_at, f.feature, f.reason].join(',')).join('\n')}
\`\`\`

---
`;

  console.log(summary);

  if (writeReport) {
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.appendFileSync(REPORT_PATH, summary);
    console.log(`Report appended to: ${REPORT_PATH}`);
  }

  return 0;
}

// Re-export hasRelationship for integration testing. BYPASS_ROLES
// now lives in shared/authConstants.ts — tests can import directly
// if needed.
export { hasRelationship };

// Only run the full audit when invoked directly (not when imported
// by a test file). Tests exercise hasRelationship() and BYPASS_ROLES
// in isolation; they must not trigger main() + process.exit().
const invokedDirectly = require.main === module;
if (invokedDirectly) {
  main()
    .then((code) => dbAdmin.destroy().then(() => process.exit(code)))
    .catch((err) => {
      console.error('audit failed:', err);
      dbAdmin.destroy().finally(() => process.exit(2));
    });
}
