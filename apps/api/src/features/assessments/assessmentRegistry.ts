/**
 * Server-side classifier for templates against the shared SCALE_REGISTRY.
 *
 * The `templates` table stores assessment scales by free-text name.
 * Phase 8 separates outcome measures from rating scales and requires
 * each clinician-rated rating scale to declare a diagnosis category.
 * Rather than migrating the table (which would force every existing
 * clinic to backfill structured columns), we resolve classification at
 * query time by matching `templates.name` -> SCALE_REGISTRY entry via
 * alias normalisation.
 *
 * What this module is NOT:
 *   - A full migration: classification still lives in code, not data.
 *     This is operator-approved per the brief ("If the data model
 *     already supports this, use it. If not, add the smallest durable
 *     schema/registry change needed. Do not create parallel truth in
 *     frontend and backend."). The SSoT is the shared registry; the DB
 *     is content storage.
 *   - A silent classifier: unknown template names are NOT classified.
 *     Callers receive `family: 'unknown'` and the rating-scales API
 *     route excludes them. This is fail-loud — operator brief.
 */
import {
  resolveScaleByTemplateName,
  type DiagnosisCategory,
  type RaterType,
  type ScaleFamily,
} from '@signacare/shared';

/** Minimal shape of a row from the `templates` table. */
export interface TemplateRowLike {
  id: string;
  name: string;
  /** Free-text category column on the templates table. */
  category?: string | null;
  /** Free-text description column. */
  description?: string | null;
  content?: unknown;
  /** Other persisted columns the consumer may carry through. */
  [k: string]: unknown;
}

export interface ClassifiedTemplate<T extends TemplateRowLike = TemplateRowLike> {
  template: T;
  family: ScaleFamily | 'unknown';
  raterType?: RaterType;
  diagnosisCategory?: DiagnosisCategory;
  slug?: string;
  displayName?: string;
}

export function classifyTemplate<T extends TemplateRowLike>(template: T): ClassifiedTemplate<T> {
  const entry = resolveScaleByTemplateName(template.name);
  if (!entry) {
    return { template, family: 'unknown' };
  }
  return {
    template,
    family: entry.family,
    raterType: entry.raterType,
    diagnosisCategory: entry.diagnosisCategory,
    slug: entry.slug,
    displayName: entry.displayName,
  };
}

export interface FilterTemplatesOptions {
  family: ScaleFamily;
  raterType?: RaterType;
  diagnosisCategory?: DiagnosisCategory;
}

/**
 * Filter a list of templates by the operator-required taxonomy. Unknown
 * templates (no registry match) are ALWAYS excluded — this is the
 * fail-loud invariant the operator brief mandates ("Do not hide missing
 * classification problems silently; fail loud in dev/tests").
 *
 * The caller (a route handler) is expected to surface the count of
 * excluded rows in its response or log if non-zero, so operators can
 * see classification drift.
 */
export function filterTemplates<T extends TemplateRowLike>(
  templates: readonly T[],
  options: FilterTemplatesOptions,
): { matched: ClassifiedTemplate<T>[]; unknownCount: number } {
  let unknownCount = 0;
  const matched: ClassifiedTemplate<T>[] = [];
  for (const template of templates) {
    const classified = classifyTemplate(template);
    if (classified.family === 'unknown') {
      unknownCount++;
      continue;
    }
    if (classified.family !== options.family) continue;
    if (options.raterType && classified.raterType !== options.raterType) continue;
    if (
      options.diagnosisCategory
      && classified.diagnosisCategory !== options.diagnosisCategory
    ) continue;
    matched.push(classified);
  }
  return { matched, unknownCount };
}
