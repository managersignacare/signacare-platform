import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import { authedAgent, isIntegrationReady, loginAsAdmin } from './_helpers';
import { withTenantContext } from '../../src/shared/tenantContext';

const READY = await isIntegrationReady();

describe.skipIf(!READY)('staff module access persistence', () => {
  let clinicId: string;
  let staffId: string;
  let agent: ReturnType<typeof authedAgent>;

  beforeAll(async () => {
    const session = await loginAsAdmin();
    clinicId = session.clinicId;
    agent = authedAgent(session.token);
    staffId = randomUUID();

    const { dbAdmin } = await import('../../src/db/db');
    await withTenantContext(clinicId, () =>
      dbAdmin('staff').insert({
        id: staffId,
        clinic_id: clinicId,
        email: `module-access-${staffId.slice(0, 8)}@signacare.local`,
        password_hash: 'stub',
        given_name: 'Access',
        family_name: 'Persistence',
        role: 'clinician',
        is_active: true,
      }),
    );
  });

  afterAll(async () => {
    const { dbAdmin } = await import('../../src/db/db');
    if (clinicId && staffId) {
      await withTenantContext(clinicId, async () => {
        await dbAdmin('staff_module_access').where({ clinic_id: clinicId, staff_id: staffId }).delete();
        await dbAdmin('staff').where({ id: staffId }).delete();
      });
    }
  });

  it('persists individual clinician access changes and preserves existing grants', async () => {
    const first = await agent
      .put(`/api/v1/staff-settings/module-access/${staffId}`)
      .send({
        modules: [
          { module: 'clinical_notes', accessLevel: 'write' },
        ],
      });

    expect(first.status).toBe(200);

    const second = await agent
      .put(`/api/v1/staff-settings/module-access/${staffId}`)
      .send({
        modules: [
          { module: 'pathology', accessLevel: 'read' },
        ],
      });

    expect(second.status).toBe(200);

    const current = await agent.get(`/api/v1/staff-settings/module-access/${staffId}`);
    expect(current.status).toBe(200);

    const access = Array.isArray(current.body?.access) ? current.body.access : [];
    expect(access).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          module: 'clinical_notes',
          accessLevel: 'write',
        }),
        expect.objectContaining({
          module: 'pathology',
          accessLevel: 'read',
        }),
      ]),
    );
  });
});
