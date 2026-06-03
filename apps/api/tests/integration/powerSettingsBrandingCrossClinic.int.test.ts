import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import type { SuperAgentTest } from 'supertest';
import {
  authedAgent,
  isIntegrationReady,
  loginAsAdmin,
} from './_helpers';
import { CANONICAL_CLINIC_IDS } from '../fixtures/canonical-personas';
import { dbAdmin } from '../../src/db/db';
import { withTenantContext } from '../../src/shared/tenantContext';

const READY = await isIntegrationReady();

type BrandingRow = {
  id: string;
  clinic_id: string;
  logo_url: string | null;
  primary_color: string | null;
  sidebar_color: string | null;
  sidebar_title: string | null;
  sidebar_subtitle: string | null;
  org_name: string | null;
  created_at: Date;
  updated_at: Date;
};

describe.skipIf(!READY)('power settings branding cross-clinic (superadmin)', () => {
  let agent: SuperAgentTest;
  let originalRows: BrandingRow[] = [];

  beforeAll(async () => {
    const session = await loginAsAdmin();
    agent = authedAgent(session.token);
    const primaryRows = await withTenantContext(
      CANONICAL_CLINIC_IDS.primary,
      () => dbAdmin<BrandingRow>('subscriber_branding').where({ clinic_id: CANONICAL_CLINIC_IDS.primary }),
    );
    const secondaryRows = await withTenantContext(
      CANONICAL_CLINIC_IDS.secondary,
      () => dbAdmin<BrandingRow>('subscriber_branding').where({ clinic_id: CANONICAL_CLINIC_IDS.secondary }),
    );
    originalRows = [...primaryRows, ...secondaryRows];
  });

  afterAll(async () => {
    await withTenantContext(
      CANONICAL_CLINIC_IDS.primary,
      () => dbAdmin('subscriber_branding').where({ clinic_id: CANONICAL_CLINIC_IDS.primary }).del(),
    );
    await withTenantContext(
      CANONICAL_CLINIC_IDS.secondary,
      () => dbAdmin('subscriber_branding').where({ clinic_id: CANONICAL_CLINIC_IDS.secondary }).del(),
    );

    const primaryRestore = originalRows.filter((row) => row.clinic_id === CANONICAL_CLINIC_IDS.primary);
    const secondaryRestore = originalRows.filter((row) => row.clinic_id === CANONICAL_CLINIC_IDS.secondary);
    if (primaryRestore.length > 0) {
      await withTenantContext(
        CANONICAL_CLINIC_IDS.primary,
        () => dbAdmin('subscriber_branding').insert(primaryRestore),
      );
    }
    if (secondaryRestore.length > 0) {
      await withTenantContext(
        CANONICAL_CLINIC_IDS.secondary,
        () => dbAdmin('subscriber_branding').insert(secondaryRestore),
      );
    }
  });

  it('allows superadmin to upsert branding for another clinic and keeps /branding/me clinic-scoped', async () => {
    const stamp = Date.now().toString();
    const primaryTitle = `Primary Brand ${stamp}`;
    const secondaryTitle = `Secondary Brand ${stamp}`;
    const primaryLogoPath = `/uploads/logos/${stamp}-primary.png`;

    const primaryRes = await agent
      .put(`/api/v1/power-settings/branding/${CANONICAL_CLINIC_IDS.primary}`)
      .send({
        sidebarTitle: primaryTitle,
        sidebarSubtitle: 'Primary Subtitle',
        logoUrl: primaryLogoPath,
      });

    expect(primaryRes.status).toBe(200);
    expect(primaryRes.body?.branding?.clinicId).toBe(CANONICAL_CLINIC_IDS.primary);
    expect(primaryRes.body?.branding?.sidebarTitle).toBe(primaryTitle);
    expect(primaryRes.body?.branding?.logoUrl).toBe(primaryLogoPath);

    const secondaryRes = await agent
      .put(`/api/v1/power-settings/branding/${CANONICAL_CLINIC_IDS.secondary}`)
      .send({
        sidebarTitle: secondaryTitle,
        sidebarSubtitle: 'Secondary Subtitle',
        logoUrl: '',
      });

    expect(secondaryRes.status).toBe(200);
    expect(secondaryRes.body?.branding?.clinicId).toBe(CANONICAL_CLINIC_IDS.secondary);
    expect(secondaryRes.body?.branding?.sidebarTitle).toBe(secondaryTitle);

    const meRes = await agent.get('/api/v1/power-settings/branding/me');
    expect(meRes.status).toBe(200);
    expect(meRes.body?.branding?.clinicId).toBe(CANONICAL_CLINIC_IDS.primary);
    expect(meRes.body?.branding?.sidebarTitle).toBe(primaryTitle);

    const allRes = await agent.get('/api/v1/power-settings/branding');
    expect(allRes.status).toBe(200);
    const all = Array.isArray(allRes.body?.branding) ? allRes.body.branding : [];
    const byClinicId = new Map<string, { sidebarTitle: string }>(
      all.map((row: { clinicId: string; sidebarTitle: string }) => [row.clinicId, row]),
    );
    expect(byClinicId.get(CANONICAL_CLINIC_IDS.primary)?.sidebarTitle).toBe(primaryTitle);
    expect(byClinicId.get(CANONICAL_CLINIC_IDS.secondary)?.sidebarTitle).toBe(secondaryTitle);
  });

  it('persists logo URL returned by the branding upload endpoint', async () => {
    const uploadRes = await agent
      .post('/api/v1/power-settings/branding/logo')
      .attach('logo', Buffer.from('fake-image-bytes'), {
        filename: 'test-logo.png',
        contentType: 'image/png',
      });

    expect(uploadRes.status).toBe(200);
    const uploadedUrl = uploadRes.body?.url as string | undefined;
    expect(typeof uploadedUrl).toBe('string');
    expect(uploadedUrl).toMatch(/^\/uploads\/logos\//);

    const stamp = Date.now().toString();
    const saveRes = await agent
      .put(`/api/v1/power-settings/branding/${CANONICAL_CLINIC_IDS.primary}`)
      .send({
        sidebarTitle: `Logo Save ${stamp}`,
        sidebarSubtitle: 'Logo Save Subtitle',
        logoUrl: uploadedUrl,
      });

    expect(saveRes.status).toBe(200);
    expect(saveRes.body?.branding?.logoUrl).toBe(uploadedUrl);
  });

  it('returns clinic-name fallback branding when a clinic has no branding row', async () => {
    const clinic = await withTenantContext(
      CANONICAL_CLINIC_IDS.primary,
      () => dbAdmin('clinics')
        .where({ id: CANONICAL_CLINIC_IDS.primary })
        .first('name'),
    );
    expect(typeof clinic?.name).toBe('string');

    await withTenantContext(
      CANONICAL_CLINIC_IDS.primary,
      () => dbAdmin('subscriber_branding')
        .where({ clinic_id: CANONICAL_CLINIC_IDS.primary })
        .del(),
    );

    const meRes = await agent.get('/api/v1/power-settings/branding/me');
    expect(meRes.status).toBe(200);
    expect(meRes.body?.branding?.clinicId).toBe(CANONICAL_CLINIC_IDS.primary);
    expect(meRes.body?.branding?.sidebarTitle).toBe(clinic?.name);
    expect(meRes.body?.branding?.sidebarSubtitle).toBe('Mental Health EMR');
  });

  it('normalizes blank branding fields and falls back to clinic defaults', async () => {
    const clinic = await withTenantContext(
      CANONICAL_CLINIC_IDS.primary,
      () => dbAdmin('clinics')
        .where({ id: CANONICAL_CLINIC_IDS.primary })
        .first('name'),
    );
    expect(typeof clinic?.name).toBe('string');

    const saveRes = await agent
      .put(`/api/v1/power-settings/branding/${CANONICAL_CLINIC_IDS.primary}`)
      .send({
        sidebarTitle: '   ',
        sidebarSubtitle: '   ',
        logoUrl: '',
      });

    expect(saveRes.status).toBe(200);

    const meRes = await agent.get('/api/v1/power-settings/branding/me');
    expect(meRes.status).toBe(200);
    expect(meRes.body?.branding?.clinicId).toBe(CANONICAL_CLINIC_IDS.primary);
    expect(meRes.body?.branding?.sidebarTitle).toBe(clinic?.name);
    expect(meRes.body?.branding?.sidebarSubtitle).toBe('Mental Health EMR');
    expect(meRes.body?.branding?.logoUrl).toBe('');
  });
});
