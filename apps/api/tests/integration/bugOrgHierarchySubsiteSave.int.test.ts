import { randomUUID } from 'crypto'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { dbAdmin } from '../../src/db/db'
import { authedAgent, isIntegrationReady, loginAsAdmin } from './_helpers'

const READY = await isIntegrationReady()

describe.skipIf(!READY)('BUG-ORG-HIERARCHY-SUBSITE-SAVE', () => {
  let token = ''
  const createdRootIds: string[] = []

  beforeAll(async () => {
    ({ token } = await loginAsAdmin())
  })

  afterEach(async () => {
    while (createdRootIds.length > 0) {
      const rootId = createdRootIds.pop()
      if (!rootId) break
      await dbAdmin('org_units').where({ id: rootId }).delete().catch(() => undefined)
    }
  })

  it('creates a child unit when the client sends a legacy string level payload', async () => {
    const rootRes = await authedAgent(token)
      .post('/api/v1/org-settings/units')
      .send({
        name: `Org Root ${randomUUID().slice(0, 8)}`,
        level: 1,
      })

    expect(rootRes.status).toBe(201)
    const rootId = rootRes.body?.unit?.id as string
    expect(typeof rootId).toBe('string')
    createdRootIds.push(rootId)

    const childRes = await authedAgent(token)
      .post('/api/v1/org-settings/units')
      .send({
        parentId: rootId,
        name: `Org Child ${randomUUID().slice(0, 8)}`,
        level: '11',
      })

    expect(childRes.status).toBe(201)
    expect(childRes.body?.unit?.parentId).toBe(rootId)
    expect(String(childRes.body?.unit?.level)).toBe('2')
  })
})
