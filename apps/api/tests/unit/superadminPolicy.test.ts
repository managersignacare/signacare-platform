import { afterEach, describe, expect, it } from 'vitest';
import { HttpError } from '../../src/shared/errors';
import {
  assertSuperadminRoleMutationAllowed,
  assertSuperadminSessionEligibility,
  getAllowedSuperadminEmailDomains,
  isAllowedSuperadminEmail,
} from '../../src/shared/superadminPolicy';

const ORIGINAL_ALLOWED_DOMAINS = process.env.SUPERADMIN_ALLOWED_EMAIL_DOMAINS;

function restoreEnv() {
  if (ORIGINAL_ALLOWED_DOMAINS === undefined) {
    delete process.env.SUPERADMIN_ALLOWED_EMAIL_DOMAINS;
    return;
  }
  process.env.SUPERADMIN_ALLOWED_EMAIL_DOMAINS = ORIGINAL_ALLOWED_DOMAINS;
}

afterEach(() => {
  restoreEnv();
});

describe('superadminPolicy', () => {
  it('uses Signacare defaults when allowlist env var is missing', () => {
    delete process.env.SUPERADMIN_ALLOWED_EMAIL_DOMAINS;
    expect(getAllowedSuperadminEmailDomains()).toEqual(['signacare.net', 'signacare.local']);
    expect(isAllowedSuperadminEmail('admin@signacare.net')).toBe(true);
    expect(isAllowedSuperadminEmail('admin@clinic.example')).toBe(false);
  });

  it('supports configurable allowlist domains', () => {
    process.env.SUPERADMIN_ALLOWED_EMAIL_DOMAINS = 'signacare.net,signacare.com.au,@ops.signacare.net';
    expect(getAllowedSuperadminEmailDomains()).toEqual([
      'signacare.net',
      'signacare.com.au',
      'ops.signacare.net',
    ]);
    expect(isAllowedSuperadminEmail('platform@signacare.com.au')).toBe(true);
    expect(isAllowedSuperadminEmail('platform@ops.signacare.net')).toBe(true);
    expect(isAllowedSuperadminEmail('platform@outside.example')).toBe(false);
  });

  it('blocks superadmin login/session when email domain is not allowed', () => {
    process.env.SUPERADMIN_ALLOWED_EMAIL_DOMAINS = 'signacare.net';
    expect(() =>
      assertSuperadminSessionEligibility({
        role: 'superadmin',
        email: 'legacy-admin@clinic.example',
      }),
    ).toThrowError(HttpError);
  });

  it('allows non-superadmin sessions regardless of email domain', () => {
    process.env.SUPERADMIN_ALLOWED_EMAIL_DOMAINS = 'signacare.net';
    expect(() =>
      assertSuperadminSessionEligibility({
        role: 'admin',
        email: 'anyone@clinic.example',
      }),
    ).not.toThrow();
  });

  it('blocks superadmin role mutations by non-superadmin actors', () => {
    process.env.SUPERADMIN_ALLOWED_EMAIL_DOMAINS = 'signacare.net';
    expect(() =>
      assertSuperadminRoleMutationAllowed({
        actorAuth: {
          staffId: 'staff-1',
          clinicId: 'clinic-1',
          role: 'admin',
          permissions: [],
        },
        existingRole: 'clinician',
        targetRole: 'superadmin',
        targetEmail: 'admin@signacare.net',
      }),
    ).toThrowError(HttpError);
  });

  it('blocks superadmin assignment to non-Signacare email domain', () => {
    process.env.SUPERADMIN_ALLOWED_EMAIL_DOMAINS = 'signacare.net';
    expect(() =>
      assertSuperadminRoleMutationAllowed({
        actorAuth: {
          staffId: 'staff-1',
          clinicId: 'clinic-1',
          role: 'superadmin',
          permissions: [],
        },
        existingRole: 'clinician',
        targetRole: 'superadmin',
        targetEmail: 'admin@clinic.example',
      }),
    ).toThrowError(HttpError);
  });

  it('allows superadmin assignment when actor and email domain are valid', () => {
    process.env.SUPERADMIN_ALLOWED_EMAIL_DOMAINS = 'signacare.net';
    expect(() =>
      assertSuperadminRoleMutationAllowed({
        actorAuth: {
          staffId: 'staff-1',
          clinicId: 'clinic-1',
          role: 'superadmin',
          permissions: [],
        },
        existingRole: 'admin',
        targetRole: 'superadmin',
        targetEmail: 'admin@signacare.net',
      }),
    ).not.toThrow();
  });
});
