import { adminPoolRaw } from '../db/db';
import { logger } from '../utils/logger';

type ForceRlsCountRow = {
  not_forced_count: string;
  total_rls_tables: string;
};

type RolePostureRow = {
  role_name: string;
  rolbypassrls: boolean;
};

export async function assertForceRlsPosture(): Promise<void> {
  const forceRowsResult = (await adminPoolRaw.raw(`
    SELECT
      COUNT(*) FILTER (WHERE c.relrowsecurity AND NOT c.relforcerowsecurity)::text AS not_forced_count,
      COUNT(*) FILTER (WHERE c.relrowsecurity)::text AS total_rls_tables
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
  `)) as { rows: ForceRlsCountRow[] };

  const roleRowsResult = (await adminPoolRaw.raw(`
    SELECT rolname AS role_name, rolbypassrls
    FROM pg_roles
    WHERE rolname = current_user
  `)) as { rows: RolePostureRow[] };

  const force = forceRowsResult.rows[0];
  const role = roleRowsResult.rows[0];
  const notForcedCount = Number(force?.not_forced_count ?? '0');
  const totalRlsTables = Number(force?.total_rls_tables ?? '0');
  const roleBypassesRls = Boolean(role?.rolbypassrls);

  if (notForcedCount > 0) {
    throw new Error(
      `FORCE RLS posture failed: ${notForcedCount}/${totalRlsTables} RLS tables are not FORCE-enabled`,
    );
  }

  if (roleBypassesRls) {
    const msg =
      `FORCE RLS posture warning: runtime owner role '${role?.role_name ?? 'unknown'}' has BYPASSRLS. ` +
      'DBA must run: ALTER ROLE <owner-role> NOBYPASSRLS';
    if (process.env.NODE_ENV === 'production') {
      throw new Error(msg);
    }
    logger.warn({ role: role?.role_name ?? 'unknown' }, msg);
  }
}
