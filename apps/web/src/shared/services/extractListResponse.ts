/**
 * Canonical list-response extractor for frontend queries.
 *
 * Why this exists:
 * - API list endpoints are in mixed migration state across modules:
 *   some return `T[]`, others `{ data: T[] }`, some `{ items: T[] }`.
 * - Ad-hoc per-page `Array.isArray(...) ? ...` checks led to drift and
 *   runtime crashes (`.map is not a function`) when a page assumed one
 *   shape and received another.
 *
 * This helper centralises list extraction and fails loud when payload
 * shape is unexpected, so React Query transitions to `isError` instead
 * of crashing component render.
 */
const DEFAULT_LIST_KEYS = ['data', 'items'] as const;

export function extractListResponse<T>(
  payload: unknown,
  opts?: {
    keys?: readonly string[];
    endpoint?: string;
  },
): T[] {
  if (Array.isArray(payload)) return payload as T[];

  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    const keys = opts?.keys ?? DEFAULT_LIST_KEYS;
    for (const key of keys) {
      const candidate = record[key];
      if (Array.isArray(candidate)) return candidate as T[];
    }
  }

  const endpoint = opts?.endpoint ? ` for "${opts.endpoint}"` : '';
  throw new Error(`Unexpected list response shape${endpoint}`);
}
