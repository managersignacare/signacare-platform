// apps/api/src/features/prescriptions/therapeuticLevelHelpers.ts
//
// BUG-592 — read-only helper for the therapeutic-level monitoring
// scheduler. Walks active prescriptions for level-monitored drugs
// (lithium / valproate / carbamazepine / warfarin / phenytoin) and joins the
// patient's most-recent matching pathology_results to determine if
// surveillance is overdue.
//
// Tenant isolation: scheduler caller MUST pass `dbAdmin` per BUG-583.
// Per-row `clinic_id` is FK-bound and propagated into every emit.
//
// fix-registry anchors: BUG592-DRUG-CONFIG, BUG592-LATERAL-LATEST-RESULT.

import type { Knex } from 'knex';

/**
 * Apply a safe case-insensitive token match over generic + brand columns
 * without interpolating SQL fragments into `whereRaw`.
 */
export function applyDrugTokenFilter(
  qb: Knex.QueryBuilder,
  genericColumn: string,
  brandColumn: string,
  tokens: readonly string[],
): void {
  if (tokens.length === 0) {
    // Fail-closed: no tokens means no matches are valid.
    qb.whereRaw('1 = 0');
    return;
  }
  qb.andWhere(function addTokenGroups() {
    for (const token of tokens) {
      const wildcarded = `%${token}%`;
      this.orWhere(function addSingleTokenGroup() {
        this.where(genericColumn, 'ilike', wildcarded).orWhere(brandColumn, 'ilike', wildcarded);
      });
    }
  });
}

/**
 * BUG-592 — drug-class configuration. Each entry maps a brand/generic
 * name match-pattern to the relevant pathology test code(s) and the
 * default surveillance threshold (days since last test result).
 *
 * Why these five:
 *   - lithium: narrow therapeutic window (0.4-1.0 mEq/L; toxicity above
 *     1.5). Missed monitoring → renal / cardiac / cognitive harm.
 *   - valproate: serum trough surveillance + hepatotoxicity / aplastic-
 *     anaemia surveillance. Level range 50-100 mcg/mL.
 *   - carbamazepine: serum trough + FBC for aplastic anaemia. Level
 *     range 4-12 mcg/mL.
 *   - warfarin: INR for atrial-fibrillation / mechanical-valve patients
 *     on co-prescription. INR drift outside therapeutic range = bleed
 *     risk above + thrombosis risk below.
 *   - phenytoin: narrow therapeutic window (10-20 mcg/mL), non-linear
 *     pharmacokinetics, and high toxicity risk when unmonitored.
 *
 * The match-pattern includes Australian PBS brand variants per BUG-372c
 * `isHighRiskDrugClass` precedent.
 */
