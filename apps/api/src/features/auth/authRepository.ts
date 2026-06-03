//apps/api/src/repositories/authRepository.ts
import { db } from "../../db/db";

export interface MfaSecretRow {
  id: string;
  staff_id: string;
  secret: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface SessionRow {
  id: string;
  staff_id: string;
  clinic_id: string;
  refresh_token: string;
  user_agent: string | null;
  ip_address: string | null;
  expires_at: Date;
  created_at: Date;
  updated_at: Date;
  revoked_at: Date | null;
  lock_version: number;
  /**
   * RFC 6819 §5.2.2.3 session-family identifier. Propagated across
   * refresh-token rotations — a reuse of any rotated token revokes
   * every row in the family. See migration
   * 20260412000003_staff_sessions_family_id.
   */
  family_id: string;
}

let staffSessionsHasLockVersionCache: boolean | null = null;

async function hasStaffSessionsLockVersionColumn(): Promise<boolean> {
  if (staffSessionsHasLockVersionCache !== null) {
    return staffSessionsHasLockVersionCache;
  }
  const row = await db('information_schema.columns')
    .where({
      table_schema: 'public',
      table_name: 'staff_sessions',
      column_name: 'lock_version',
    })
    .first('column_name');
  staffSessionsHasLockVersionCache = Boolean(row);
  return staffSessionsHasLockVersionCache;
}

export class AuthRepository {
  private async buildSessionRevokePatch(): Promise<Record<string, unknown>> {
    const patch: Record<string, unknown> = {
      revoked_at: new Date(),
      updated_at: new Date(),
    };
    if (await hasStaffSessionsLockVersionColumn()) {
      patch['lock_version'] = db.raw('lock_version + 1');
    }
    return patch;
  }

  async upsertMfaSecret(staffId: string, secret: string): Promise<MfaSecretRow> {
    const existing = await db<MfaSecretRow>("mfa_secrets")
      .where({ staff_id: staffId, is_active: true })
      .first();
    const now = new Date();

    if (existing) {
      const [row] = await db<MfaSecretRow>("mfa_secrets")
        .where({ id: existing.id })
        .update({ secret, updated_at: now })
        .returning("*");
      return row;
    }

    const [row] = await db<MfaSecretRow>("mfa_secrets")
      .insert({
        id: crypto.randomUUID(),
        staff_id: staffId,
        secret,
        is_active: true,
        created_at: now,
        updated_at: now,
      })
      .returning("*");

    return row;
  }

  async getActiveMfaSecret(staffId: string): Promise<MfaSecretRow | undefined> {
    const row = await db<MfaSecretRow>("mfa_secrets")
      .where({ staff_id: staffId, is_active: true })
      .first();
    return row ?? undefined;
  }

  async createSession(row: SessionRow): Promise<SessionRow> {
    const insertRow: Partial<SessionRow> = { ...row };
    if (!(await hasStaffSessionsLockVersionColumn())) {
      delete insertRow.lock_version;
    }
    const [created] = await db<SessionRow>("staff_sessions")
      .insert(insertRow)
      .returning("*");
    return created;
  }

  async findSessionByToken(token: string): Promise<SessionRow | undefined> {
    const row = await db<SessionRow>("staff_sessions")
      .where({ refresh_token: token, revoked_at: null })
      .first();
    return row ?? undefined;
  }

  /**
   * RFC 6819 §5.2.2.3 reuse-detection lookup. Returns the session
   * row even when revoked_at is set, so the service layer can tell
   * apart "token doesn't exist" (forged / never issued) from "token
   * was rotated and is now being replayed" (stolen chain).
   */
  async findAnySessionByToken(token: string): Promise<SessionRow | undefined> {
    const row = await db<SessionRow>("staff_sessions")
      .where({ refresh_token: token })
      .first();
    return row ?? undefined;
  }

  async revokeSession(id: string): Promise<void> {
    const patch = await this.buildSessionRevokePatch();
    await db<SessionRow>("staff_sessions")
      .where({ id })
      .update(patch);
  }

  /**
   * RFC 6819 §5.2.2.3 session-tree invalidation. Revokes every
   * currently-active session that shares a family_id with the
   * reused token. Called from authService.refresh() when a stale
   * refresh token is presented.
   */
  async revokeSessionFamily(familyId: string): Promise<number> {
    const patch = await this.buildSessionRevokePatch();
    const affected = await db<SessionRow>("staff_sessions")
      .where({ family_id: familyId })
      .whereNull('revoked_at')
      .update(patch);
    return affected;
  }

  async revokeSessionsByIds(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const patch = await this.buildSessionRevokePatch();
    const affected = await db<SessionRow>('staff_sessions')
      .whereIn('id', ids)
      .whereNull('revoked_at')
      .update(patch);
    return affected;
  }

  async revokeSessionsForStaff(staffId: string): Promise<void> {
    const patch = await this.buildSessionRevokePatch();
    await db<SessionRow>("staff_sessions")
      .where({ staff_id: staffId, revoked_at: null })
      .update(patch);
  }
}
