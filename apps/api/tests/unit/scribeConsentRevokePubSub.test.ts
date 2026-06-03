import { describe, expect, it } from 'vitest';
import { __decodeConsentRevokeMessageForTests } from '../../src/shared/scribeConsentRevokePubSub';

describe('BUG-329 revoke-cache pub/sub payload decode', () => {
  it('BUG-329-1 parses canonical payload', () => {
    const payload = __decodeConsentRevokeMessageForTests(
      JSON.stringify({
        consentId: '11111111-1111-4111-8111-111111111111',
        clinicId: '22222222-2222-4222-8222-222222222222',
        source: 'unit-test',
        revokedAt: '2026-05-14T10:00:00.000Z',
      }),
    );
    expect(payload).not.toBeNull();
    expect(payload?.consentId).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('BUG-329-2 rejects malformed payloads fail-closed', () => {
    expect(__decodeConsentRevokeMessageForTests('not-json')).toBeNull();
    expect(
      __decodeConsentRevokeMessageForTests(
        JSON.stringify({
          consentId: 'not-a-uuid',
          clinicId: '22222222-2222-4222-8222-222222222222',
          source: 'unit-test',
          revokedAt: '2026-05-14T10:00:00.000Z',
        }),
      ),
    ).toBeNull();
    expect(
      __decodeConsentRevokeMessageForTests(
        JSON.stringify({
          consentId: '11111111-1111-4111-8111-111111111111',
          clinicId: '',
          source: 'unit-test',
          revokedAt: '2026-05-14T10:00:00.000Z',
        }),
      ),
    ).toBeNull();
  });
});
