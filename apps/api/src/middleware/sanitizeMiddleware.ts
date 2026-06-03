// apps/api/src/middleware/sanitizeMiddleware.ts
//
// Strips HTML tags from all string values in request bodies.
// Prevents stored XSS without affecting clinical data integrity.
//
// Preserves:  plain text, unicode, clinical symbols (<, >, etc. as entities)
// Strips:     <script>, <img onerror=...>, all HTML tags
// Skips:      fields named 'content', 'body', 'htmlBody' (rich text fields)

import type { Request, Response, NextFunction } from 'express';

const TAG_REGEX = /<\/?[a-z][^>]*>/gi;
const RICH_TEXT_FIELDS = new Set(['content', 'body', 'htmlBody', 'foiContent', 'letterBody']);

function stripTags(value: unknown, key?: string): unknown {
  if (typeof value === 'string') {
    // Skip rich-text fields — they're rendered in sandboxed contexts
    if (key && RICH_TEXT_FIELDS.has(key)) return value;
    return value.replace(TAG_REGEX, '');
  }
  if (Array.isArray(value)) {
    return value.map((v) => stripTags(v));
  }
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      cleaned[k] = stripTags(v, k);
    }
    return cleaned;
  }
  return value;
}

/**
 * Sanitize all string fields in request body by stripping HTML tags.
 * Registered globally before route handlers.
 */
export function sanitizeMiddleware(req: Request, _res: Response, next: NextFunction): void {
  if (req.body && typeof req.body === 'object') {
    req.body = stripTags(req.body) as Record<string, unknown>;
  }
  next();
}
