// Prevent unhandled errors from crashing the process
// BUG-267 L4 absorption — route err through sanitizeErrForLogging so
// any PG constraint-violation PHI embedded in err.message/.stack is
// redacted before hitting journald. The sanitizer is a pure function
// (no side effects), safe to call from these very-early handlers.
import { sanitizeErrForLogging as _sanitizeErr } from './utils/sanitizeErrForLogging';
import './shared/installBullmqEvictionWarningPolicy';
process.on('uncaughtException', (err) => {
  const safe = _sanitizeErr(err);
  console.error('[FATAL] Uncaught exception:', safe.message, safe.stack);
  // In production, exit so process manager (PM2/systemd) restarts cleanly.
  // In development, stay alive — killing the server on every unhandled error
  // forces manual restarts and loses developer flow.
  if (process.env.NODE_ENV === 'production') {
    setTimeout(() => process.exit(1), 3000); // 3s grace for log flush
  }
});
process.on('unhandledRejection', (reason) => {
  // reason may or may not be an Error. Only sanitize when it is.
  const safeReason = reason instanceof Error ? _sanitizeErr(reason) : reason;
  console.error('[FATAL] Unhandled rejection:', safeReason);
  // Never exit on unhandled rejections — log and continue.
  // A single failed async operation (DB timeout, bad query) should not
  // take down the entire server and disconnect all other users.
});

// S4.1: load secrets from the configured backend BEFORE any module
// that reads process.env (config.ts validates JWT_ACCESS_SECRET etc.
// at module-load time, so the secrets resolver MUST run first).
// When SECRETS_BACKEND is unset or 'env', this is a no-op and dev
// runs are unchanged.
//
// BUG-366a — the azure_keyvault backend requires async SDK calls.
// For that backend, index.ts awaits loadSecretsAsync() BEFORE
// importing this file, so process.env is already populated by the
// time we reach this line. The sync path is skipped (sync loadSecrets()
// would throw by design since it cannot reach Azure). loadSecrets()
// itself emits a structured `secrets.resolved` event when it runs.
//
// BUG-366a L5 absorb — if server.ts is the entry point (bypassing
// index.ts) AND the backend is azure_keyvault, emit a loud diagnostic.
// This is a deploy-misconfiguration indicator: ops pointed the
// process manager (pm2, docker CMD, systemd ExecStart, etc.) at
// dist/src/server.js instead of dist/src/index.js. We don't auto-
// correct because the right fix is at the deploy layer, not here.
import { loadSecrets, getSecretsBackendName } from './config/secrets';
if (getSecretsBackendName() === 'azure_keyvault') {
  if (!process.env.JWT_ACCESS_SECRET) {
    throw new Error(
      'BUG-366a: SECRETS_BACKEND=azure_keyvault but process.env.JWT_ACCESS_SECRET is unset. ' +
      'This means index.ts was bypassed as the boot entry. ' +
      'Check package.json "start" / Dockerfile CMD / ecosystem.config.js "script" — ' +
      'they must point at dist/src/index.js, not dist/src/server.js.',
    );
  }
  // If we got here with JWT_ACCESS_SECRET set, index.ts already
  // ran loadSecretsAsync and populated process.env. Nothing to do.
} else {
  loadSecrets();
}

// Audit Tier 5.2 (HIGH-G5) — AI data residency boot check. ⚠ BREAKING.
// Aborts boot if any AI-endpoint env var points to a non-localhost /
// non-private-IP host that isn't explicitly whitelisted in
// AI_EXTERNAL_HOSTS. See shared/aiDataResidencyCheck.ts for rules.
import { assertAiDataResidency } from './shared/aiDataResidencyCheck';
assertAiDataResidency();

// S2.2: OpenTelemetry SDK MUST be imported before any instrumented module
// (express, knex, ioredis, http) so the auto-instrumentation can hook into
// their require cache. The module is a no-op when OTEL_EXPORTER_OTLP_ENDPOINT
// is unset, so dev/test runs are unchanged.
import './observability/otel';

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
// BUG-469 L5 absorb-1 — `rateLimit` + `RedisStore` now imported by
// `middleware/rateLimiters.ts` which is the limiter SSoT.
import { redis } from './config/redis';
import * as Sentry from '@sentry/node';
import { errorHandler } from './middleware/errorHandler';
import { flushLoggerSync, logger } from './utils/logger';

import authRoutes from './features/auth/authRoutes';
import appointmentRoutes from './features/appointments/appointmentRoutes';
import episodeRoutes from './features/episode/episodeRoutes';
import clinicalNoteRoutes from './features/clinical-notes/clinicalNote.routes';
import referralRoutes from './features/referrals/referralRoutes';
import taskRoutes from './features/tasks/taskRoutes';
import messageRoutes from './features/messaging/messageRoutes';
import billingRoutes from './features/billing/billingRoutes';
import escalationRoutes from './features/escalations/escalation.routes';
import { riskRoutes, riskPatientRoutes } from './features/risk/risk.routes';
import calendarRoutes from './features/calendar/calendarRoutes';
import calendarIcalPublicRoutes from './features/calendar/calendarIcalPublicRoutes';
import medicationRoutes from './features/medications/medicationRoutes';
import internalMedicineRoutes from './features/internal-medicine/internalMedicineRoutes';
import endocrinologyRoutes from './features/endocrinology/endocrinologyRoutes';
import paediatricsRoutes from './features/paediatrics/paediatricsRoutes';
import obsGyneRoutes from './features/obs-gyne/obsGyneRoutes';
import surgeryRoutes from './features/surgery/surgeryRoutes';
import ectRoutes from './features/ect/ectRoutes';
import tmsRoutes from './features/tms/tmsRoutes';
import oncologyRoutes from './features/oncology/oncologyRoutes';
import telehealthRoutes from './features/telehealth/telehealthRoutes';
import complianceDashboardRoutes from './features/reports/complianceDashboardRoutes';
import notificationRoutes from './features/notifications/notificationRoutes';
import patientOutreachRoutes from './features/patient-outreach/patientOutreachRoutes';
import mobileSyncRoutes from './features/mobile-sync/mobileSyncRoutes';
import importRoutes from './features/imports/importRoutes';
import reallocationRoutes from './features/reallocations/reallocationRoutes';
import laiRoutes from './features/lai/laiScheduleRoutes';
import clozapineRoutes from './features/clozapine/clozapineRoutes';
import pathologyRoutes from './features/pathology/pathologyRoutes';
import correspondenceRoutes from './features/correspondence/correspondenceRoutes';
import settingsRoutes from './features/settings/settingsRoutes';
import powerSettingsRoutes from './features/power-settings/powerSettingsRoutes';
import orgSettingsRoutes from './features/org-settings/orgSettingsRoutes';
import staffSettingsRoutes from './features/staff-settings/staffSettingsRoutes';
import flagRoutes from './features/flags/flag.routes';
import allergyRoutes from './features/allergies/allergies.routes';
import { clinicalReviewRoutes } from './features/clinical-review/clinicalReviewRoutes';
import dashboardRoutes from './features/dashboard/dashboardRoutes';
import voiceRoutes from './features/voice/voiceRoutes';
import llmRoutes from './features/llm/llmRoutes';
import healthRoutes from './routes/health';
import prescriptionRoutes from './features/prescriptions/prescriptionRoutes';
import templateRoutes from './features/templates/template.routes';
import reportsRoutes from './features/reports/reportsRoutes';
import patientRoutes from './features/patients/patientRoutes';
import { legalOrderRoutes } from './features/legal/legalOrderRoutes';
import { staffRouter as staffRoutes } from './features/staff/staffRoutes';
import { clinicRouter as clinicRoutes } from './features/clinic/clinicRoutes';
import { waitlistRoutes } from './features/appointments/waitlistRoutes';
import roleFeatureRoutes from './features/roles/roleFeatureRoutes';

