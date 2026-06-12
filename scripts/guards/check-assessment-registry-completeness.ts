#!/usr/bin/env tsx
/**
 * Assessment registry completeness guard
 *
 * Enforces the canonical SSoT for assessment taxonomy
 * (packages/shared/src/assessmentTaxonomy.ts):
 *
 *   1. Every entry in SCALE_REGISTRY parses cleanly via ScaleRegistryEntrySchema
 *      (which already enforces cross-field invariants like
 *      outcome_measure-cannot-carry-raterType, clinician_rated-must-carry-diagnosis).
 *   2. Slugs are unique (case-insensitive).
 *   3. Display names are unique (case-insensitive).
 *   4. Alias canonical forms are unique (a name normalised to its canonical form
 *      must resolve to exactly one scale).
 *   5. No seed script under apps/api/src/ may seed an outcome-measure-classified
 *      scale into category 'Rating Scales'. This prevents the bug class that
 *      Phase D removed (HoNOS / K10 / LSP-16 / BASIS-32 seeded into rating-scales
 *      tables, which then surfaced inside the rating-scales picker).
 *   6. Every non-outcome scale seeded into category 'Rating Scales' resolves
 *      through SCALE_REGISTRY as a rating_scale. Unknown seeded scales are a
 *      UI disappearance bug because the API fail-closes unknown templates.
 *
 * Wired via:  npm run guard:assessment-registry-completeness
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';

import {
  SCALE_REGISTRY,
  ScaleRegistryEntrySchema,
  normaliseScaleName,
  resolveScaleByTemplateName,
} from '../../packages/shared/src/assessmentTaxonomy';
import {
  MAX_TOTAL,
  OUTCOME_MEASURE_FORM_CONFIG,
} from '../../apps/web/src/features/patients/components/detail/tabs/assessmentsConfig';
import { getBuiltinRatingScaleTemplateRows } from '../../apps/api/src/features/assessments/builtinAssessmentDefinitions';

const ROOT = resolve(__dirname, '..', '..');
const ASSESSMENT_SOURCE_ROOT = resolve(ROOT, 'apps', 'api', 'src');
const PROVISIONING_FILES = new Set([
  'apps/api/src/features/provisioning/provisioningService.ts',
]);
const LEGACY_UNSUPPORTED_OUTCOME_NAMES = [
  'BASIS-32 (Behaviour and Symptom Identification Scale)',
] as const;

export interface Violation {
  file: string;
  reason: string;
}

export interface RunGuardResult {
  exitCode: number;
  violations: Violation[];
}

function walkAssessmentSeedAndProvisioningFiles(root: string): string[] {
  const out: string[] = [];
  let entries: string[] = [];
  try {
    entries = readdirSync(root);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name.startsWith('.') || name === 'node_modules' || name === 'dist') continue;
    const full = join(root, name);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      out.push(...walkAssessmentSeedAndProvisioningFiles(full));
      continue;
    }
    const rel = relative(ROOT, full);
    if (
      stats.isFile()
      && name.endsWith('.ts')
      && (name.startsWith('seed-') || PROVISIONING_FILES.has(rel))
    ) {
      out.push(full);
    }
  }
  return out;
}

export function runGuard(): RunGuardResult {
  const violations: Violation[] = [];

  // (1) Every entry parses cleanly through the Zod schema (cross-field invariants).
  SCALE_REGISTRY.forEach((entry, idx) => {
    const parsed = ScaleRegistryEntrySchema.safeParse(entry);
    if (!parsed.success) {
      violations.push({
        file: 'packages/shared/src/assessmentTaxonomy.ts',
        reason: `SCALE_REGISTRY[${idx}] (${entry.slug ?? '?'}) failed Zod parse: ${parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`,
      });
    }
  });

  // (2) Unique slugs.
  const slugSeen = new Map<string, number>();
  SCALE_REGISTRY.forEach((entry, idx) => {
    const slug = entry.slug.toLowerCase();
    if (slugSeen.has(slug)) {
      violations.push({
        file: 'packages/shared/src/assessmentTaxonomy.ts',
        reason: `duplicate slug "${entry.slug}" at SCALE_REGISTRY[${idx}] (also at [${slugSeen.get(slug)}])`,
      });
    } else {
      slugSeen.set(slug, idx);
    }
  });

  // (3) Unique display names.
  const displayNameSeen = new Map<string, number>();
  SCALE_REGISTRY.forEach((entry, idx) => {
    const key = entry.displayName.toLowerCase();
    if (displayNameSeen.has(key)) {
      violations.push({
        file: 'packages/shared/src/assessmentTaxonomy.ts',
        reason: `duplicate displayName "${entry.displayName}" at SCALE_REGISTRY[${idx}] (also at [${displayNameSeen.get(key)}])`,
      });
    } else {
      displayNameSeen.set(key, idx);
    }
  });

  // (4) Alias canonical forms unique across the whole registry.
  const aliasCanonicalSeen = new Map<string, { slug: string; alias: string }>();
  SCALE_REGISTRY.forEach((entry) => {
    const candidates = [entry.displayName, ...(entry.aliases ?? [])];
    for (const candidate of candidates) {
      const canonical = normaliseScaleName(candidate);
      if (!canonical) continue;
      const prior = aliasCanonicalSeen.get(canonical);
      if (prior && prior.slug !== entry.slug) {
        violations.push({
          file: 'packages/shared/src/assessmentTaxonomy.ts',
          reason: `alias collision: "${candidate}" (canonical "${canonical}") resolves to BOTH slug "${prior.slug}" and slug "${entry.slug}"`,
        });
      } else {
        aliasCanonicalSeen.set(canonical, { slug: entry.slug, alias: candidate });
      }
    }
  });

  // (5) Every outcome measure in the shared taxonomy must be renderable
  // by the dedicated Outcome Measures tab. Display names come from the
  // shared SSoT; the web config only owns form mechanics (item count,
  // slider max, chart max).
  const outcomeMeasureCanonicals = new Set<string>();
  for (const entry of SCALE_REGISTRY) {
    if (entry.family !== 'outcome_measure') continue;
    const formConfig = OUTCOME_MEASURE_FORM_CONFIG[entry.slug];
    if (!formConfig) {
      violations.push({
        file: 'apps/web/src/features/patients/components/detail/tabs/assessmentsConfig.ts',
        reason: `outcome measure "${entry.slug}" exists in SCALE_REGISTRY but has no OUTCOME_MEASURE_FORM_CONFIG entry`,
      });
    } else if (formConfig.id !== entry.slug) {
      violations.push({
        file: 'apps/web/src/features/patients/components/detail/tabs/assessmentsConfig.ts',
        reason: `outcome measure "${entry.slug}" form config id drifted to "${formConfig.id}"`,
      });
    }
    if (MAX_TOTAL[entry.slug] === undefined) {
      violations.push({
        file: 'apps/web/src/features/patients/components/detail/tabs/assessmentsConfig.ts',
        reason: `outcome measure "${entry.slug}" has no MAX_TOTAL chart scale`,
      });
    }
    outcomeMeasureCanonicals.add(normaliseScaleName(entry.displayName));
    for (const alias of entry.aliases ?? []) {
      const canonical = normaliseScaleName(alias);
      if (canonical) outcomeMeasureCanonicals.add(canonical);
    }
  }
  for (const legacyName of LEGACY_UNSUPPORTED_OUTCOME_NAMES) {
    const canonical = normaliseScaleName(legacyName);
    if (canonical) outcomeMeasureCanonicals.add(canonical);
  }

  const builtinRows = getBuiltinRatingScaleTemplateRows();
  const builtinSlugSet = new Set(builtinRows.map((row) => row.builtinSlug));
  const registryRatingScaleSlugs = SCALE_REGISTRY
    .filter((entry) => entry.family === 'rating_scale')
    .map((entry) => entry.slug);
  for (const slug of registryRatingScaleSlugs) {
    if (!builtinSlugSet.has(slug)) {
      violations.push({
        file: 'apps/api/src/features/assessments/builtinAssessmentDefinitions.ts',
        reason: `rating_scale "${slug}" exists in SCALE_REGISTRY but has no built-in assessment definition`,
      });
    }
  }
  for (const slug of builtinSlugSet) {
    if (!registryRatingScaleSlugs.includes(slug)) {
      violations.push({
        file: 'apps/api/src/features/assessments/builtinAssessmentDefinitions.ts',
        reason: `built-in assessment definition "${slug}" is not declared in SCALE_REGISTRY`,
      });
    }
  }

  // (6) Seed/provisioning code must not seed outcome measures as 'Rating Scales'.
  const seedFiles = walkAssessmentSeedAndProvisioningFiles(ASSESSMENT_SOURCE_ROOT);
  for (const seedFile of seedFiles) {
    let source: string;
    try {
      source = readFileSync(seedFile, 'utf8');
    } catch {
      continue;
    }
    // Look for any object literal that pairs a name string with category 'Rating Scales'.
    // The pattern is line-aware (within ~12 lines of the name) so we don't false-match
    // a string defined far above its category. We match both single- and double-quoted.
    const nameRe = /name:\s*['"]([^'"]+)['"]/g;
    let nm;
    while ((nm = nameRe.exec(source)) !== null) {
      const nameLiteral = nm[1];
      const canonical = normaliseScaleName(nameLiteral);
      // Confirm category 'Rating Scales' appears within 600 chars of this name (same object literal).
      const window = source.slice(nm.index, Math.min(source.length, nm.index + 600));
      if (!/category:\s*['"]Rating Scales['"]/.test(window)) continue;
      if (canonical && outcomeMeasureCanonicals.has(canonical)) {
        violations.push({
          file: relative(ROOT, seedFile),
          reason: `outcome measure "${nameLiteral}" seeded with category 'Rating Scales' — must be removed (canonical SSoT classifies it as outcome_measure)`,
        });
        continue;
      }
      const resolved = resolveScaleByTemplateName(nameLiteral);
      if (resolved?.family !== 'rating_scale') {
        violations.push({
          file: relative(ROOT, seedFile),
          reason: `rating-scale seed "${nameLiteral}" does not resolve to a rating_scale registry entry — add it to SCALE_REGISTRY or remove it from the seed`,
        });
      }
    }
  }

  return { exitCode: violations.length > 0 ? 1 : 0, violations };
}

if (require.main === module) {
  const result = runGuard();
  if (result.violations.length === 0) {
    console.log('check-assessment-registry-completeness: PASS');
    process.exit(0);
  }
  console.error('check-assessment-registry-completeness: FAIL');
  for (const v of result.violations) {
    console.error(`  - ${v.file}: ${v.reason}`);
  }
  process.exit(result.exitCode);
}
