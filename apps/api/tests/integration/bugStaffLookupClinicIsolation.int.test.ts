import { beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import app from '../../src/server'
import {
  authedAgent,
  isIntegrationReady,
  loginAsAdmin,
  TEST_ADMIN_EMAIL,
} from './_helpers'
import { CANONICAL_PASSWORD, CANONICAL_PERSONAS } from '../fixtures/canonical-personas'

const ready = await isIntegrationReady()

interface StaffLookupRow {
  id: string
  givenName: string
  familyName: string
  email: string
  role: string
  discipline: string | null
}

describe.skipIf(!ready)('BUG-STAFF-LOOKUP-CLINIC-ISOLATION', () => {
  let primaryToken = ''
  let secondaryToken = ''

  beforeAll(async () => {
    const primary = await loginAsAdmin()
    primaryToken = primary.token

    const secondaryLogin = await request(app)
      .post('/api/v1/auth/login')
      .set('X-CSRF-Token', 'test')
      .set('X-Client', 'mobile')
      .send({
        email: CANONICAL_PERSONAS.otherClinicClinician.email,
        password: CANONICAL_PASSWORD,
      })

    expect(secondaryLogin.status).toBe(200)
    expect(typeof secondaryLogin.body?.accessToken).toBe('string')
    secondaryToken = secondaryLogin.body.accessToken
  })

  it('keeps /staff/lookup tenant-scoped even when two clinics hit the endpoint back-to-back', async () => {
    const primaryAgent = authedAgent(primaryToken)
    const secondaryAgent = authedAgent(secondaryToken)

    const primaryLookup = await primaryAgent.get('/api/v1/staff/lookup')
    expect(primaryLookup.status).toBe(200)
    const primaryRows = primaryLookup.body as StaffLookupRow[]
    const primaryEmails = new Set(primaryRows.map((row) => row.email.toLowerCase()))
    expect(primaryEmails.has(TEST_ADMIN_EMAIL.toLowerCase())).toBe(true)
    expect(primaryEmails.has(CANONICAL_PERSONAS.otherClinicClinician.email.toLowerCase())).toBe(false)

    const secondaryLookup = await secondaryAgent.get('/api/v1/staff/lookup')
    expect(secondaryLookup.status).toBe(200)
    const secondaryRows = secondaryLookup.body as StaffLookupRow[]
    const secondaryEmails = new Set(secondaryRows.map((row) => row.email.toLowerCase()))
    expect(secondaryEmails.has(CANONICAL_PERSONAS.otherClinicClinician.email.toLowerCase())).toBe(true)
    expect(secondaryEmails.has(TEST_ADMIN_EMAIL.toLowerCase())).toBe(false)

    const primaryLookupAgain = await primaryAgent.get('/api/v1/staff/lookup')
    expect(primaryLookupAgain.status).toBe(200)
    expect(primaryLookupAgain.body).toEqual(primaryLookup.body)
  })
})

