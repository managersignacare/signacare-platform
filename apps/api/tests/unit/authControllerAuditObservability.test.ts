// BUG-443 — authController login/logout audit-write swallow
//
// Pre-fix `apps/api/src/features/auth/authController.ts:118` and `:192`
// had empty try/catch blocks that swallowed any error from the audit
// write with zero observability — no log, no metric, no alert. AHPRA
// §164.312(b) + APP 11 require operator-visible audit-trail
// degradation. This fix preserves the must-not-block invariant
// (login/logout still complete) but emits a structured logger.warn so
// the failure surfaces. Pre-fix RED gate: AC-2 + AC-5 fail (no
// logger.warn invocation). Post-fix: 6/6 GREEN.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

// Stub config BEFORE importing authController. The controller pulls
// `cookieOptions()` which reads `config.NODE_ENV` and the JWT TTLs.
vi.mock('../../src/config', () => ({
  config: {
    NODE_ENV: 'test',
    jwt: {
      accessSecret: 'unit-test-access-secret-which-is-32-bytes-long',
      refreshSecret: 'unit-test-refresh-secret-which-is-also-32b',
      accessTtlMinutes: 60,
      refreshTtlDays: 7,
    },
  },
}));

const { writeAuditLogMock, loginMock, logoutMock, staffFirstMock } = vi.hoisted(() => {
  return {
    writeAuditLogMock: vi.fn(),
    loginMock: vi.fn(),
    logoutMock: vi.fn(),
    staffFirstMock: vi.fn(),
  };
});

vi.mock('../../src/utils/audit', () => ({
  writeAuditLog: writeAuditLogMock,
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/features/auth/authService', () => ({
  AuthService: class {
    login = loginMock;
    logout = logoutMock;
  },
}));

vi.mock('../../src/middleware/sessionIdleMiddleware', () => ({
  primeIdleWindow: vi.fn().mockResolvedValue(undefined),
  clearIdleWindow: vi.fn().mockResolvedValue(undefined),
  effectiveIdleMinutesForClinic: vi.fn().mockResolvedValue(15),
}));

vi.mock('../../src/db/db', () => ({
  db: Object.assign(vi.fn().mockReturnValue({
    where: vi.fn().mockReturnThis(),
    first: staffFirstMock,
  }), {
    fn: { now: () => new Date() },
  }),
}));

import { loginController, logoutController } from '../../src/features/auth/authController';
import { logger } from '../../src/utils/logger';

const STAFF_ID = '11111111-1111-1111-1111-111111111111';
const CLINIC_ID = '22222222-2222-2222-2222-222222222222';

const LOGIN_SUCCESS = {
  user: {
    id: STAFF_ID,
    clinicId: CLINIC_ID,
    email: 'ada@example.com',
    role: 'clinician',
  },
  accessToken: 'access-jwt',
  refreshToken: 'refresh-jwt',
};

interface LoginRequestDouble {
  body: { email: string; password: string };
  headers: Record<string, string>;
  ip: string;
  requestId?: string;
}

interface LogoutRequestDouble {
  cookies: { signacare_refresh: string };
  user: { id: string; clinicId: string };
  headers: Record<string, string>;
  ip: string;
}

interface ResponseDouble {
  status: (code: number) => { json: (body: unknown) => void };
  json: (body: unknown) => void;
  cookie: (...args: unknown[]) => void;
  clearCookie: (...args: unknown[]) => void;
}

function makeRes(): {
  res: ResponseDouble;
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
  cookie: ReturnType<typeof vi.fn>;
} {
  const json = vi.fn();
  const cookie = vi.fn();
  const clearCookie = vi.fn();
  const status = vi.fn().mockImplementation(() => ({ json }));
  const res: ResponseDouble = { status, json, cookie, clearCookie };
  return { res, status, json, cookie };
}

async function invokeLoginController(req: LoginRequestDouble, res: ResponseDouble): Promise<void> {
  await loginController(req as Request, res as Response);
}

