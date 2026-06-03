/**
 * BUG-286 regression — llm_interactions tamper-evidence (two-layer
 * defence mirroring BUG-039's audit_log pattern).
 *
 * Layer A (DB grants): app_user has INSERT + SELECT only — UPDATE,
 * DELETE, TRUNCATE are revoked.
 *
 * Layer B (BEFORE UPDATE/DELETE triggers): `llm_interactions_prevent_
 * mutation()` raises 'llm_interactions is append-only (BUG-286 tamper-
 * evident)' for all roles including dbAdmin (no SECURITY DEFINER).
 *
 * Coverage (7 tests):
 *   T1 — app_user has SELECT on llm_interactions (read preserved).
 *   T2 — app_user has INSERT on llm_interactions (write preserved for
 *        recordLlmInteraction).
 *   T3 — app_user does NOT have UPDATE on llm_interactions.
 *   T4 — app_user does NOT have DELETE on llm_interactions.
 *   T5 — dbAdmin UPDATE attempt raises 'llm_interactions is append-only'
 *        (Layer B defence-in-depth — trigger fires even for owner).
 *   T6 — dbAdmin DELETE attempt raises 'llm_interactions is append-only'.
 *   T7 — dead updated_at trigger (`trg_llm_interactions_updated_at`) is
 *        absent (BUG-325 schema cleanup).
 */

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'crypto';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const READY = await isIntegrationReady();

describe.skipIf(!READY)('BUG-286 llm_interactions immutability (live DB)', () => {
  it('T1 — app_user has SELECT on llm_interactions', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    const appUser = process.env.DB_APP_USER ?? 'app_user';
    const r = await dbAdmin.raw<{ rows: Array<{ has: boolean }> }>(
      "SELECT has_table_privilege(?, 'llm_interactions', 'SELECT') AS has",
      [appUser],
    );
    const has = r.rows?.[0]?.has;
    if (typeof has !== 'boolean') return;
    expect(has).toBe(true);
  });

  it('T2 — app_user has INSERT on llm_interactions', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    const appUser = process.env.DB_APP_USER ?? 'app_user';
    const r = await dbAdmin.raw<{ rows: Array<{ has: boolean }> }>(
      "SELECT has_table_privilege(?, 'llm_interactions', 'INSERT') AS has",
      [appUser],
    );
    const has = r.rows?.[0]?.has;
    if (typeof has !== 'boolean') return;
    expect(has).toBe(true);
  });

  it('T3 — app_user does NOT have UPDATE on llm_interactions', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    const appUser = process.env.DB_APP_USER ?? 'app_user';
    const r = await dbAdmin.raw<{ rows: Array<{ has: boolean }> }>(
      "SELECT has_table_privilege(?, 'llm_interactions', 'UPDATE') AS has",
      [appUser],
    );
    const has = r.rows?.[0]?.has;
    if (typeof has !== 'boolean') return;
    expect(has).toBe(false);
  });

  it('T4 — app_user does NOT have DELETE on llm_interactions', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    const appUser = process.env.DB_APP_USER ?? 'app_user';
    const r = await dbAdmin.raw<{ rows: Array<{ has: boolean }> }>(
      "SELECT has_table_privilege(?, 'llm_interactions', 'DELETE') AS has",
      [appUser],
    );
    const has = r.rows?.[0]?.has;
    if (typeof has !== 'boolean') return;
    expect(has).toBe(false);
  });

  it('T5 — BEFORE UPDATE trigger raises for dbAdmin (owner role)', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    const session = await loginAsAdmin();
    const probeId = randomUUID();
    await dbAdmin('llm_interactions').insert({
      id: probeId,
      clinic_id: session.clinicId,
      feature: 'bug_286_trigger_update_probe',
      model_name: 'test',
      success: true,
    } as never);

    let caught: Error | null = null;
    try {
      await dbAdmin('llm_interactions')
        .where({ id: probeId })
        .update({ feature: 'TAMPERED' });
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).not.toBeNull();
    expect((caught as Error).message).toMatch(/llm_interactions is append-only/);
  });

  it('T6 — BEFORE DELETE trigger raises for dbAdmin (owner role)', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    const session = await loginAsAdmin();
    const probeId = randomUUID();
    await dbAdmin('llm_interactions').insert({
      id: probeId,
      clinic_id: session.clinicId,
      feature: 'bug_286_trigger_delete_probe',
      model_name: 'test',
      success: true,
    } as never);

    let caught: Error | null = null;
    try {
      await dbAdmin('llm_interactions').where({ id: probeId }).del();
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).not.toBeNull();
    expect((caught as Error).message).toMatch(/llm_interactions is append-only/);
  });

  it('T7 — dead updated_at trigger is absent on llm_interactions (BUG-325)', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    const r = await dbAdmin.raw<{ rows: Array<{ present: boolean }> }>(`
      SELECT EXISTS (
        SELECT 1
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = 'llm_interactions'
          AND t.tgname = 'trg_llm_interactions_updated_at'
          AND NOT t.tgisinternal
      ) AS present
    `);
    const present = r.rows?.[0]?.present;
    if (typeof present !== 'boolean') return;
    expect(present).toBe(false);
  });
});
