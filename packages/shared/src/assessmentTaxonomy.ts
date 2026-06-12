/**
 * Canonical taxonomy for assessment scales.
 *
 * Operator brief (Phase 8 separation refactor):
 *   - Outcome measures are a distinct clinical surface from rating scales.
 *   - Rating scales are split by RATER TYPE (self_rated / clinician_rated).
 *   - Self-rated rating scales surface in the Viva patient app.
 *   - Clinician-rated rating scales are CATEGORISED BY DIAGNOSIS.
 *
 * This file is the SINGLE SOURCE OF TRUTH for the taxonomy. Frontend +
 * backend both consume `SCALE_REGISTRY`; there is NO parallel truth in
 * either layer. The `templates` table stores scale content by name; the
 * registry joins by slug to classify each row at query time.
 *
 * Cross-validation invariants enforced by Zod refinements below:
 *   - family == 'outcome_measure'   -> raterType + diagnosisCategory MUST be undefined
 *   - family == 'rating_scale'      -> raterType is REQUIRED
 *   - family == 'rating_scale'
 *     && raterType == 'clinician_rated' -> diagnosisCategory is REQUIRED
 *   - family == 'rating_scale'
 *     && raterType == 'self_rated'      -> diagnosisCategory is OPTIONAL
 *     (self-rated scales surface under Viva, not under a diagnosis tab)
 *
 * Slugs are stable and lowercase; matching against `templates.name` is
 * performed by a normalisation helper in
 * apps/api/src/features/assessments/assessmentRegistry.ts.
 */
import { z } from 'zod';

/** Top-level family — outcome measure vs rating scale. */
export const ScaleFamilySchema = z.enum(['outcome_measure', 'rating_scale']);
export type ScaleFamily = z.infer<typeof ScaleFamilySchema>;

/** Rater type for rating-scale entries. Outcome measures do not have a rater type. */
export const RaterTypeSchema = z.enum(['self_rated', 'clinician_rated']);
export type RaterType = z.infer<typeof RaterTypeSchema>;

/**
 * Diagnosis-category buckets used to group clinician-rated rating scales
 * in the patient-detail Rating Scales tab. Each clinician-rated scale
 * declares exactly one bucket. Outcome measures and self-rated scales
 * do NOT need a bucket (they surface under different routes).
 *
 * The list is intentionally short + clinically grouped — it is NOT the
 * full ICD/DSM diagnosis catalogue. A scale that covers multiple buckets
 * picks the canonical one (e.g. AIMS -> movement_disorder even though
 * antipsychotic side-effects span psychosis treatment).
 */
export const DiagnosisCategorySchema = z.enum([
  'mood',
  'anxiety',
  'trauma_stress',
  'psychosis',
  'mania_bipolar',
  'substance_use',
  'cognitive_dementia',
  'movement_disorder',
  'global_severity',
  'sleep',
  'eating_personality',
  'general_functional',
]);
export type DiagnosisCategory = z.infer<typeof DiagnosisCategorySchema>;

/**
 * Display label for each diagnosis category. Used by the Rating Scales
 * tab as the accordion heading. Maintained adjacent to the enum so a
 * future contributor cannot add a category to the enum without also
 * naming it.
 */
export const DIAGNOSIS_CATEGORY_LABEL: Readonly<Record<DiagnosisCategory, string>> = {
  mood: 'Mood',
  anxiety: 'Anxiety',
  trauma_stress: 'Trauma & Stress',
  psychosis: 'Psychosis',
  mania_bipolar: 'Mania & Bipolar',
  substance_use: 'Substance Use',
  cognitive_dementia: 'Cognitive & Dementia',
  movement_disorder: 'Movement Disorder',
  global_severity: 'Global Severity',
  sleep: 'Sleep',
  eating_personality: 'Eating & Personality',
  general_functional: 'General / Functional',
} as const;

/**
 * Age cohort the scale is validated for. Display-only metadata; not used
 * for filtering.
 */
export const ScaleAgeGroupSchema = z.enum(['adult', 'older_adult', 'child_adolescent', 'all_ages']);
export type ScaleAgeGroup = z.infer<typeof ScaleAgeGroupSchema>;

