// apps/api/src/middleware/parsePagination.ts
//
// Utility to parse pagination params from req.query consistently.
// Replaces the 3 different implementations found during the audit.

import type { PaginationParams } from '@signacare/shared';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;

export function parsePagination(
  query: Record<string, unknown>,
): PaginationParams {
  const page = Math.max(
    1,
    parseInt(String(query.page ?? query.offset ?? DEFAULT_PAGE), 10) || DEFAULT_PAGE,
  );
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, parseInt(String(query.limit ?? query.pageSize ?? DEFAULT_LIMIT), 10) || DEFAULT_LIMIT),
  );
  return { page, limit };
}
