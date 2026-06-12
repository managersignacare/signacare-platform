import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  authedAgent,
  isIntegrationReady,
  loginAsAdmin,
} from './_helpers';
import { dbAdmin } from '../../src/db/db';

const READY = await isIntegrationReady();
const RUN_TAG = `taskMonitoring_${Date.now().toString(36)}`;

describe.skipIf(!READY)('Task monitoring summary', () => {
  let token = '';
  let clinicId = '';
  let actorStaffId = '';
  let assigneeAId = '';
  let assigneeBId = '';
  const createdTaskIds: string[] = [];

  beforeAll(async () => {
    const admin = await loginAsAdmin();
    token = admin.token;
    clinicId = admin.clinicId;
    actorStaffId = admin.userId;

    const clinicians = await dbAdmin('staff')
      .where({ clinic_id: clinicId, role: 'clinician' })
      .whereNull('deleted_at')
      .select('id')
      .limit(2);
    if (clinicians.length < 2) {
      throw new Error('Need at least two clinicians in the seeded clinic for task monitoring test');
    }
    assigneeAId = String(clinicians[0]!.id);
    assigneeBId = String(clinicians[1]!.id);

    const today = new Date().toISOString().slice(0, 10);
    const overdue = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const nextWeek = new Date(Date.now() + (3 * 86_400_000)).toISOString().slice(0, 10);
    const now = new Date().toISOString();

    const rows = [
      {
        id: randomUUID(),
        clinic_id: clinicId,
        assigned_by_id: actorStaffId,
        assigned_to_id: assigneeAId,
        title: `${RUN_TAG} overdue pending`,
        description: RUN_TAG,
        priority: 'urgent',
        status: 'pending',
        due_date: overdue,
        created_at: now,
        updated_at: now,
      },
      {
        id: randomUUID(),
        clinic_id: clinicId,
        assigned_by_id: actorStaffId,
        assigned_to_id: assigneeAId,
        title: `${RUN_TAG} due today waiting`,
        description: RUN_TAG,
        priority: 'high',
        status: 'waiting_external',
        due_date: today,
        created_at: now,
        updated_at: now,
      },
      {
        id: randomUUID(),
        clinic_id: clinicId,
        assigned_by_id: actorStaffId,
        assigned_to_id: assigneeBId,
        title: `${RUN_TAG} blocked next week`,
        description: RUN_TAG,
        priority: 'medium',
        status: 'blocked',
        due_date: nextWeek,
        created_at: now,
        updated_at: now,
      },
      {
        id: randomUUID(),
        clinic_id: clinicId,
        assigned_by_id: actorStaffId,
        assigned_to_id: null,
        title: `${RUN_TAG} unassigned review`,
        description: RUN_TAG,
        priority: 'medium',
        status: 'review_pending',
        due_date: null,
        created_at: now,
        updated_at: now,
      },
      {
        id: randomUUID(),
        clinic_id: clinicId,
        assigned_by_id: actorStaffId,
        assigned_to_id: assigneeBId,
        title: `${RUN_TAG} completed`,
        description: RUN_TAG,
        priority: 'low',
        status: 'completed',
        due_date: today,
        completed_at: now,
        completed_by_id: actorStaffId,
        created_at: now,
        updated_at: now,
      },
    ];

    createdTaskIds.push(...rows.map((row) => String(row.id)));
    await dbAdmin('tasks').insert(rows);
  });

  afterAll(async () => {
    if (createdTaskIds.length > 0) {
      await dbAdmin('tasks')
        .where({ clinic_id: clinicId })
        .whereIn('id', createdTaskIds)
        .delete()
        .catch(() => undefined);
    }
  });

  it('treats open as all actionable statuses and returns monitoring totals', async () => {
    const agent = authedAgent(token);

    const openRes = await agent.get('/api/v1/tasks').query({ status: 'open' });
    expect(openRes.status).toBe(200);
    const openRows = Array.isArray(openRes.body) ? openRes.body : (openRes.body?.data ?? []);
    const taggedRows = openRows.filter((row: { description?: string | null }) => row.description === RUN_TAG);
    expect(taggedRows).toHaveLength(4);

    const summaryRes = await agent.get('/api/v1/tasks/summary');
    expect(summaryRes.status).toBe(200);

    const summary = summaryRes.body;
    expect(summary.totals.open).toBeGreaterThanOrEqual(4);
    expect(summary.totals.overdue).toBeGreaterThanOrEqual(1);
    expect(summary.totals.dueToday).toBeGreaterThanOrEqual(1);
    expect(summary.totals.waitingExternal).toBeGreaterThanOrEqual(1);
    expect(summary.totals.blocked).toBeGreaterThanOrEqual(1);
    expect(summary.totals.reviewPending).toBeGreaterThanOrEqual(1);
    expect(summary.totals.unassigned).toBeGreaterThanOrEqual(1);
    expect(summary.totals.urgent).toBeGreaterThanOrEqual(1);

    const assignees = summary.assigneeBreakdown.map((row: { displayName: string }) => row.displayName);
    expect(assignees).toContain('Unassigned');
  });
});