import './jobs/workers/hl7Worker';
import patientAppRoutes from './features/patient-app/patientAppRoutes';
const app = express();

// ── Trust Proxy (required behind Nginx/ALB for correct client IP) ──
const trustProxy = process.env.TRUST_PROXY ?? (process.env.NODE_ENV === 'production' ? '1' : '0');
if (trustProxy === '1' || trustProxy === 'true') {
  app.set('trust proxy', 1);
  logger.info('[Proxy] Trust proxy enabled — client IP from X-Forwarded-For');
}

// ── Sentry Error Monitoring ──
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? 'development',
    release: `signacare-api@${process.env.npm_package_version ?? '1.0.0'}`,
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    // Scrub PHI from error reports — never send patient data to Sentry
    beforeSend(event) {
      if (event.request?.data) {
        const phiFields = ['medicareNumber','ihiNumber','dvaNumber','phoneMobile','phoneHome','emailPrimary','dateOfBirth','givenName','familyName'];
        for (const field of phiFields) {
          if (typeof event.request.data === 'object' && event.request.data && field in event.request.data) {
            (event.request.data as Record<string, unknown>)[field] = '[REDACTED]';
          }
        }
      }
      return event;
    },
  });
  logger.info('[Sentry] Error monitoring enabled');
} else {
  logger.info('[Sentry] Not configured — set SENTRY_DSN to enable');
}

// ── Rate Limiting ──
// BUG-469 L5 absorb-1 — limiters extracted to `middleware/rateLimiters.ts`
// so route files can attach the upload limiter per-handler instead of
// relying on `app.use(prefix, limiter)` mounts that would sweep in
// non-upload routes. See that module for the full SSoT.
let redisAvailable = false;
const isDev = process.env.NODE_ENV === 'development';
// BUG-469 L5 absorb-1 — limiter SSoT lives in middleware/rateLimiters.ts.
import {
  apiLimiter,
  authLimiter,
  patientAuthLimiter,
  uploadLimiter,
  webhookLimiter,
  llmLimiter,
  setRedisAvailable as setRateLimiterRedisAvailable,
} from './middleware/rateLimiters';

// IP allowlisting (set IP_ALLOWLIST env var to enable)
import { ipAllowlistMiddleware } from './middleware/ipAllowlist';
app.use(ipAllowlistMiddleware);

// S2.2: Prometheus metrics — observe latency on every request, expose
// /metrics gated by the IP allowlist (already mounted above). The
// metricsHandler reads from the same registry the middleware writes
// into. Keep this BEFORE route registration so all routes are timed.
import {
  metricsMiddleware,
  metricsHandler,
  startDbPoolMetricsPolling,
  stopDbPoolMetricsPolling,
} from './observability/metrics';
app.use(metricsMiddleware);
app.get('/metrics', metricsHandler);

// HMAC request signing for external integrations
import { verifyHmacSignature } from './middleware/hmacSigning';
app.use('/api/v1/integrations', verifyHmacSignature);

// BUG-469 L5 absorb-1 — narrow per-endpoint authLimiter mounts on the
// credential-issuance verbs only. The earlier blanket `app.use('/api/v1/auth',
// authLimiter)` would have throttled hydration GETs (`/me`, `/csrf`,
// `/mfa/status`, `/webauthn/credentials`, `/break-glass/{active,audit}`)
// in clinics on shared NAT — an availability regression that ops would
// hot-fix by raising AUTH_RATE_LIMIT, re-opening the brute-force gap.
// Defence-in-depth: `authLimiter`'s `skip:` clause also exempts safe
// (GET/HEAD/OPTIONS) methods so any incidental prefix overlap stays
// safe.
app.use('/api/v1/auth/login', authLimiter);
app.use('/api/v1/auth/mfa', authLimiter);                         // mfa/verify, mfa/setup, mfa/confirm, mfa/disable; mfa/status GET is skipped
app.use('/api/v1/auth/refresh', authLimiter);
app.use('/api/v1/auth/change-password', authLimiter);
app.use('/api/v1/auth/verify-mfa-challenge', authLimiter);
app.use('/api/v1/auth/verify-password-challenge', authLimiter);
app.use('/api/v1/auth/break-glass', authLimiter);                 // request, approve, extend, revoke; active/audit GETs skipped
app.use('/api/v1/auth/webauthn/login', authLimiter);              // login/options + login/verify (credential-issuance)
app.use('/api/v1/auth/webauthn/register', authLimiter);           // register/options + register/verify
app.use('/api/v1/admin/impersonate', authLimiter);                // staffId POST + :id/end POST; root GET skipped

// BUG-469 — patient-app brute-force / invite-grinding limiter on the
// two unauthenticated credential surfaces. /login is the password
// vector; /activate is the invite-code-redemption vector.
app.use('/api/v1/patient-app/login', patientAuthLimiter);
app.use('/api/v1/patient-app/activate', patientAuthLimiter);

// BUG-469 — `uploadLimiter` is attached PER-HANDLER in the route files
// (patientRoutes.ts, streamingTranscribeRoutes.ts, llmRoutes.ts,
// referralRoutes.ts). The /imports surface IS upload-only so its
// blanket mount is preserved.
app.use('/api/v1/imports', uploadLimiter);

// BUG-469 — public-webhook IP limiter. Pre-HMAC; layers above the
// per-source DB rate_limit_per_minute cap that runs after HMAC verify.
app.use('/api/v1/webhooks', webhookLimiter);

app.use('/api/v1/llm', llmLimiter);
app.use('/api/', apiLimiter);