export const THERAPEUTIC_LEVEL_DRUG_CONFIG: ReadonlyArray<{
  drugLabel: string;
  /**
   * ERE pattern matched (case-insensitive) against generic_name +
   * brand_name. Word-boundary anchored (\b...\b) per BUG-592 cycle-2
   * absorb (L4 RC-2 + L3 #2): prevents substring-match false positives
   * across DOACs (e.g. "transitioning from coumadin" remarks) and
   * hypothetical compounds.
   */
  pattern: RegExp;
  /**
   * pathology_results.test_code values that indicate the level draw.
   * Case-insensitive matched (lowercased on both sides per BUG-592
   * cycle-2 absorb L4 RC-1). Includes:
   *   - English token variants (case-folded): 'lithium', 'inr', etc.
   *   - Common AU lab mnemonics: 'li', 'lith', 'inr-1', 'vpa', 'cbz'
   *   - LOINC codes: AU pathology labs increasingly emit LOINC per
   *     ADHA Pathology Information eXchange standard
   * Pre-cycle-2 used only English tokens — silent-zero against any
   * lab not emitting that exact lowercase string. Sibling-perfect
   * with BUG-583 RLS-CLOSED silent-zero closure pattern.
   */
  testCodes: ReadonlyArray<string>;
  /** Default threshold in days; overridable per-clinic */
  defaultThresholdDays: number;
  /** Per-clinic threshold key in `clinic_thresholds` */
  thresholdKey: string;
}> = [
  {
    drugLabel: 'lithium',
    // BUG-592 cycle-2 absorb: word-boundary anchored.
    pattern: /\b(lithium|lithicarb|priadel|quilonum)\b/i,
    // BUG-592 cycle-2 absorb (L4 RC-1): case-insensitive variants
    // + AU lab mnemonics (Li, LITH, LITHIUM) + LOINC 14683-7 (serum lithium).
    testCodes: ['lithium', 'lith', 'li', '14683-7'],
    defaultThresholdDays: 90,
    thresholdKey: 'therapeutic_level_lithium_days',
  },
  {
    drugLabel: 'valproate',
    pattern: /\b(valproate|valproic|epilim|depakote)\b/i,
    // BUG-592 cycle-2 absorb (L4 RC-1): + 'vpa' + LOINC 35668-3 (serum valproate).
    testCodes: ['valproate', 'vpa', 'valproic', '35668-3'],
    defaultThresholdDays: 90,
    thresholdKey: 'therapeutic_level_valproate_days',
  },
  {
    drugLabel: 'carbamazepine',
    pattern: /\b(carbamazepine|tegretol)\b/i,
    // BUG-592 cycle-2 absorb (L4 RC-1): + 'cbz' + 'carbamaz' + LOINC 3431-4.
    testCodes: ['carbamazepine', 'cbz', 'carbamaz', '3431-4'],
    defaultThresholdDays: 90,
    thresholdKey: 'therapeutic_level_carbamazepine_days',
  },
  {
    drugLabel: 'warfarin',
    pattern: /\b(warfarin|coumadin|marevan)\b/i,
    // BUG-592 cycle-2 absorb (L4 RC-1): + 'inr-1' + LOINC 5894-1 (PT/INR).
    // 6301-6 (LOINC) is alternative for prothrombin time-INR.
    testCodes: ['INR', 'inr', 'inr-1', '5894-1', '6301-6'],
    defaultThresholdDays: 14,
    thresholdKey: 'therapeutic_level_warfarin_days',
  },
  {
    drugLabel: 'phenytoin',
    pattern: /\b(phenytoin|dilantin|epanutin)\b/i,
    // BUG-592-FOLLOWUP-PHENYTOIN: includes AU brand variants and
    // LOINC 3968-5 for serum/plasma phenytoin concentration.
    testCodes: ['phenytoin', 'phen', '3968-5'],
    defaultThresholdDays: 90,
    thresholdKey: 'therapeutic_level_phenytoin_days',
  },
];

/**
 * @schema-drift-exempt select-aliased
 * BUG-592 — `TherapeuticLevelOverdueRow` is a SELECT-aliased shape
 * sourced from a JOIN of `prescriptions` + `pathology_results` LATERAL
 * (most-recent test_code match per patient) + `episodes` (LEFT JOIN
 * for primary_clinician_id). `last_result_date` may be NULL when the
 * patient has NEVER had a level draw (overdue-from-day-1 case).
 * Per CLAUDE.md §15.
 */
export interface TherapeuticLevelOverdueRow {
  prescription_id: string;
  clinic_id: string;
  patient_id: string;
  generic_name: string | null;
  brand_name: string | null;
  prescribed_by_staff_id: string;
  primary_clinician_id: string | null;
  drug_label: string;
  test_code: string;
  /** ISO date or NULL if no prior result. */
  last_result_date: string | null;
  /** Days since last result; NULL when no prior result. */
  days_since_last_result: number | null;
}

