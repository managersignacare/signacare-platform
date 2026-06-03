/**
 * BUG-453 / C3-4 Batch 1:
 * non-critical integration-route coverage backfill.
 *
 * Scope is intentionally bounded to three non-safety-critical read paths
 * so Batch 1 stays within the max-5 contract and proves deterministic
 * route execution against the real API stack.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import {
  authedAgent,
  isIntegrationReady,
  loginAsAdmin,
} from './_helpers';

const READY = await isIntegrationReady();

describe.skipIf(!READY)('BUG-453 C3-4 Batch 1 non-critical route coverage', () => {
  let token: string;

  beforeAll(async () => {
    ({ token } = await loginAsAdmin());
  });

  it('GET /api/v1/feature-flags returns resolved bootstrap flags', async () => {
    const res = await authedAgent(token).get('/api/v1/feature-flags');
    expect(res.status).toBe(200);
    expect(res.body).toBeTruthy();
    expect(typeof res.body).toBe('object');
    expect(res.body.flags).toBeTruthy();
    expect(typeof res.body.flags).toBe('object');
  });

  it('GET /api/v1/org-settings/units/tree returns org-tree payload', async () => {
    const res = await authedAgent(token).get('/api/v1/org-settings/units/tree');
    expect(res.status).toBe(200);
    expect(res.body).toBeTruthy();
  });

  it('GET /api/v1/waitlist returns waitlist collection for the clinic context', async () => {
    const res = await authedAgent(token).get('/api/v1/waitlist');
    expect(res.status).toBe(200);
    expect(res.body).toBeTruthy();
  });
});

