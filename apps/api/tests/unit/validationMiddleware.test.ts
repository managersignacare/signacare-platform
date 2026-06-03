import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { validateBody } from '../../src/middleware/validationMiddleware';
import { HttpError } from '../../src/shared/errors';

function requestWithBody(body: unknown): Request {
  return { body } as unknown as Request;
}

describe('validateBody', () => {
  const schema = z.object({
    age: z.coerce.number().int().min(0),
  });

  it('parses payload and calls next() once when valid', () => {
    const middleware = validateBody(schema);
    const req = requestWithBody({ age: '7' });
    const res = {} as Response;
    const next = vi.fn() as unknown as NextFunction;

    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.body).toEqual({ age: 7 });
  });

  it('throws HttpError(422, VALIDATION_ERROR) when payload is invalid', () => {
    const middleware = validateBody(schema);
    const req = requestWithBody({ age: -1 });
    const res = {} as Response;
    const next = vi.fn() as unknown as NextFunction;

    try {
      middleware(req, res, next);
      throw new Error('Expected validateBody to throw');
    } catch (err) {
      expect(next).not.toHaveBeenCalled();
      expect(err).toBeInstanceOf(HttpError);
      const httpErr = err as HttpError;
      expect(httpErr.status).toBe(422);
      expect(httpErr.code).toBe('VALIDATION_ERROR');
    }
  });
});