// S2.6: CDN domains for CSP allow-listing.
// CDN_HOSTS is a comma-separated list of bare hostnames or origin URLs
// (e.g. "cdn.signacare.com" or "https://d1234abcd.cloudfront.net,https://media.signacare.com").
// Each entry is normalised to a fully-qualified origin that helmet's
// CSP directive accepts. The list is used by script-src, style-src,
// img-src, font-src, and connect-src so a single env var unlocks
// CDN-served bundles, fonts, presigned attachment URLs (S1.1), and any
// future image proxy.
//
// When CDN_HOSTS is unset (the default in dev), the directives stay
// 'self' only — exactly the previous behaviour.
const cdnHosts = (process.env.CDN_HOSTS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((host) => (host.startsWith('http') ? host : `https://${host}`));

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", ...cdnHosts],
        // unsafe-inline is required for MUI/Emotion CSS-in-JS which
        // injects <style> tags at runtime. Only styleSrc has this —
        // scriptSrc does NOT. XSS via CSS injection is theoretical
        // (can't execute JS). Nonce-based CSP would require changes
        // across Vite dev server + nginx prod server for near-zero
        // gain. Reviewed Phase 0.7.1 audit — accepted per OWASP.
        styleSrc: ["'self'", "'unsafe-inline'", ...cdnHosts],
        imgSrc: ["'self'", 'data:', ...cdnHosts],
        fontSrc: ["'self'", 'data:', ...cdnHosts],
        connectSrc: ["'self'", ...cdnHosts, ...(isDev ? ['http://localhost:*'] : [])],
        frameAncestors: ["'self'"],  // Prevent clickjacking
        // BUG-468 — pin defence-in-depth directives EXPLICITLY so a
        // future commit cannot silently drop them by adding
        // `useDefaults: false` to this helmet config. Each directive
        // closes an OWASP A03 (Injection) / A05 (Security Misconfig)
        // attack class. 4 of the 5 are already on the wire today via
        // helmet 8 defaults; pinning them is the regression-trap.
        baseUri: ["'self'"],                  // <base href> rewrite XSS
        objectSrc: ["'none'"],                // <object>/<embed>/<applet> plugin XSS
        formAction: ["'self'"],               // form-action exfil hijack
        upgradeInsecureRequests: [],          // auto-upgrade http: → https:
        // BUG-468 — observability hook. Browsers POST violation reports
        // to this URL; the route is unauthenticated by W3C design and
        // CSRF-exempted at csrfMiddleware.ts. Rate-limited by apiLimiter.
        reportUri: ['/api/v1/csp-report'],
      },
    },
    hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },  // 2 years
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    permittedCrossDomainPolicies: { permittedPolicies: 'none' },
  }),
);

// Per-request correlation ID — must be before all other middleware
// so every log entry and error response includes it.
import { requestIdMiddleware } from './middleware/requestIdMiddleware';
app.use(requestIdMiddleware);

// Additional security headers not covered by helmet
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '0'); // Modern browsers — CSP is preferred
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(self), geolocation=(), payment=()');
  res.removeHeader('X-Powered-By');
  next();
});

app.use(
  cors({
    origin: (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(',').map(o => o.trim()).filter(Boolean),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-Request-Id', 'X-CSRF-Token', 'X-Client', 'Authorization'],
    exposedHeaders: ['X-Request-Id'],
  }),
);

app.use(compression()); // Gzip responses — reduces bandwidth ~70%
// S3.4: capture the raw request body on /webhooks/* so the inbound
// webhook receiver can verify HMAC signatures over the exact bytes the
// partner signed. Stripe's recommended pattern. The verify callback
// runs BEFORE JSON.parse, so req.rawBody is set even when parsing
// fails (signature verification still has bytes to work with).
app.use(
  express.json({
    limit: '2mb',
    verify: (req, _res, buf) => {
      const path = (req as { url?: string }).url ?? '';
      if (path.startsWith('/api/v1/webhooks/') || path.startsWith('/webhooks/')) {
        (req as { rawBody?: Buffer }).rawBody = Buffer.from(buf);
      }
    },
  }),
);
app.use(cookieParser());

// Input sanitization — strip HTML tags from request bodies to prevent stored XSS
import { sanitizeMiddleware } from './middleware/sanitizeMiddleware';
app.use(sanitizeMiddleware);

// Response normalization — snake_case DB columns → camelCase JSON responses
import { camelCaseResponse } from './middleware/camelCaseResponse';
app.use(camelCaseResponse);

// UUID param validation — return 400 instead of 500 for malformed IDs
import { registerUuidValidation } from './middleware/uuidParamMiddleware';
registerUuidValidation(app);

// CSRF protection for cookie-based browser requests
import { csrfMiddleware } from './middleware/csrfMiddleware';
app.use(csrfMiddleware);

// Forbidden-access audit — every 403 response gets written to
// audit_log with action='FORBIDDEN_ACCESS'. Hooks res.on('finish')
// so it catches 403s emitted by ANY downstream middleware
// (rbacMiddleware, ipAllowlist, uploadsTenantGuard, etc.) without
// each one having to call an audit helper explicitly.
// OWASP A09 / Privacy Act APP 11 forensic-discoverability control.
import { forbiddenAccessAudit } from './middleware/forbiddenAccessAudit';
app.use(forbiddenAccessAudit());

// Request timeout — prevent slow requests from holding connections
app.use((req, _res, next) => {
  const isLlm = req.path.includes('/llm/') || req.path.includes('/documents/');
  req.setTimeout(isLlm ? 180_000 : 30_000);
  next();
});

// Serve public uploads (logos/branding) — no auth needed for login page
app.use('/uploads/logos', express.static(path.resolve(process.cwd(), 'uploads', 'logos')));

// Serve protected uploads (attachments, audio) — S1.1-DEFERRED-D
// hardens this from "any authenticated user" to "authenticated user from
// the same clinic that owns the file". The uploadsTenantGuard does the
// DB lookup and the path-traversal checks; if BLOB_STORAGE_BACKEND=s3
// and there's no matching row, it returns 410 Gone (because S3 owns the
// files now and the local serve is dead-letter).
import { requireAuth } from './middleware/authMiddleware';
import { tenantMiddleware } from './middleware/tenantMiddleware';
import { uploadsTenantGuard } from './middleware/uploadsTenantGuard';
app.use(
  '/uploads',
  (req, res, next) => {
    // Allow OPTIONS for CORS preflight
    if (req.method === 'OPTIONS') { next(); return; }
    requireAuth(req, res, next);
  },
  tenantMiddleware,
  uploadsTenantGuard(),
  express.static(path.resolve(process.cwd(), 'uploads')),
);

app.use((req, _res, next) => {
  req.requestId =
    (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
  next();
});

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    logger.info({
      type: 'access',
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: Date.now() - start,
      userId: req.user?.id,
      clinicId: req.clinicId,
    });
  });
  next();
});

// Patient read-access audit logging (Health Records Act HPP 6 compliance)
import { patientAccessAudit } from './middleware/patientAccessAudit';
app.use(patientAccessAudit);

app.use(healthRoutes);

// OpenAPI / Swagger UI — interactive API documentation.
// Gated behind NODE_ENV !== 'production' so the full route + schema
// map is NOT exposed on production deployments. Without this gate,
// any unauthenticated visitor can browse /api/docs and enumerate
// every endpoint — a classic OWASP A05 information-disclosure risk.
// Docs remain available in dev / test / staging for developer use.
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './shared/swagger';
if (process.env.NODE_ENV !== 'production') {
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'Signacare EMR API Documentation',
  }));
  app.get('/api/docs.json', (_req, res) => res.json(swaggerSpec));
}

const API = '/api/v1';

