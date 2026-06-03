import { describe, it, expect } from 'vitest';
import {
  buildExecutiveStaff,
  stubHash,
} from '../src/seed-good-health/generators/02_executive_staff';
import { EXECUTIVE_STAFF } from '../src/seed-good-health/config/catalog';
import { clinicId } from '../src/seed-good-health/config/ids';

describe('seed-good-health generator 02: executive staff', () => {
  it('emits one row per catalog executive persona', async () => {
    const { rows } = await buildExecutiveStaff(stubHash);
    expect(rows).toHaveLength(EXECUTIVE_STAFF.length);
    expect(rows.length).toBe(5);
  });

  it('every row anchors to the executive clinic tenant (RLS proof)', async () => {
    const { rows } = await buildExecutiveStaff(stubHash);
    const exec = clinicId('executive');
    for (const row of rows) {
      expect(row.clinic_id).toBe(exec);
    }
  });

  it('every row has a deterministic id that is a v5 uuid', async () => {
    const { rows } = await buildExecutiveStaff(stubHash);
    for (const row of rows) {
      expect(row.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
  });

  it('ids are byte-stable across two builds (idempotency proof)', async () => {
    const a = await buildExecutiveStaff(stubHash);
    const b = await buildExecutiveStaff(stubHash);
    expect(a.rows.map((r) => r.id)).toStrictEqual(b.rows.map((r) => r.id));
  });

  it('emails are unique and lowercased', async () => {
    const { rows } = await buildExecutiveStaff(stubHash);
    const emails = new Set(rows.map((r) => r.email));
    expect(emails.size).toBe(rows.length);
    for (const row of rows) {
      expect(row.email).toBe(row.email.toLowerCase());
      expect(row.email).toMatch(/^[a-z.]+@exec\.goodhealth\.demo$/);
    }
  });

  it('every row has a non-empty password_hash that matches stub shape', async () => {
    const { rows } = await buildExecutiveStaff(stubHash);
    for (const row of rows) {
      expect(row.password_hash).toMatch(/^\$2b\$10\$stub\./);
    }
  });

  it('login table matches the row count and cross-references staffId', async () => {
    const { rows, loginTable } = await buildExecutiveStaff(stubHash);
    expect(loginTable).toHaveLength(rows.length);
    const staffIdsInRows = new Set(rows.map((r) => r.id));
    for (const login of loginTable) {
      expect(staffIdsInRows.has(login.staffId)).toBe(true);
      expect(login.plainPassword).toMatch(/2026$/);
      expect(login.plainPassword.length).toBeGreaterThanOrEqual(8);
    }
  });

  it('two personas have superadmin role (CEO + CMO)', async () => {
    const { rows } = await buildExecutiveStaff(stubHash);
    const supers = rows.filter((r) => r.role === 'superadmin');
    expect(supers).toHaveLength(2);
  });

  it('every row is flagged active + MFA required + MFA not yet configured', async () => {
    const { rows } = await buildExecutiveStaff(stubHash);
    for (const row of rows) {
      expect(row.is_active).toBe(true);
      expect(row.require_mfa).toBe(true);
      expect(row.has_mfa_configured).toBe(false);
      expect(row.failed_login_attempts).toBe(0);
    }
  });

  it('accepts an async hashFn without breaking row shape', async () => {
    const asyncHash = async (plain: string) => `async.${plain.length}`;
    const { rows } = await buildExecutiveStaff(asyncHash);
    for (const row of rows) {
      expect(row.password_hash).toMatch(/^async\.\d+$/);
    }
  });
});
