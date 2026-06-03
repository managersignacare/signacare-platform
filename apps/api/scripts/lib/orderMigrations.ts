/**
 * Canonical migration ordering for the post-R2 ledger.
 *
 * Why this exists:
 * - R2 introduced a consolidated baseline migration (20260701000000_baseline).
 * - Historical migrations with lower lexical timestamps may still exist on disk.
 * - Fresh-database bootstrap must apply the baseline first so table-alter
 *   migrations don't execute before their target tables exist.
 *
 * Rule:
 *   baseline first, then the remaining files in lexical order.
 */

export const R2_BASELINE_STEM = '20260701000000_baseline';

export function orderMigrationsForExecution(fileNames: readonly string[]): string[] {
  const sorted = [...fileNames].sort();
  const baseline = sorted.find((name) => name.startsWith(R2_BASELINE_STEM));
  if (!baseline) return sorted;

  const remaining = sorted.filter((name) => name !== baseline);
  return [baseline, ...remaining];
}
