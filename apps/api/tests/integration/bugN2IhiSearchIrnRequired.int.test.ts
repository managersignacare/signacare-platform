/**
 * BUG-N2 — Medicare IRN mandatory on IHI search path (ADHA req 24065).
 *
 * This suite pins API-boundary enforcement for /prescriptions/hi/search-ihi:
 * - missing IRN is rejected (422)
 * - malformed IRN is rejected (422)
 * - valid Medicare number + IRN pair is accepted by schema (200 path)
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { authedAgent, isIntegrationReady, loginAsClinician } from './_helpers';

const READY = await isIntegrationReady();

describe.skipIf(!READY)('BUG-N2 /prescriptions/hi/search-ihi Medicare IRN requirement', () => {
  let token: string;

  beforeAll(async () => {
    const session = await loginAsClinician();
    token = session.token;
  });

  it('T1 — missing medicareIrn is rejected with 422', async () => {
    const agent = authedAgent(token);
    const res = await agent.post('/api/v1/prescriptions/hi/search-ihi').send({
      familyName: 'Smith',
      givenName: 'Jane',
      dateOfBirth: '1985-01-01',
      gender: 'F',
      medicareNumber: '29500003411',
    });
    expect(res.status).toBe(422);
  });

  it('T2 — malformed medicareIrn is rejected with 422', async () => {
    const agent = authedAgent(token);
    const res = await agent.post('/api/v1/prescriptions/hi/search-ihi').send({
      familyName: 'Smith',
      givenName: 'Jane',
      dateOfBirth: '1985-01-01',
      gender: 'F',
      medicareNumber: '29500003411',
      medicareIrn: '0',
    });
    expect(res.status).toBe(422);
  });

  it('T3 — valid medicareNumber + medicareIrn pair passes schema and reaches service', async () => {
    const agent = authedAgent(token);
    const res = await agent.post('/api/v1/prescriptions/hi/search-ihi').send({
      familyName: 'Smith',
      givenName: 'Jane',
      dateOfBirth: '1985-01-01',
      gender: 'F',
      medicareNumber: '29500003411',
      medicareIrn: '1',
    });
    expect(res.status).toBe(200);
    expect(typeof res.body.found).toBe('boolean');
  });
});