/** Raw shape before cross-field refinement. */
const ScaleRegistryEntryShape = z.object({
  /** Stable lowercase identifier; canonical join key against templates.name. */
  slug: z.string().min(1).max(80).regex(/^[a-z0-9][a-z0-9-]*$/),
  /** Display name shown to clinicians. */
  displayName: z.string().min(1).max(200),
  /** outcome_measure | rating_scale. */
  family: ScaleFamilySchema,
  /** REQUIRED for rating_scale; absent for outcome_measure. */
  raterType: RaterTypeSchema.optional(),
  /** REQUIRED for clinician_rated rating_scale; optional otherwise. */
  diagnosisCategory: DiagnosisCategorySchema.optional(),
  /** Age cohort metadata. */
  ageGroup: ScaleAgeGroupSchema,
  /**
   * Optional list of template.name candidates the seed scripts have
   * historically used for this scale. The registry's first match wins;
   * additional aliases let us migrate without touching production data.
   * Always lower-cased + stripped of punctuation by the resolver.
   */
  aliases: z.array(z.string().min(1)).optional(),
  /** Free-text description shown next to the scale name in the UI. */
  description: z.string().max(400).optional(),
});

/**
 * Final entry schema — enforces the cross-field invariants the operator
 * brief makes explicit. A schema parse error here is a programmer error
 * (the registry literal is malformed); it cannot reach production data
 * because the registry is a TypeScript literal.
 */
export const ScaleRegistryEntrySchema = ScaleRegistryEntryShape.superRefine((entry, ctx) => {
  if (entry.family === 'outcome_measure') {
    if (entry.raterType !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['raterType'],
        message: 'outcome_measure entries MUST NOT carry a raterType',
      });
    }
    if (entry.diagnosisCategory !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['diagnosisCategory'],
        message: 'outcome_measure entries MUST NOT carry a diagnosisCategory',
      });
    }
    return;
  }
  // family === 'rating_scale'
  if (entry.raterType === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['raterType'],
      message: 'rating_scale entries REQUIRE a raterType',
    });
    return;
  }
  if (entry.raterType === 'clinician_rated' && entry.diagnosisCategory === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['diagnosisCategory'],
      message: 'clinician_rated rating_scale entries REQUIRE a diagnosisCategory',
    });
  }
});
export type ScaleRegistryEntry = z.infer<typeof ScaleRegistryEntrySchema>;

/**
 * The canonical scale registry. Every assessment scale Signacare knows
 * about lives here exactly once. Order is for code-search convenience
 * only (outcome measures first, then rating scales grouped by diagnosis
 * category).
 *
 * Adding a scale is a two-step process:
 *   1. Add the entry here with full classification.
 *   2. Ensure the seed (or operator data import) names the template
 *      with one of the entry's aliases so the resolver matches it.
 *
 * A scale that exists in `templates` but matches NO registry entry will
 * be rejected by the API's rating-scales route — the alternative is
 * silent classification drift, which the operator brief forbids.
 */
