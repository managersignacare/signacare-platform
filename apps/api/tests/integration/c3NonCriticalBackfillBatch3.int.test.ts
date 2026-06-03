/**
 * BUG-453 / C3-4 Batch 3:
 * non-critical integration-route coverage backfill.
 *
 * Adds coverage for three additional non-safety-critical read paths.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import {
  authedAgent,
  isIntegrationReady,
  loginAsAdmin,
} from './_helpers';

const READY = await isIntegrationReady();

describe.skipIf(!READY)('BUG-453 C3-4 Batch 3 non-critical route coverage', () => {
  let token: string;

  beforeAll(async () => {
    ({ token } = await loginAsAdmin());
  });

  it('GET /api/v1/reports returns report-run list payload', async () => {
    const res = await authedAgent(token).get('/api/v1/reports');
    expect(res.status).toBe(200);
    expect(res.body).toBeTruthy();
    expect(typeof res.body).toBe('object');
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('GET /api/v1/feature-flags/:name returns single-flag status payload', async () => {
    const res = await authedAgent(token).get('/api/v1/feature-flags/ai-chart-summary');
    expect(res.status).toBe(200);
    expect(res.body).toBeTruthy();
    expect(typeof res.body).toBe('object');
    expect(typeof res.body.name).toBe('string');
    expect(typeof res.body.enabled).toBe('boolean');
  });

  it('GET /api/v1/org-settings/units returns flat org-unit list payload', async () => {
    const res = await authedAgent(token).get('/api/v1/org-settings/units');
    expect(res.status).toBe(200);
    expect(res.body).toBeTruthy();
    expect(typeof res.body).toBe('object');
    expect(Array.isArray(res.body.units)).toBe(true);
  });
});

