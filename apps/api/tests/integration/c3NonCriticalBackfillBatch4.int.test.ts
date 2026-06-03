/**
 * BUG-453 / C3-4 Batch 4:
 * non-critical integration-route coverage backfill.
 *
 * Final allowed batch under the 4-batch pre-retriage hard-stop.
 * Adds three non-safety-critical read paths.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import {
  authedAgent,
  isIntegrationReady,
  loginAsAdmin,
} from './_helpers';

const READY = await isIntegrationReady();

describe.skipIf(!READY)('BUG-453 C3-4 Batch 4 non-critical route coverage', () => {
  let token: string;

  beforeAll(async () => {
    ({ token } = await loginAsAdmin());
  });

  it('GET /api/v1/reports/admin-overview returns governance summary payload', async () => {
    const res = await authedAgent(token).get('/api/v1/reports/admin-overview');
    expect(res.status).toBe(200);
    expect(res.body).toBeTruthy();
    expect(typeof res.body).toBe('object');
    expect(res.body.overview).toBeTruthy();
    expect(typeof res.body.overview).toBe('object');
  });

  it('GET /api/v1/feature-flags-admin returns admin flag list payload', async () => {
    const res = await authedAgent(token).get('/api/v1/feature-flags-admin');
    expect(res.status).toBe(200);
    expect(res.body).toBeTruthy();
    expect(typeof res.body).toBe('object');
    expect(Array.isArray(res.body.flags)).toBe(true);
  });

  it('GET /api/v1/org-settings/level-labels returns level-label list payload', async () => {
    const res = await authedAgent(token).get('/api/v1/org-settings/level-labels');
    expect(res.status).toBe(200);
    expect(res.body).toBeTruthy();
    expect(typeof res.body).toBe('object');
    expect(Array.isArray(res.body.labels)).toBe(true);
  });
});