export const SCALE_REGISTRY: readonly ScaleRegistryEntry[] = (
  [
    // ── OUTCOME MEASURES (separate clinical surface) ─────────────────
    {
      slug: 'honos',
      displayName: 'HoNOS (Health of the Nation Outcome Scales)',
      family: 'outcome_measure',
      ageGroup: 'adult',
      aliases: ['HoNOS', 'HoNOS (Health of the Nation Outcome Scales)', 'HoNOS (Adult)'],
      description: 'NOCC-mandated outcome measure for adults receiving public mental-health care.',
    },
    {
      slug: 'honos65',
      displayName: 'HoNOS 65+ (Older Persons)',
      family: 'outcome_measure',
      ageGroup: 'older_adult',
      aliases: ['HoNOS 65+', 'HoNOS 65+ (Older Persons)'],
    },
    {
      slug: 'honosca',
      displayName: 'HoNOSCA (Child & Adolescent)',
      family: 'outcome_measure',
      ageGroup: 'child_adolescent',
      aliases: ['HoNOSCA', 'HoNOSCA (Child and Adolescent)', 'HoNOSCA (Child & Adolescent)'],
    },
    {
      slug: 'k10',
      displayName: 'K10 (Kessler Psychological Distress Scale)',
      family: 'outcome_measure',
      ageGroup: 'adult',
      aliases: ['K10', 'K10 (Kessler Psychological Distress Scale)'],
    },
    {
      slug: 'k10plus',
      displayName: 'K10+ (Extended Kessler Psychological Distress Scale)',
      family: 'outcome_measure',
      ageGroup: 'adult',
      // K10 vs K10+ ambiguity: normaliseScaleName() strips non-alphanumerics,
      // so 'K10+' alone collapses to 'k10' and collides with the K10 alias.
      // Only retain aliases that remain unique after normalisation —
      // template authors using just "K10+" cannot be resolved unambiguously
      // and must use the fuller form to disambiguate (fail-loud by design).
      aliases: ['K10+ (Extended)', 'K10+ Extended', 'K10 Plus'],
    },
    {
      slug: 'lsp16',
      displayName: 'LSP-16 (Life Skills Profile)',
      family: 'outcome_measure',
      ageGroup: 'adult',
      aliases: ['LSP-16', 'LSP-16 (Life Skills Profile)'],
    },
    // ── SELF-RATED RATING SCALES (surfaced in Viva) ──────────────────
    {
      slug: 'phq9',
      displayName: 'PHQ-9 (Patient Health Questionnaire-9)',
      family: 'rating_scale',
      raterType: 'self_rated',
      diagnosisCategory: 'mood',
      ageGroup: 'adult',
      aliases: ['PHQ-9', 'PHQ-9 (Patient Health Questionnaire-9)', 'PHQ-9 (Patient Health Questionnaire)'],
    },
    {
      slug: 'gad7',
      displayName: 'GAD-7 (Generalised Anxiety Disorder-7)',
      family: 'rating_scale',
      raterType: 'self_rated',
      diagnosisCategory: 'anxiety',
      ageGroup: 'adult',
      aliases: ['GAD-7', 'GAD-7 (Generalized Anxiety Disorder-7)', 'GAD-7 (Generalised Anxiety Disorder)', 'GAD-7 (Generalised Anxiety Disorder-7)'],
    },
    {
      slug: 'dass21',
      displayName: 'DASS-21 (Depression Anxiety Stress Scales)',
      family: 'rating_scale',
      raterType: 'self_rated',
      ageGroup: 'adult',
      aliases: ['DASS-21', 'DASS-21 (Depression Anxiety Stress Scales)'],
    },
    {
      slug: 'pcl5',
      displayName: 'PCL-5 (PTSD Checklist DSM-5)',
      family: 'rating_scale',
      raterType: 'self_rated',
      ageGroup: 'adult',
      aliases: ['PCL-5', 'PCL-5 (PTSD Checklist DSM-5)'],
    },
    {
      slug: 'audit',
      displayName: 'AUDIT (Alcohol Use Disorders Identification Test)',
      family: 'rating_scale',
      raterType: 'self_rated',
      ageGroup: 'adult',
      aliases: ['AUDIT', 'AUDIT (Alcohol Use Disorders Identification Test)'],
    },
    {
      slug: 'dast10',
      displayName: 'DAST-10 (Drug Abuse Screening Test)',
      family: 'rating_scale',
      raterType: 'self_rated',
      ageGroup: 'adult',
      aliases: ['DAST-10', 'DAST-10 (Drug Abuse Screening Test)'],
    },
    {
      slug: 'bdi2',
      displayName: 'BDI-II (Beck Depression Inventory-II)',
      family: 'rating_scale',
      raterType: 'self_rated',
      diagnosisCategory: 'mood',
      ageGroup: 'adult',
      aliases: ['BDI-II', 'BDI-II (Beck Depression Inventory-II)'],
    },
    {
      slug: 'bai',
      displayName: 'BAI (Beck Anxiety Inventory)',
      family: 'rating_scale',
      raterType: 'self_rated',
      ageGroup: 'adult',
      aliases: ['BAI', 'BAI (Beck Anxiety Inventory)'],
    },
    {
      slug: 'epds',
      displayName: 'EPDS (Edinburgh Postnatal Depression Scale)',
      family: 'rating_scale',
      raterType: 'self_rated',
      ageGroup: 'adult',
      aliases: ['EPDS', 'EPDS (Edinburgh Postnatal Depression Scale)'],
    },
    {
      slug: 'pss10',
      displayName: 'PSS-10 (Perceived Stress Scale)',
      family: 'rating_scale',
      raterType: 'self_rated',
      ageGroup: 'adult',
      aliases: ['PSS-10', 'PSS-10 (Perceived Stress Scale)'],
    },
    {
      slug: 'isi',
      displayName: 'ISI (Insomnia Severity Index)',
      family: 'rating_scale',
      raterType: 'self_rated',
      ageGroup: 'adult',
      aliases: ['ISI', 'ISI (Insomnia Severity Index)'],
    },
    {
      slug: 'psqi',
      displayName: 'PSQI (Pittsburgh Sleep Quality Index)',
      family: 'rating_scale',
      raterType: 'self_rated',
      ageGroup: 'adult',
      aliases: ['PSQI', 'PSQI (Pittsburgh Sleep Quality Index - Component Ratings)', 'PSQI (Pittsburgh Sleep Quality Index)'],
    },
    {
      slug: 'who5',
      displayName: 'WHO-5 (World Health Organization Well-Being Index)',
      family: 'rating_scale',
      raterType: 'self_rated',
      ageGroup: 'adult',
      aliases: ['WHO-5', 'WHO-5 (World Health Organization Well-Being Index)'],
    },
    {
      slug: 'sds',
      displayName: 'SDS (Sheehan Disability Scale)',
      family: 'rating_scale',
      raterType: 'self_rated',
      ageGroup: 'adult',
      aliases: ['SDS', 'SDS (Sheehan Disability Scale)'],
    },
    {
      slug: 'mdq',
      displayName: 'MDQ (Mood Disorder Questionnaire)',
      family: 'rating_scale',
      raterType: 'self_rated',
      diagnosisCategory: 'mania_bipolar',
      ageGroup: 'adult',
      aliases: ['MDQ', 'MDQ (Mood Disorder Questionnaire)'],
    },
    {
      slug: 'asrs',
      displayName: 'ASRS v1.1 (Adult ADHD Self-Report Scale)',
      family: 'rating_scale',
      raterType: 'self_rated',
      ageGroup: 'adult',
      aliases: ['ASRS', 'ASRS v1.1', 'ASRS v1.1 (Adult ADHD Self-Report Scale)'],
    },
    {
      slug: 'ocir',
      displayName: 'OCI-R (Obsessive-Compulsive Inventory - Revised)',
      family: 'rating_scale',
      raterType: 'self_rated',
      diagnosisCategory: 'anxiety',
      ageGroup: 'adult',
      aliases: ['OCI-R', 'OCI-R (Obsessive-Compulsive Inventory - Revised)'],
    },
    {
      slug: 'ybocs-sr',
      displayName: 'Y-BOCS-SR (Yale-Brown Obsessive Compulsive Scale - Self Report)',
      family: 'rating_scale',
      raterType: 'self_rated',
      diagnosisCategory: 'anxiety',
      ageGroup: 'adult',
      aliases: ['Y-BOCS-SR', 'Y-BOCS-SR (Yale-Brown Obsessive Compulsive Scale - Self Report)'],
    },
    {
      slug: 'rcads25',
      displayName: 'RCADS-25 (Revised Child Anxiety and Depression Scale)',
      family: 'rating_scale',
      raterType: 'self_rated',
      ageGroup: 'child_adolescent',
      aliases: ['RCADS-25', 'RCADS-25 (Revised Child Anxiety and Depression Scale)'],
    },

    // ── CLINICIAN-RATED RATING SCALES (grouped by diagnosis) ─────────
    {
      slug: 'hamd17',
      displayName: 'HAM-D 17 (Hamilton Depression Rating Scale)',
      family: 'rating_scale',
      raterType: 'clinician_rated',
      diagnosisCategory: 'mood',
      ageGroup: 'adult',
      aliases: ['HAM-D', 'HAMD', 'HAM-D 17', 'HAM-D-17', 'HAM-D 17 (Hamilton Depression Rating Scale)', 'Hamilton Depression Rating Scale'],
    },
    {
      slug: 'madrs',
      displayName: 'MADRS (Montgomery-Åsberg Depression Rating Scale)',
      family: 'rating_scale',
      raterType: 'clinician_rated',
      diagnosisCategory: 'mood',
      ageGroup: 'adult',
      aliases: ['MADRS', 'MADRS (Montgomery-Åsberg Depression Rating Scale)'],
    },
    {
      slug: 'hama',
      displayName: 'HAM-A (Hamilton Anxiety Rating Scale)',
      family: 'rating_scale',
      raterType: 'clinician_rated',
      diagnosisCategory: 'anxiety',
      ageGroup: 'adult',
      aliases: ['HAM-A', 'HAM-A (Hamilton Anxiety Rating Scale)', 'Hamilton Anxiety Rating Scale'],
    },
    {
      slug: 'ymrs',
      displayName: 'YMRS (Young Mania Rating Scale)',
      family: 'rating_scale',
      raterType: 'clinician_rated',
      diagnosisCategory: 'mania_bipolar',
      ageGroup: 'adult',
      aliases: ['YMRS', 'YMRS (Young Mania Rating Scale)'],
    },
    {
      slug: 'bprs24',
      displayName: 'BPRS-24 (Brief Psychiatric Rating Scale)',
      family: 'rating_scale',
      raterType: 'clinician_rated',
      diagnosisCategory: 'psychosis',
      ageGroup: 'adult',
      aliases: ['BPRS', 'BPRS-24', 'BPRS-24 (Brief Psychiatric Rating Scale)', 'BPRS (Brief Psychiatric Rating Scale)'],
    },
    {
      slug: 'panss',
      displayName: 'PANSS (Positive and Negative Syndrome Scale)',
      family: 'rating_scale',
      raterType: 'clinician_rated',
      diagnosisCategory: 'psychosis',
      ageGroup: 'adult',
      aliases: ['PANSS', 'PANSS (Positive and Negative Syndrome Scale)'],
    },
    {
      slug: 'aims',
      displayName: 'AIMS (Abnormal Involuntary Movement Scale)',
      family: 'rating_scale',
      raterType: 'clinician_rated',
      diagnosisCategory: 'movement_disorder',
      ageGroup: 'adult',
      aliases: ['AIMS', 'AIMS (Abnormal Involuntary Movement Scale)'],
    },
    {
      slug: 'sas',
      displayName: 'SAS (Simpson-Angus Scale)',
      family: 'rating_scale',
      raterType: 'clinician_rated',
      diagnosisCategory: 'movement_disorder',
      ageGroup: 'adult',
      aliases: ['SAS', 'SAS (Simpson-Angus Scale)'],
    },
    {
      slug: 'cgi',
      displayName: 'CGI (Clinical Global Impression — Severity/Improvement)',
      family: 'rating_scale',
      raterType: 'clinician_rated',
      diagnosisCategory: 'global_severity',
      ageGroup: 'all_ages',
      aliases: ['CGI', 'CGI (Clinical Global Impression - Severity/Improvement)', 'CGI (Clinical Global Impression — Severity/Improvement)'],
    },
    {
      slug: 'gaf',
      displayName: 'GAF (Global Assessment of Functioning)',
      family: 'rating_scale',
      raterType: 'clinician_rated',
      diagnosisCategory: 'global_severity',
      ageGroup: 'adult',
      aliases: ['GAF', 'GAF (Global Assessment of Functioning)', 'Global Assessment of Functioning'],
    },
    {
      slug: 'mmse',
      displayName: 'MMSE (Mini-Mental State Examination)',
      family: 'rating_scale',
      raterType: 'clinician_rated',
      diagnosisCategory: 'cognitive_dementia',
      ageGroup: 'older_adult',
      aliases: ['MMSE', 'MMSE (Mini-Mental State Examination)', 'Mini-Mental State Examination'],
    },
    {
      slug: 'moca',
      displayName: 'MoCA (Montreal Cognitive Assessment)',
      family: 'rating_scale',
      raterType: 'clinician_rated',
      diagnosisCategory: 'cognitive_dementia',
      ageGroup: 'older_adult',
      aliases: ['MoCA', 'MOCA', 'MoCA (Montreal Cognitive Assessment)', 'Montreal Cognitive Assessment'],
    },
  ] as const satisfies readonly ScaleRegistryEntry[]
).map((entry) => ScaleRegistryEntrySchema.parse(entry));

