import { describe, it, expect, vi, beforeEach } from 'vitest';

// Unit test for the Phase 0.7 audit H1 fix:
// `billingRepository.createPayment` must serialise concurrent
// payments against the same invoice so one payment's money
// can't be silently overwritten by another.
//
// The fix has three moving parts — this test pins all three:
//
//   1. SELECT on invoices uses `.forUpdate()` so concurrent
//      transactions serialise on the row lock.
//   2. UPDATE sets `paid_cents = trx.raw('?? + ?', ...)` so the
//      increment is an atomic SQL expression, not a JS read-modify-
//      write. (Belt-and-braces — if a future refactor drops the
//      row lock, the raw expression still eliminates the race.)
//   3. UPDATE carries `clinic_id` in its WHERE clause (CLAUDE.md
//      §1.3 — every tenant-table mutation must filter by clinic_id,
//      the pre-fix UPDATE was only keyed on `id`).
//
// Phase 0.7.5 c24 D7a (SD42) — the fixture + assertions were updated
// from paid_amount/total_amount to paid_cents/total_cents. The earlier
// version was testing the broken code; because the column names didn't
// actually exist in the DB, every live invoice status derivation was
// producing NaN/'unpaid' regardless of the payment applied. The
// corrected assertions pin the real column names against the
// real payment arithmetic.
//
// This is a unit test, not an integration test — we mock knex's
// query-builder chain and assert shape, not round-trip. The
// integration story (two live concurrent calls, check only one
// write wins) runs in the live `test:integration` suite.

import { db } from '../src/db/db';
import { createPayment } from '../src/features/billing/billingRepository';
import { AppError } from '../src/shared/errors';

interface Builder {
  insert: ReturnType<typeof vi.fn>;
  returning: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  forUpdate: ReturnType<typeof vi.fn>;
  first: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
}

let tableCalls: string[];
let recordedUpdatePayload: Record<string, unknown> | undefined;
let recordedUpdateWhere: Record<string, unknown> | undefined;
let invoiceForUpdateCount: number;
let invoiceToReturn: Record<string, unknown> | undefined;

function makeBuilder(tableName: string): Builder {
  tableCalls.push(tableName);
  // Deferred self-reference — method bodies close over `b` so every
  // builder call returns the same chainable. Building in two steps
  // (allocate, then assign) avoids a TDZ ReferenceError.
  const b = {} as Builder;
  b.insert = vi.fn().mockReturnValue(b);
  // Phase 0.7.5 c24 D7a (SD40) — column is `amount_cents`, not `amount`.
  b.returning = vi
    .fn()
    .mockResolvedValue([{ id: 'PAYMENT-UUID', amount_cents: 50 }]);
  b.where = vi.fn().mockImplementation((where: Record<string, unknown>) => {
    if (tableName === 'invoices' && where && 'id' in where) {
      recordedUpdateWhere = where;
    }
    return b;
  });
  b.forUpdate = vi.fn().mockImplementation(() => {
    if (tableName === 'invoices') invoiceForUpdateCount += 1;
    return b;
  });
  b.first = vi.fn().mockImplementation(async () => invoiceToReturn);
  b.update = vi.fn().mockImplementation((payload: Record<string, unknown>) => {
    if (tableName === 'invoices') {
      recordedUpdatePayload = payload;
    }
    return Promise.resolve(1);
  });
  return b;
}

beforeEach(() => {
  tableCalls = [];
  recordedUpdatePayload = undefined;
  recordedUpdateWhere = undefined;
  invoiceForUpdateCount = 0;
  invoiceToReturn = {
    id: 'INV-UUID',
    clinic_id: 'CLINIC-UUID',
    paid_cents: '40',
    total_cents: '100',
  };

  vi.spyOn(db, 'transaction').mockImplementation(
    (async (fn: unknown) => {
      const trxMock = ((name: string) => makeBuilder(name)) as unknown as {
        fn: { now: () => unknown };
        raw: (expr: string, bindings: unknown[]) => unknown;
      };
      trxMock.fn = { now: () => 'NOW()' };
      trxMock.raw = vi.fn().mockImplementation((expr: string, bindings: unknown[]) => ({
        __knexRaw: true,
        expr,
        bindings,
      })) as unknown as (expr: string, bindings: unknown[]) => unknown;
      return (fn as (t: unknown) => Promise<unknown>)(trxMock);
    }) as unknown as typeof db.transaction,
  );
});

