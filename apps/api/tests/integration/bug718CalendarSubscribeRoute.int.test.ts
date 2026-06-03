import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import app from '../../src/server';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const READY = await isIntegrationReady();

let authToken = '';

describe.skipIf(!READY)('BUG-718 — calendar subscribe route contract', () => {
  beforeAll(async () => {
    const session = await loginAsAdmin();
    authToken = session.token;
  });

  it('serves GET /api/v1/calendar/ical/subscribe from authenticated calendar routes', async () => {
    const res = await request(app)
      .get('/api/v1/calendar/ical/subscribe')
      .set('Authorization', `Bearer ${authToken}`)
      .set('X-Client', 'mobile');

    expect(res.status).toBe(200);
    expect(typeof res.body?.url).toBe('string');
    expect(String(res.body.url)).toContain('/api/v1/calendar/ical/');
  });
});

