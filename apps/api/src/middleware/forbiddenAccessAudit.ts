/**
 * Forbidden-access audit middleware.
 *
 * Wraps every outgoing response: if the status code is 403
 * (Forbidden), writes a row to audit_log with
 * `action: 'FORBIDDEN_ACCESS'` recording WHO attempted WHICH
 * resource and WHY it was denied.
 *
 * Without this middleware, 403 responses from rbacMiddleware,
 * csrfMiddleware, ipAllowlist, and uploadsTenantGuard all emitted
 * "Forbidden" with ZERO audit rows — OWASP A09 (Security Logging
 * Failures) + APP 11 (forensic discoverability).
 *
 * Design notes:
 *   - Hooks res.on('finish') rather than wrapping res.json(), so
 *     it catches forbidden responses emitted from ANY middleware
 *     layer including downstream routes, not just ones that call
 *     res.status(403).json().
 *   - Writes via dbAdmin (bypassing RLS) with an async fire-and-
 *     forget pattern: audit failure MUST NOT block the response.
 *   - Does NOT log 401s — those are authentication failures
 *     (someone without a valid token tried to reach a protected
 *     endpoint), which aren't inherently "access attempts" against
 *     a specific resource. 401 logging is authController's job.
 *   - Does NOT log 403s from the forbidden audit route itself
 *     (no recursion risk because there is no such route).
 *
 * Standard satisfied: OWASP A09 (Security Logging Failures),
 *                     Australian Privacy Act APP 11 (forensic
 *                     discoverability of unauthorised access),
 *                     HIPAA §164.312(b) (Audit Controls).
 */

import type { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export function forbiddenAccessAudit() {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Hook finish so we observe the FINAL status code (after any
    // middleware that might change it). The 'finish' event fires
    // once when response headers are flushed.
    res.on('finish', () => {
      if (res.statusCode !== 403) return;

      // Best-effort audit write — never throws into the request
      // flow. The hook runs AFTER the response is sent, so even
      // if the DB write fails, the client has already been told
      // they're forbidden.
      void (async () => {
        try {
          // BUG-467 — migrated from direct db('audit_log').insert to
          // typed writeAuditLog. Inherits BUG-283 outbox recovery +
          // eventTime stamp. Action literal is now a first-class
          // member of the AuditAction union.
          const { writeAuditLog } = await import('../utils/audit');
          await writeAuditLog({
            clinicId: req.clinicId ?? '00000000-0000-0000-0000-000000000000',
            actorId: req.user?.id ?? '',
            tableName: 'http_request',
            recordId: '00000000-0000-0000-0000-000000000000',
            action: 'FORBIDDEN_ACCESS',
            newData: {
              method: req.method,
              path: req.originalUrl ?? req.url,
              ip: req.ip ?? null,
              userAgent: req.headers['user-agent'] ?? null,
              role: req.user?.role ?? null,
              statusCode: res.statusCode,
              timestamp: new Date().toISOString(),
            },
          });
        } catch (err: unknown) {
          // writeAuditLog never throws, but keep the safety net — an
          // audit outage must not create a second-order incident.
          logger.warn(
            { err: err instanceof Error ? err.message : String(err) },
            'forbiddenAccessAudit: failed to write audit row',
          );
        }
      })();
    });

    next();
  };
}