export const therapeuticLevelHelpers = {
  /**
   * BUG-592 — find active prescriptions of a level-monitored drug
   * whose most-recent matching pathology_result is older than the
   * per-clinic threshold (or has NEVER been drawn).
   *
   * SQL strategy:
   *   1. Filter active prescriptions matching the drug pattern (raw
   *      LIKE because Knex builder cannot express case-insensitive
   *      ILIKE-OR cleanly across multiple patterns).
   *   2. LEFT JOIN LATERAL the patient's most-recent pathology_result
   *      with matching test_code (sibling-perfect with BUG-590
   *      current-episode LATERAL pattern).
   *   3. LEFT JOIN episodes for primary_clinician_id with COALESCE
   *      to current-team via inner LATERAL (BUG-590 sibling).
   *   4. Filter to rows where days_since_last_result > thresholdDays
   *      OR last_result_date IS NULL (NEVER drawn).
   *
   * `conn` required (no default — scheduler MUST pass dbAdmin per
   * BUG-583). Excludes status='cancelled' and 'superseded'.
   */
  async listOverdueTherapeuticLevels(
    conn: Knex,
    drugConfig: typeof THERAPEUTIC_LEVEL_DRUG_CONFIG[number],
    thresholdDays: number,
    // BUG-592 cycle-2 absorb (L3 #1) — REQUIRED clinic_id parameter.
    // Pre-cycle-2 the helper had no clinic_id filter; the processor
    // iterated per-clinic but the SQL was global, causing N×M
    // duplicate processing + cross-clinic threshold drift +
    // duplicate audit_log rows. Per CLAUDE.md §1.3 + §6.3, every
    // multi-tenant SELECT must include clinic_id predicate.
    clinicId: string,
  ): Promise<TherapeuticLevelOverdueRow[]> {
    // Convert RegExp source to a SQL ILIKE-OR: match on generic_name
    // OR brand_name. Strip the regex word-boundary anchors `\b` and
    // outer `()` group introduced in cycle-2 absorb when reducing to
    // SQL tokens (regex engine vs SQL ILIKE differ in syntax).
    const cleanedSource = drugConfig.pattern.source
      .replace(/^\\b\(/, '')
      .replace(/\)\\b$/, '');
    const tokens = cleanedSource
      .split('|')
      .map((token) => token.trim())
      .filter(Boolean);

    const query = conn('prescriptions as pr')
      // BUG-592 cycle-2 absorb (L3 #1) — clinic_id filter (defence-
      // in-depth + per-clinic threshold correctness).
      .where('pr.clinic_id', clinicId)
      .leftJoin('episodes as ep', function () {
        this.on('ep.id', '=', 'pr.episode_id')
          .andOn('ep.clinic_id', '=', 'pr.clinic_id')
          .andOnNull('ep.deleted_at');
      })
      // BUG-590 sibling — current-episode fallback for transferred
      // patients (sibling-perfect with prescriptionRepeatHelpers).
      .joinRaw(`
        LEFT JOIN LATERAL (
          SELECT cur_ep.primary_clinician_id
          FROM episodes AS cur_ep
          WHERE cur_ep.patient_id = pr.patient_id
            AND cur_ep.clinic_id = pr.clinic_id
            AND cur_ep.status = 'open'
            AND cur_ep.deleted_at IS NULL
          ORDER BY cur_ep.start_date DESC
          LIMIT 1
        ) AS cur_ep ON TRUE
      `)
      // BUG-592 — most-recent matching pathology_result per patient.
      // LIMIT 1 + ORDER BY result_date DESC. Returns NULL row when
      // patient has NEVER had a matching test (NEVER-drawn case).
      // BUG-592 cycle-2 absorb (L4 RC-1) — case-insensitive
      // matching: lower(test_code) = ANY(?). Pre-cycle-2 the
      // case-sensitive `test_code = ANY(?)` against lowercase
      // English tokens silent-zero'd against real HL7 OBX-3.1
      // ingest (raw uppercase mnemonics + LOINC codes, never
      // normalised). Sibling-perfect with BUG-583 silent-zero
      // closure pattern.
      .joinRaw(
        `
        LEFT JOIN LATERAL (
          SELECT pr_res.result_date
          FROM pathology_results AS pr_res
          WHERE pr_res.patient_id = pr.patient_id
            AND pr_res.clinic_id = pr.clinic_id
            AND lower(pr_res.test_code) = ANY(?)
          ORDER BY pr_res.result_date DESC
          LIMIT 1
        ) AS latest_result ON TRUE
      `,
        [drugConfig.testCodes.map((c) => c.toLowerCase()) as unknown as string[]],
      )
      .whereIn('pr.status', ['active', 'dispensed'])
      .whereNull('pr.deleted_at')
      .whereRaw(
        `(latest_result.result_date IS NULL OR latest_result.result_date < (now()::date - ?::int))`,
        [thresholdDays],
      )
      .select(
        'pr.id as prescription_id',
        'pr.clinic_id',
        'pr.patient_id',
        'pr.generic_name',
        'pr.brand_name',
        'pr.prescribed_by_staff_id',
        conn.raw(
          'COALESCE(ep.primary_clinician_id, cur_ep.primary_clinician_id) as primary_clinician_id',
        ),
        conn.raw('?::text as drug_label', [drugConfig.drugLabel]),
        conn.raw('?::text as test_code', [drugConfig.testCodes[0]]),
        'latest_result.result_date as last_result_date',
        conn.raw(
          'CASE WHEN latest_result.result_date IS NULL THEN NULL ELSE (now()::date - latest_result.result_date)::int END as days_since_last_result',
        ),
      );
    applyDrugTokenFilter(query, 'pr.generic_name', 'pr.brand_name', tokens);
    const rows = await query;
    return rows as TherapeuticLevelOverdueRow[];
  },
};
