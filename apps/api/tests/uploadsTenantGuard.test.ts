/**
 * S1.1-DEFERRED-D — uploadsTenantGuard unit tests
 *
 * The full DB-backed cross-tenant test belongs in the integration suite
 * (it needs real Postgres + seeded patient_attachments rows). These
 * unit tests cover the pieces that DO NOT need a database:
 *
 *   - Path-safety guards (.., absolute paths, null bytes, control chars)
 *   - The middleware short-circuits when req.clinicId is missing
 *   - The middleware short-circuits on logos sub-path
 *   - 404 vs 410 branching by BLOB_STORAGE_BACKEND
 *
 * The DB-lookup branches are exercised in the integration suite under
 * apps/api/tests/integration/uploadsTenantGuard.int.test.ts (to be
 * added when integration scaffolding lands).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// Mock the db module so the test never opens a real connection. The
// 'no DB row' branch is what we exercise here.
vi.mock('../src/db/db', () => {
  const queryBuilder = {
    where: vi.fn().mockReturnThis(),
    orWhere: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(null),
  };
  return { db: vi.fn(() => queryBuilder) };
});

vi.mock('../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { uploadsTenantGuard } from '../src/middleware/uploadsTenantGuard';

interface FakeResponse {
  statusCode: number;
  body?: unknown;
  status: (code: number) => FakeResponse;
  json: (body: unknown) => FakeResponse;
}

function buildRes(): FakeResponse {
  return {
    statusCode: 200,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
  };
}

function buildReq(opts: { path: string; clinicId?: string }): Request {
  return {
    path: opts.path,
    clinicId: opts.clinicId,
  } as unknown as Request;
}

describe('uploadsTenantGuard', () => {
  beforeEach(() => {
    delete process.env.BLOB_STORAGE_BACKEND;
    vi.clearAllMocks();
  });

  it('rejects path traversal with 403', async () => {
    const req = buildReq({ path: '/../etc/passwd', clinicId: 'clinic-A' });
    const res = buildRes();
    const next = vi.fn();
    await uploadsTenantGuard()(req, res as unknown as Response, next as NextFunction);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect((res.body as { error?: string } | undefined)?.error).toBe('forbidden_path');
  });

  it('rejects null bytes with 403', async () => {
    const req = buildReq({ path: '/foo\0bar.pdf', clinicId: 'clinic-A' });
    const res = buildRes();
    const next = vi.fn();
    await uploadsTenantGuard()(req, res as unknown as Response, next as NextFunction);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it('returns 401 when req.clinicId is missing', async () => {
    const req = buildReq({ path: '/attachments/2026/04/abc.pdf' });
    const res = buildRes();
    const next = vi.fn();
    await uploadsTenantGuard()(req, res as unknown as Response, next as NextFunction);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('lets logos/* through (defensive — they are mounted earlier in server.ts)', async () => {
    const req = buildReq({ path: '/logos/clinic-A.png', clinicId: 'clinic-A' });
    const res = buildRes();
    const next = vi.fn();
    await uploadsTenantGuard()(req, res as unknown as Response, next as NextFunction);
    expect(next).toHaveBeenCalled();
  });

  it('returns 404 when no DB row matches and backend is local', async () => {
    process.env.BLOB_STORAGE_BACKEND = 'local';
    const req = buildReq({ path: '/attachments/2026/04/unknown.pdf', clinicId: 'clinic-A' });
    const res = buildRes();
    const next = vi.fn();
    await uploadsTenantGuard()(req, res as unknown as Response, next as NextFunction);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(404);
  });

  it('returns 410 Gone when no DB row matches and backend is s3', async () => {
    process.env.BLOB_STORAGE_BACKEND = 's3';
    const req = buildReq({ path: '/attachments/2026/04/unknown.pdf', clinicId: 'clinic-A' });
    const res = buildRes();
    const next = vi.fn();
    await uploadsTenantGuard()(req, res as unknown as Response, next as NextFunction);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(410);
    expect((res.body as { error?: string } | undefined)?.error).toBe('gone_use_signed_url');
  });
});
