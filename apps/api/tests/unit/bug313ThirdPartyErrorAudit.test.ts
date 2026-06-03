import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  registerKnexQueryErrorAudit,
  registerPgClientErrorAudit,
} from '../../src/shared/thirdPartyErrorAudit';
import { logger } from '../../src/utils/logger';

describe('BUG-313 third-party error audit hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs knex query-error via pino err serializer path with structural metadata', () => {
    const knexEmitter = new EventEmitter() as unknown as Knex;
    registerKnexQueryErrorAudit(knexEmitter, 'app_user');

    const err = new Error(
      'duplicate key value violates unique constraint "staff_email_unique": Key (email)=(a@b.com) already exists',
    );
    (knexEmitter as unknown as EventEmitter).emit('query-error', err, {
      __knexUid: 'conn-1',
      __knexQueryUid: 'query-1',
      __knexTxId: 'tx-1',
      method: 'insert',
      sql: 'insert into staff (email) values (?)',
    });

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'third_party_knex_query_error',
        poolRole: 'app_user',
        connectionUid: 'conn-1',
        queryUid: 'query-1',
        txUid: 'tx-1',
        sqlVerb: 'INSERT',
        err,
      }),
      expect.stringContaining('Knex query error'),
    );
  });

  it('is idempotent for knex instances (no duplicate listeners)', () => {
    const knexEmitter = new EventEmitter() as unknown as Knex;
    registerKnexQueryErrorAudit(knexEmitter, 'read_replica');
    registerKnexQueryErrorAudit(knexEmitter, 'read_replica');

    const err = new Error('boom');
    (knexEmitter as unknown as EventEmitter).emit('query-error', err, {
      method: 'select',
      sql: 'select 1',
    });

    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('logs pg client error via pino err serializer path and is idempotent', () => {
    const pgConnection = new EventEmitter() as unknown as {
      on: (event: 'error', handler: (err: unknown) => void) => unknown;
    };

    registerPgClientErrorAudit(pgConnection, 'admin');
    registerPgClientErrorAudit(pgConnection, 'admin');

    const err = new Error('Key (medicare_number)=(2123456789) already exists');
    (pgConnection as unknown as EventEmitter).emit('error', err);

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'third_party_pg_client_error',
        poolRole: 'admin',
        err,
      }),
      expect.stringContaining('Postgres client emitted an error event'),
    );
  });
});
