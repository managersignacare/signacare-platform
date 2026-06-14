import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthContext } from '@signacare/shared';

const firstMock = vi.fn();
const selectMock = vi.fn(() => ({ first: firstMock }));
const whereMock = vi.fn(() => ({ select: selectMock }));
const dbMock = vi.fn(() => ({ where: whereMock }));
const validateHpiiFormatMock = vi.fn();

vi.mock('../../src/db/db', () => ({
  db: dbMock,
  dbAdmin: {},
  rlsStore: { getStore: vi.fn() },
}));

vi.mock('../../src/integrations/hiService/hiServiceClient', () => ({
  validateHpiiFormat: validateHpiiFormatMock,
}));

describe('requireValidHpii staging bypass', () => {
  const auth: AuthContext = {
    clinicId: '11111111-1111-1111-1111-111111111111',
    staffId: '22222222-2222-2222-2222-222222222222',
    role: 'prescriber_consultant',
    permissions: [],
  };

  const originalReleaseEnv = process.env.SIGNACARE_RELEASE_ENV;
  const originalBypass = process.env.ALLOW_INVALID_HPII_IN_STAGING;

  beforeEach(() => {
    vi.clearAllMocks();
    firstMock.mockResolvedValue({ hpii: null });
    validateHpiiFormatMock.mockReturnValue(false);
    delete process.env.SIGNACARE_RELEASE_ENV;
    delete process.env.ALLOW_INVALID_HPII_IN_STAGING;
  });

  afterEach(() => {
    if (originalReleaseEnv === undefined) {
      delete process.env.SIGNACARE_RELEASE_ENV;
    } else {
      process.env.SIGNACARE_RELEASE_ENV = originalReleaseEnv;
    }

    if (originalBypass === undefined) {
      delete process.env.ALLOW_INVALID_HPII_IN_STAGING;
    } else {
      process.env.ALLOW_INVALID_HPII_IN_STAGING = originalBypass;
    }
  });

  it('keeps strict HPI-I enforcement outside staging', async () => {
    const { requireValidHpii } = await import('../../src/shared/authGuards');

    await expect(requireValidHpii(auth)).rejects.toMatchObject({
      code: 'PRESCRIBER_HPII_INVALID',
      status: 403,
    });
  });

  it('allows invalid or missing HPI-I only when the explicit staging bypass flag is enabled', async () => {
    process.env.SIGNACARE_RELEASE_ENV = 'staging';
    process.env.ALLOW_INVALID_HPII_IN_STAGING = 'true';

    const { requireValidHpii } = await import('../../src/shared/authGuards');

    await expect(requireValidHpii(auth)).resolves.toBeUndefined();
  });
});