// Public branding (logo / sidebar title) — MUST be public so the login page
// can render branded chrome before any user is authenticated. Registered
// here as a top-level app.get because roleFeatureRoutes (mounted below at
// /api/v1) applies router.use(authMiddleware) which short-circuits any
// public endpoint declared after it inside a sub-router.
app.get(`${API}/power-settings/branding/public`, async (_req, res) => {
  try {
    const { db } = await import('./db/db');
    const row = await db('subscriber_branding').orderBy([{ column: 'updated_at', order: 'desc' }, { column: 'created_at', order: 'desc' }, { column: 'id', order: 'desc' }]).first();
    res.json({
      branding: row ? {
        sidebarTitle: row.sidebar_title ?? row.org_name ?? 'Signacare',
        sidebarSubtitle: row.sidebar_subtitle ?? 'Mental Health EMR',
        logoUrl: row.logo_url ?? '/signacare-logo.svg',
      } : null,
    });
  } catch {
    res.json({ branding: null });
  }
});
// FHIR metadata is declared in the FHIR block below to keep discovery
// and SMART configuration anchored with the rest of FHIR routes.

// BUG-468 — CSP-violation report endpoint. Mounted FIRST in the
// public-route band: unauthenticated by W3C `report-uri` design,
// CSRF-exempted at csrfMiddleware.ts. Browsers POST violation
// reports here; structured pino warn log per violation.
import cspReportRoutes from './features/security/cspReportRoutes';
app.use(`${API}/csp-report`, cspReportRoutes);

// Patient app routes — BEFORE auth routes (activate/login are unauthenticated)
app.use(`${API}/patient-app`, patientAppRoutes);
app.use(`${API}/auth`, authRoutes);

// Emergency break-glass access (HIPAA 164.312(a)(2)(ii))
import breakGlassRoutes from './features/auth/breakGlassRoutes';
app.use(`${API}/auth`, breakGlassRoutes);

// Tier 12.13 — admin impersonation for audit review.
import adminImpersonationRoutes from './features/auth/adminImpersonationRoutes';
app.use(`${API}/admin/impersonate`, adminImpersonationRoutes);

// WebAuthn/FIDO2 phishing-resistant MFA (ACSC Essential Eight ML3)
import webauthnRoutes from './features/auth/webauthnRoutes';
app.use(`${API}/auth`, webauthnRoutes);

// Role-based feature routes registered before parameterised /:id catch-alls
app.use(`${API}/appointments`, appointmentRoutes);
app.use(`${API}/episodes`, episodeRoutes);
app.use(`${API}/clinical-notes`, clinicalNoteRoutes);
app.use(`${API}/referrals`, referralRoutes);
app.use(`${API}/tasks`, taskRoutes);
app.use(`${API}/messages`, messageRoutes);
app.use(`${API}/billing`, billingRoutes);
app.use(`${API}/escalations`, escalationRoutes);
// Risk assessments ship two routers (audit L3) — one at
// /risk-assessments for POST, one at /patients/:patientId/... for
// nested reads. Both are named exports from risk.routes.ts and
// carry their own auth+tenant middleware.
app.use(`${API}/risk-assessments`, riskRoutes);
app.use(`${API}/patients`, riskPatientRoutes);
// Phase 13 — per-clinician calendar (availability blocks,
// preferences, iCal subscription management). The public
// /ical/:clinicianId.ics endpoint is the ONE calendar route
// that bypasses auth middleware — the HMAC token in the
// query string is the credential. It mounts BEFORE the
// authenticated calendar router so the more specific path
// matches first.
app.use(`${API}/calendar/ical`, calendarIcalPublicRoutes);
app.use(`${API}/calendar`, calendarRoutes);
app.use(`${API}/medications`, medicationRoutes);
app.use(`${API}/internal-medicine`, internalMedicineRoutes);
app.use(`${API}/endocrinology`, endocrinologyRoutes);
app.use(`${API}/paediatrics`, paediatricsRoutes);
app.use(`${API}/obs-gyne`, obsGyneRoutes);
app.use(`${API}/surgery`, surgeryRoutes);
app.use(`${API}/ect`, ectRoutes);
app.use(`${API}/tms`, tmsRoutes);
app.use(`${API}/oncology`, oncologyRoutes);
app.use(`${API}/telehealth`, telehealthRoutes);
app.use(`${API}/reports`, complianceDashboardRoutes);
app.use(`${API}/notifications`, notificationRoutes);
app.use(`${API}/patient-outreach`, patientOutreachRoutes);
app.use(`${API}/mobile`, mobileSyncRoutes);
app.use(`${API}/imports`, importRoutes);
app.use(`${API}/reallocations`, reallocationRoutes);
app.use(`${API}/prescriptions`, prescriptionRoutes);
app.use(`${API}/lai`, laiRoutes);
app.use(`${API}/clozapine`, clozapineRoutes);
app.use(`${API}/pathology`, pathologyRoutes);
app.use(`${API}/correspondence`, correspondenceRoutes);
app.use(`${API}/settings`, settingsRoutes);
app.use(`${API}/power-settings`, powerSettingsRoutes);
import clinicSettingsRoutes from './features/clinic-settings/clinicSettingsRoutes';
app.use(`${API}/clinic-settings`, clinicSettingsRoutes);

// Clinic provisioning (onboarding)
import { provisioningRoutes } from './features/provisioning/provisioningRoutes';
app.use(`${API}/provisioning`, provisioningRoutes);

// Workflow engine
import workflowRoutes from './features/workflows/workflowRoutes';
app.use(`${API}/workflows`, workflowRoutes);

