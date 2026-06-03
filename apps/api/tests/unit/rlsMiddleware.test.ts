import { EventEmitter } from 'node:events';
import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { appPoolRaw } from '../../src/db/db';
import { rlsMiddleware } from '../../src/middleware/rlsMiddleware';

function buildReq(): Request {
  return {
    clinicId: '11111111-1111-1111-1111-111111111111',
    path: '/api/v1/medications/patients/abc/medications',
    headers: {},
    user: { id: '22222222-2222-2222-2222-222222222222' },
  } as unknown as Request;
}

function buildRes(): Response {
  const emitter = new EventEmitter() as Response & EventEmitter;
  emitter.writableFinished = false;
  emitter.headersSent = false;
  return emitter as unknown as Response;
}

describe('rlsMiddleware nested-context behaviour', () => {
  it('reuses request-scoped guard on duplicate middleware invocation', async () => {
    const req = buildReq();
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;
    const transactionSpy = vi.spyOn(appPoolRaw, 'transaction').mockImplementationOnce(
      async (runner: Parameters<typeof appPoolRaw.transaction>[0]) => {
        const trx = {
          raw: vi.fn().mockResolvedValue(undefined),
        } as unknown as Parameters<Parameters<typeof appPoolRaw.transaction>[0]>[0];
        const promise = runner(trx);
        setImmediate(() => {
          (res as unknown as EventEmitter).emit('finish');
        });
        return promise;
      },
    );

    try {
      rlsMiddleware(req, res, next);
      await new Promise((resolve) => setImmediate(resolve));
      rlsMiddleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(2);
      expect(transactionSpy).toHaveBeenCalledTimes(1);
      expect((res as unknown as EventEmitter).listenerCount('finish')).toBe(0);
      expect((res as unknown as EventEmitter).listenerCount('close')).toBe(0);
    } finally {
      transactionSpy.mockRestore();
    }
  });

  it('treats client disconnect as terminal without error re-entry', async () => {
    const req = buildReq();
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;
    const transactionSpy = vi.spyOn(appPoolRaw, 'transaction').mockImplementationOnce(
      async (runner: Parameters<typeof appPoolRaw.transaction>[0]) => {
        const trx = {
          raw: vi.fn().mockResolvedValue(undefined),
        } as unknown as Parameters<Parameters<typeof appPoolRaw.transaction>[0]>[0];
        return runner(trx);
      },
    );

    try {
      rlsMiddleware(req, res, next);
      await new Promise((resolve) => setImmediate(resolve));
      (res as unknown as EventEmitter).emit('close');
      await new Promise((resolve) => setImmediate(resolve));

      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith();
    } finally {
      transactionSpy.mockRestore();
    }
  });
});
