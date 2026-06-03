/**
 * BUG-468 — Content-Security-Policy violation report endpoint.
 *
 * The browser POSTs to this URL whenever a directive in our CSP blocks
 * a resource (script, stylesheet, image, frame, etc.). The endpoint is
 * unauthenticated by W3C `report-uri` design — browsers cannot
 * necessarily attach cookies cross-origin during a violation, and the
 * reporter has no session anyway. Rate-limited by the global
 * `apiLimiter` mounted at `/api/` (1000/min/IP).
 *
 * Body parser:
 *   - Chrome sends `application/csp-report` (legacy MIME).
 *   - Firefox sends `application/json`.
 *   - Both shapes carry the same outer `{ "csp-report": { ... } }` shell
 *     for the `report-uri` directive (BUG-468 uses the legacy shape;
 *     modern `report-to` is filed as a possible follow-up).
 *
 * Observability: structured pino `warn` log with `type: 'csp_violation'`
 * and the documented W3C fields. Raw body is NOT logged so any
 * vendor-extended fields containing user-typed strings are skipped.
 *
 * Persistence: log only. A `csp_violations` table is filed as a
 * possible follow-up if staging volume warrants.
 */

import { Router } from 'express';
import express from 'express';
import { z } from 'zod';
import { logger } from '../../utils/logger';
import { HttpError } from '../../shared/errors';

const router = Router();

const CspReportSchema = z.object({
  'csp-report': z.object({
    'document-uri': z.string().optional(),
    referrer: z.string().optional(),
    'violated-directive': z.string(),
    'effective-directive': z.string().optional(),
    'original-policy': z.string().optional(),
    disposition: z.string().optional(),
    'blocked-uri': z.string().optional(),
    'line-number': z.number().optional(),
    'column-number': z.number().optional(),
    'source-file': z.string().optional(),
    'status-code': z.number().optional(),
    'script-sample': z.string().optional(),
  }).passthrough(),
}).passthrough();

// Body parser scoped to THIS route — accepts both legacy
// `application/csp-report` (Chrome) and `application/json` (Firefox).
//
// Effective body-size limit is asymmetric by MIME, by design of the
// upstream global parser at `server.ts` (`express.json({ limit: '2mb' })`):
//   - Chrome's `application/csp-report` MIME does NOT match the
//     default `application/json` matcher, so this route-scoped 64KB
//     limit applies.
//   - Firefox's `application/json` MIME IS consumed by the global
//     parser BEFORE this scoped one runs, so the effective limit is
//     2MB (still bounded; rate-limited; Zod-validated).
// Legitimate CSP reports are < 2KB; both limits are far above.
const cspBodyParser = express.json({
  type: ['application/csp-report', 'application/json'],
  limit: '64kb',
});

router.post('/', cspBodyParser, (req, res, next) => {
  try {
    const parsed = CspReportSchema.parse(req.body);
    const report = parsed['csp-report'];
    logger.warn(
      {
        type: 'csp_violation',
        documentUri: report['document-uri'],
        referrer: report['referrer'],
        violatedDirective: report['violated-directive'],
        effectiveDirective: report['effective-directive'],
        disposition: report['disposition'],
        blockedUri: report['blocked-uri'],
        sourceFile: report['source-file'],
        lineNumber: report['line-number'],
        columnNumber: report['column-number'],
        statusCode: report['status-code'],
        scriptSample: report['script-sample'],
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      },
      'CSP violation reported',
    );
    res.status(204).send();
  } catch (err) {
    if (err instanceof z.ZodError) {
      next(new HttpError(400, 'CSP_REPORT_MALFORMED', 'Malformed CSP report body'));
      return;
    }
    next(err);
  }
});

export default router;
