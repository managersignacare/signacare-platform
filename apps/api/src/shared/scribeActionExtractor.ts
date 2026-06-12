export interface ScribeAction {
  type: 'referral' | 'appointment' | 'prescription' | 'pathology' | 'task' | 'alert';
  description: string;
  details: Record<string, string>;
  autoCreateable: boolean;
}

const PATHOLOGY_TEST_PATTERNS: ReadonlyArray<{ pattern: RegExp; canonical: string }> = [
  { pattern: /\bfbc\b/i, canonical: 'FBC' },
  { pattern: /\bu(?:&|and)\s*e\b/i, canonical: 'U&E' },
  { pattern: /\buec\b/i, canonical: 'UEC' },
  { pattern: /\blft\b/i, canonical: 'LFT' },
  { pattern: /\btft\b/i, canonical: 'TFT' },
  { pattern: /\blipid(?:\s+panel)?\b/i, canonical: 'Lipid panel' },
  { pattern: /\bhba1c\b/i, canonical: 'HbA1c' },
  { pattern: /\bfasting glucose\b/i, canonical: 'Fasting glucose' },
  { pattern: /\bmetabolic panel\b/i, canonical: 'Metabolic panel' },
  { pattern: /\bclozapine level\b/i, canonical: 'Clozapine level' },
  { pattern: /\blithium level\b/i, canonical: 'Lithium level' },
  { pattern: /\bvalproate level\b/i, canonical: 'Valproate level' },
];

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function splitIntoClauses(text: string): string[] {
  return text
    .split(/[\n\r]+|(?<=[.!?;])\s+/)
    .map(normalizeWhitespace)
    .filter((sentence) => sentence.length > 0);
}

function uniquePreserveOrder(values: string[]): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(value);
  }
  return unique;
}

function extractPathologyTestsFromClause(clause: string): string[] {
  const normalized = normalizeWhitespace(clause);
  const lower = normalized.toLowerCase();
  const mentionsPathology =
    /(?:order|request|arrange|book|repeat)\b/.test(lower)
    || /\b(pathology|blood(?:\s+tests?)?|labs?)\b/.test(lower);
  if (!mentionsPathology) return [];

  const recognized = uniquePreserveOrder(
    PATHOLOGY_TEST_PATTERNS
      .filter(({ pattern }) => pattern.test(normalized))
      .map(({ canonical }) => canonical),
  );
  if (recognized.length > 0) return recognized;

  const trailingMatch = normalized.match(
    /(?:pathology|blood(?:\s+tests?)?|labs?)\s*:?\s*(.+)$/i,
  );
  if (!trailingMatch) return [];

  return trailingMatch[1]
    .split(/(?:,| and )/i)
    .map((part) => normalizeWhitespace(part.replace(/^(?:tests?\s+for|for)\s+/i, '')))
    .map((part) => part.replace(/\b(?:this week|next week|today|tomorrow|asap|urgent)\b/gi, '').trim())
    .filter((part) => part.length > 0)
    .filter((part) => !/^pathology:?$/i.test(part));
}

export function extractScribeActions(
  planFacts: string[],
  medicationFacts: string[],
  formattedNote: string,
): ScribeAction[] {
  const actions: ScribeAction[] = [];
  const combined = [...planFacts, formattedNote].join('\n');
  const clauses = splitIntoClauses(combined);

  const referralPatterns = [
    /refer\w*\s+(?:to\s+)?(.+?)(?:\.|$)/gi,
    /referral\s+(?:to\s+)?(.+?)(?:\.|$)/gi,
  ];
  for (const re of referralPatterns) {
    let match;
    while ((match = re.exec(combined)) !== null) {
      actions.push({
        type: 'referral',
        description: `Referral to ${match[1].trim()}`,
        details: { recipient: match[1].trim() },
        autoCreateable: true,
      });
    }
  }

  for (const clause of clauses) {
    if (!/(?:follow[- ]?up|review|appointment|session)/i.test(clause)) continue;
    if (!/(?:book|schedule|arrange|next|follow[- ]?up|review)/i.test(clause)) continue;
    const timeframe = clause.match(/(\d+\s*(?:day|week|fortnight|month)s?)/i)?.[1]?.trim() ?? 'TBA';
    const mode =
      /(telehealth|video|virtual)/i.test(clause) ? 'telehealth'
        : /(phone|telephone|call)/i.test(clause) ? 'phone'
          : /(in person|clinic|face[\s-]?to[\s-]?face)/i.test(clause) ? 'in_person'
            : 'unspecified';
    const description = timeframe === 'TBA'
      ? normalizeWhitespace(clause)
      : `Follow-up${mode !== 'unspecified' ? ` ${mode.replace('_', ' ')}` : ''} in ${timeframe}`;
    actions.push({
      type: 'appointment',
      description,
      details: { timeframe, mode, source: normalizeWhitespace(clause) },
      autoCreateable: true,
    });
  }

  for (const fact of medicationFacts) {
    const lower = fact.toLowerCase();
    if (/start|commence|increase|decrease|cease|change/.test(lower)) {
      actions.push({
        type: 'prescription',
        description: `Medication change: ${fact}`,
        details: { medication: fact },
        autoCreateable: false,
      });
    }
  }

  const seenPath = new Set<string>();
  for (const clause of clauses) {
    for (const test of extractPathologyTestsFromClause(clause)) {
      const key = test.toLowerCase();
      if (seenPath.has(key)) continue;
      seenPath.add(key);
      actions.push({
        type: 'pathology',
        description: `Pathology: ${test}`,
        details: { test, source: normalizeWhitespace(clause) },
        autoCreateable: true,
      });
    }
  }

  if (/safety.*plan|crisis.*plan/i.test(combined)) {
    actions.push({
      type: 'alert',
      description: 'Update safety/crisis plan',
      details: {},
      autoCreateable: false,
    });
  }

  const unique: ScribeAction[] = [];
  const seen = new Set<string>();
  for (const action of actions) {
    const key = `${action.type}:${action.description}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(action);
    }
  }

  return unique;
}
