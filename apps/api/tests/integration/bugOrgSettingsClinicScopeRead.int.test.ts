import { randomUUID } from 'crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import app from '../../src/server'
import { dbAdmin } from '../../src/db/db'
import { withTenantContext } from '../../src/shared/tenantContext'
import {
  authedAgent,
  isIntegrationReady,
  loginAsAdmin,
} from './_helpers'
import {
  CANONICAL_CLINIC_IDS,
  CANONICAL_PASSWORD,
  CANONICAL_PERSONAS,
} from '../fixtures/canonical-personas'

const READY = await isIntegrationReady()

interface OrgTreeNode {
  id: string
  children?: OrgTreeNode[]
}

function flattenIds(nodes: OrgTreeNode[]): Set<string> {
  const ids = new Set<string>()
  const stack = [...nodes]
  while (stack.length > 0) {
    const node = stack.pop()
    if (!node) continue
    ids.add(node.id)
    if (Array.isArray(node.children)) {
      for (const child of node.children) stack.push(child)
    }
  }
  return ids
}

describe.skipIf(!READY)('BUG-ORG-SETTINGS-CLINIC-SCOPE-READ', () => {
  let superadminToken = ''
  let clinicianToken = ''
  let secondaryUnitId = ''

  beforeAll(async () => {
    const admin = await loginAsAdmin()
    superadminToken = admin.token

    const clinicianLogin = await request(app)
      .post('/api/v1/auth/login')
      .set('X-CSRF-Token', 'test')
      .set('X-Client', 'mobile')
      .send({
        email: CANONICAL_PERSONAS.clinician.email,
        password: CANONICAL_PASSWORD,
      })
    expect(clinicianLogin.status).toBe(200)
    clinicianToken = clinicianLogin.body.accessToken as string

    const [row] = await withTenantContext(CANONICAL_CLINIC_IDS.secondary, async () =>
      dbAdmin('org_units')
        .insert({
          id: randomUUID(),
          clinic_id: CANONICAL_CLINIC_IDS.secondary,
          parent_id: null,
          name: `Scope Secondary ${Date.now()}`,
          level: '1',
          sort_order: 0,
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .returning(['id']),
    )
    secondaryUnitId = row?.id as string
  })

  afterAll(async () => {
    if (secondaryUnitId) {
      await withTenantContext(
        CANONICAL_CLINIC_IDS.secondary,
        () => dbAdmin('org_units').where({ id: secondaryUnitId }).delete(),
      ).catch(() => undefined)
    }
  })

  it('allows superadmin to read a selected clinic org tree via clinicId query', async () => {
    const res = await authedAgent(superadminToken)
      .get('/api/v1/org-settings/units/tree')
      .query({ clinicId: CANONICAL_CLINIC_IDS.secondary })

    expect(res.status).toBe(200)
    const ids = flattenIds((res.body?.tree ?? []) as OrgTreeNode[])
    expect(ids.has(secondaryUnitId)).toBe(true)
  })

  it('rejects non-superadmin cross-clinic org tree reads', async () => {
    const res = await authedAgent(clinicianToken)
      .get('/api/v1/org-settings/units/tree')
      .query({ clinicId: CANONICAL_CLINIC_IDS.secondary })

    expect(res.status).toBe(403)
  })
})
