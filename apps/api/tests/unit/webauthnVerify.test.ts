/**
 * BUG-239 regression: WebAuthn cryptographic verification.
 *
 * These tests assert the post-fix contract:
 *   - register/verify MUST call verifyRegistrationResponse from
 *     @simplewebauthn/server with expectedChallenge + expectedOrigin +
 *     expectedRPID and MUST reject verified:false results.
 *   - login/verify MUST call verifyAuthenticationResponse with the
 *     same expected-* and MUST reject verified:false results.
 *   - A consumed Redis challenge MUST surface as CHALLENGE_EXPIRED.
 *   - A counter that does not strictly advance MUST surface as
 *     COUNTER_REGRESSION.
 *   - On successful register, the stored public_key MUST be the
 *     library-derived material (not the client echo).
 *
 * Red-first trace: these tests are authored against the POST-FIX
 * contract. Running them against the placeholder webauthnRoutes.ts
 * (pre-BUG-239 fix) yields FAIL on all 5 assertions — see commit
 * body for the captured FAIL log. After applying the fix, all 5
 * PASS. The FAIL→PASS transition is mutation-resistant: reverting
 * the fix re-breaks every test.
 *
 * Standard: ACSC Essential Eight ML3, OWASP ASVS V2.2.2.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// ── Hoisted mocks (MUST precede route import) ────────────────────────────────

vi.mock('../../src/config', () => ({
  config: {
    database: { host: 'localhost', port: 5433, user: 't', password: 't', name: 't', ssl: false, poolMax: 5 },
    jwt: { accessSecret: 'x'.repeat(32), refreshSecret: 'y'.repeat(32), accessTtlMinutes: 60, refreshTtlDays: 7 },
  },
}));

// Knex query-chain mock. Each method returns `this`; terminal operations
// (first, insert, update, count, select) resolve with configurable values.
type QueryMock = {
  firstResult?: unknown;
  insertCapture?: Record<string, unknown>;
  updateCapture?: Record<string, unknown>;
  countResult?: number;
};
const qm: QueryMock = {};
const makeQuery = () => {
  const chain: Record<string, unknown> = {};
  const chainable = ['where', 'whereNull', 'whereNot', 'orderBy', 'select'];
  for (const m of chainable) chain[m] = vi.fn(() => chain);
  chain.first = vi.fn(async (..._cols: string[]) => qm.firstResult);
  chain.insert = vi.fn(async (obj: Record<string, unknown>) => {
    qm.insertCapture = obj;
    return [{ id: 'new-cred-uuid' }];
  });
  chain.update = vi.fn(async (obj: Record<string, unknown>) => {
    qm.updateCapture = obj;
    return 1;
  });
  chain.count = vi.fn(async () => [{ count: String(qm.countResult ?? 1) }]);
  return chain;
};
vi.mock('../../src/db/db', () => ({
  db: vi.fn(() => makeQuery()),
  dbAdmin: vi.fn(() => makeQuery()),
  dbRead: vi.fn(() => makeQuery()),
}));

// In-memory Redis substitute — ONE shared map across all instances so
// putChallenge in one call can be read by takeChallenge in the next.
const redisStore = new Map<string, string>();
vi.mock('../../src/config/redis', () => ({
  redisCache: {
    set: vi.fn(async (k: string, v: string) => {
      redisStore.set(k, v);
      return 'OK';
    }),
    get: vi.fn(async (k: string) => redisStore.get(k) ?? null),
    del: vi.fn(async (k: string) => {
      const had = redisStore.delete(k);
      return had ? 1 : 0;
    }),
  },
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/middleware/authMiddleware', () => ({
  authMiddleware: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    // Inject a fake authenticated user.
    (req as unknown as { user: unknown }).user = {
      id: 'staff-uuid-1',
      email: 'ada@example.com',
      givenName: 'Ada',
      familyName: 'Lovelace',
    };
    (req as unknown as { clinicId: string }).clinicId = 'clinic-uuid-1';
    next();
  },
}));

// Mock @simplewebauthn/server — tests drive verified:true/false + counter.
// vi.mock is hoisted, so the mock module uses vi.hoisted() to share refs
// between the hoisted factory and the test bodies.
const libMock = vi.hoisted(() => ({
  verifyRegistrationResponse: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));
vi.mock('@simplewebauthn/server', () => libMock);

// ── App + error middleware ───────────────────────────────────────────────────

import webauthnRouter from '../../src/features/auth/webauthnRoutes';
import { toErrorResponse } from '../../src/shared/errors';

function makeApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/auth', webauthnRouter);
  // Mirror real error middleware so HttpError surfaces as JSON.
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const { status, body } = toErrorResponse(err);
    res.status(status).json(body);
  });
  return app;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// Populate Redis with a challenge for the fake authenticated user.
async function seedRegChallenge(app: express.Express, _challenge = 'challenge-xyz'): Promise<string> {
  const res = await request(app).post('/auth/webauthn/register/options').send({});
  expect(res.status).toBe(200);
  return res.body.challenge as string;
}

async function seedLoginChallenge(
  app: express.Express,
  email = 'ada@example.com',
): Promise<string> {
  // /webauthn/login/options reads staff + credentials via dbAdmin, so seed
  // the mock state for this path.
  qm.firstResult = { id: 'staff-uuid-1', clinic_id: 'clinic-uuid-1' };
  // The route also calls select on credentials — route uses `.select(...)` which
  // resolves as an array; hijack via the chain’s terminal by returning the
  // same mock array from `select`. Easiest: return credentials list through
  // a one-shot override on `select`.
  // We handle this by replacing the dbAdmin factory just for this call.
  const { dbAdmin } = await import('../../src/db/db');
  const credChain = makeQuery();
  credChain.select = vi.fn(async () => [{ credential_id: 'cred-123', transports: null }]);
  // Sequentially: first call → staff lookup, second call → credentials.
  (dbAdmin as unknown as { mockImplementationOnce: (f: () => unknown) => void })
    .mockImplementationOnce(() => {
      const staffChain = makeQuery();
      staffChain.first = vi.fn(async () => ({ id: 'staff-uuid-1', clinic_id: 'clinic-uuid-1' }));
      return staffChain;
    });
  (dbAdmin as unknown as { mockImplementationOnce: (f: () => unknown) => void })
    .mockImplementationOnce(() => credChain);

  const res = await request(app).post('/auth/webauthn/login/options').send({ email });
  expect(res.status).toBe(200);
  return res.body.challenge as string;
}

function validRegPayload(): Record<string, unknown> {
  return {
    credential: {
      id: 'cred-123',
      rawId: 'cred-123',
      type: 'public-key',
      response: {
        clientDataJSON: 'clientDataJSON-b64u',
        attestationObject: 'attestationObject-b64u',
      },
    },
    deviceName: 'Test Key',
  };
}

function validLoginPayload(): Record<string, unknown> {
  return {
    email: 'ada@example.com',
    credential: {
      id: 'cred-123',
      rawId: 'cred-123',
      type: 'public-key',
      response: {
        clientDataJSON: 'clientDataJSON-b64u',
        authenticatorData: 'authenticatorData-b64u',
        signature: 'signature-b64u',
        userHandle: 'user-handle-b64u',
      },
    },
  };
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  redisStore.clear();
  qm.firstResult = undefined;
  qm.insertCapture = undefined;
  qm.updateCapture = undefined;
  qm.countResult = 1;
  libMock.verifyRegistrationResponse.mockReset();
  libMock.verifyAuthenticationResponse.mockReset();
  process.env.WEBAUTHN_RP_ID = 'localhost';
  process.env.WEBAUTHN_ORIGIN = 'http://localhost:3000';
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('BUG-239 — WebAuthn register/verify', () => {
  it('calls verifyRegistrationResponse with expected challenge, origin, and RP ID', async () => {
    const app = makeApp();
    const challenge = await seedRegChallenge(app);

    libMock.verifyRegistrationResponse.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: 'LIB-DERIVED-CRED-ID',
          publicKey: new Uint8Array([1, 2, 3, 4]),
          counter: 0,
        },
        aaguid: '00000000-0000-0000-0000-000000000000',
        credentialBackedUp: false,
        credentialDeviceType: 'singleDevice',
        fmt: 'none',
      },
    });

    const res = await request(app).post('/auth/webauthn/register/verify').send(validRegPayload());

    expect(res.status).toBe(200);
    expect(libMock.verifyRegistrationResponse).toHaveBeenCalledTimes(1);
    const args = libMock.verifyRegistrationResponse.mock.calls[0][0] as {
      expectedChallenge: string;
      expectedOrigin: string | string[];
      expectedRPID: string | string[];
    };
    expect(args.expectedChallenge).toBe(challenge);
    expect(args.expectedOrigin).toEqual(['http://localhost:3000']);
    expect(args.expectedRPID).toBe('localhost');
  });

  it('stores library-derived publicKey + credential_id (NOT the client echo) — tamper-resistance', async () => {
    const app = makeApp();
    await seedRegChallenge(app);

    libMock.verifyRegistrationResponse.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: 'LIB-DERIVED-CRED-ID',
          publicKey: new Uint8Array([0xca, 0xfe, 0xba, 0xbe]),
          counter: 7,
        },
        aaguid: 'aa-gu-id',
        credentialBackedUp: false,
        credentialDeviceType: 'singleDevice',
        fmt: 'none',
      },
    });

    const res = await request(app).post('/auth/webauthn/register/verify').send(validRegPayload());

    expect(res.status).toBe(200);
    // The INSERT must capture the library-derived material, NOT the client's
    // `id` field or client-echoed response. If the fix stores
    // JSON.stringify(credential.response) (the placeholder behaviour), this
    // assertion fails — that is the silent-MFA-bypass regression.
    expect(qm.insertCapture).toBeDefined();
    expect(qm.insertCapture!.credential_id).toBe('LIB-DERIVED-CRED-ID');
    expect(qm.insertCapture!.credential_id).not.toBe('cred-123'); // client echo rejected
    expect(qm.insertCapture!.counter).toBe(7);
    expect(qm.insertCapture!.clinic_id).toBe('clinic-uuid-1'); // §1.6 RLS
    // public_key should be the base64url-encoded library bytes.
    const expectedPk = Buffer.from([0xca, 0xfe, 0xba, 0xbe]).toString('base64url');
    expect(qm.insertCapture!.public_key).toBe(expectedPk);
  });

  it('tamper rejected — verifyRegistrationResponse returns verified:false → 401, no INSERT', async () => {
    const app = makeApp();
    await seedRegChallenge(app);

    libMock.verifyRegistrationResponse.mockResolvedValue({ verified: false });

    const res = await request(app).post('/auth/webauthn/register/verify').send(validRegPayload());

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_CREDENTIAL');
    expect(qm.insertCapture).toBeUndefined(); // nothing written
  });
});

describe('BUG-239 — WebAuthn login/verify', () => {
  it('replay rejected — challenge consumed on first use → CHALLENGE_EXPIRED on second', async () => {
    const app = makeApp();
    // First request consumes the challenge; second replay submits the same
    // body and must be rejected as CHALLENGE_EXPIRED because takeChallenge
    // does GET+DEL atomically (not due to library replay logic).
    await seedLoginChallenge(app);

    // Seed DB mocks for the FIRST verify (staff + stored credential).
    const { dbAdmin } = await import('../../src/db/db');
    const setupVerifyMocks = () => {
      (dbAdmin as unknown as { mockImplementationOnce: (f: () => unknown) => void })
        .mockImplementationOnce(() => {
          const c = makeQuery();
          c.first = vi.fn(async () => ({ id: 'staff-uuid-1', clinic_id: 'clinic-uuid-1' }));
          return c;
        });
      (dbAdmin as unknown as { mockImplementationOnce: (f: () => unknown) => void })
        .mockImplementationOnce(() => {
          const c = makeQuery();
          c.first = vi.fn(async () => ({
            id: 'row-uuid',
            credential_id: 'cred-123',
            public_key: Buffer.from([1, 2, 3, 4]).toString('base64url'),
            counter: 5,
          }));
          return c;
        });
      (dbAdmin as unknown as { mockImplementationOnce: (f: () => unknown) => void })
        .mockImplementationOnce(() => makeQuery()); // counter update
    };
    setupVerifyMocks();
    libMock.verifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: { credentialID: 'cred-123', newCounter: 6, userVerified: true, credentialDeviceType: 'singleDevice', credentialBackedUp: false, origin: 'http://localhost:3000', rpID: 'localhost' },
    });

    const first = await request(app).post('/auth/webauthn/login/verify').send(validLoginPayload());
    expect(first.status).toBe(200);

    // Replay: challenge is gone, route should short-circuit with CHALLENGE_EXPIRED
    // BEFORE reaching the library or the DB.
    const replay = await request(app).post('/auth/webauthn/login/verify').send(validLoginPayload());
    expect(replay.status).toBe(400);
    expect(replay.body.code).toBe('CHALLENGE_EXPIRED');
  });

  it('tamper rejected — verifyAuthenticationResponse returns verified:false → 401, counter unchanged', async () => {
    const app = makeApp();
    await seedLoginChallenge(app);

    const { dbAdmin } = await import('../../src/db/db');
    (dbAdmin as unknown as { mockImplementationOnce: (f: () => unknown) => void })
      .mockImplementationOnce(() => {
        const c = makeQuery();
        c.first = vi.fn(async () => ({ id: 'staff-uuid-1', clinic_id: 'clinic-uuid-1' }));
        return c;
      });
    (dbAdmin as unknown as { mockImplementationOnce: (f: () => unknown) => void })
      .mockImplementationOnce(() => {
        const c = makeQuery();
        c.first = vi.fn(async () => ({
          id: 'row-uuid',
          credential_id: 'cred-123',
          public_key: Buffer.from([1, 2, 3, 4]).toString('base64url'),
          counter: 5,
        }));
        return c;
      });

    libMock.verifyAuthenticationResponse.mockResolvedValue({ verified: false, authenticationInfo: undefined });

    const res = await request(app).post('/auth/webauthn/login/verify').send(validLoginPayload());

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_CREDENTIAL');
    // No counter update should have happened — qm.updateCapture stays undefined
    // because only the register/login success branches call .update().
    expect(qm.updateCapture).toBeUndefined();
  });

  it('counter regression rejected — library verified:true but newCounter ≤ stored.counter → 401 COUNTER_REGRESSION', async () => {
    const app = makeApp();
    await seedLoginChallenge(app);

    const { dbAdmin } = await import('../../src/db/db');
    (dbAdmin as unknown as { mockImplementationOnce: (f: () => unknown) => void })
      .mockImplementationOnce(() => {
        const c = makeQuery();
        c.first = vi.fn(async () => ({ id: 'staff-uuid-1', clinic_id: 'clinic-uuid-1' }));
        return c;
      });
    (dbAdmin as unknown as { mockImplementationOnce: (f: () => unknown) => void })
      .mockImplementationOnce(() => {
        const c = makeQuery();
        c.first = vi.fn(async () => ({
          id: 'row-uuid',
          credential_id: 'cred-123',
          public_key: Buffer.from([1, 2, 3, 4]).toString('base64url'),
          counter: 10,
        }));
        return c;
      });

    libMock.verifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: {
        credentialID: 'cred-123',
        newCounter: 5, // REGRESSION — below stored counter
        userVerified: true,
        credentialDeviceType: 'singleDevice',
        credentialBackedUp: false,
        origin: 'http://localhost:3000',
        rpID: 'localhost',
      },
    });

    const res = await request(app).post('/auth/webauthn/login/verify').send(validLoginPayload());

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('COUNTER_REGRESSION');
    expect(qm.updateCapture).toBeUndefined();
  });
});
