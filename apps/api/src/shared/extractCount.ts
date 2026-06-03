// apps/api/src/shared/extractCount.ts
//
// Normalizes Knex .count() results which return different shapes
// depending on the database driver. Eliminates the (r[0] as any).cnt
// pattern found 20+ times in the codebase.

export function extractCount(rows: Array<Record<string, unknown>>): number {
  if (!rows || rows.length === 0) return 0;
  const first = rows[0];
  // Knex pg driver returns alias keys verbatim (e.g. cnt / c), or
  // { count: "5" } when no alias is provided.
  const val = first?.cnt ?? first?.c ?? first?.count ?? first?.['count(*)'] ?? 0;
  return parseInt(String(val), 10) || 0;
}