// ── Lookup + filter helpers ──────────────────────────────────────────

const slugIndex = new Map<string, ScaleRegistryEntry>(
  SCALE_REGISTRY.map((entry) => [entry.slug, entry]),
);

const aliasIndex = (() => {
  const map = new Map<string, ScaleRegistryEntry>();
  for (const entry of SCALE_REGISTRY) {
    map.set(normaliseScaleName(entry.displayName), entry);
    for (const alias of entry.aliases ?? []) map.set(normaliseScaleName(alias), entry);
  }
  return map;
})();

/**
 * Normalise a free-text scale name for alias matching: lowercase, drop
 * everything outside `[a-z0-9 ]`, collapse whitespace.
 *
 * Examples:
 *   "PHQ-9 (Patient Health Questionnaire-9)" -> "phq9 patient health questionnaire9"
 *   "HoNOS 65+"                              -> "honos 65"
 */
export function normaliseScaleName(name: string): string {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function getScaleBySlug(slug: string): ScaleRegistryEntry | undefined {
  return slugIndex.get(slug);
}

/**
 * Resolve a free-text template name to a registry entry via alias
 * matching. Returns undefined for unknown names — the API is expected
 * to fail loud (not silently classify as "rating scale") so the caller
 * can surface the gap.
 */
export function resolveScaleByTemplateName(templateName: string): ScaleRegistryEntry | undefined {
  return aliasIndex.get(normaliseScaleName(templateName));
}

export function listOutcomeMeasures(): readonly ScaleRegistryEntry[] {
  return SCALE_REGISTRY.filter((e) => e.family === 'outcome_measure');
}

export function listSelfRatedScales(): readonly ScaleRegistryEntry[] {
  return SCALE_REGISTRY.filter(
    (e) => e.family === 'rating_scale' && e.raterType === 'self_rated',
  );
}

export function listClinicianRatedScales(): readonly ScaleRegistryEntry[] {
  return SCALE_REGISTRY.filter(
    (e) => e.family === 'rating_scale' && e.raterType === 'clinician_rated',
  );
}

/**
 * Group clinician-rated scales by diagnosis category, in the
 * declaration order of the diagnosis-category enum. Used by the Rating
 * Scales tab to render accordion groups.
 */
export function groupClinicianRatedByDiagnosis(): Array<{
  diagnosis: DiagnosisCategory;
  label: string;
  scales: ScaleRegistryEntry[];
}> {
  const orderedDiagnoses = DiagnosisCategorySchema.options;
  const buckets: Array<{ diagnosis: DiagnosisCategory; label: string; scales: ScaleRegistryEntry[] }> = [];
  for (const diagnosis of orderedDiagnoses) {
    const scales = SCALE_REGISTRY.filter(
      (e) =>
        e.family === 'rating_scale'
        && e.raterType === 'clinician_rated'
        && e.diagnosisCategory === diagnosis,
    );
    if (scales.length === 0) continue;
    buckets.push({
      diagnosis,
      label: DIAGNOSIS_CATEGORY_LABEL[diagnosis],
      scales: [...scales],
    });
  }
  return buckets;
}

/**
 * The names that historically appeared with `category: 'Rating Scales'`
 * in the seed scripts but actually belong to the outcome-measure surface.
 * Used by the seed-hygiene CI guard to prevent re-introduction.
 */
export const OUTCOME_MEASURE_SCALE_DISPLAY_NAMES: readonly string[] = listOutcomeMeasures().map(
  (entry) => entry.displayName,
);
