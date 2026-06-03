// apps/api/src/routes/health.ts
import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { db } from '../db/db';
import { redis } from '../config/redis';
import { logger } from '../utils/logger';
// Audit Tier 7.2 (MED-I2) — /health/integrations admin-gated view.
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRoles } from '../middleware/rbacMiddleware';
// BUG-042 — graceful-shutdown readiness short-circuit.
import { isReady as gsIsReady } from '../shared/gracefulShutdown';

const router = Router();

// GET /health — shallow liveness probe
router.get('/health', (_req: Request, res: Response): void => {
  res.json({
    status: 'ok',
    service: 'signacare-api',
    timestamp: new Date().toISOString(),
  });
});

// GET /ready — deep readiness probe
router.get(
  '/ready',
  async (_req: Request, res: Response): Promise<void> => {
    // BUG-042 — short-circuit to 503 when graceful shutdown is in
    // progress. k8s / ECS readiness probe sees this immediately and
    // stops routing traffic BEFORE the in-flight drain proceeds.
    if (!gsIsReady()) {
      res.status(503).json({ status: 'draining', reason: 'graceful_shutdown_in_progress' });
      return;
    }
    const checks: Record<string, 'ok' | 'error'> = {};
    let httpStatus = 200;

    // PostgreSQL check
    try {
      await db.raw('SELECT 1');
      checks.postgres = 'ok';
    } catch (err) {
      checks.postgres = 'error';
      httpStatus = 503;
      logger.warn(
        { err, check: 'postgres' },
        'Readiness check: postgres unavailable',
      );
    }

    // S4.4 — Read replica check (BUG-042 consolidation: moved from
    // server.ts duplicate /ready). Only runs when DB_REPLICA_HOST is
    // configured. When the replica is unreachable the primary is
    // still usable (dbRead falls back to primary pool via the proxy
    // in db.ts), so flag as 'degraded' by default. DB_REPLICA_REQUIRED=true
    // promotes the replica to a hard readiness gate.
    if (process.env.DB_REPLICA_HOST) {
      try {
        const { dbRead } = await import('../db/db');
        await dbRead.raw('SELECT 1');
        (checks as Record<string, string>).db_replica = 'ok';
      } catch {
        (checks as Record<string, string>).db_replica = 'error';
        if (process.env.DB_REPLICA_REQUIRED === 'true') {
          httpStatus = 503;
        }
      }
    } else {
      (checks as Record<string, string>).db_replica = 'not_configured';
    }

    // Redis check
    try {
      await redis.ping();
      checks.redis = 'ok';
    } catch (err) {
      checks.redis = 'error';
      httpStatus = 503;
      logger.warn(
        { err, check: 'redis' },
        'Readiness check: redis unavailable',
      );
    }

    res.status(httpStatus).json({
      status: httpStatus === 200 ? 'ready' : 'not_ready',
      checks,
      timestamp: new Date().toISOString(),
    });
  },
);

// Audit Tier 7.2 (MED-I2) — admin-only integration health view.
// Each integration module exposes its own `healthCheck()` if it has
// one; this endpoint calls each and returns a uniform status map.
// Admin/superadmin only because status includes operational details
// (URLs, last-error strings) that shouldn't leak to non-admin users.
interface IntegrationHealthEntry {
  status: 'OK' | 'UNCONFIGURED' | 'UNREACHABLE' | 'ERROR';
  lastCheckedAt: string;
  error?: string;
}

