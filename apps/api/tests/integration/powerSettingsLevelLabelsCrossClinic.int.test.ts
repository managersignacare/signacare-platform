import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SuperAgentTest } from 'supertest'
import { authedAgent, isIntegrationReady, loginAsAdmin } from './_helpers'
import { CANONICAL_CLINIC_IDS } from '../fixtures/canonical-personas'
import { dbAdmin } from '../../src/db/db'
import { withTenantContext } from '../../src/shared/tenantContext'

const ready = await isIntegrationReady()

interface LabelRow {
  id: string
  clinic_id: string
  level: number
  label: string
  created_at: Date
  updated_at: Date
}

describe.skipIf(!ready)('power settings level labels cross-clinic', () => {
  let agent: SuperAgentTest
  let originalRows: LabelRow[] = []

  beforeAll(async () => {
    const session = await loginAsAdmin()
    agent = authedAgent(session.token)
    const primaryRows = await withTenantContext(
      CANONICAL_CLINIC_IDS.primary,
      () => dbAdmin<LabelRow>('org_level_labels').where({ clinic_id: CANONICAL_CLINIC_IDS.primary }),
    )
    const secondaryRows = await withTenantContext(
      CANONICAL_CLINIC_IDS.secondary,
      () => dbAdmin<LabelRow>('org_level_labels').where({ clinic_id: CANONICAL_CLINIC_IDS.secondary }),
    )
    originalRows = [...primaryRows, ...secondaryRows]
  })

  afterAll(async () => {
    await withTenantContext(
      CANONICAL_CLINIC_IDS.primary,
      () => dbAdmin('org_level_labels').where({ clinic_id: CANONICAL_CLINIC_IDS.primary }).del(),
    )
    await withTenantContext(
      CANONICAL_CLINIC_IDS.secondary,
      () => dbAdmin('org_level_labels').where({ clinic_id: CANONICAL_CLINIC_IDS.secondary }).del(),
    )

    const primaryRestore = originalRows.filter((row) => row.clinic_id === CANONICAL_CLINIC_IDS.primary)
    const secondaryRestore = originalRows.filter((row) => row.clinic_id === CANONICAL_CLINIC_IDS.secondary)
    if (primaryRestore.length > 0) {
      await withTenantContext(
        CANONICAL_CLINIC_IDS.primary,
        () => dbAdmin('org_level_labels').insert(primaryRestore),
      )
    }
    if (secondaryRestore.length > 0) {
      await withTenantContext(
        CANONICAL_CLINIC_IDS.secondary,
        () => dbAdmin('org_level_labels').insert(secondaryRestore),
      )
    }
  })

  it('stores and reads clinic-specific level labels without cross-tenant bleed', async () => {
    const stamp = Date.now()
    const primaryPayload = [
      { level: 1, label: `Primary Org ${stamp}` },
      { level: 2, label: `Primary Team ${stamp}` },
    ]
    const secondaryPayload = [
      { level: 1, label: `Secondary Org ${stamp}` },
      { level: 2, label: `Secondary Team ${stamp}` },
    ]

    const writePrimary = await agent
      .put(`/api/v1/power-settings/level-labels/${CANONICAL_CLINIC_IDS.primary}`)
      .send({ labels: primaryPayload })
    expect(writePrimary.status).toBe(200)
    expect(Array.isArray(writePrimary.body?.labels)).toBe(true)

    const writeSecondary = await agent
      .put(`/api/v1/power-settings/clinics/${CANONICAL_CLINIC_IDS.secondary}/level-labels`)
      .send({ labels: secondaryPayload })
    expect(writeSecondary.status).toBe(200)
    expect(Array.isArray(writeSecondary.body?.labels)).toBe(true)

    const readPrimary = await agent
      .get(`/api/v1/power-settings/level-labels/${CANONICAL_CLINIC_IDS.primary}`)
    expect(readPrimary.status).toBe(200)
    const primaryByLevel = new Map<number, string>(
      (readPrimary.body?.labels ?? []).map((row: { level: number; label: string }) => [row.level, row.label]),
    )
    expect(primaryByLevel.get(1)).toBe(primaryPayload[0]?.label)
    expect(primaryByLevel.get(2)).toBe(primaryPayload[1]?.label)
    expect(primaryByLevel.get(1)).not.toBe(secondaryPayload[0]?.label)

    const readSecondary = await agent
      .get(`/api/v1/power-settings/clinics/${CANONICAL_CLINIC_IDS.secondary}/level-labels`)
    expect(readSecondary.status).toBe(200)
    const secondaryByLevel = new Map<number, string>(
      (readSecondary.body?.labels ?? []).map((row: { level: number; label: string }) => [row.level, row.label]),
    )
    expect(secondaryByLevel.get(1)).toBe(secondaryPayload[0]?.label)
    expect(secondaryByLevel.get(2)).toBe(secondaryPayload[1]?.label)
    expect(secondaryByLevel.get(1)).not.toBe(primaryPayload[0]?.label)
  })

  it('supports same-clinic save/read via /power-settings/level-labels', async () => {
    const stamp = Date.now()
    const payload = [
      { level: 1, label: `Self Org ${stamp}` },
      { level: 2, label: `Self Team ${stamp}` },
    ]

    const write = await agent
      .put('/api/v1/power-settings/level-labels')
      .send({ labels: payload })
    expect(write.status).toBe(200)
    expect(Array.isArray(write.body?.labels)).toBe(true)

    const read = await agent
      .get('/api/v1/power-settings/level-labels')
    expect(read.status).toBe(200)

    const byLevel = new Map<number, string>(
      (read.body?.labels ?? []).map((row: { level: number; label: string }) => [row.level, row.label]),
    )
    expect(byLevel.get(1)).toBe(payload[0]?.label)
    expect(byLevel.get(2)).toBe(payload[1]?.label)
  })
})
