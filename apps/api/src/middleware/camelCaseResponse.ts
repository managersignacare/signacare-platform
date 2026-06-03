/**
 * Response Middleware: snake_case → camelCase
 *
 * Intercepts res.json() and transforms all keys from snake_case to camelCase
 * before sending. This eliminates the need for manual mapping in every endpoint
 * and guarantees the frontend always receives camelCase.
 *
 * Applied globally in server.ts BEFORE route registration.
 *
 * Exceptions:
 *   - FHIR endpoints (FHIR spec requires its own casing)
 *   - Raw file/stream responses (non-JSON)
 *   - Explicitly opted-out responses (res.locals.skipCamelCase = true)
 */

import type { Request, Response, NextFunction } from 'express';

function snakeToCamel(str: string): string {
  return str.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

function transformKeys(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(transformKeys);
  if (typeof obj === 'object' && !(obj instanceof Date)) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[snakeToCamel(key)] = transformKeys(value);
    }
    return result;
  }
  return obj;
}

export function camelCaseResponse(req: Request, res: Response, next: NextFunction): void {
  // Skip FHIR endpoints — they follow the FHIR specification casing.
  // S3.1a: also skip OAuth and well-known endpoints. The OAuth 2 RFCs
  // (6749, 7009, 7662) and SMART App Launch v2 spec all mandate
  // snake_case JSON (access_token, expires_in, client_id, etc.).
  // Even though SMART is currently mounted under /fhir/auth/* (and
  // therefore caught by the /fhir/ guard above), future OAuth routes
  // mounted at /oauth/* would silently break without this guard.
  if (
    req.path.includes('/fhir/') ||
    req.path.includes('/oauth/') ||
    req.path.includes('/.well-known/')
  ) {
    next();
    return;
  }

  const originalJson = res.json.bind(res);

  res.json = function (body: unknown) {
    // Skip if handler explicitly opted out
    if (res.locals.skipCamelCase) {
      return originalJson(body);
    }
    return originalJson(transformKeys(body));
  };

  next();
}