async function integrationHealthSnapshot(): Promise<Record<string, IntegrationHealthEntry>> {
  const now = new Date().toISOString();
  const out: Record<string, IntegrationHealthEntry> = {};

  // Pathology (HL7 MLLP outbound queue health — BullMQ queue state).
  try {
    const { Queue } = await import('bullmq');
    const q = new Queue('hl7-outbound', {
      connection: { host: process.env['REDIS_HOST'] ?? 'localhost', port: 6379 },
    });
    const [waiting, active, failed] = await Promise.all([
      q.getWaitingCount(),
      q.getActiveCount(),
      q.getFailedCount(),
    ]);
    await q.close();
    out.pathology = {
      status: failed > 10 ? 'ERROR' : 'OK',
      lastCheckedAt: now,
      error: failed > 10 ? `${failed} failed jobs — manual review required` : undefined,
    };
    (out.pathology as IntegrationHealthEntry & { queue?: unknown }).queue = { waiting, active, failed };
  } catch (err) {
    out.pathology = { status: 'ERROR', lastCheckedAt: now, error: err instanceof Error ? err.message : String(err) };
  }

  // NPDS (eScript PBS subsidy lookup).
  try {
    const npds = await import('../integrations/escript/npdsClient');
    out.npds = {
      status: npds.isNpdsConfigured ? (npds.isNpdsConfigured() ? 'OK' : 'UNCONFIGURED') : 'ERROR',
      lastCheckedAt: now,
    };
  } catch (err) {
    out.npds = { status: 'ERROR', lastCheckedAt: now, error: err instanceof Error ? err.message : String(err) };
  }

  // eRx Adapter.
  try {
    const erx = await import('../integrations/escript/erxAdapterClient');
    out.erx = {
      status: erx.isErxAdapterConfigured() ? 'OK' : 'UNCONFIGURED',
      lastCheckedAt: now,
    };
  } catch (err) {
    out.erx = { status: 'ERROR', lastCheckedAt: now, error: err instanceof Error ? err.message : String(err) };
  }

  // HI Service (IHI / HPI-I).
  try {
    const hi = await import('../integrations/hiService/hiServiceClient');
    out.hiService = {
      status: hi.isHiServiceConfigured() ? 'OK' : 'UNCONFIGURED',
      lastCheckedAt: now,
    };
  } catch (err) {
    out.hiService = { status: 'ERROR', lastCheckedAt: now, error: err instanceof Error ? err.message : String(err) };
  }

  // NHSD (provider directory).
  try {
    const nhsd = await import('../integrations/nhsd/nhsdClient');
    out.nhsd = {
      status: nhsd.isNhsdConfigured() ? 'OK' : 'UNCONFIGURED',
      lastCheckedAt: now,
    };
  } catch (err) {
    out.nhsd = { status: 'ERROR', lastCheckedAt: now, error: err instanceof Error ? err.message : String(err) };
  }

  // SMS gateway (patient-outreach token delivery).
  out.sms = {
    status: process.env['SMS_GATEWAY_URL'] && process.env['SMS_GATEWAY_API_KEY'] ? 'OK' : 'UNCONFIGURED',
    lastCheckedAt: now,
  };

  // Ollama (AI scribe / letters / chat).
  try {
    const base = process.env['OLLAMA_URL'] ?? 'http://localhost:11434';
    const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(3000) });
    out.ollama = {
      status: res.ok ? 'OK' : 'UNREACHABLE',
      lastCheckedAt: now,
      error: res.ok ? undefined : `HTTP ${res.status}`,
    };
  } catch (err) {
    out.ollama = { status: 'UNREACHABLE', lastCheckedAt: now, error: err instanceof Error ? err.message : String(err) };
  }

  // Whisper (ambient scribe transcription).
  try {
    const base = process.env['WHISPER_API_URL'] ?? 'http://localhost:8080';
    const res = await fetch(`${base}/`, { signal: AbortSignal.timeout(3000) });
    out.whisper = {
      status: res.ok ? 'OK' : 'UNREACHABLE',
      lastCheckedAt: now,
      error: res.ok ? undefined : `HTTP ${res.status}`,
    };
  } catch (err) {
    out.whisper = { status: 'UNREACHABLE', lastCheckedAt: now, error: err instanceof Error ? err.message : String(err) };
  }

  // Audit Tier 8 — Major missing integration skeletons. Each client's
  // healthCheck() reports UNCONFIGURED until the clinic provisions
  // real credentials + external partner sign-off; the feature flag
  // (integration-*) remains off by default.
  try {
    const radiology = await import('../integrations/radiology/radiologyClient');
    out.radiology = await radiology.healthCheck();
  } catch (err) {
    out.radiology = { status: 'ERROR', lastCheckedAt: now, error: err instanceof Error ? err.message : String(err) };
  }
  try {
    const hl = await import('../integrations/healthlink/healthLinkClient');
    out.healthlink = await hl.healthCheck();
  } catch (err) {
    out.healthlink = { status: 'ERROR', lastCheckedAt: now, error: err instanceof Error ? err.message : String(err) };
  }
  try {
    const eclipse = await import('../integrations/medicare/eclipseClient');
    out.medicareEclipse = await eclipse.healthCheck();
  } catch (err) {
    out.medicareEclipse = { status: 'ERROR', lastCheckedAt: now, error: err instanceof Error ? err.message : String(err) };
  }
  try {
    const mhr = await import('../integrations/mhr/mhrDocumentClient');
    out.mhrDocument = await mhr.healthCheck();
  } catch (err) {
    out.mhrDocument = { status: 'ERROR', lastCheckedAt: now, error: err instanceof Error ? err.message : String(err) };
  }

  return out;
}

router.get(
  '/health/integrations',
  authMiddleware,
  requireRoles(['admin', 'superadmin']),
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const snapshot = await integrationHealthSnapshot();
      res.json({ integrations: snapshot, timestamp: new Date().toISOString() });
    } catch (err) { next(err); }
  },
);

export default router;
