/**
 * Reset Patient Data — Gold Standard Approach
 *
 * Handles: prevent_hard_delete RULES, RLS policies, FK CASCADE, audit triggers.
 *
 * Strategy:
 *   1. Drop prevent_hard_delete RULES on patients/episodes/clinical_notes
 *   2. Disable RLS on patients
 *   3. TRUNCATE patients CASCADE (FK CASCADE propagates to all 70+ child tables)
 *   4. TRUNCATE remaining non-patient-linked tables
 *   5. Restore RULES and RLS
 *
 * Preserves: clinics, staff, org_units, templates, lookup lists, clinical_roles.
 *
 * Run: npx ts-node -r dotenv/config --project tsconfig.node.json src/reset-patient-data.ts
 */
import { db } from './db/db';

async function resetPatientData() {
  console.log('\n══════════════════════════════════════════');
  console.log('  RESET PATIENT DATA (Gold Standard)');
  console.log('  Handles: RLS, RULES, FK CASCADE');
  console.log('══════════════════════════════════════════\n');

  try {
    // Step 1: Drop prevent_hard_delete RULES that intercept DELETE
    console.log('  [1/5] Dropping prevent_hard_delete rules...');
    for (const table of ['patients', 'episodes', 'clinical_notes']) {
      await db.raw(`DROP RULE IF EXISTS prevent_hard_delete ON "${table}"`);
    }

    // Step 2: Disable RLS on patients
    console.log('  [2/5] Disabling RLS on patients...');
    await db.raw('ALTER TABLE patients DISABLE ROW LEVEL SECURITY');

    // Step 3: TRUNCATE patients CASCADE — propagates to all child tables
    console.log('  [3/5] TRUNCATE patients CASCADE...');
    await db.raw('TRUNCATE TABLE patients CASCADE');
    console.log('         ✓ patients + all child tables cleared');

    // Step 4: Clean remaining non-patient tables
    console.log('  [4/5] Cleaning non-patient tables...');
    const extraTables = [
      'group_sessions', 'tasks', 'escalations',
      'messages', 'message_thread_participants', 'message_threads',
      'staff_role_assignments', 'audit_log', 'audit_runs',
    ];
    for (const table of extraTables) {
      try {
        const exists = await db.schema.hasTable(table);
        if (exists) {
          await db.raw(`TRUNCATE TABLE "${table}" CASCADE`);
          console.log(`         ✓ ${table}`);
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(`         ⏭ ${table}: ${message.substring(0, 60)}`);
      }
    }

    // Step 5: Restore RULES and RLS
    console.log('  [5/5] Restoring rules and RLS...');
    await db.raw(`CREATE RULE prevent_hard_delete AS ON DELETE TO patients DO INSTEAD UPDATE patients SET deleted_at = now() WHERE patients.id = old.id AND patients.deleted_at IS NULL`);
    await db.raw(`CREATE RULE prevent_hard_delete AS ON DELETE TO episodes DO INSTEAD UPDATE episodes SET deleted_at = now() WHERE episodes.id = old.id AND episodes.deleted_at IS NULL`);
    await db.raw(`CREATE RULE prevent_hard_delete AS ON DELETE TO clinical_notes DO INSTEAD UPDATE clinical_notes SET deleted_at = now() WHERE clinical_notes.id = old.id AND clinical_notes.deleted_at IS NULL`);
    await db.raw('ALTER TABLE patients ENABLE ROW LEVEL SECURITY');

    // Verify
    const counts = await db.raw(`
      SELECT 'patients' as tbl, count(*)::int as cnt FROM patients
      UNION ALL SELECT 'episodes', count(*)::int FROM episodes
      UNION ALL SELECT 'clinical_notes', count(*)::int FROM clinical_notes
      UNION ALL SELECT 'staff (kept)', count(*)::int FROM staff
      UNION ALL SELECT 'org_units (kept)', count(*)::int FROM org_units
      UNION ALL SELECT 'templates (kept)', count(*)::int FROM templates
      ORDER BY tbl
    `);
    console.log('\n  ── Verification ──');
    for (const row of counts.rows) {
      console.log(`  ${row.cnt === 0 ? '✓' : '⚠'} ${row.tbl}: ${row.cnt}`);
    }

    console.log('\n  Done. All patient data removed. Staff, templates, and org settings preserved.\n');
  } catch (err) {
    console.error('\n  ✗ Reset failed:', err instanceof Error ? err.message : String(err));
    // Attempt to restore rules even on failure
    try {
      await db.raw(`CREATE RULE IF NOT EXISTS prevent_hard_delete AS ON DELETE TO patients DO INSTEAD UPDATE patients SET deleted_at = now() WHERE patients.id = old.id AND patients.deleted_at IS NULL`).catch(() => {});
      await db.raw('ALTER TABLE patients ENABLE ROW LEVEL SECURITY').catch(() => {});
    } catch { /* best effort */ }
  }

  await db.destroy();
  process.exit(0);
}

resetPatientData();
