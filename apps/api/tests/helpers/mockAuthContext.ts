// tests/helpers/mockAuthContext.ts
//
// Test factory for AuthContext. Every service test uses this
// instead of constructing raw (clinicId, staffId) strings.

import type { AuthContext } from '@signacare/shared';

const DEFAULT_CLINIC = '11111111-1111-1111-1111-111111111111';
const DEFAULT_STAFF = '22222222-2222-2222-2222-222222222222';

export function mockAuthContext(
  overrides?: Partial<AuthContext>,
): AuthContext {
  return {
    staffId: DEFAULT_STAFF,
    clinicId: DEFAULT_CLINIC,
    role: 'clinician',
    permissions: [
      'patient:read', 'patient:create', 'patient:update',
      'note:read', 'note:create',
      'medication:read', 'medication:create', 'medication:update',
      'appointment:read', 'appointment:create', 'appointment:update',
      'ect:read', 'ect:create',
      'tms:read', 'tms:create',
    ],
    ...overrides,
  };
}

export function mockSuperadmin(
  overrides?: Partial<AuthContext>,
): AuthContext {
  return mockAuthContext({
    role: 'superadmin',
    permissions: [],
    ...overrides,
  });
}

export function mockReceptionist(
  overrides?: Partial<AuthContext>,
): AuthContext {
  return mockAuthContext({
    role: 'receptionist',
    permissions: [
      'patient:read', 'appointment:read', 'appointment:create',
    ],
    ...overrides,
  });
}

export function mockNurse(
  overrides?: Partial<AuthContext>,
): AuthContext {
  return mockAuthContext({
    role: 'nurse',
    permissions: [
      'patient:read', 'note:read', 'note:create',
      'medication:read',
    ],
    ...overrides,
  });
}

export function mockPsychologist(
  overrides?: Partial<AuthContext>,
): AuthContext {
  return mockAuthContext({
    role: 'clinician',
    permissions: [
      'patient:read', 'note:read', 'note:create',
      'outcome:read', 'outcome:create',
    ],
    ...overrides,
  });
}

export function mockPsychiatrist(
  overrides?: Partial<AuthContext>,
): AuthContext {
  return mockAuthContext({
    role: 'clinician',
    permissions: [
      'patient:read', 'patient:create',
      'note:read', 'note:create',
      'medication:read', 'medication:create',
      'ect:read', 'ect:create',
      'tms:read', 'tms:create',
    ],
    ...overrides,
  });
}

export function mockManager(
  overrides?: Partial<AuthContext>,
): AuthContext {
  return mockAuthContext({
    role: 'manager',
    permissions: [
      'patient:read', 'appointment:read',
      'report:read', 'staff:read',
    ],
    ...overrides,
  });
}

export function mockDirector(
  overrides?: Partial<AuthContext>,
): AuthContext {
  return mockAuthContext({
    role: 'medical_director',
    permissions: [
      'patient:read', 'note:read',
      'report:read', 'audit:read', 'staff:read',
      'governance:read',
    ],
    ...overrides,
  });
}
