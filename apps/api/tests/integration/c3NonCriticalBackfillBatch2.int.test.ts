/**
 * BUG-453 / C3-4 Batch 2:
 * non-critical integration-route coverage backfill.
 *
 * This batch extends coverage on three additional non-safety-critical
 * read paths. Contract remains bounded (<=5 routes, >=+3 routes delta).
 */

import { beforeAll, describe, expect, it } from 'vitest';
import {
  authedAgent,
  isIntegrationReady,
  loginAsAdmin,
} from './_helpers';

const READY = await isIntegrationReady();

describe.skipIf(!READY)('BUG-453 C3-4 Batch 2 non-critical route coverage', () => {
  let token: string;

  beforeAll(async () => {
    ({ token } = await loginAsAdmin());
  });

  it('GET /api/v1/templates returns template list payload', async () => {
    const res = await authedAgent(token).get('/api/v1/templates');
    expect(res.status).toBe(200);
    expect(res.body).toBeTruthy();
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /api/v1/settings/thresholds returns threshold map', async () => {
    const res = await authedAgent(token).get('/api/v1/settings/thresholds');
    expect(res.status).toBe(200);
    expect(res.body).toBeTruthy();
    expect(typeof res.body).toBe('object');
    expect(res.body.thresholds).toBeTruthy();
    expect(typeof res.body.thresholds).toBe('object');
  });

  it('GET /api/v1/org-settings/programs returns programs payload', async () => {
    const res = await authedAgent(token).get('/api/v1/org-settings/programs');
    expect(res.status).toBe(200);
    expect(res.body).toBeTruthy();
    expect(typeof res.body).toBe('object');
    expect(Array.isArray(res.body.programs)).toBe(true);
  });
});

