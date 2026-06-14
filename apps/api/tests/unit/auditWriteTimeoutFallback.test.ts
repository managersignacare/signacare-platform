import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type InsertStep =
  | { kind: 'resolve' }
  | { kind: 'reject'; error: unknown }
  | { kind: 'never' };

const { dbAdminMock, enqueueAuditOutboxMock, loggerErrorMock, loggerWarnMock, loggerInfoMock } = vi.hoisted(() => ({
  dbAdminMock: vi.fn(),
  enqueueAuditOutboxMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  loggerInfoMock: vi.fn(),
}));

vi.mock('../../src/db/db', () => ({
  db: dbAdminMock,
  rlsStore: {
    getStore: vi.fn(() => undefined),
  },
}));

vi.mock('../../src/shared/tenantContext', () => ({
  withTenantContext: async (_clinicId: string, fn: () => Promise<unknown>) => fn(),
}));

vi.mock('../../src/shared/auditOutbox', () => ({
  enqueueAuditOutbox: enqueueAuditOutboxMock,
}));

vi.mock('../../src/utils/logger', () => ({
  logger: {
    error: loggerErrorMock,
    warn: loggerWarnMock,
    info: loggerInfoMock,
    debug: vi.fn(),
  },
}));

import { writeAuditLog } from '../../src/utils/audit';

function installDbInsertSequence(steps: InsertStep[]) {
  let callCount = 0;
  const insertedRows: Array<Record<string, unknown>> = [];

  dbAdminMock.mockImplementation(() => ({
    insert: (row: Record<string, unknown>) => {
      insertedRows.push(row);
      return {
        onConflict: () => ({
          ignore: () => {
            const step = steps[callCount] ?? steps[steps.length - 1] ?? { kind: 'resolve' as const };
            callCount += 1;
            if (step.kind === 'resolve') {
              return Promise.resolve([]);
            }
            if (step.kind === 'never') {
              return new Promise<never>(() => {});
            }
            return Promise.reject(step.error);
          },
        }),
      };
    },
  }));

  return {
    insertedRows,
    getCallCount: () => callCount,
  };
}

const BASE_INPUT = {
  clinicId: '11111111-1111-1111-1111-111111111111',
  actorId: '22222222-2222-2222-2222-222222222222',
  action: 'LOGIN' as const,
  tableName: 'staff_sessions',
  recordId: '33333333-3333-3333-3333-333333333333',
};

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.AUDIT_DB_WRITE_TIMEOUT_MS;
  delete process.env.AUDIT_OUTBOX_ENQUEUE_TIMEOUT_MS;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('A2 timeout fallback semantics — writeAuditLog', () => {
  it('A2-TFS-1: primary insert timeout falls back to outbox once and returns', async () => {
    vi.useFakeTimers();
    process.env.AUDIT_DB_WRITE_TIMEOUT_MS = '5';
    installDbInsertSequence([{ kind: 'never' }]);
    enqueueAuditOutboxMock.mockResolvedValue(undefined);

    const p = writeAuditLog(BASE_INPUT);
    await vi.advanceTimersByTimeAsync(10);
    await p;

    expect(dbAdminMock).toHaveBeenCalledTimes(1);
    expect(enqueueAuditOutboxMock).toHaveBeenCalledTimes(1);
    const row = enqueueAuditOutboxMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(typeof row.dedupe_key).toBe('string');
  });

  it('A2-TFS-2: schema mismatch retries legacy insert path and does not enqueue', async () => {
    const schemaErr = Object.assign(new Error('column "staff_id" does not exist'), { code: '42703' });
    const db = installDbInsertSequence([{ kind: 'reject', error: schemaErr }, { kind: 'resolve' }]);
    enqueueAuditOutboxMock.mockResolvedValue(undefined);

    await writeAuditLog(BASE_INPUT);

    expect(db.getCallCount()).toBe(2);
    expect(enqueueAuditOutboxMock).not.toHaveBeenCalled();
    expect(db.insertedRows[1]).toMatchObject({
      user_id: BASE_INPUT.actorId,
      action: 'login',
      module: BASE_INPUT.tableName,
    });
    expect(db.insertedRows[1]).not.toHaveProperty('staff_id');
  });

  it('A2-TFS-3: non-schema primary failure skips legacy retry and enqueues directly', async () => {
    const dbErr = Object.assign(new Error('cannot connect now'), { code: '57P03' });
    const db = installDbInsertSequence([{ kind: 'reject', error: dbErr }]);
    enqueueAuditOutboxMock.mockResolvedValue(undefined);

    await writeAuditLog(BASE_INPUT);

    expect(db.getCallCount()).toBe(1);
    expect(enqueueAuditOutboxMock).toHaveBeenCalledTimes(1);
  });

  it('A2-TFS-3b: non-staff UUID actor retries with staff_id=NULL and stays on v2 shape', async () => {
    const fkErr = Object.assign(new Error('staff FK violation'), {
      code: '23503',
      constraint: 'audit_log_staff_id_foreign',
    });
    const db = installDbInsertSequence([{ kind: 'reject', error: fkErr }, { kind: 'resolve' }]);
    enqueueAuditOutboxMock.mockResolvedValue(undefined);

    await writeAuditLog(BASE_INPUT);

    expect(db.getCallCount()).toBe(2);
    expect(enqueueAuditOutboxMock).not.toHaveBeenCalled();
    expect(db.insertedRows[1]).toMatchObject({
      staff_id: null,
      user_id: BASE_INPUT.actorId,
      operation: 'LOGIN',
      table_name: BASE_INPUT.tableName,
      record_id: BASE_INPUT.recordId,
    });
  });

  it('A2-TFS-4: outbox enqueue timeout is bounded and does not leak a throw', async () => {
    vi.useFakeTimers();
    process.env.AUDIT_OUTBOX_ENQUEUE_TIMEOUT_MS = '5';
    const dbErr = Object.assign(new Error('cannot connect now'), { code: '57P03' });
    installDbInsertSequence([{ kind: 'reject', error: dbErr }]);
    enqueueAuditOutboxMock.mockImplementation(() => new Promise<void>(() => {}));

    const p = writeAuditLog(BASE_INPUT);
    await vi.advanceTimersByTimeAsync(10);
    await p;

    const matched = loggerErrorMock.mock.calls.some(
      ([ctx]) =>
        typeof ctx === 'object' &&
        ctx !== null &&
        (ctx as Record<string, unknown>).kind === 'tier_5_9_audit_outbox_enqueue_failed',
    );
    expect(matched).toBe(true);
  });

  it('BUG-328-1: LLM bypass audit write failure emits alert-ready pino context', async () => {
    const dbErr = Object.assign(new Error('cannot connect now'), { code: '57P03' });
    installDbInsertSequence([{ kind: 'reject', error: dbErr }]);
    enqueueAuditOutboxMock.mockResolvedValue(undefined);

    await writeAuditLog({
      ...BASE_INPUT,
      action: 'LLM_ACCESS_BYPASS_ROLE',
      tableName: 'llm_interactions',
    });

    const matched = loggerErrorMock.mock.calls.some(
      ([ctx]) =>
        typeof ctx === 'object' &&
        ctx !== null &&
        (ctx as Record<string, unknown>).alertKind === 'llm_access_bypass_audit_write_failed' &&
        (ctx as Record<string, unknown>).action === 'LLM_ACCESS_BYPASS_ROLE' &&
        (ctx as Record<string, unknown>).kind === 'tier_5_9_audit_write_failed',
    );
    expect(matched).toBe(true);
  });
});
