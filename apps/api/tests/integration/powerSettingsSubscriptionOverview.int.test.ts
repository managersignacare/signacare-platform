import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { randomUUID } from 'node:crypto'
import app from '../../src/server'
import { dbAdmin } from '../../src/db/db'
import { withTenantContext } from '../../src/shared/tenantContext'
import { authedAgent, isIntegrationReady, loginAsAdmin } from './_helpers'
import { CANONICAL_CLINIC_IDS, CANONICAL_PASSWORD, CANONICAL_PERSONAS } from '../fixtures/canonical-personas'

const READY = await isIntegrationReady()

describe.skipIf(!READY)('power settings subscription overview (superadmin)', () => {
  let superadminToken = ''
  let adminToken = ''
  const insertedPrimaryId = randomUUID()
  const insertedSecondaryId = randomUUID()

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
    expect(typeof adminToken).toBe('string')

    const createdAt = new Date('2099-01-01T00:00:00.000Z')
    const updatedAt = new Date('2099-01-02T00:00:00.000Z')

    await withTenantContext(CANONICAL_CLINIC_IDS.primary, () =>
      dbAdmin('subscriptions').insert({
        id: insertedPrimaryId,
        clinic_id: CANONICAL_CLINIC_IDS.primary,
        plan_type: 'annual',
        seats: 42,
        price_per_month: 199,
        price_per_year: 1990,
        discount_percent: 10,
        discount_amount: null,
        status: 'active',
        start_date: '2026-01-01',
        end_date: '2026-12-31',
        renewal_date: '2026-12-01',
        reminder_days: 30,
        notes: 'Primary clinic annual enterprise plan',
        created_at: createdAt,
        updated_at: updatedAt,
      }),
    )

    await withTenantContext(CANONICAL_CLINIC_IDS.secondary, () =>
      dbAdmin('subscriptions').insert({
        id: insertedSecondaryId,
        clinic_id: CANONICAL_CLINIC_IDS.secondary,
        plan_type: 'trial',
        seats: 8,
        price_per_month: 0,
        price_per_year: null,
        discount_percent: null,
        discount_amount: null,
        status: 'trial',
        start_date: '2026-03-01',
        end_date: '2026-03-31',
        renewal_date: '2026-03-24',
        reminder_days: 7,
        notes: 'Secondary clinic trial',
        created_at: createdAt,
        updated_at: updatedAt,
      }),
    )
  })

  afterAll(async () => {
    await withTenantContext(
      CANONICAL_CLINIC_IDS.primary,
      () => dbAdmin('subscriptions').where({ id: insertedPrimaryId }).delete(),
    )
    await withTenantContext(
      CANONICAL_CLINIC_IDS.secondary,
      () => dbAdmin('subscriptions').where({ id: insertedSecondaryId }).delete(),
    )
  })

  it('returns all onboarded clinics with latest subscription details for superadmin', async () => {
    const res = await authedAgent(superadminToken).get('/api/v1/power-settings/subscriptions/overview')

    expect(res.status).toBe(200)
    const rows = Array.isArray(res.body?.subscriptions) ? res.body.subscriptions : []
    expect(rows.length).toBeGreaterThanOrEqual(2)

    const primary = rows.find((row: { clinicId: string }) => row.clinicId === CANONICAL_CLINIC_IDS.primary)
    const secondary = rows.find((row: { clinicId: string }) => row.clinicId === CANONICAL_CLINIC_IDS.secondary)

    expect(primary?.clinicName).toBeTruthy()
    expect(primary?.subscription?.id).toBe(insertedPrimaryId)
    expect(primary?.subscription?.planType).toBe('annual')
    expect(primary?.subscription?.seats).toBe(42)
    expect(primary?.subscription?.status).toBe('active')

    expect(secondary?.clinicName).toBeTruthy()
    expect(secondary?.subscription?.id).toBe(insertedSecondaryId)
    expect(secondary?.subscription?.planType).toBe('trial')
    expect(secondary?.subscription?.seats).toBe(8)
    expect(secondary?.subscription?.status).toBe('trial')
  })

  it('denies non-superadmin access', async () => {
    const res = await authedAgent(adminToken).get('/api/v1/power-settings/subscriptions/overview')
    expect(res.status).toBe(403)
  })
})
