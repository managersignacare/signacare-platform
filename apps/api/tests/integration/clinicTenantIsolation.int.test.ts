import { describe, expect, it, beforeAll } from 'vitest'
import request from 'supertest'
import type { SuperAgentTest } from 'supertest'
import app from '../../src/server'
import { authedAgent, isIntegrationReady, loginAsAdmin } from './_helpers'
import { CANONICAL_CLINIC_IDS, CANONICAL_PASSWORD, CANONICAL_PERSONAS } from '../fixtures/canonical-personas'

const ready = await isIntegrationReady()

describe.skipIf(!ready)('clinic tenant isolation', () => {
  let superadminAgent: SuperAgentTest
  let clinicAdminAgent: SuperAgentTest

  beforeAll(async () => {
    const superadminSession = await loginAsAdmin()
    superadminAgent = authedAgent(superadminSession.token)

    const clinicAdminLogin = await request(app)
      .post('/api/v1/auth/login')
      .set('X-CSRF-Token', 'test')
      .set('X-Client', 'mobile')
      .send({
        email: CANONICAL_PERSONAS.admin.email,
        password: CANONICAL_PASSWORD,
      })

    expect(clinicAdminLogin.status).toBe(200)
    expect(typeof clinicAdminLogin.body?.accessToken).toBe('string')
    clinicAdminAgent = authedAgent(clinicAdminLogin.body.accessToken as string)
  })

  it('scopes clinic lookup/list/get/update to own clinic for non-superadmin users', async () => {
    const lookupRes = await clinicAdminAgent.get('/api/v1/clinics/lookup')
    expect(lookupRes.status).toBe(200)
    const lookupRows = Array.isArray(lookupRes.body) ? lookupRes.body : []
    expect(lookupRows.length).toBe(1)
    expect(lookupRows[0]?.id).toBe(CANONICAL_CLINIC_IDS.primary)

    const listRes = await clinicAdminAgent.get('/api/v1/clinics')
    expect(listRes.status).toBe(200)
    const listRows = Array.isArray(listRes.body) ? listRes.body : []
    expect(listRows.length).toBe(1)
    expect(listRows[0]?.id).toBe(CANONICAL_CLINIC_IDS.primary)

    const ownClinicRes = await clinicAdminAgent.get(`/api/v1/clinics/${CANONICAL_CLINIC_IDS.primary}`)
    expect(ownClinicRes.status).toBe(200)
    expect(ownClinicRes.body?.id).toBe(CANONICAL_CLINIC_IDS.primary)

    const foreignClinicRes = await clinicAdminAgent.get(`/api/v1/clinics/${CANONICAL_CLINIC_IDS.secondary}`)
    expect(foreignClinicRes.status).toBe(404)

    const foreignUpdateRes = await clinicAdminAgent
      .put(`/api/v1/clinics/${CANONICAL_CLINIC_IDS.secondary}`)
      .send({ name: 'Should Not Update' })
    expect(foreignUpdateRes.status).toBe(404)
  })

  it('keeps superadmin cross-clinic visibility for power-settings workflows', async () => {
    const lookupRes = await superadminAgent.get('/api/v1/clinics/lookup')
    expect(lookupRes.status).toBe(200)
    const ids = new Set(
      (Array.isArray(lookupRes.body) ? lookupRes.body : []).map((row: { id: string }) => row.id),
    )
    expect(ids.has(CANONICAL_CLINIC_IDS.primary)).toBe(true)
    expect(ids.has(CANONICAL_CLINIC_IDS.secondary)).toBe(true)
  })
})