// Checklists
import checklistRoutes from './features/checklists/checklistRoutes';
app.use(`${API}/checklists`, checklistRoutes);
import('./features/workflows/workflowEngine').then(({ startWorkflowEngine, stopWorkflowEngine }) => {
  startWorkflowEngine();
  // BUG-042 — stop workflow engine (unregister event listeners) at
  // priority 50, AFTER workers drain but BEFORE DB pool destroy.
  registerShutdownHook({
    name: 'workflow-engine',
    priority: 50,
    handler: async () => { stopWorkflowEngine(); },
  });
}).catch(err => logger.warn({ err: err?.message }, 'Workflow engine start failed'));
app.use(`${API}/org-settings`, orgSettingsRoutes);
app.use(`${API}/staff-settings`, staffSettingsRoutes);
app.use(flagRoutes);
app.use(allergyRoutes);
app.use(`${API}/clinical-review`, clinicalReviewRoutes);
app.use(`${API}/dashboard`, dashboardRoutes);
app.use(`${API}/voice`, voiceRoutes);
app.use(`${API}/llm`, llmRoutes);
import aiJobRoutes from './features/llm/aiJobRoutes';
app.use(`${API}/ai`, aiJobRoutes);
import sseRoutes from './features/events/sseRoutes';
app.use(`${API}/events`, sseRoutes);
import auditReplayRoutes from './features/audit/auditReplayRoutes';
app.use(`${API}/audit`, auditReplayRoutes);
import tabConfigRoutes from './features/settings/tabConfigRoutes';
app.use(`${API}/settings`, tabConfigRoutes);
import scribeRoutes from './features/llm/scribeRoutes';
app.use(`${API}/scribe`, scribeRoutes);
import streamingTranscribeRoutes from './features/llm/streamingTranscribeRoutes';
app.use(`${API}/scribe`, streamingTranscribeRoutes);
import agenticScribeRoutes from './features/llm/agenticScribeRoutes';
app.use(`${API}/agentic-scribe`, agenticScribeRoutes);
// Tier 15 — letter authoring (draft / regen / review / approve / send).
// Letters live under /letters, not /scribe, because they're authored by
// non-scribe surfaces too (manual letters, letters produced from
// structured notes that weren't scribed).
import letterRoutes from './features/llm/letterRoutes';
app.use(`${API}/letters`, letterRoutes);
// Tier 17 — structured clinical artefacts (capacity assessments,
// forensic risk, letter citations, tone presets, state MHA forms).
// Mounted under /clinical so the URL shape reflects the clinical
// domain rather than the letters surface.
import letterStructuredRoutes from './features/llm/letterStructuredRoutes';
app.use(`${API}/clinical`, letterStructuredRoutes);
// Tier 19 — admin training platform (PHI scrubber, training corpus
// review, model registry, red-team gate, canary deployments,
// surveillance). All endpoints admin + superadmin only.
import adminTrainingRoutes from './features/llm/adminTrainingRoutes';
app.use(`${API}/admin/training`, adminTrainingRoutes);
app.use(`${API}/templates`, templateRoutes);
app.use(`${API}/reports`, reportsRoutes);
// Patient deactivation routes — mounted BEFORE main patient routes to avoid any catch-all interference
import { patientStatusRoutes } from './features/patients/patientStatusRoutes';
import { authMiddleware as statusAuth } from './middleware/authMiddleware';
import { tenantMiddleware as statusTenant } from './middleware/tenantMiddleware';
app.use(`${API}/patients`, statusAuth, statusTenant, patientStatusRoutes);

import { contactRecordMiddleware } from './middleware/contactRecordMiddleware';
app.use(`${API}/patients`, contactRecordMiddleware, patientRoutes);
// R-FIX-BUG-576-SERVER-MOUNT
// BUG-576: legal-order CRUD mounted as a first-class feature router so
// route-catalog guards resolve the endpoints directly.
app.use(`${API}/patients`, contactRecordMiddleware, legalOrderRoutes);
import zitaviSyncRoutes from './features/patients/zitaviSyncRoutes';
app.use(`${API}/patients`, zitaviSyncRoutes);

// Duplicate detection + merge (S7.1). Mounted at the API root (not under
// /patients) because the routes file declares its own prefixed paths
// (/patients/duplicates/check and /patients/:id/merge). This keeps the
// service self-contained and avoids catch-all ordering hazards in
// patientRoutes where /:id would intercept /duplicates.
import patientDuplicateRoutes from './features/patients/duplicateRoutes';
app.use(API, patientDuplicateRoutes);

app.use(`${API}/staff`, staffRoutes);
app.use(`${API}/clinics`, clinicRoutes);

// BUG-336 + BUG-339 — HI Service admin endpoints for HPI-I / HPI-O
// live verification (NASH mTLS via BUG-297). Thin wrappers over
// hiServiceClient.verifyHpii / verifyHpio. Per-route RBAC in router.
import { hiServiceRouter } from './features/hi-service/hiServiceRoutes';
app.use(`${API}/hi-service`, hiServiceRouter);
app.use(`${API}/waitlist`, waitlistRoutes);

// CMI (Victorian Department of Health)
import cmiRoutes from './integrations/cmi/cmiRoutes';
app.use(`${API}/cmi`, cmiRoutes);

// Office 365 / Outlook integration
import { outlookRoutes } from './integrations/outlook/outlookRoutes';
app.use(`${API}/integrations/outlook`, outlookRoutes);

// ── New Enhancement Modules ──
import outcomeRoutes from './features/outcomes/outcomeRoutes';
import safetyPlanRoutes from './features/safety-plan/safetyPlanRoutes';
import advanceDirectiveRoutes from './features/advance-directives/advanceDirectiveRoutes';
import groupTherapyRoutes from './features/group-therapy/groupTherapyRoutes';
import bedRoutes from './features/beds/bedRoutes';
import carerRoutes from './features/carers/carerRoutes';
import pathwayRoutes from './features/treatment-pathways/pathwayRoutes';
import ereferralRoutes from './features/ereferral/ereferralRoutes';
import clinicalDecisionRoutes from './features/clinical-decision/clinicalDecisionRoutes';

app.use(`${API}/outcomes`, outcomeRoutes);
app.use(`${API}/safety-plans`, safetyPlanRoutes);
app.use(`${API}/advance-directives`, advanceDirectiveRoutes);
app.use(`${API}/group-therapy`, groupTherapyRoutes);
app.use(`${API}/beds`, bedRoutes);
app.use(`${API}/carers`, carerRoutes);
app.use(`${API}/pathways`, pathwayRoutes);
app.use(`${API}/ereferrals`, ereferralRoutes);
app.use(`${API}/clinical-decision`, clinicalDecisionRoutes);

// Role-based feature routes registered at top of route chain (before /:id catch-alls)
import backupRoutes from './features/backup/backupRoutes';
app.use(`${API}/backup`, backupRoutes);

import documentRoutes from './features/documents/documentRoutes';
app.use(`${API}/documents`, documentRoutes);

import nhsdRoutes from './integrations/nhsd/nhsdRoutes';
app.use(`${API}/nhsd`, nhsdRoutes);

import contactRecordRoutes from './features/contacts/contactRecordRoutes';
app.use(`${API}/contact-records`, contactRecordRoutes);

// License (no auth required)
import licenseRoutes from './features/license/licenseRoutes';
app.use(`${API}/license`, licenseRoutes);