async function invokeLogoutController(req: LogoutRequestDouble, res: ResponseDouble): Promise<void> {
  await logoutController(req as Request, res as Response);
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.LOGIN_PINO_TIMING;
  delete process.env.LOGIN_AUDIT_TIMEOUT_MS;
  // Per-mock resets to drain leftover mockResolvedValueOnce /
  // mockRejectedValueOnce queues that vi.clearAllMocks() leaves intact.
  writeAuditLogMock.mockReset();
  loginMock.mockReset();
  logoutMock.mockReset();
  staffFirstMock.mockReset();
  loginMock.mockResolvedValue(LOGIN_SUCCESS);
  logoutMock.mockResolvedValue(undefined);
  staffFirstMock.mockResolvedValue({ must_change_password: false });
});

describe('BUG-443 — authController login/logout audit-write observability', () => {
  it('AC-1 — loginController returns 200 when writeAuditLog throws (must-not-block)', async () => {
    writeAuditLogMock.mockRejectedValueOnce(new Error('audit DB down'));
    const req: LoginRequestDouble = { body: { email: 'ada@example.com', password: 'pw' }, headers: {}, ip: '127.0.0.1' };
    const { res, status } = makeRes();
    await invokeLoginController(req, res);
    expect(status).toHaveBeenCalledWith(200);
  });

  it('AC-2 — loginController emits logger.warn with audit_write_failure shape on writeAuditLog throw', async () => {
    writeAuditLogMock.mockRejectedValueOnce(new Error('audit DB down'));
    const req: LoginRequestDouble = { body: { email: 'ada@example.com', password: 'pw' }, headers: {}, ip: '127.0.0.1' };
    const { res } = makeRes();
    await invokeLoginController(req, res);
    const warnSpy = vi.mocked(logger.warn);
    expect(warnSpy).toHaveBeenCalled();
    const matched = warnSpy.mock.calls.some(
      ([ctx, msg]) =>
        typeof ctx === 'object' &&
        ctx !== null &&
        (ctx as Record<string, unknown>).action === 'LOGIN' &&
        (ctx as Record<string, unknown>).staffId === STAFF_ID &&
        (ctx as Record<string, unknown>).clinicId === CLINIC_ID &&
        (ctx as Record<string, unknown>).kind === 'audit_write_failure' &&
        typeof msg === 'string' &&
        msg.includes('BUG-443'),
    );
    expect(matched).toBe(true);
  });

  it('AC-3 — loginController happy-path triggers no audit_write_failure warn', async () => {
    writeAuditLogMock.mockResolvedValueOnce(undefined);
    const req: LoginRequestDouble = { body: { email: 'ada@example.com', password: 'pw' }, headers: {}, ip: '127.0.0.1' };
    const { res } = makeRes();
    await invokeLoginController(req, res);
    const warnSpy = vi.mocked(logger.warn);
    const fired = warnSpy.mock.calls.some(
      ([ctx]) =>
        typeof ctx === 'object' &&
        ctx !== null &&
        (ctx as Record<string, unknown>).kind === 'audit_write_failure',
    );
    expect(fired).toBe(false);
  });

  it('AC-3b — loginController emits four TIMING logger.info events when LOGIN_PINO_TIMING=1', async () => {
    process.env.LOGIN_PINO_TIMING = '1';
    writeAuditLogMock.mockResolvedValueOnce(undefined);
    const req: LoginRequestDouble = {
      body: { email: 'ada@example.com', password: 'pw' },
      headers: {},
      ip: '127.0.0.1',
      requestId: 'req-a1',
    };
    const { res } = makeRes();

    await invokeLoginController(req, res);

    const infoCalls = vi.mocked(logger.info).mock.calls.filter(([ctx]) =>
      typeof ctx === 'object' &&
      ctx !== null &&
      (ctx as Record<string, unknown>).kind === 'TIMING',
    );

    expect(infoCalls).toHaveLength(4);
    expect(infoCalls.map(([ctx]) => (ctx as Record<string, unknown>).stage)).toEqual([
      'login.authService.login',
      'login.importStaffDb',
      'login.readMustChangePasswordFlag',
      'login.writeAuditLog',
    ]);
    expect(infoCalls[0]?.[0]).toMatchObject({
      kind: 'TIMING',
      requestId: 'req-a1',
      userId: undefined,
      surface: 'auth.login',
    });
    expect(infoCalls[1]?.[0]).toMatchObject({
      kind: 'TIMING',
      requestId: 'req-a1',
      userId: STAFF_ID,
      surface: 'auth.login',
    });
  });

  it('AC-3c — loginController suppresses TIMING logger.info events when LOGIN_PINO_TIMING is unset', async () => {
    writeAuditLogMock.mockResolvedValueOnce(undefined);
    const req: LoginRequestDouble = {
      body: { email: 'ada@example.com', password: 'pw' },
      headers: {},
      ip: '127.0.0.1',
      requestId: 'req-a1',
    };
    const { res } = makeRes();

    await invokeLoginController(req, res);

    const timingCalls = vi.mocked(logger.info).mock.calls.filter(([ctx]) =>
      typeof ctx === 'object' &&
      ctx !== null &&
      (ctx as Record<string, unknown>).kind === 'TIMING',
    );
    expect(timingCalls).toHaveLength(0);
  });

  it('AC-3d — loginController times out audit write and still returns 200', async () => {
    process.env.LOGIN_AUDIT_TIMEOUT_MS = '5';
    writeAuditLogMock.mockImplementation(() => new Promise<void>(() => {}));
    const req: LoginRequestDouble = {
      body: { email: 'ada@example.com', password: 'pw' },
      headers: {},
      ip: '127.0.0.1',
      requestId: 'req-a2',
    };
    const { res, status } = makeRes();

    await invokeLoginController(req, res);

    expect(status).toHaveBeenCalledWith(200);
    const warnSpy = vi.mocked(logger.warn);
    const matched = warnSpy.mock.calls.some(
      ([ctx]) =>
        typeof ctx === 'object' &&
        ctx !== null &&
        (ctx as Record<string, unknown>).kind === 'audit_write_failure' &&
        (ctx as Record<string, unknown>).action === 'LOGIN' &&
        (ctx as Record<string, unknown>).staffId === STAFF_ID &&
        (ctx as Record<string, unknown>).timeoutMs === 5,
    );
    expect(matched).toBe(true);
  });

  it('AC-4 — logoutController returns 200 when writeAuditLog throws (must-not-block)', async () => {
    writeAuditLogMock.mockRejectedValueOnce(new Error('audit DB down'));
    const req: LogoutRequestDouble = {
      cookies: { signacare_refresh: 'refresh-jwt' },
      user: { id: STAFF_ID, clinicId: CLINIC_ID },
      headers: {},
      ip: '127.0.0.1',
    };
    const { res, status } = makeRes();
    await invokeLogoutController(req, res);
    expect(status).toHaveBeenCalledWith(200);
  });

  it('AC-5 — logoutController emits logger.warn with action=LOGOUT shape on writeAuditLog throw', async () => {
    writeAuditLogMock.mockRejectedValueOnce(new Error('audit DB down'));
    const req: LogoutRequestDouble = {
      cookies: { signacare_refresh: 'refresh-jwt' },
      user: { id: STAFF_ID, clinicId: CLINIC_ID },
      headers: {},
      ip: '127.0.0.1',
    };
    const { res } = makeRes();
    await invokeLogoutController(req, res);
    const warnSpy = vi.mocked(logger.warn);
    const matched = warnSpy.mock.calls.some(
      ([ctx, msg]) =>
        typeof ctx === 'object' &&
        ctx !== null &&
        (ctx as Record<string, unknown>).action === 'LOGOUT' &&
        (ctx as Record<string, unknown>).staffId === STAFF_ID &&
        (ctx as Record<string, unknown>).clinicId === CLINIC_ID &&
        (ctx as Record<string, unknown>).kind === 'audit_write_failure' &&
        typeof msg === 'string' &&
        msg.includes('BUG-443'),
    );
    expect(matched).toBe(true);
  });

  it('AC-6 — logoutController happy-path triggers no audit_write_failure warn', async () => {
    writeAuditLogMock.mockResolvedValueOnce(undefined);
    const req: LogoutRequestDouble = {
      cookies: { signacare_refresh: 'refresh-jwt' },
      user: { id: STAFF_ID, clinicId: CLINIC_ID },
      headers: {},
      ip: '127.0.0.1',
    };
    const { res } = makeRes();
    await invokeLogoutController(req, res);
    const warnSpy = vi.mocked(logger.warn);
    const fired = warnSpy.mock.calls.some(
      ([ctx]) =>
        typeof ctx === 'object' &&
        ctx !== null &&
        (ctx as Record<string, unknown>).kind === 'audit_write_failure',
    );
    expect(fired).toBe(false);
  });
});
