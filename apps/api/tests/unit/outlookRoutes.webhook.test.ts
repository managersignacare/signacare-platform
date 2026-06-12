import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { outlookRoutes } from '../../src/integrations/outlook/outlookRoutes';

describe('outlookRoutes webhook validation', () => {
  it('echoes the Microsoft Graph validationToken without auth', async () => {
    const app = express();
    app.use(express.json());
    app.use(outlookRoutes);

    const res = await request(app)
      .post('/calendar-sync/webhook?validationToken=hello-graph');

    expect(res.status).toBe(200);
    expect(res.text).toBe('hello-graph');
    expect(res.headers['content-type']).toContain('text/plain');
  });
});