// Audit log
import { authMiddleware as auditAuth } from './middleware/authMiddleware';
import { tenantMiddleware as auditTenant } from './middleware/tenantMiddleware';
app.get(`${API}/audit`, auditAuth, auditTenant, async (req, res, next) => {
  try {
    const { db } = await import('./db/db');
    const rows = await db('audit_events_canonical')
      .where({ clinic_id: req.clinicId })
      .orderBy('created_at', 'desc')
      .limit(100);
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// Privacy & PII management
import privacyRoutes from './features/privacy/privacyRoutes';
app.use(`${API}/privacy`, privacyRoutes);

// FHIR R4: Public metadata endpoint (no auth required per FHIR R4 spec)
app.get(`${API}/fhir/metadata`, (_req, res) => {
  res.json({ resourceType: 'CapabilityStatement', status: 'active', fhirVersion: '4.0.1',
    date: new Date().toISOString(), publisher: 'Signacare PTY Ltd',
    software: { name: 'Signacare EMR', version: '1.0.0' }, format: ['json'],
    rest: [{ mode: 'server', resource: [
      { type: 'Patient', interaction: [{ code: 'read' }, { code: 'search-type' }, { code: 'create' }] },
      { type: 'Observation', interaction: [{ code: 'read' }, { code: 'search-type' }, { code: 'create' }] },
      { type: 'Condition', interaction: [{ code: 'search-type' }] },
      { type: 'MedicationStatement', interaction: [{ code: 'search-type' }] },
      { type: 'AllergyIntolerance', interaction: [{ code: 'search-type' }] },
      { type: 'Encounter', interaction: [{ code: 'search-type' }] },
      { type: 'DiagnosticReport', interaction: [{ code: 'search-type' }] },
      { type: 'Practitioner', interaction: [{ code: 'read' }, { code: 'search-type' }] },
      { type: 'Organization', interaction: [{ code: 'search-type' }] },
    ]}],
  });
});

// FHIR R4: Protected endpoints (require authentication)
import fhirRoutes from './integrations/fhir/fhirRoutes';
app.use(`${API}/fhir`, fhirRoutes);

// SMART on FHIR authorization (ADHA conformance)
import smartAuthRoutes from './integrations/fhir/smartAuth';
app.use(`${API}/fhir`, smartAuthRoutes);

// SMART App Registry (equivalent to Epic's App Orchard)
import smartAppRegistry from './integrations/fhir/smartAppRegistry';
app.use(`${API}/fhir`, smartAppRegistry);

// FHIR Subscription (real-time webhook notifications)
import fhirSubscriptionRoutes from './integrations/fhir/fhirSubscription';
app.use(`${API}/fhir`, fhirSubscriptionRoutes);

// S3.4: Inbound webhook receiver. The public POST /webhooks/:source
// route is unauthenticated — partners authenticate via HMAC-SHA256
// over the raw body (signature in the configurable header). The admin
// endpoints for managing webhook secrets are mounted at
// /webhooks-admin behind authMiddleware + admin role.
import webhookRoutes, { webhookAdminRouter } from './features/webhooks/webhookRoutes';
app.use(`${API}/webhooks`, webhookRoutes);
app.use(`${API}/webhooks-admin`, webhookAdminRouter);

// S4.2: Feature flag bootstrap + admin routes. The bootstrap endpoint
// (GET /feature-flags) is auth-required but not role-gated so any
// authenticated user can fetch the resolved flag map for their clinic.
// Admin write endpoints are at /feature-flags-admin behind admin role.
import featureFlagRoutes, { featureFlagAdminRouter } from './features/feature-flags/featureFlagRoutes';
app.use(`${API}/feature-flags`, featureFlagRoutes);
app.use(`${API}/feature-flags-admin`, featureFlagAdminRouter);

// Additional FHIR resources (MedicationRequest, Procedure, Location)
import fhirAdditionalRoutes from './integrations/fhir/fhirAdditionalResources';
app.use(`${API}/fhir`, fhirAdditionalRoutes);
// Role-based feature routes are public-surface safe here because all public
// SMART/public-fhir endpoints are now mounted above. This keeps public
// endpoints from being gated by auth while preserving role-level checks
// on role-specific clinical feature actions.
app.use(`${API}`, roleFeatureRoutes);

// FHIR error middleware — converts errors to OperationOutcome format (R4 spec)
// Must be after all FHIR route mounts, before the general error handler.
import { fhirErrorMiddleware } from './integrations/fhir/fhirErrorMiddleware';
// BUG-042 — canonical shutdown registry. Static top-level import so the
// same module instance is shared with routes/health.ts (which reads
// isReady from the SAME state). Prevents Vitest module-cache fragmentation.
import { registerShutdownHook, runGracefulShutdown } from './shared/gracefulShutdown';
app.use(`${API}/fhir`, fhirErrorMiddleware);

// Sentry error handler must be after routes, before custom error handler
if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
}

// Multer file-size / file-type errors → 400 instead of 500
app.use((err: Error & { code?: string; detail?: string }, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: 'File too large. Maximum 20MB.', code: 'FILE_TOO_LARGE' });
    return;
  }
  if (err.message?.includes('File type') && err.message?.includes('not allowed')) {
    res.status(400).json({ error: err.message, code: 'INVALID_FILE_TYPE' });
    return;
  }
  // FK constraint violations → 400
  if (err.code === '23503') {
    logger.warn(
      { requestId: req.requestId, errCode: err.code },
      'FK violation blocked',
    );
    res.status(400).json({ error: 'Referenced record not found', code: 'FK_VIOLATION' });
    return;
  }
  next(err);
});

app.use(errorHandler);

