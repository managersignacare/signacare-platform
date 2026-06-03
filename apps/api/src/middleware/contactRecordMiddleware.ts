/**
 * Contact Record Middleware
 *
 * Automatically creates a draft ABF contact record after any successful
 * POST to a patient-related clinical endpoint.
 *
 * Applied to routes matching /patients/:patientId/...
 * Triggers on successful POST responses (2xx status).
 */

import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { createAutoContactRecord } from '../features/contacts/autoContactRecord';
import { withTenantContext } from '../shared/tenantContext';

/** Patterns of POST endpoints that represent clinical contacts */
const CLINICAL_PATTERNS = [
  /\/patients\/[^/]+\/legal-orders$/,
  /\/patients\/[^/]+\/alerts$/,
  /\/patients\/[^/]+\/hotspot$/,
  /\/outcomes$/,
  /\/safety-plans$/,
  /\/advance-directives$/,
  /\/pathways$/,
  /\/pathology.*\/orders$/,
  /\/medications$/,
  /\/risk-assessments$/,
];

// Match the sourceType union accepted by createAutoContactRecord
// (see features/contacts/autoContactRecord.ts).
type AutoContactSourceType = 'clinical_note' | 'correspondence' | 'message' | 'appointment' | 'group_session' | 'phone_call' | 'lai_administration';

/** Map URL patterns to source types for ABF reporting */
function inferSourceType(url: string): AutoContactSourceType {
  if (url.includes('legal-order')) return 'correspondence';
  if (url.includes('alert')) return 'clinical_note';
  if (url.includes('outcome')) return 'clinical_note';
  if (url.includes('safety-plan')) return 'clinical_note';
  if (url.includes('pathway')) return 'appointment';
  if (url.includes('pathology')) return 'clinical_note';
  if (url.includes('medication')) return 'clinical_note';
  if (url.includes('risk')) return 'clinical_note';
  return 'clinical_note';
}

export function contactRecordMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Only intercept POST requests
  if (req.method !== 'POST') { next(); return; }

  // Check if this URL matches a clinical pattern
  const matches = CLINICAL_PATTERNS.some(p => p.test(req.originalUrl));
  if (!matches) { next(); return; }

  // Override res.json to hook into the response. The Response.json
  // signature is overloaded in @types/express so we narrow the body to
  // `unknown` — the original handler may pass any JSON-serializable value.
  const originalJson = res.json.bind(res);
  res.json = function (body: unknown) {
    // Only create contact record on success
    if (res.statusCode >= 200 && res.statusCode < 300) {
      // Extract patientId from URL or body
      const urlMatch = req.originalUrl.match(/\/patients\/([^/]+)/);
      const bodyRec = (body ?? {}) as Record<string, unknown>;
      const patientId = urlMatch?.[1] ?? (req.body?.patientId as string | undefined);

      if (patientId && req.clinicId && req.user?.id) {
        const staffId = req.user.id;
        const nested = (bodyRec.note as Record<string, unknown> | undefined)
          ?? (bodyRec.order as Record<string, unknown> | undefined);
        const sourceId = (bodyRec.id as string | undefined)
          ?? (nested?.id as string | undefined)
          ?? randomUUID();
        // Non-blocking — don't delay the response. Run in an explicit
        // tenant-scoped context so the background contact write doesn't
        // reuse a completed request transaction and doesn't lose RLS scope.
        withTenantContext(req.clinicId, async () => {
          await createAutoContactRecord({
            clinicId: req.clinicId,
            patientId,
            staffId,
            sourceType: inferSourceType(req.originalUrl),
            sourceId,
            briefSummary: `${req.originalUrl.split('/').pop()?.replace(/-/g, ' ')} — ${req.body?.title ?? req.body?.noteType ?? ''}`.trim(),
          });
        }, staffId).catch(() => { /* non-blocking — errors logged inside createAutoContactRecord */ });
      }
    }
    return originalJson(body);
  };

  next();
}
