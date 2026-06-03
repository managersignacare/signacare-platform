/**
 * BUG-262-UC — UNIQUE (clinic_id, order_number) on pathology_orders.
 *
 * Verifies the DB-level invariant that `findOrderByNumberAdmin` relies
 * on. Without this constraint, a collision would be technically
 * possible (astronomically improbable given UUID-suffix
 * `generateOrderNumber()`, but not enforced). Post-migration, a
 * second INSERT with the same (clinic_id, order_number) MUST fail
 * with the unique-violation SQLSTATE (23505).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { isIntegrationReady, loginAsAdmin } from './_helpers';
import { dbAdmin } from '../../src/db/db';

const READY = await isIntegrationReady();

let clinicId = '';
let staffId = '';
let patientId = '';

beforeAll(async () => {
  if (!READY) return;
  const session = await loginAsAdmin();
  clinicId = session.clinicId;
  staffId = session.userId;
  const patient = await dbAdmin('patients').where({ clinic_id: clinicId }).whereNull('deleted_at').first('id');
  if (!patient) throw new Error('No seeded patient for BUG-262-UC test');
  patientId = patient.id as string;
});

afterAll(async () => {
  if (!READY) return;
  await dbAdmin('pathology_orders')
    .where({ clinic_id: clinicId, panel_name: 'BUG-262-UC-TEST' })
    .del();
});

async function insertOrder(orderNumber: string): Promise<string> {
  const id = randomUUID();
  await dbAdmin('pathology_orders').insert({
    id, clinic_id: clinicId, patient_id: patientId,
    ordered_by_id: staffId, order_number: orderNumber,
    panel_name: 'BUG-262-UC-TEST', tests: ['CBC'], urgency: 'routine',
    fasting: false, copy_to_gp: false, status: 'sent',
  });
  return id;
}

describe.skipIf(!READY)('BUG-262-UC — pathology_orders(clinic_id, order_number) UNIQUE', () => {
  it('rejects a second INSERT with the same (clinic_id, order_number) with SQLSTATE 23505', async () => {
    const orderNumber = `BUG-262-UC-${Date.now()}`;
    await insertOrder(orderNumber);

    await expect(
      insertOrder(orderNumber),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('UNIQUE is composite on (clinic_id, order_number) — scope verified via INFORMATION_SCHEMA', async () => {
    // Instead of seeding a second clinic (which requires cross-tenant
    // seed fixtures out of scope for this test), verify the index
    // shape directly from the catalog. The constraint must cover
    // BOTH columns, not just order_number alone, else cross-clinic
    // collisions would be blocked (wrong behaviour).
    const idx = await dbAdmin.raw(`
      SELECT indexdef
      FROM pg_indexes
      WHERE tablename = 'pathology_orders'
        AND indexname = 'pathology_orders_clinic_order_number_unique'
    `);
    expect(idx.rows).toHaveLength(1);
    const def = idx.rows[0].indexdef as string;
    expect(def).toMatch(/UNIQUE/);
    expect(def).toMatch(/clinic_id/);
    expect(def).toMatch(/order_number/);
  });
});