// ── Health + Readiness endpoints ──
// /health — lightweight liveness probe (load balancer uses this)
app.get('/health', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// /ready — handled by routes/health.ts (mounted at line 401 before
// this point). That handler includes the BUG-042 shutdown short-circuit
// + DB + Redis checks. A duplicate /ready was previously defined here
// but never reached; removed during BUG-042 consolidation.

// ── Pre-flight Checks & Server Start ──
import { connectRedis } from './config/redis';

async function startServer() {
  let dbPoolBudgetRuntimeConfig:
    | { appPoolMax: number; adminPoolMax: number; replicaPoolMax: number; hasReplica: boolean }
    | null = null;

  // 1. Connect Redis (non-blocking — server starts even if Redis fails)
  redisAvailable = await connectRedis();
  // BUG-469 L5 absorb-1 — propagate to the rate-limiter SSoT module so
  // its `redisStore()` factory returns the real RedisStore on the next
  // limiter request. Pre-fix this was a local closure variable.
  setRateLimiterRedisAvailable(redisAvailable);
  // BUG-329 — cross-process revoke-cache invalidation. If Redis pub/sub
  // bridge fails to attach, the consent gate still remains safe via the
  // short TTL cache fallback in recordingConsent.ts.
  if (redisAvailable) {
    try {
      const { startConsentRevokeCachePubSubBridge } = await import('./shared/recordingConsent');
      await startConsentRevokeCachePubSubBridge();
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        '[BUG-329] failed to start revoke-cache pub/sub bridge (TTL fallback active)',
      );
    }
  }

  // 2. Verify database (admin connection — bypasses RLS)
  try {
    const { dbAdmin, getDbPoolBudgetRuntimeConfig, getDbPoolTelemetrySnapshot } = await import('./db/db');
    await dbAdmin.raw('SELECT 1');
    dbPoolBudgetRuntimeConfig = getDbPoolBudgetRuntimeConfig();
    startDbPoolMetricsPolling(getDbPoolTelemetrySnapshot);
    registerShutdownHook({
      name: 'db-pool-metrics-poller',
      priority: 30,
      handler: async () => { stopDbPoolMetricsPolling(); },
    });
    const { assertForceRlsPosture } = await import('./shared/assertForceRlsPosture');
    await assertForceRlsPosture();
    const { ensureCanonicalSpecialties } = await import('./shared/ensureCanonicalSpecialties');
    await ensureCanonicalSpecialties({ force: true, caller: 'server.startup' });
    logger.info('Database connection OK');
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, 'Database connection FAILED — server may not function correctly');
  }

  // Pool budget projection assertion (worksheet moved from doc-only to runtime).
  // Default mode is "warn": warns for caution/risky projections and continues.
  // Set DB_POOL_BUDGET_ASSERT_MODE=fail to hard-block startup when verdict=risky.
  try {
    if (dbPoolBudgetRuntimeConfig) {
      const processCountRaw = process.env.API_PROCESS_COUNT ?? '1';
      const parsedProcessCount = Number.parseInt(processCountRaw, 10);
      const apiProcessCount = Number.isFinite(parsedProcessCount) && parsedProcessCount > 0 ? parsedProcessCount : 1;

      const { evaluatePoolBudgetFromEnv } = await import('./shared/poolBudget');
      const evaluation = evaluatePoolBudgetFromEnv(
        {
          DB_POOL_BUDGET_ASSERT_MODE: process.env.DB_POOL_BUDGET_ASSERT_MODE,
          DB_USABLE_BACKEND_CONNECTIONS: process.env.DB_USABLE_BACKEND_CONNECTIONS,
          DB_RESERVED_BACKEND_CONNECTIONS: process.env.DB_RESERVED_BACKEND_CONNECTIONS,
          DB_NON_API_CONSUMERS: process.env.DB_NON_API_CONSUMERS,
          DB_SAFE_UTILIZATION_CEILING: process.env.DB_SAFE_UTILIZATION_CEILING,
        },
        {
          apiProcessCount,
          ...dbPoolBudgetRuntimeConfig,
        },
      );

      if (evaluation.skippedReason) {
        logger.warn(
          {
            mode: evaluation.mode,
            reason: evaluation.skippedReason,
            hint: 'Set DB_USABLE_BACKEND_CONNECTIONS (+ optional DB_RESERVED_BACKEND_CONNECTIONS, DB_NON_API_CONSUMERS, DB_SAFE_UTILIZATION_CEILING).',
          },
          '[POOL_BUDGET] projection skipped',
        );
      } else if (evaluation.projection && evaluation.inputs) {
        logger.info(
          {
            mode: evaluation.mode,
            verdict: evaluation.projection.verdict,
            headroomRatio: Number(evaluation.projection.headroomRatio.toFixed(3)),
            primaryPressure: evaluation.projection.primaryPressure,
            safePrimaryCap: evaluation.projection.safePrimaryCap,
            clientSocketCeiling: evaluation.projection.clientSocketCeiling,
            replicaPressure: evaluation.projection.replicaPressure,
            inputs: evaluation.inputs,
          },
          '[POOL_BUDGET] projection',
        );

        if (evaluation.projection.verdict !== 'healthy') {
          const payload = {
            mode: evaluation.mode,
            verdict: evaluation.projection.verdict,
            headroomRatio: Number(evaluation.projection.headroomRatio.toFixed(3)),
            primaryPressure: evaluation.projection.primaryPressure,
            safePrimaryCap: evaluation.projection.safePrimaryCap,
          };
          if (evaluation.projection.verdict === 'risky') {
            logger.error(payload, '[POOL_BUDGET] pressure above healthy threshold');
          } else {
            logger.warn(payload, '[POOL_BUDGET] pressure above healthy threshold');
          }
        }

        if (evaluation.mode === 'fail' && evaluation.projection.verdict === 'risky') {
          logger.error(
            {
              headroomRatio: Number(evaluation.projection.headroomRatio.toFixed(3)),
              primaryPressure: evaluation.projection.primaryPressure,
              safePrimaryCap: evaluation.projection.safePrimaryCap,
            },
            '[POOL_BUDGET] startup blocked: risky projection in fail mode',
          );
          process.exit(1);
        }
      }
    }
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      '[POOL_BUDGET] projection assertion failed unexpectedly (non-blocking)',
    );
  }

  // BUG-043 — production integration-config boot check. Fails fast if
  // critical integrations (eRx, SafeScript, FCM, ACS, etc.) are not
  // configured in NODE_ENV=production. Runs AFTER Redis + DB are up
  // because feature-flag reads need DB. Wrapped in try/catch so the
  // operator sees a clean pino JSON log with `missing` + `remediation`
  // fields rather than Node's default unhandled-exception stack trace.
  // CrashLoopBackoff is the intended enforcement mechanism.
  try {
    const { assertProductionIntegrationsConfigured } = await import('./shared/assertProductionIntegrationsConfigured');
    await assertProductionIntegrationsConfigured();
  } catch (err) {
    if (err && typeof err === 'object' && 'missing' in err && 'remediation' in err) {
      const e = err as { missing: unknown[]; remediation: string; message: string };
      logger.error(
        { missing: e.missing, remediation: e.remediation },
        '[BOOT] refusing to start — production integration config incomplete',
      );
      // Print the human-readable remediation block so DevOps engineers
      // see it even when pino is configured for JSON-only output.
      // eslint-disable-next-line no-console
      console.error('\n' + e.remediation + '\n');
      process.exit(1);
    }
    // Unexpected error shape — re-throw so the outer catch handles it.
    throw err;
  }

  // 3. Flush rate limit keys on startup (not ALL of Redis — preserves sessions, cache, queues)
  if (isDev && redisAvailable) {
    try {
      const keys = await redis.keys('rl:*');
      if (keys.length > 0) await redis.del(...keys);
      logger.info({ count: keys.length }, 'Dev rate limit keys flushed on startup');
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Dev rate-limit flush failed (non-blocking)');
    }
  }

  // 4. Start AI job worker (in-process for single-server, separate process in production)
  if (redisAvailable) {
    try {
      const { startAiWorker } = await import('./jobs/workers/aiWorker');
      startAiWorker(process.env.REDIS_URL ?? 'redis://localhost:6379');
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'AI worker failed to start — async AI disabled');
    }
  }

  // 4b. S2.1: Wire up the bootstrap-defined schedulers and workers.
  // Prior to this commit, startSchedulers() and startWorkers() were
  // exported from apps/api/src/jobs/bootstrap.ts but never called from
  // anywhere — meaning the BullMQ email/sms/llm/flag/outlook workers
  // and the lai/clozapine/mha/referral/appointment-reminder/backup
  // schedulers were dead code in any deployment that wasn't running
  // the separate `signacare-workers` PM2 process. This includes the local
  // dev loop. We now invoke them from server start so a single API
  // process is self-sufficient (the PM2 split is still supported for
  // production scale).
  try {
    const { startWorkers, startSchedulers } = await import('./jobs/bootstrap');
    startWorkers();
    startSchedulers();
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Bootstrap workers/schedulers failed to start');
  }

  const PORT = parseInt(process.env.PORT ?? '4000', 10);
  const TLS_CERT = process.env.TLS_CERT_PATH;
  const TLS_KEY = process.env.TLS_KEY_PATH;

  if (TLS_CERT && TLS_KEY && fs.existsSync(TLS_CERT) && fs.existsSync(TLS_KEY)) {
  // HTTPS mode
  const httpsOptions = {
    cert: fs.readFileSync(path.resolve(TLS_CERT)),
    key: fs.readFileSync(path.resolve(TLS_KEY)),
  };
  const server = https.createServer(httpsOptions, app);
  server.keepAliveTimeout = 65_000;   // Must be > ALB/Nginx idle timeout (60s)
  server.headersTimeout = 66_000;
  // Attach WebSocket for real-time scribe streaming
  import('./mcp/scribeStreaming').then(({ setupScribeWebSocket }) => setupScribeWebSocket(server)).catch((err) => { logger.warn({ err: err?.message }, 'Scribe WebSocket setup failed — real-time transcription unavailable'); });
  server.listen(PORT, () => {
    logger.info({ action: 'server_start', port: PORT, protocol: 'HTTPS', env: process.env.NODE_ENV }, 'Signacare API started (HTTPS)');
    if (typeof process.send === 'function') process.send('ready');
    // Auto-start Whisper transcription server
    import('./jobs/bootstrap').then(({ startWhisperServer }) => startWhisperServer()).catch(err => logger.warn({ err: err?.message }, 'Whisper auto-start failed'));
    // Audit Tier 4.4 (CRIT-G3 part 1) — snapshot every installed
    // Ollama model's digest at boot so there's an audit baseline
    // before any AI writes happen. Non-fatal if Ollama is offline.
    import('./mcp/ollamaModelRegistry').then(({ ollamaModelRegistry }) => ollamaModelRegistry.logStartupSnapshot()).catch((err) => logger.warn({ err: err?.message }, 'ollamaModelRegistry startup snapshot failed'));
  });

  // BUG-042 — register HTTP-layer hooks with the canonical registry.
  // Server-specific (HTTP/HTTPS binding) hooks live here; worker /
  // WebSocket / DB / Redis / scheduler hooks register themselves in
  // their own modules at init time.
  registerHttpLayerShutdownHooks(server);
} else {
  // HTTP mode (development or behind reverse proxy)
  const server = app.listen(PORT, () => {
    server.keepAliveTimeout = 65_000;
    server.headersTimeout = 66_000;
    // Attach WebSocket for real-time scribe streaming
    import('./mcp/scribeStreaming').then(({ setupScribeWebSocket }) => setupScribeWebSocket(server)).catch((err) => { logger.warn({ err: err?.message }, 'Scribe WebSocket setup failed — real-time transcription unavailable'); });
    logger.info({ action: 'server_start', port: PORT, protocol: 'HTTP', env: process.env.NODE_ENV }, 'Signacare API started');
    if (process.env.NODE_ENV === 'production' && !TLS_CERT) {
      logger.warn('Running HTTP in production — set TLS_CERT_PATH and TLS_KEY_PATH for HTTPS, or use a reverse proxy (Nginx/ALB)');
    }
    // Signal PM2 that the process is ready to accept connections
    if (typeof process.send === 'function') process.send('ready');
    // Auto-start Whisper transcription server
    import('./jobs/bootstrap').then(({ startWhisperServer }) => startWhisperServer()).catch(err => logger.warn({ err: err?.message }, 'Whisper auto-start failed'));
    // Audit Tier 4.4 (CRIT-G3 part 1) — snapshot every installed
    // Ollama model's digest at boot.
    import('./mcp/ollamaModelRegistry').then(({ ollamaModelRegistry }) => ollamaModelRegistry.logStartupSnapshot()).catch((err) => logger.warn({ err: err?.message }, 'ollamaModelRegistry startup snapshot failed'));
  });

  // BUG-042 — same canonical registry path in HTTP mode.
  registerHttpLayerShutdownHooks(server);
}
} // end startServer()