describe('billingRepository.createPayment — race + clinic_id + 404 fix', () => {
  it('selects the invoice with forUpdate() so concurrent payments serialise on the lock', async () => {
    await createPayment('CLINIC-UUID', 'STAFF-UUID', {
      invoiceId: 'INV-UUID',
      amount: 50,
      paymentMethod: 'card',
      paymentDate: '2026-04-15',
    } as never);
    expect(invoiceForUpdateCount).toBe(1);
  });

  it('UPDATE uses an atomic SQL expression for paid_cents (not a JS-computed number)', async () => {
    await createPayment('CLINIC-UUID', 'STAFF-UUID', {
      invoiceId: 'INV-UUID',
      amount: 50,
      paymentMethod: 'card',
      paymentDate: '2026-04-15',
    } as never);
    expect(recordedUpdatePayload).toBeDefined();
    const paid = recordedUpdatePayload!.paid_cents as {
      __knexRaw?: boolean;
      expr?: string;
      bindings?: unknown[];
    };
    // Must be a knex.raw object, NOT a plain number — this is the
    // property that makes the increment atomic at the SQL level.
    expect(paid.__knexRaw).toBe(true);
    expect(paid.expr).toBe('?? + ?');
    expect(paid.bindings).toEqual(['paid_cents', 50]);
  });

  it('UPDATE WHERE clause includes clinic_id (§1.3)', async () => {
    await createPayment('CLINIC-UUID', 'STAFF-UUID', {
      invoiceId: 'INV-UUID',
      amount: 50,
      paymentMethod: 'card',
      paymentDate: '2026-04-15',
    } as never);
    expect(recordedUpdateWhere).toBeDefined();
    expect(recordedUpdateWhere!.clinic_id).toBe('CLINIC-UUID');
    expect(recordedUpdateWhere!.id).toBe('INV-UUID');
  });

  it('derived status is computed from locked paid_amount + dto.amount', async () => {
    invoiceToReturn = {
      id: 'INV-UUID',
      clinic_id: 'CLINIC-UUID',
      paid_cents: '50',
      total_cents: '100',
    };
    await createPayment('CLINIC-UUID', 'STAFF-UUID', {
      invoiceId: 'INV-UUID',
      amount: 50,
      paymentMethod: 'card',
      paymentDate: '2026-04-15',
    } as never);
    // 50 existing + 50 new = 100 total = 'paid'
    expect(recordedUpdatePayload!.status).toBe('paid');
  });

  it('partial payment derives status=partially_paid', async () => {
    invoiceToReturn = {
      id: 'INV-UUID',
      clinic_id: 'CLINIC-UUID',
      paid_cents: '0',
      total_cents: '100',
    };
    await createPayment('CLINIC-UUID', 'STAFF-UUID', {
      invoiceId: 'INV-UUID',
      amount: 30,
      paymentMethod: 'card',
      paymentDate: '2026-04-15',
    } as never);
    expect(recordedUpdatePayload!.status).toBe('partially_paid');
  });

  it('throws NOT_FOUND AppError when the invoice does not exist (§1.3 guard)', async () => {
    invoiceToReturn = undefined;
    await expect(
      createPayment('CLINIC-UUID', 'STAFF-UUID', {
        invoiceId: 'MISSING-INV',
        amount: 50,
        paymentMethod: 'card',
        paymentDate: '2026-04-15',
      } as never),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('NOT_FOUND path does not perform an UPDATE (no ghost mutations)', async () => {
    invoiceToReturn = undefined;
    try {
      await createPayment('CLINIC-UUID', 'STAFF-UUID', {
        invoiceId: 'MISSING-INV',
        amount: 50,
        paymentMethod: 'card',
        paymentDate: '2026-04-15',
      } as never);
    } catch {
      // expected
    }
    expect(recordedUpdatePayload).toBeUndefined();
  });
});
