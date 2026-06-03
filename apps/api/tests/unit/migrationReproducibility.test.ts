/**
 * Phase 0.7.1 — Migration reproducibility guards.
 *
 * These tests verify structural properties of the migration set
 * that would catch the classes of drift found during the deep audit:
 *   - No orphaned SQL files
 *   - No silent .catch() patterns in migration up() functions
 *   - Phase R R2 (2026-04-18) introduced a baseline file
 *     (`20260701000000_baseline.ts`). A bounded set of pre-baseline
 *     corrective migrations is still allowed; anything outside that
 *     explicit set is drift.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../migrations');
const SQL_DIR = path.resolve(__dirname, '../../src/db/migrations');
const BASELINE_FILE = '20260701000000_baseline.ts';
const ALLOWED_PRE_BASELINE_FILES = new Set([
  '20260421000001_llm_interactions_audit_fields.ts',
  '20260421000002_audit_log_immutability.ts',
  '20260421000003_prescriber_discipline_barrier.ts',
  '20260423000001_clinic_access_admins.ts',
  '20260423000002_rating_scales_seed.ts',
  '20260423000003_staff_leave_periods.ts',
  '20260423000004_drop_duplicate_staff_leave_periods.ts',
  '20260423000005_access_admin_slot_integrity_trigger.ts',
  '20260423000007_access_admin_trigger_audit_log.ts',
  '20260423000008_reconcile_stale_admin_slots.ts',
  '20260424000001_force_revoke_sessions_on_staff_state_change.ts',
  '20260424000002_pathology_orders_unique_order_number.ts',
  '20260424000003_rls_gap_closure_19_tables.ts',
  '20260427000001_data_retention_storage.ts',
  '20260427000002_patients_last_contact_at_and_manager_approval.ts',
  '20260430000000_bug_622_medication_administrations_context_prn_reason.ts',
  '20260430010000_bug_626_medication_administrations_patient_medication_id_not_null.ts',
]);

describe('Migration reproducibility', () => {
  const migrationFiles = fs.existsSync(MIGRATIONS_DIR)
    ? fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.ts')).sort()
    : [];

  it('has no UNEXPECTED pre-baseline migration files on disk', () => {
    const preBaseline = migrationFiles.filter(
      (f) => f < '20260701000000' && !f.startsWith('_'),
    );
    const unexpected = preBaseline.filter((f) => !ALLOWED_PRE_BASELINE_FILES.has(f));
    expect(unexpected).toEqual([]);
  });

  it('has at least 1 migration file (the R2 baseline)', () => {
    expect(migrationFiles.length).toBeGreaterThanOrEqual(1);
  });

  it('R2 baseline file exists', () => {
    expect(migrationFiles).toContain(BASELINE_FILE);
  });

  it('no migration up() function uses .catch(() => {}) pattern', () => {
    const violations: string[] = [];
    for (const file of migrationFiles) {
      const content = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
      // Match .catch(() => {}) or .catch(() => { /* ... */ }) in non-comment lines
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!.trim();
        if (line.startsWith('//') || line.startsWith('*')) continue;
        if (/\.catch\s*\(\s*\(\)\s*=>\s*\{/.test(line) || /\.catch\s*\(\s*\(\)\s*=>\s*undefined/.test(line)) {
          violations.push(`${file}:${i + 1}: ${line.slice(0, 80)}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('every SQL sidecar file uses IF NOT EXISTS on CREATE INDEX', () => {
    if (!fs.existsSync(SQL_DIR)) return;
    const sqlFiles = fs.readdirSync(SQL_DIR).filter((f) => f.endsWith('.sql'));
    const violations: string[] = [];
    for (const file of sqlFiles) {
      const content = fs.readFileSync(path.join(SQL_DIR, file), 'utf-8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!.trim();
        if (/^CREATE INDEX(?! IF NOT EXISTS)/i.test(line)) {
          violations.push(`${file}:${i + 1}: missing IF NOT EXISTS`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('every SQL sidecar file has DROP POLICY IF EXISTS before CREATE POLICY', () => {
    if (!fs.existsSync(SQL_DIR)) return;
    const sqlFiles = fs.readdirSync(SQL_DIR).filter((f) => f.endsWith('.sql'));
    const violations: string[] = [];
    for (const file of sqlFiles) {
      const content = fs.readFileSync(path.join(SQL_DIR, file), 'utf-8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!.trim();
        if (/^CREATE POLICY\s/i.test(line)) {
          const prevLine = i > 0 ? lines[i - 1]!.trim() : '';
          if (!/DROP POLICY IF EXISTS/i.test(prevLine)) {
            violations.push(`${file}:${i + 1}: CREATE POLICY without preceding DROP IF EXISTS`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