// BUG-042 — register HTTP-layer hooks exactly once per server instance.
// Priority map (canonical in shared/gracefulShutdown.ts header):
//   70  Whisper external process
//   80  HTTP server closeIdleConnections + close
//   45  mTLS keep-alive agent drain
//   20  DB pool destroy
//   10  Redis quit
//    5  OTEL flush + pino sync flush
// WebSocket / BullMQ / schedulers / workflow-engine register themselves
// in their own module init (static imports).
function registerHttpLayerShutdownHooks(server: import('http').Server | import('https').Server): void {
  registerShutdownHook({
    name: 'whisper-server',
    priority: 70,
    handler: async () => {
      const { stopWhisperServer } = await import('./jobs/bootstrap');
      await stopWhisperServer();
    },
  });
  registerShutdownHook({
    name: 'http-server',
    priority: 80,
    // server.close() alone would wait for keep-alive TCP to drain
    // (up to keepAliveTimeout=65_000ms). closeIdleConnections() drops
    // idle keep-alive sockets immediately — LB routing is already gone
    // (readiness flipped at priority 100) so there's no legitimate
    // reason to wait for them.
    handler: () => new Promise<void>((resolve) => {
      try {
        // Node 18.2+ — closeIdleConnections is on Server instances.
        const maybeCloseIdle = (server as unknown as { closeIdleConnections?: () => void }).closeIdleConnections;
        if (typeof maybeCloseIdle === 'function') maybeCloseIdle.call(server);
      } catch (err) {
        logger.warn({ err: err instanceof Error ? err.message : String(err) }, '[shutdown] closeIdleConnections failed (non-blocking)');
      }
      server.close(() => resolve());
    }),
  });
  registerShutdownHook({
    name: 'mtls-agent-drain',
    priority: 45,
    // BUG-333 — drain cached keep-alive outbound mTLS agents so
    // long-lived TLS sockets do not outlive graceful shutdown.
    handler: async () => {
      const { drainMtlsAgentCacheForShutdown } = await import('./shared/mtls');
      const drained = drainMtlsAgentCacheForShutdown();
      logger.info({ drained }, '[shutdown] drained cached mTLS keep-alive agents');
    },
  });
  registerShutdownHook({
    name: 'db-pool',
    priority: 20,
    handler: async () => {
      const { db, clearPoolMonitor } = await import('./db/db');
      clearPoolMonitor();
      await db.destroy();
    },
  });
  registerShutdownHook({
    name: 'redis',
    priority: 10,
    handler: async () => { await redis.quit(); },
  });
  registerShutdownHook({
    name: 'pino-sync-flush',
    priority: 5,
    handler: async () => {
      try {
        const flushed = flushLoggerSync();
        if (!flushed) {
          // eslint-disable-next-line no-console
          console.warn('[shutdown] pino flushSync unavailable; log durability is best-effort');
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[shutdown] pino flushSync failed', err instanceof Error ? err.message : String(err));
      }
    },
  });
}

// BUG-042 — single SIGTERM + SIGINT handler path. registered at module
// load (top-level) so even a SIGTERM before startServer() completes
// still triggers a graceful shutdown against the hooks that have been
// registered by then. NODE_ENV=test skips (supertest imports server
// without starting it).
if (process.env.NODE_ENV !== 'test') {
  const onSignal = (signal: string) => {
    runGracefulShutdown(signal).finally(() => process.exit(0));
  };
  process.on('SIGTERM', () => onSignal('SIGTERM'));
  process.on('SIGINT', () => onSignal('SIGINT'));
}

// Skip auto-start when imported by the test runner — supertest mounts the
// exported app in-process and would otherwise race against the listen() call.
if (process.env.NODE_ENV !== 'test') {
  startServer().catch(err => {
    logger.error({ err }, 'Fatal error during server startup');
    process.exit(1);
  });
}

export default app;
