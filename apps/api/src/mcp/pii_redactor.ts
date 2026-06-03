// apps/api/src/mcp/pii_redactor.ts
//
// Audit Tier 5.11 (SCRIBE-GAP A4/B10, Dialpad 2025 pattern) — real-time
// PHI redaction before the transcript hits any LLM prompt.
//
// Pass-before-prompt defence: the scribe runtime hands raw text to
// `redactTranscript` which strips AU-format PHI and replaces each
// match with an opaque `[REDACTED:<CATEGORY>]` token. The redacted
// text is what gets composed into the LLM prompt; the original tokens
// are preserved in the return value so the downstream audit trail can
// record which entities were redacted per session.
//
// Scope is AU-format PHI patterns:
//   - Medicare number (10 or 11 digits, with IRN suffix)
//   - IHI (16 digits beginning with 800360)
//   - DVA number (alphanumeric 8-9 chars)
//   - Australian mobile (04xx) and landline (02/03/07/08) phones
//   - Email
//   - URL (http/https)
//
// Names, dates-of-birth, and addresses are NOT covered by the regex
// pass — those require NER (Tier 19 will wire John Snow Labs NER).
// The regex pass is the "cheap safety net" that catches identifiers
// that are trivially pattern-matchable.
//
// NOT removed from the output: clinical content (symptoms, medications,
// diagnoses, vitals) — those are what the scribe is supposed to
// extract. Clinicians' PHI is retained where relevant because the
// clinician is a logged-in entity whose identity is already known.

export interface RedactionEntry {
  category: PhiCategory;
  original: string;
  replacement: string;
  offset: number;  // position in the original text
}

export interface RedactedTranscript {
  text: string;
  entries: RedactionEntry[];
}

export type PhiCategory =
  | 'MEDICARE'
  | 'IHI'
  | 'DVA'
  | 'PHONE_MOBILE'
  | 'PHONE_LANDLINE'
  | 'EMAIL'
  | 'URL';

// Each rule: pattern (with a single capture group = the identifier to
// redact) + category. Order matters when rules could overlap; the
// more specific pattern must come first.
interface Rule {
  category: PhiCategory;
  regex: RegExp;
}

const RULES: Rule[] = [
  // IHI — 16 digits starting with 800360. Common separators: space,
  // hyphen, none.
  {
    category: 'IHI',
    regex: /\b(800360\d{10}|800360[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{2})\b/g,
  },
  // Medicare — 10 or 11 digits with optional IRN suffix / spaces /
  // hyphens. Typical format: 4 digits + 5 digits + 1 check digit
  // (+ optional 1-digit IRN). Commonly rendered as `2428 77813 2 / 1`.
  {
    category: 'MEDICARE',
    regex: /\b(\d{4}[\s-]?\d{5}[\s-]?\d[\s-]?(?:\/?\s?\d)?)\b/g,
  },
  // DVA — typically 1-3 letter state prefix + 6 digits (e.g. NX 123 456).
  {
    category: 'DVA',
    regex: /\b([A-Z]{1,3}[\s-]?\d{3}[\s-]?\d{3})\b/g,
  },
  // AU mobile — 04xx xxx xxx / 04xxxxxxxx / +61 4xx xxx xxx
  {
    category: 'PHONE_MOBILE',
    regex: /(?:\+?61\s?)?(?:\(?0?4\)?[\s-]?\d{2}[\s-]?\d{3}[\s-]?\d{3})\b/g,
  },
  // AU landline — 02 / 03 / 07 / 08 area codes + 8 digits
  {
    category: 'PHONE_LANDLINE',
    regex: /(?:\+?61\s?)?(?:\(?0?[23578]\)?[\s-]?\d{4}[\s-]?\d{4})\b/g,
  },
  // Email
  {
    category: 'EMAIL',
    regex: /\b([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})\b/gi,
  },
  // URL
  {
    category: 'URL',
    regex: /\b(https?:\/\/[^\s<>")]+)/gi,
  },
];

/**
 * Redact PHI from a transcript. Returns the redacted text + an ordered
 * list of entries describing what was removed, for audit storage on
 * `llm_interactions.metadata.redactions`.
 *
 * Pure — no IO, no DB access. Safe to call per-chunk in the scribe
 * streaming pipeline without adding latency.
 */
export function redactTranscript(raw: string): RedactedTranscript {
  if (!raw) return { text: raw, entries: [] };
  const entries: RedactionEntry[] = [];
  let text = raw;
  for (const rule of RULES) {
    // Global regex; rebuild lastIndex for each pass. We mutate text
    // sequentially (one category at a time) so offsets inside the
    // return array stay consistent with the ORIGINAL input for audit.
    const matches: Array<{ match: string; offset: number }> = [];
    let m: RegExpExecArray | null;
    rule.regex.lastIndex = 0;
    while ((m = rule.regex.exec(text)) !== null) {
      matches.push({ match: m[0], offset: m.index });
      if (m[0].length === 0) rule.regex.lastIndex += 1;  // guard against zero-width
    }
    // Apply in reverse so offsets remain valid for the subsequent
    // splices in this pass.
    for (let i = matches.length - 1; i >= 0; i--) {
      const { match, offset } = matches[i];
      const replacement = `[REDACTED:${rule.category}]`;
      entries.push({ category: rule.category, original: match, replacement, offset });
      text = text.slice(0, offset) + replacement + text.slice(offset + match.length);
    }
  }
  // Sort entries by offset for stable audit output.
  entries.sort((a, b) => a.offset - b.offset);
  return { text, entries };
}

/** Convenience summary: the count per category. Used by audit logs. */
export function summariseRedactions(entries: RedactionEntry[]): Record<PhiCategory, number> {
  const out: Partial<Record<PhiCategory, number>> = {};
  for (const e of entries) {
    out[e.category] = (out[e.category] ?? 0) + 1;
  }
  return out as Record<PhiCategory, number>;
}
