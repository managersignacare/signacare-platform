/**
 * apps/api/src/features/reports/complianceDashboardRoutes.ts
 *
 * BI / compliance dashboard for admins + managers.
 *
 *   GET /api/v1/reports/compliance/summary
 *
 * Returns a single object with every metric a compliance officer
 * would look at in a typical weekly review. No new tables, no new
 * ETL layer — the dashboard reads directly from the same
 * tamper-evident sources the rest of the app already writes to:
 *
 *   - audit_log       (forbidden access + break-glass + writes)
 *   - patient_outreach_log (consent + skip rate + override usage)
 *   - patient_flags   (LAI overdue, clozapine flags)
 *   - legal_orders    (MHA expiring soon)
 *   - staff           (failed-login + locked accounts)
 *   - patients        (SMS consent coverage)
 *   - staff_module_access (per-module grant coverage)
 *
 * Gated behind requireModuleRead(MODULE_KEYS.REPORTS_BI) which
 * falls back to the existing `report:read` RBAC permission — so
 * any staff with the manager / admin / superadmin role already
 * passes without an explicit grant. A clinic admin can still
 * explicitly deny an individual with an access_level='none' row.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/authMiddleware';
import { tenantMiddleware } from '../../middleware/tenantMiddleware';
import { requireModuleRead } from '../../middleware/moduleAccessMiddleware';
import { MODULE_KEYS } from '../../shared/moduleKeys';
import { db } from '../../db/db';
import { ALL_MODULE_KEYS } from '../../shared/moduleKeys';
import { AppError } from '../../shared/errors';
import { getGracefulShutdownObservabilitySnapshot } from '../../shared/gracefulShutdown';

const router = Router();
router.use(authMiddleware, tenantMiddleware);
const requireReportsBiRead = requireModuleRead(MODULE_KEYS.REPORTS_BI);
router.use('/compliance', requireReportsBiRead);
router.use('/llm-bypass-audit', requireReportsBiRead);

// ── Dashboard shape ───────────────────────────────────────────────────

interface ComplianceSummary {
  clinicId: string;
  generatedAt: string;
  governance: {
    forbiddenAccessLast7Days: number;
    breakGlassLast30Days: number;
    llmBypassLast30Days: number;
    llmBypassLast90Days: number;
    failedLoginsLast24h: number;
    lockedAccountsNow: number;
  };
  clinicalSafety: {
    laiOverdueCount: number;
    clozapineAmberCount: number;
    clozapineRedCount: number;
    mhaOrdersExpiringNext7Days: number;
  };
  patientEngagement: {
    patientsWithSmsConsent: number;
    patientsWithVivaInstalled: number;
    totalActivePatients: number;
    smsConsentRate: number; // 0..1
    vivaAdoptionRate: number; // 0..1
  };
  outreach: {
    last30DayAttempts: number;
    last30DaySkipped: number;
    skipRate: number; // 0..1
    overrideCount: number;
  };
  accessControl: {
    moduleGrantCoverage: Array<{
      module: string;
      grants: number;
      writeGrants: number;
      explicitDenies: number;
    }>;
  };
  platformReliability: {
    shutdownRunsLast24Hours: number;
    shutdownHookTimeoutsLast24Hours: number;
    shutdownHookFailuresLast24Hours: number;
    maxShutdownHookDurationMsLast24Hours: number;
    lastShutdownTotalDurationMs: number | null;
  };
}

interface LlmBypassAuditEventRow {
  id: string;
  created_at: string;
  staff_id: string | null;
  username: string | null;
  endpoint: string | null;
  feature: string | null;
  role: string | null;
  patient_id: string | null;
  record_id: string | null;
}

interface LlmBypassAuditBreakdownRow {
  staff_id: string | null;
  username: string | null;
  given_name: string | null;
  family_name: string | null;
  endpoint: string | null;
}

const LlmBypassAuditFiltersSchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  staffId: z.string().uuid().optional(),
  endpoint: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const LlmBypassAuditResponseSchema = z.object({
  clinicId: z.string().uuid(),
  generatedAt: z.string(),
  filters: z.object({
    startDate: z.string(),
    endDate: z.string(),
    staffId: z.string().uuid().nullable(),
    endpoint: z.string().nullable(),
    limit: z.number().int().min(1).max(500),
  }),
  rollingCounts: z.object({
    last30Days: z.number().int().min(0),
    last90Days: z.number().int().min(0),
  }),
  totalMatched: z.number().int().min(0),
  breakdown: z.object({
    byStaff: z.array(z.object({
      staffId: z.string().uuid().nullable(),
      staffName: z.string(),
      count: z.number().int().min(0),
    })),
    byEndpoint: z.array(z.object({
      endpoint: z.string(),
      count: z.number().int().min(0),
    })),
  }),
  events: z.array(z.object({
    id: z.string().uuid(),
    createdAt: z.string(),
    staffId: z.string().uuid().nullable(),
    staffName: z.string(),
    endpoint: z.string(),
    feature: z.string().nullable(),
    role: z.string().nullable(),
    patientId: z.string().uuid().nullable(),
    recordId: z.string().nullable(),
  })),
});

const ShutdownObservabilityResponseSchema = z.object({
  generatedAt: z.string(),
  isShuttingDown: z.boolean(),
  runCount: z.number().int().min(0),
  runsLast24Hours: z.number().int().min(0),
  lastRun: z.union([
    z.null(),
    z.object({
      signal: z.string(),
      startedAt: z.string(),
      completedAt: z.string(),
      totalDurationMs: z.number().int().min(0),
      budgetMs: z.number().int().positive(),
      budgetExhausted: z.boolean(),
      hookCount: z.number().int().min(0),
      summary: z.object({
        completed: z.number().int().min(0),
        failed: z.number().int().min(0),
        timedOut: z.number().int().min(0),
        skippedBudget: z.number().int().min(0),
      }),
      hooks: z.array(z.object({
        hookName: z.string(),
        priority: z.number().int(),
        timeoutMs: z.number().int().positive(),
        durationMs: z.number().int().min(0),
        outcome: z.enum(['completed', 'failed', 'timed_out', 'skipped_budget']),
        error: z.string().nullable(),
      })),
    }),
  ]),
  aggregatesLast24Hours: z.object({
    hooksCompleted: z.number().int().min(0),
    hooksFailed: z.number().int().min(0),
    hooksTimedOut: z.number().int().min(0),
    hooksSkippedBudget: z.number().int().min(0),
    avgHookDurationMs: z.number().int().min(0),
    maxHookDurationMs: z.number().int().min(0),
  }),
  perHookLast24Hours: z.array(z.object({
    hookName: z.string(),
    priority: z.number().int(),
    invocations: z.number().int().min(0),
    completed: z.number().int().min(0),
    failed: z.number().int().min(0),
    timedOut: z.number().int().min(0),
    skippedBudget: z.number().int().min(0),
    avgDurationMs: z.number().int().min(0),
    maxDurationMs: z.number().int().min(0),
    maxTimeoutMs: z.number().int().positive(),
  })),
});

function parseOptionalDate(input: string | undefined): Date | null {
  if (!input) return null;
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ── GET /reports/compliance/summary ───────────────────────────────────

router.get('/compliance/summary', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const clinicId = req.clinicId;
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const inSevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    // ── Governance metrics ────────────────────────────────────────────
    // Canonical schema only (audit_log.*_at + clinic_id). Dual-schema
    // COALESCE fallbacks against non-existent legacy columns caused
    // runtime 500s when Postgres parsed the raw SQL.
    const governanceRows = await db('audit_events_canonical')
      .where({ clinic_id: clinicId })
      .select(
        db.raw(
          `COUNT(*) FILTER (
             WHERE created_at > ?
               AND UPPER(COALESCE(operation, action)) IN ('FORBIDDEN', 'FORBIDDEN_ACCESS')
           ) AS forbidden_last_7`,
          [sevenDaysAgo.toISOString()],
        ),
        db.raw(
          `COUNT(*) FILTER (
             WHERE created_at > ?
               AND UPPER(COALESCE(operation, action)) = 'BREAK_GLASS'
           ) AS break_glass_last_30`,
          [thirtyDaysAgo.toISOString()],
        ),
        db.raw(
          `COUNT(*) FILTER (
             WHERE created_at > ?
               AND UPPER(COALESCE(operation, action)) = 'LLM_ACCESS_BYPASS_ROLE'
           ) AS llm_bypass_last_30`,
          [thirtyDaysAgo.toISOString()],
        ),
        db.raw(
          `COUNT(*) FILTER (
             WHERE created_at > ?
               AND UPPER(COALESCE(operation, action)) = 'LLM_ACCESS_BYPASS_ROLE'
           ) AS llm_bypass_last_90`,
          [ninetyDaysAgo.toISOString()],
        ),
      ) as Array<{
        forbidden_last_7: string | number;
        break_glass_last_30: string | number;
        llm_bypass_last_30: string | number;
        llm_bypass_last_90: string | number;
      }>;
    const g = governanceRows[0] ?? {
      forbidden_last_7: 0,
      break_glass_last_30: 0,
      llm_bypass_last_30: 0,
      llm_bypass_last_90: 0,
    };

    const staffRows = await db('staff')
      .where({ clinic_id: clinicId })
      .whereNull('deleted_at')
      .andWhere({ is_active: true })
      .select(
        db.raw(
          `COUNT(*) FILTER (WHERE locked_until IS NOT NULL AND locked_until > now()) AS locked_now`,
        ),
        db.raw(
          `COALESCE(SUM(CASE WHEN updated_at > ? AND failed_login_attempts > 0 THEN failed_login_attempts ELSE 0 END), 0) AS failed_24h`,
          [yesterday.toISOString()],
        ),
      ) as Array<{ locked_now: string | number; failed_24h: string | number }>;
    const s = staffRows[0] ?? { locked_now: 0, failed_24h: 0 };

    // ── Clinical safety metrics ───────────────────────────────────────
    const flagCounts = await db('patient_flags')
      .where({ clinic_id: clinicId, status: 'active' })
      .select('category', 'severity')
      .count<Array<{ category: string; severity: string; count: string }>>('* as count')
      .groupBy('category', 'severity')
      .catch(() => [] as Array<{ category: string; severity: string; count: string }>);

    const laiOverdue = flagCounts
      .filter((f) => f.category === 'lai_overdue')
      .reduce((acc, f) => acc + Number(f.count), 0);

    const clozapineAmber = flagCounts
      .filter((f) => f.category === 'clozapine' && f.severity === 'medium')
      .reduce((acc, f) => acc + Number(f.count), 0);
    const clozapineRed = flagCounts
      .filter((f) => f.category === 'clozapine' && f.severity === 'high')
      .reduce((acc, f) => acc + Number(f.count), 0);

    const mhaExpiring = await db('legal_orders')
      .where({ clinic_id: clinicId, status: 'active' })
      .where('expires_at', '>=', now.toISOString().split('T')[0])
      .where('expires_at', '<=', inSevenDays.toISOString().split('T')[0])
      .count<Array<{ count: string | number }>>('* as count')
      .first()
      .catch(() => ({ count: 0 } as { count: number }));

    // ── Patient engagement metrics ────────────────────────────────────
    const patientCounts = await db('patients')
      .where({ clinic_id: clinicId })
      .whereNull('deleted_at')
      .select(
        db.raw('COUNT(*) AS total'),
        db.raw("COUNT(*) FILTER (WHERE sms_consent = true) AS with_sms_consent"),
      ) as Array<{ total: string | number; with_sms_consent: string | number }>;
    const p = patientCounts[0] ?? { total: 0, with_sms_consent: 0 };

    const fcmPatients = await db('patient_fcm_tokens')
      .where({ clinic_id: clinicId })
      .countDistinct<Array<{ count: string | number }>>('patient_app_account_id as count')
      .first()
      .catch(() => ({ count: 0 } as { count: number }));

    const totalActive = Number(p.total);
    const smsConsentRate = totalActive > 0 ? Number(p.with_sms_consent) / totalActive : 0;
    const vivaAdoptionRate = totalActive > 0 ? Number(fcmPatients?.count ?? 0) / totalActive : 0;

    // ── Outreach metrics ──────────────────────────────────────────────
    const outreachRows = await db('patient_outreach_log')
      .where({ clinic_id: clinicId })
      .where('attempted_at', '>', thirtyDaysAgo.toISOString())
      .select(
        db.raw('COUNT(*) AS attempts'),
        db.raw("COUNT(*) FILTER (WHERE channel = 'skipped') AS skipped"),
        db.raw('COUNT(*) FILTER (WHERE override_channel IS NOT NULL) AS overrides'),
      )
      .catch(() => [] as Array<{ attempts: number; skipped: number; overrides: number }>);
    const or = outreachRows[0] ?? { attempts: 0, skipped: 0, overrides: 0 };
    const attempts = Number(or.attempts);
    const skipped = Number(or.skipped);
    const skipRate = attempts > 0 ? skipped / attempts : 0;

    // ── Access control metrics ────────────────────────────────────────
    const grantRows = await db('staff_module_access')
      .where({ clinic_id: clinicId })
      .select('module', 'access_level')
      .count<Array<{ module: string; access_level: string; count: string }>>('* as count')
      .groupBy('module', 'access_level') as Array<{ module: string; access_level: string; count: string }>;

    const coverageMap = new Map<string, { grants: number; writeGrants: number; explicitDenies: number }>();
    for (const key of ALL_MODULE_KEYS) {
      coverageMap.set(key, { grants: 0, writeGrants: 0, explicitDenies: 0 });
    }
    for (const row of grantRows) {
      const entry = coverageMap.get(row.module) ?? { grants: 0, writeGrants: 0, explicitDenies: 0 };
      const count = Number(row.count);
      entry.grants += count;
      if (row.access_level === 'write' || row.access_level === 'full') entry.writeGrants += count;
      if (row.access_level === 'none') entry.explicitDenies += count;
      coverageMap.set(row.module, entry);
    }

    const moduleGrantCoverage = Array.from(coverageMap.entries())
      .map(([module, v]) => ({ module, ...v }))
      .sort((a, b) => a.module.localeCompare(b.module));

    // ── Assemble response ────────────────────────────────────────────
    const summary: ComplianceSummary = {
      clinicId,
      generatedAt: now.toISOString(),
      governance: {
        forbiddenAccessLast7Days: Number(g.forbidden_last_7),
        breakGlassLast30Days: Number(g.break_glass_last_30),
        llmBypassLast30Days: Number(g.llm_bypass_last_30),
        llmBypassLast90Days: Number(g.llm_bypass_last_90),
        failedLoginsLast24h: Number(s.failed_24h),
        lockedAccountsNow: Number(s.locked_now),
      },
      clinicalSafety: {
        laiOverdueCount: laiOverdue,
        clozapineAmberCount: clozapineAmber,
        clozapineRedCount: clozapineRed,
        mhaOrdersExpiringNext7Days: Number(mhaExpiring?.count ?? 0),
      },
      patientEngagement: {
        patientsWithSmsConsent: Number(p.with_sms_consent),
        patientsWithVivaInstalled: Number(fcmPatients?.count ?? 0),
        totalActivePatients: totalActive,
        smsConsentRate,
        vivaAdoptionRate,
      },
      outreach: {
        last30DayAttempts: attempts,
        last30DaySkipped: skipped,
        skipRate,
        overrideCount: Number(or.overrides),
      },
      accessControl: {
        moduleGrantCoverage,
      },
      platformReliability: {
        shutdownRunsLast24Hours: 0,
        shutdownHookTimeoutsLast24Hours: 0,
        shutdownHookFailuresLast24Hours: 0,
        maxShutdownHookDurationMsLast24Hours: 0,
        lastShutdownTotalDurationMs: null,
      },
    };

    const shutdownObs = getGracefulShutdownObservabilitySnapshot(now);
    summary.platformReliability.shutdownRunsLast24Hours = shutdownObs.runsLast24Hours;
    summary.platformReliability.shutdownHookTimeoutsLast24Hours = shutdownObs.aggregatesLast24Hours.hooksTimedOut;
    summary.platformReliability.shutdownHookFailuresLast24Hours = shutdownObs.aggregatesLast24Hours.hooksFailed;
    summary.platformReliability.maxShutdownHookDurationMsLast24Hours = shutdownObs.aggregatesLast24Hours.maxHookDurationMs;
    summary.platformReliability.lastShutdownTotalDurationMs = shutdownObs.lastRun?.totalDurationMs ?? null;

    res.json(summary);
  } catch (err) { next(err); }
});

// ── GET /reports/llm-bypass-audit ─────────────────────────────────────
// BUG-326 — governance dashboard surface for LLM_ACCESS_BYPASS_ROLE rows.
// R-FIX-LLM-BYPASS-DASHBOARD
router.get('/llm-bypass-audit', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = LlmBypassAuditFiltersSchema.safeParse(req.query);
    if (!parsed.success) {
      return next(new AppError('Invalid LLM bypass audit filters', 400, 'VALIDATION_ERROR', parsed.error.flatten()));
    }

    const clinicId = req.clinicId;
    const now = new Date();
    const rawStartDate = parsed.data.startDate;
    const rawEndDate = parsed.data.endDate;
    const startDate = parseOptionalDate(rawStartDate) ?? new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const endDate = parseOptionalDate(rawEndDate) ?? now;

    if ((rawStartDate && !parseOptionalDate(rawStartDate)) || (rawEndDate && !parseOptionalDate(rawEndDate))) {
      return next(new AppError('Invalid date range', 400, 'VALIDATION_ERROR', {
        startDate: rawStartDate ?? null,
        endDate: rawEndDate ?? null,
      }));
    }

    if (startDate > endDate) {
      return next(new AppError('startDate must be <= endDate', 400, 'VALIDATION_ERROR'));
    }

    const limit = parsed.data.limit ?? 100;
    const staffIdFilter = parsed.data.staffId ?? null;
    const endpointFilter = parsed.data.endpoint ?? null;

    const base = db('audit_events_canonical as al')
      .where('al.clinic_id', clinicId)
      .whereRaw("UPPER(COALESCE(al.operation, al.action)) = 'LLM_ACCESS_BYPASS_ROLE'");

    const filteredForWindow = base.clone();
    if (staffIdFilter) {
      filteredForWindow.whereRaw('COALESCE(al.staff_id, al.user_id) = ?', [staffIdFilter]);
    }
    if (endpointFilter) {
      filteredForWindow.whereRaw("COALESCE(al.new_data->>'endpoint', '') = ?", [endpointFilter]);
    }
    filteredForWindow
      .where('al.created_at', '>=', startDate.toISOString())
      .where('al.created_at', '<=', endDate.toISOString());

    const totalMatchedRow = await filteredForWindow.clone().count<Array<{ count: string | number }>>('* as count').first();
    const totalMatched = Number(totalMatchedRow?.count ?? 0);

    const events = await filteredForWindow
      .clone()
      .leftJoin('staff as s', db.raw('s.id = COALESCE(al.staff_id, al.user_id)'))
      .select<LlmBypassAuditEventRow[]>(
        'al.id',
        'al.created_at',
        db.raw('COALESCE(al.staff_id, al.user_id) as staff_id'),
        db.raw("COALESCE(s.given_name || ' ' || s.family_name, al.username, 'System') as username"),
        db.raw("NULLIF(al.new_data->>'endpoint', '') as endpoint"),
        db.raw("NULLIF(al.new_data->>'feature', '') as feature"),
        db.raw("NULLIF(al.new_data->>'role', '') as role"),
        db.raw("NULLIF(al.new_data->>'patientId', '') as patient_id"),
        db.raw("al.record_id::text as record_id"),
      )
      .orderBy('al.created_at', 'desc')
      .limit(limit);

    const nowIso = now.toISOString();
    const last30Iso = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const last90Iso = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();

    const rollingBase = base.clone();
    if (staffIdFilter) {
      rollingBase.whereRaw('COALESCE(al.staff_id, al.user_id) = ?', [staffIdFilter]);
    }
    if (endpointFilter) {
      rollingBase.whereRaw("COALESCE(al.new_data->>'endpoint', '') = ?", [endpointFilter]);
    }
    const rolling30Row = await rollingBase
      .clone()
      .where('al.created_at', '>=', last30Iso)
      .where('al.created_at', '<=', nowIso)
      .count<Array<{ count: string | number }>>('* as count')
      .first();
    const rolling90Row = await rollingBase
      .clone()
      .where('al.created_at', '>=', last90Iso)
      .where('al.created_at', '<=', nowIso)
      .count<Array<{ count: string | number }>>('* as count')
      .first();

    const breakdownRows = await filteredForWindow
      .clone()
      .leftJoin('staff as s', db.raw('s.id = COALESCE(al.staff_id, al.user_id)'))
      .select<LlmBypassAuditBreakdownRow[]>(
        db.raw('COALESCE(al.staff_id, al.user_id) as staff_id'),
        db.raw('al.username as username'),
        db.raw('s.given_name as given_name'),
        db.raw('s.family_name as family_name'),
        db.raw("NULLIF(al.new_data->>'endpoint', '') as endpoint"),
      );

    const staffCountMap = new Map<string, { staffId: string | null; staffName: string; count: number }>();
    const endpointCountMap = new Map<string, number>();

    for (const row of breakdownRows) {
      const staffKey = row.staff_id ?? `system:${row.username ?? 'unknown'}`;
      const staffName = [row.given_name, row.family_name].filter(Boolean).join(' ').trim() || row.username || 'System';
      const currentStaff = staffCountMap.get(staffKey);
      if (currentStaff) {
        currentStaff.count += 1;
      } else {
        staffCountMap.set(staffKey, {
          staffId: row.staff_id,
          staffName,
          count: 1,
        });
      }

      const endpointKey = row.endpoint ?? 'unknown';
      endpointCountMap.set(endpointKey, (endpointCountMap.get(endpointKey) ?? 0) + 1);
    }

    const byStaff = Array.from(staffCountMap.values()).sort((a, b) => b.count - a.count);
    const byEndpoint = Array.from(endpointCountMap.entries())
      .map(([endpoint, count]) => ({ endpoint, count }))
      .sort((a, b) => b.count - a.count);
    const normalizeCreatedAt = (value: unknown): string => {
      if (Object.prototype.toString.call(value) === '[object Date]') {
        return (value as Date).toISOString();
      }
      const parsed = new Date(String(value));
      return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
    };

    const payload = {
      clinicId,
      generatedAt: nowIso,
      filters: {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        staffId: staffIdFilter,
        endpoint: endpointFilter,
        limit,
      },
      rollingCounts: {
        last30Days: Number(rolling30Row?.count ?? 0),
        last90Days: Number(rolling90Row?.count ?? 0),
      },
      totalMatched,
      breakdown: {
        byStaff,
        byEndpoint,
      },
      events: events.map((row) => ({
        id: row.id,
        createdAt: normalizeCreatedAt(row.created_at),
        staffId: row.staff_id,
        staffName: row.username ?? 'System',
        endpoint: row.endpoint ?? 'unknown',
        feature: row.feature ?? null,
        role: row.role ?? null,
        patientId: row.patient_id ?? null,
        recordId: row.record_id ?? null,
      })),
    };

    res.json(LlmBypassAuditResponseSchema.parse(payload));
  } catch (err) {
    next(err);
  }
});

// ── GET /reports/compliance/shutdown-observability ────────────────────
// BUG-308 — shutdown observability dashboard payload. Exposes last-run
// and rolling 24h per-hook duration + timeout metrics from the canonical
// graceful-shutdown registry telemetry.
router.get('/compliance/shutdown-observability', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const payload = getGracefulShutdownObservabilitySnapshot();
    res.json(ShutdownObservabilityResponseSchema.parse(payload));
  } catch (err) {
    next(err);
  }
});

export default router;
