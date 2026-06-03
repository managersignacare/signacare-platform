/**
 * Category 1 — Unit tests for the RBAC middleware: requireRole,
 * requireRoles, and requirePermission.
 *
 * Why this matters: every protected route in the API gates on these
 * three middleware factories. A regression here would silently grant
 * cross-role access to PHI. The middleware is short and pure (no DB,
 * no Redis), so a unit test is the right fit.
 *
 * Standard satisfied: OWASP A01 (Broken Access Control), ACHS Standard
 * 1 (Clinical Governance — least-privilege access to clinical record).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import {
  requireRole,
  requireRoles,
  requirePermission,
} from '../../src/middleware/rbacMiddleware';

// Build a minimal Request stub. Only the fields the middleware reads
// (req.user) are populated; everything else is intentionally undefined.
function makeReq(user: Partial<{ id: string; role: string; permissions: string[] }> | null): Request {
  return { user: user as Request['user'] } as unknown as Request;
}

// Build a Response stub that captures status() + json() calls.
function makeRes(): { res: Response; statusSpy: ReturnType<typeof vi.fn>; jsonSpy: ReturnType<typeof vi.fn> } {
  const jsonSpy = vi.fn();
  const statusSpy = vi.fn().mockReturnValue({ json: jsonSpy });
  const res = {
    status: statusSpy,
    json: jsonSpy,
  } as unknown as Response;
  return { res, statusSpy, jsonSpy };
}

describe('requireRole — single-role gate', () => {
  let next: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    next = vi.fn();
  });

  it('allows a clinician on a clinician-only route', () => {
    const mw = requireRole('clinician');
    const req = makeReq({ id: 's1', role: 'clinician', permissions: [] });
    const { res } = makeRes();
    mw(req, res, next as unknown as NextFunction);
    expect(next).toHaveBeenCalledOnce();
  });

  it('rejects a guest on a clinician-only route with 403', () => {
    const mw = requireRole('clinician');
    const req = makeReq({ id: 's1', role: 'guest', permissions: [] });
    const { res, statusSpy, jsonSpy } = makeRes();
    mw(req, res, next as unknown as NextFunction);
    expect(next).not.toHaveBeenCalled();
    expect(statusSpy).toHaveBeenCalledWith(403);
    expect(jsonSpy).toHaveBeenCalledWith(expect.objectContaining({ code: 'FORBIDDEN' }));
  });

  it('rejects an unauthenticated request with 401', () => {
    const mw = requireRole('clinician');
    const req = makeReq(null);
    const { res, statusSpy, jsonSpy } = makeRes();
    mw(req, res, next as unknown as NextFunction);
    expect(next).not.toHaveBeenCalled();
    expect(statusSpy).toHaveBeenCalledWith(401);
    expect(jsonSpy).toHaveBeenCalledWith(expect.objectContaining({ code: 'UNAUTHENTICATED' }));
  });

  it('allows superadmin on any role-gated route (RBAC bypass)', () => {
    const mw = requireRole('clinician');
    const req = makeReq({ id: 's1', role: 'superadmin', permissions: [] });
    const { res } = makeRes();
    mw(req, res, next as unknown as NextFunction);
    expect(next).toHaveBeenCalledOnce();
  });
});

describe('requireRoles — any-of-many gate', () => {
  let next: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    next = vi.fn();
  });

  it('allows when the user role matches any of the permitted roles', () => {
    const mw = requireRoles(['clinician', 'admin']);
    const req = makeReq({ id: 's1', role: 'admin', permissions: [] });
    const { res } = makeRes();
    mw(req, res, next as unknown as NextFunction);
    expect(next).toHaveBeenCalledOnce();
  });

  it('rejects when the user role is not in the list (403)', () => {
    const mw = requireRoles(['clinician', 'admin']);
    const req = makeReq({ id: 's1', role: 'patient', permissions: [] });
    const { res, statusSpy } = makeRes();
    mw(req, res, next as unknown as NextFunction);
    expect(next).not.toHaveBeenCalled();
    expect(statusSpy).toHaveBeenCalledWith(403);
  });
});

describe('requirePermission — fine-grained gate', () => {
  let next: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    next = vi.fn();
  });

  it('allows when the user holds the exact permission', () => {
    const mw = requirePermission('patient:create');
    const req = makeReq({ id: 's1', role: 'clinician', permissions: ['patient:read', 'patient:create'] });
    const { res } = makeRes();
    mw(req, res, next as unknown as NextFunction);
    expect(next).toHaveBeenCalledOnce();
  });

  it('rejects when the permission is missing (403)', () => {
    const mw = requirePermission('patient:delete');
    const req = makeReq({ id: 's1', role: 'clinician', permissions: ['patient:read'] });
    const { res, statusSpy, jsonSpy } = makeRes();
    mw(req, res, next as unknown as NextFunction);
    expect(next).not.toHaveBeenCalled();
    expect(statusSpy).toHaveBeenCalledWith(403);
    expect(jsonSpy).toHaveBeenCalledWith(expect.objectContaining({ code: 'FORBIDDEN' }));
  });

  it('rejects an unauthenticated request with 401', () => {
    const mw = requirePermission('patient:read');
    const req = makeReq(null);
    const { res, statusSpy } = makeRes();
    mw(req, res, next as unknown as NextFunction);
    expect(next).not.toHaveBeenCalled();
    expect(statusSpy).toHaveBeenCalledWith(401);
  });

  it('allows superadmin even without the explicit permission (bypass)', () => {
    const mw = requirePermission('patient:delete');
    const req = makeReq({ id: 's1', role: 'superadmin', permissions: [] });
    const { res } = makeRes();
    mw(req, res, next as unknown as NextFunction);
    expect(next).toHaveBeenCalledOnce();
  });

  it('does NOT match a partial permission name (least privilege)', () => {
    const mw = requirePermission('patient:delete');
    const req = makeReq({
      id: 's1',
      role: 'clinician',
      // Note: contains 'patient:de' as a substring of an unrelated perm
      permissions: ['patient:de-identify', 'patient:read'],
    });
    const { res, statusSpy } = makeRes();
    mw(req, res, next as unknown as NextFunction);
    expect(next).not.toHaveBeenCalled();
    expect(statusSpy).toHaveBeenCalledWith(403);
  });
});
