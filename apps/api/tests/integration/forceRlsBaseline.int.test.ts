import { describe, expect, it } from 'vitest';
import { dbAdmin } from '../../src/db/db';
import { isIntegrationReady } from './_helpers';

const READY = await isIntegrationReady();

describe.skipIf(!READY)('BUG-ARCH-FORCE-RLS-BASELINE', () => {
  it('all RLS-enabled public tables are FORCE-enabled', async () => {
    const res = await dbAdmin.raw<{
      not_forced_count: string;
      total_rls_tables: string;
    }[]>(`
      SELECT
        COUNT(*) FILTER (WHERE c.relrowsecurity AND NOT c.relforcerowsecurity)::text AS not_forced_count,
        COUNT(*) FILTER (WHERE c.relrowsecurity)::text AS total_rls_tables
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
    `);

    const row = res.rows[0];
    const notForcedCount = Number(row?.not_forced_count ?? '0');
    const totalRlsTables = Number(row?.total_rls_tables ?? '0');

    expect(totalRlsTables).toBeGreaterThan(0);
    expect(notForcedCount).toBe(0);
  });
});

