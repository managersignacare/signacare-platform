import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import app from '../../src/server'
import { dbAdmin } from '../../src/db/db'
import { withTenantContext } from '../../src/shared/tenantContext'
import { authedAgent, isIntegrationReady, loginAsAdmin } from './_helpers'
import { CANONICAL_CLINIC_IDS, CANONICAL_PASSWORD, CANONICAL_PERSONAS } from '../fixtures/canonical-personas'

const READY = await isIntegrationReady()
const MODULE_KEY = 'pathways'

describe.skipIf(!READY)('power settings subscription module toggle', () => {
  let superadminToken = ''
  let adminToken = ''
  let originalSecondaryRow: { id: string; is_enabled: boolean } | null = null

  beforeAll(async () => {
    const superadmin = await loginAsAdmin()
    superadminToken = superadmin.token

    const adminLogin = await request(app)
      .post('/api/v1/auth/login')
      .set('X-CSRF-Token', 'test')
      .set('X-Client', 'mobile')
      .send({
        email: CANONICAL_PERSONAS.admin.email,
        password: CANONICAL_PASSWORD,
      })
    expect(adminLogin.status).toBe(200)
    adminToken = adminLogin.body.accessToken as string

    originalSecondaryRow = await withTenantContext(
      CANONICAL_CLINIC_IDS.secondary,
      () => dbAdmin('clinic_modules')
        .where({ clinic_id: CANONICAL_CLINIC_IDS.secondary, module_key: MODULE_KEY })
        .first('id', 'is_enabled'),
    )
  })

  afterAll(async () => {
    await withTenantContext(CANONICAL_CLINIC_IDS.secondary, async () => {
      if (!originalSecondaryRow) {
        await dbAdmin('clinic_modules')
          .where({ clinic_id: CANONICAL_CLINIC_IDS.secondary, module_key: MODULE_KEY })
          .delete()
        return
      }

      await dbAdmin('clinic_modules')
        .where({ id: originalSecondaryRow.id })
        .update({
          is_enabled: originalSecondaryRow.is_enabled,
          updated_at: new Date(),
        })
    })
  })

  it('allows superadmin to toggle modules for a different clinic', async () => {
    const disableRes = await authedAgent(superadminToken)
      .put(`/api/v1/power-settings/subscriptions/${CANONICAL_CLINIC_IDS.secondary}/modules/${MODULE_KEY}`)
      .send({ enabled: false })
    expect(disableRes.status).toBe(200)

    const readDisabledRes = await authedAgent(superadminToken)
      .get(`/api/v1/power-settings/subscriptions/${CANONICAL_CLINIC_IDS.secondary}/modules`)
    expect(readDisabledRes.status).toBe(200)
    expect(readDisabledRes.body?.modules?.[MODULE_KEY]).toBe(false)

    const enableRes = await authedAgent(superadminToken)
      .put(`/api/v1/power-settings/subscriptions/${CANONICAL_CLINIC_IDS.secondary}/modules/${MODULE_KEY}`)
      .send({ enabled: true })
    expect(enableRes.status).toBe(200)

    const readEnabledRes = await authedAgent(superadminToken)
      .get(`/api/v1/power-settings/subscriptions/${CANONICAL_CLINIC_IDS.secondary}/modules`)
    expect(readEnabledRes.status).toBe(200)
    expect(readEnabledRes.body?.modules?.[MODULE_KEY]).toBe(true)
  })

  it('blocks non-superadmin access to cross-clinic module toggles', async () => {
    const readRes = await authedAgent(adminToken)
      .get(`/api/v1/power-settings/subscriptions/${CANONICAL_CLINIC_IDS.secondary}/modules`)
    expect(readRes.status).toBe(403)

    const writeRes = await authedAgent(adminToken)
      .put(`/api/v1/power-settings/subscriptions/${CANONICAL_CLINIC_IDS.secondary}/modules/${MODULE_KEY}`)
      .send({ enabled: false })
    expect(writeRes.status).toBe(403)
  })
})

