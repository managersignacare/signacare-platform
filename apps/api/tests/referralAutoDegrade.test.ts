/**
 * Multi-specialty Phase 1 — referral auto-degrade + task state machine.
 *
 * Exercises:
 *
 *   - ReferralRepository.countCoordinatorsForSpecialty — the oracle the
 *     auto-degrade rule consults. In a solo clinic (zero coordinators)
 *     it must return 0 so a new referral skips the triage queue; in a
 *     hospital (one or more coordinators) it must return the true count.
 *
 *   - ReferralRepository.transitionTaskStatus — the atomic state-machine
 *     step. It must reject transitions that are not allowed from the
 *     current state (409 INVALID_TRANSITION), and on the happy path it
 *     must write a referral_state_transitions audit row in the same
 *     transaction as the referral UPDATE.
 *
 * The test mocks the `db` module with a small in-memory fake so the
 * suite runs without Postgres. This matches the pattern used by
 * `featureFlags.test.ts`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// The fake tables + db callable are declared inside `vi.hoisted` so they
// are evaluated before `vi.mock` — otherwise the repository import would
// hit a ReferenceError (vi.mock is hoisted to the top of the file).
const fixture = vi.hoisted(() => {
  interface StaffRow {
    id: string;
    clinic_id: string;
    role: string;
    is_active: boolean;
    deleted_at: Date | null;
  }
  interface StaffSpecialtyRow {
    id: string;
    clinic_id: string;
    staff_id: string;
    specialty_code: string;
    role: string;
    is_active: boolean;
    deleted_at: Date | null;
  }
  interface ReferralRow {
    id: string;
    clinic_id: string;
    task_status: string;
    assigned_to_id: string | null;
    coordinator_id: string | null;
    triaged_at: Date | null;
    triaged_by: string | null;
    deleted_at: Date | null;
    updated_at: Date;
  }
  interface StateTransitionRow {
    clinic_id: string;
    referral_id: string;
    from_task_status: string | null;
    to_task_status: string;
    actor_id: string | null;
    reason: string | null;
    created_at: Date;
  }

  const tables = {
    staff: [] as StaffRow[],
    staff_specialties: [] as StaffSpecialtyRow[],
    referrals: [] as ReferralRow[],
    referral_state_transitions: [] as StateTransitionRow[],
  };

  type TableName = keyof typeof tables;
  type FlatRow = Record<string, unknown>;
  type FilterPredicate = (r: FlatRow) => boolean;

  interface FakeQueryChain {
    join(): FakeQueryChain;
    where(
      field: Record<string, unknown> | string | ((...args: unknown[]) => unknown),
      value?: unknown,
    ): FakeQueryChain;
    whereNull(field: string): FakeQueryChain;
    count(): {
      first: () => Promise<{ count: string }>;
      then: (
        resolve: (value: Array<{ count: string }>) => unknown,
      ) => Promise<unknown>;
    };
    forUpdate(): FakeQueryChain;
    first(): Promise<FlatRow | undefined>;
    update(patch: Record<string, unknown>): {
      returning: () => Promise<FlatRow[]>;
    };
    insert(data: FlatRow | FlatRow[]): Promise<void>;
  }
  type FakeDb = ((table: string) => FakeQueryChain) & {
    transaction: (cb: (trx: FakeDb) => Promise<unknown>) => Promise<unknown>;
  };

  function resolveTable(raw: string): TableName {
    // Strip "table as alias" → "table" and the type-parameter form.
    return raw.split(' ')[0] as TableName;
  }

  function fakeQuery(rawTable: string): FakeQueryChain {
    const table = resolveTable(rawTable);
    const tableRows = tables[table] as unknown as FlatRow[];
    const filters: FilterPredicate[] = [];
    const chain: FakeQueryChain = {
      join() { return chain; },
      where(field, value) {
        if (typeof field === 'object') {
          for (const [k, v] of Object.entries(field)) {
            const col = k.includes('.') ? k.split('.').pop()! : k;
            filters.push((r) => r[col] === v);
          }
        } else if (typeof field === 'function') {
          // wrapped .where(qb => …) — unsupported, no-op
        } else {
          const col = String(field).includes('.') ? String(field).split('.').pop()! : String(field);
          filters.push((r) => r[col] === value);
        }
        return chain;
      },
      whereNull(field: string) {
        const col = field.includes('.') ? field.split('.').pop()! : field;
        filters.push((r) => r[col] === null);
        return chain;
      },
      count() {
        const rows = tableRows.filter((r) => filters.every((f) => f(r)));
        return {
          first: () => Promise.resolve({ count: String(rows.length) }),
          then: (resolve: (value: Array<{ count: string }>) => unknown) => Promise.resolve([{ count: String(rows.length) }]).then(resolve),
        };
      },
      forUpdate() { return chain; },
      first() {
        const row = tableRows.find((r) => filters.every((f) => f(r)));
        // Shallow clone so subsequent .update() mutations do not affect
        // the captured "before" snapshot.
        return Promise.resolve(row ? { ...row } : undefined);
      },
      update(patch: Record<string, unknown>) {
        const matching = tableRows.filter((r) => filters.every((f) => f(r)));
        for (const row of matching) Object.assign(row, patch);
        return {
          returning: () => Promise.resolve(matching.map((r) => ({ ...r }))),
        };
      },
      insert(data: FlatRow | FlatRow[]) {
        const rows = Array.isArray(data) ? data : [data];
        for (const r of rows) tableRows.push(r);
        return Promise.resolve();
      },
    };
    return chain;
  }

  const dbFn = ((table: string) => fakeQuery(table)) as FakeDb;
  dbFn.transaction = async (cb) => cb(dbFn);

  return { tables, dbFn };
});

vi.mock('../src/db/db', () => ({
  db: fixture.dbFn,
  default: fixture.dbFn,
}));

vi.mock('../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const tables = fixture.tables;

// Import AFTER mocks so the repository captures the fake.
import { referralRepository } from '../src/features/referrals/referralRepository';

const CLINIC_SOLO = '00000000-0000-0000-0000-000000000001';
const CLINIC_HOSPITAL = '00000000-0000-0000-0000-000000000002';
const STAFF_PSYCH = '10000000-0000-0000-0000-000000000001';
const STAFF_COORD = '10000000-0000-0000-0000-000000000002';
const REFERRAL_A = '20000000-0000-0000-0000-000000000001';

beforeEach(() => {
  tables.staff = [];
  tables.staff_specialties = [];
  tables.referrals = [];
  tables.referral_state_transitions = [];
});

// ── Auto-degrade: countCoordinatorsForSpecialty ────────────────────────────

// The fake query builder does not interpret `.join(...)` — it runs all
// predicates against a single "flat" row. Each staff_specialties fixture
// row therefore carries the joined staff columns (role, is_active)
// inline so that the `.where('s.role', …)` / `.where('s.is_active', …)`
// filters in the production query resolve correctly.
function seedEnrollment(row: Partial<{
  clinic_id: string;
  staff_id: string;
  specialty_code: string;
  role: string;
  is_active: boolean;
  deleted_at: Date | null;
}>): void {
  tables.staff_specialties.push({
    id: `ss-${tables.staff_specialties.length + 1}`,
    clinic_id: row.clinic_id!,
    staff_id: row.staff_id!,
    specialty_code: row.specialty_code!,
    deleted_at: row.deleted_at ?? null,
    // Denormalised joined columns (see comment above).
    role: row.role ?? 'clinician',
    is_active: row.is_active ?? true,
  });
}

describe('ReferralRepository.countCoordinatorsForSpecialty', () => {
  it('returns 0 for a solo clinic with no referral_coordinator staff', async () => {
    seedEnrollment({
      clinic_id: CLINIC_SOLO, staff_id: STAFF_PSYCH,
      specialty_code: 'endocrinology', role: 'clinician', is_active: true,
    });
    const count = await referralRepository.countCoordinatorsForSpecialty(
      CLINIC_SOLO, 'endocrinology',
    );
    expect(count).toBe(0);
  });

  it('returns >0 for a hospital with an enrolled coordinator', async () => {
    seedEnrollment({
      clinic_id: CLINIC_HOSPITAL, staff_id: STAFF_COORD,
      specialty_code: 'endocrinology', role: 'referral_coordinator', is_active: true,
    });
    const count = await referralRepository.countCoordinatorsForSpecialty(
      CLINIC_HOSPITAL, 'endocrinology',
    );
    expect(count).toBeGreaterThan(0);
  });

  it('does not count a soft-deleted enrollment', async () => {
    seedEnrollment({
      clinic_id: CLINIC_HOSPITAL, staff_id: STAFF_COORD,
      specialty_code: 'surgery', role: 'referral_coordinator', is_active: true,
      deleted_at: new Date(),
    });
    const count = await referralRepository.countCoordinatorsForSpecialty(
      CLINIC_HOSPITAL, 'surgery',
    );
    expect(count).toBe(0);
  });

  it('does not bleed across clinics (tenant scoping)', async () => {
    seedEnrollment({
      clinic_id: CLINIC_HOSPITAL, staff_id: STAFF_COORD,
      specialty_code: 'oncology', role: 'referral_coordinator', is_active: true,
    });
    const solo = await referralRepository.countCoordinatorsForSpecialty(
      CLINIC_SOLO, 'oncology',
    );
    expect(solo).toBe(0);
  });
});

// ── State machine: transitionTaskStatus ────────────────────────────────────

describe('ReferralRepository.transitionTaskStatus', () => {
  it('rejects a transition whose current state is not in the allowed-from set', async () => {
    tables.referrals.push({
      id: REFERRAL_A, clinic_id: CLINIC_HOSPITAL, task_status: 'completed',
      assigned_to_id: null, coordinator_id: null, triaged_at: null,
      triaged_by: null,
      deleted_at: null, updated_at: new Date(),
    });

    await expect(
      referralRepository.transitionTaskStatus({
        clinicId: CLINIC_HOSPITAL,
        referralId: REFERRAL_A,
        from: ['requested'],
        to: 'received',
        actorId: STAFF_COORD,
      }),
    ).rejects.toMatchObject({ status: 409, code: 'INVALID_TRANSITION' });

    // Audit trail must NOT have been written for a rejected transition.
    expect(tables.referral_state_transitions.length).toBe(0);
  });

  it('throws 404 when the referral does not exist', async () => {
    await expect(
      referralRepository.transitionTaskStatus({
        clinicId: CLINIC_HOSPITAL,
        referralId: REFERRAL_A,
        from: ['requested'],
        to: 'received',
        actorId: STAFF_COORD,
      }),
    ).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });

  it('happy path: advances status, applies patch, writes audit row', async () => {
    tables.referrals.push({
      id: REFERRAL_A, clinic_id: CLINIC_HOSPITAL, task_status: 'requested',
      assigned_to_id: null, coordinator_id: null, triaged_at: null,
      triaged_by: null,
      deleted_at: null, updated_at: new Date(),
    });

    await referralRepository.transitionTaskStatus({
      clinicId: CLINIC_HOSPITAL,
      referralId: REFERRAL_A,
      from: ['requested'],
      to: 'received',
      actorId: STAFF_COORD,
      reason: 'Claimed from queue',
      patch: { coordinator_id: STAFF_COORD, triaged_at: new Date(), triaged_by: STAFF_COORD },
    });

    const updated = tables.referrals[0];
    expect(updated.task_status).toBe('received');
    expect(updated.coordinator_id).toBe(STAFF_COORD);
    expect(updated.triaged_at).toBeInstanceOf(Date);

    expect(tables.referral_state_transitions.length).toBe(1);
    const audit = tables.referral_state_transitions[0];
    expect(audit.clinic_id).toBe(CLINIC_HOSPITAL);
    expect(audit.referral_id).toBe(REFERRAL_A);
    expect(audit.from_task_status).toBe('requested');
    expect(audit.to_task_status).toBe('received');
    expect(audit.actor_id).toBe(STAFF_COORD);
    expect(audit.reason).toBe('Claimed from queue');
  });
});
