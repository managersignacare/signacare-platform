/**
 * Australian Medicines Terminology (AMT) SNOMED CT-AU Codes
 *
 * Maps common psychiatric medication generic names to their AMT concept IDs.
 * These codes are required for FHIR MedicationRequest.medicationCodeableConcept
 * when submitting to NPDS.
 *
 * Source: Australian Medicines Terminology (AMT) via SNOMED CT-AU
 * System URI: http://snomed.info/sct  (Australian extension)
 *
 * NOTE: These are Medicinal Product (MP) level codes. For full AMT compliance,
 * use Trade Product Pack (TPP) or Containered Trade Product Pack (CTPP) codes
 * when brand-specific prescribing is required.
 */

export interface AmtCode {
  sctId: string;
  display: string;
  isS8: boolean;
}

/**
 * Lookup table keyed by lowercase generic name.
 * SCT IDs are AMT Medicinal Product (MP) concept IDs.
 */
const AMT_MAP: Record<string, AmtCode> = {
  // ── Antipsychotics ──────────────────────────────────────────────────────
  'olanzapine':       { sctId: '386849001', display: 'olanzapine',       isS8: false },
  'risperidone':      { sctId: '386840002', display: 'risperidone',      isS8: false },
  'quetiapine':       { sctId: '386850001', display: 'quetiapine',       isS8: false },
  'aripiprazole':     { sctId: '406784005', display: 'aripiprazole',     isS8: false },
  'clozapine':        { sctId: '387568001', display: 'clozapine',        isS8: false },
  'paliperidone':     { sctId: '426276000', display: 'paliperidone',     isS8: false },
  'ziprasidone':      { sctId: '386842005', display: 'ziprasidone',      isS8: false },
  'lurasidone':       { sctId: '703123005', display: 'lurasidone',       isS8: false },
  'amisulpride':      { sctId: '391761004', display: 'amisulpride',      isS8: false },
  'haloperidol':      { sctId: '386837002', display: 'haloperidol',      isS8: false },
  'chlorpromazine':   { sctId: '387258005', display: 'chlorpromazine',   isS8: false },
  'flupentixol':      { sctId: '387567006', display: 'flupentixol',      isS8: false },
  'zuclopenthixol':   { sctId: '395739004', display: 'zuclopenthixol',   isS8: false },

  // ── Antidepressants (SSRIs) ──────────────────────────────────────────
  'sertraline':       { sctId: '372594008', display: 'sertraline',       isS8: false },
  'fluoxetine':       { sctId: '372767007', display: 'fluoxetine',       isS8: false },
  'escitalopram':     { sctId: '400447003', display: 'escitalopram',     isS8: false },
  'citalopram':       { sctId: '372596005', display: 'citalopram',       isS8: false },
  'paroxetine':       { sctId: '372595009', display: 'paroxetine',       isS8: false },
  'fluvoxamine':      { sctId: '372905008', display: 'fluvoxamine',      isS8: false },

  // ── Antidepressants (SNRIs/Other) ───────────────────────────────────
  'venlafaxine':      { sctId: '372490001', display: 'venlafaxine',      isS8: false },
  'desvenlafaxine':   { sctId: '442519005', display: 'desvenlafaxine',   isS8: false },
  'duloxetine':       { sctId: '407032004', display: 'duloxetine',       isS8: false },
  'mirtazapine':      { sctId: '386847004', display: 'mirtazapine',      isS8: false },
  'bupropion':        { sctId: '387564004', display: 'bupropion',        isS8: false },
  'agomelatine':      { sctId: '441647003', display: 'agomelatine',      isS8: false },
  'vortioxetine':     { sctId: '713355008', display: 'vortioxetine',     isS8: false },

  // ── Antidepressants (TCAs) ──────────────────────────────────────────
  'amitriptyline':    { sctId: '372726002', display: 'amitriptyline',    isS8: false },
  'nortriptyline':    { sctId: '372659006', display: 'nortriptyline',    isS8: false },
  'imipramine':       { sctId: '372718005', display: 'imipramine',       isS8: false },
  'clomipramine':     { sctId: '372903007', display: 'clomipramine',     isS8: false },
  'doxepin':          { sctId: '372587005', display: 'doxepin',          isS8: false },

  // ── Mood Stabilisers ────────────────────────────────────────────────
  'lithium':          { sctId: '387480006', display: 'lithium',          isS8: false },
  'lithium carbonate':{ sctId: '387480006', display: 'lithium carbonate',isS8: false },
  'sodium valproate': { sctId: '387080000', display: 'valproate sodium', isS8: false },
  'valproate':        { sctId: '387080000', display: 'valproate',        isS8: false },
  'carbamazepine':    { sctId: '387222003', display: 'carbamazepine',    isS8: false },
  'lamotrigine':      { sctId: '387562000', display: 'lamotrigine',      isS8: false },

  // ── Anxiolytics / Sedatives (Schedule 8 or 4) ───────────────────────
  'diazepam':         { sctId: '387264003', display: 'diazepam',         isS8: true },
  'clonazepam':       { sctId: '387383007', display: 'clonazepam',       isS8: true },
  'lorazepam':        { sctId: '387106007', display: 'lorazepam',        isS8: true },
  'oxazepam':         { sctId: '387070004', display: 'oxazepam',         isS8: true },
  'temazepam':        { sctId: '387300007', display: 'temazepam',        isS8: true },
  'nitrazepam':       { sctId: '387449001', display: 'nitrazepam',       isS8: true },
  'alprazolam':       { sctId: '386983007', display: 'alprazolam',       isS8: true },
  'midazolam':        { sctId: '373476007', display: 'midazolam',        isS8: true },
  'zopiclone':        { sctId: '387569009', display: 'zopiclone',        isS8: false },
  'zolpidem':         { sctId: '387571000', display: 'zolpidem',         isS8: false },

  // ── ADHD Medications (Schedule 8) ───────────────────────────────────
  'methylphenidate':  { sctId: '373337007', display: 'methylphenidate',  isS8: true },
  'dexamphetamine':   { sctId: '387278002', display: 'dexamphetamine',   isS8: true },
  'lisdexamfetamine': { sctId: '703804003', display: 'lisdexamfetamine', isS8: true },
  'atomoxetine':      { sctId: '407037005', display: 'atomoxetine',      isS8: false },
  'guanfacine':       { sctId: '395726003', display: 'guanfacine',       isS8: false },

  // ── Opioid Substitution (Schedule 8) ────────────────────────────────
  'methadone':        { sctId: '387286002', display: 'methadone',        isS8: true },
  'buprenorphine':    { sctId: '387173000', display: 'buprenorphine',    isS8: true },

  // ── Anticholinergics ────────────────────────────────────────────────
  'benztropine':      { sctId: '387158001', display: 'benztropine',      isS8: false },
  'biperiden':        { sctId: '387159009', display: 'biperiden',        isS8: false },

  // ── Other ───────────────────────────────────────────────────────────
  'melatonin':        { sctId: '703128001', display: 'melatonin',        isS8: false },
  'propranolol':      { sctId: '372772003', display: 'propranolol',      isS8: false },
  'prazosin':         { sctId: '372837007', display: 'prazosin',         isS8: false },
  'cyproheptadine':   { sctId: '373529000', display: 'cyproheptadine',   isS8: false },
  'naltrexone':       { sctId: '373546005', display: 'naltrexone',       isS8: false },
  'acamprosate':      { sctId: '391756006', display: 'acamprosate',      isS8: false },
  'disulfiram':       { sctId: '387212009', display: 'disulfiram',       isS8: false },
};

/**
 * Look up an AMT SNOMED code by generic medication name.
 * Returns undefined if no match found.
 */
export function lookupAmtCode(genericName: string): AmtCode | undefined {
  const key = genericName.toLowerCase().trim();
  return AMT_MAP[key];
}

/**
 * Get all known AMT codes (for populating dropdowns, etc.)
 */
export function getAllAmtCodes(): { genericName: string; code: AmtCode }[] {
  return Object.entries(AMT_MAP).map(([name, code]) => ({ genericName: name, code }));
}
