/**
 * HAZARD-010 — AI-scribe hallucination detection.
 *
 * Control for the "LLM scribe invents clinical content that was
 * never spoken" hazard identified in the ISO 14971 risk register.
 *
 * The scribe pipeline produces a structured note (medications,
 * diagnoses, allergies) from a free-text transcript. An LLM can
 * legitimately summarise, paraphrase, and add plausible-sounding
 * clinical content that was NEVER present in the transcript —
 * especially for medication names and dose strengths. In mental
 * health this is lethal: an invented "olanzapine 20 mg" renders
 * as an executed clinical order that a human clinician may sign
 * without cross-checking against the audio.
 *
 * This validator runs AFTER the LLM extraction and BEFORE any
 * persistence or clinician review. It compares every medication
 * and diagnosis string in the structured note against the
 * transcript tokens and flags any that are not substantiated.
 *
 * The flagging is intentionally conservative:
 *   - Medication names are checked as case-insensitive substrings
 *     (the LLM may output "Olanzapine" when the transcript says
 *     "olanzapine")
 *   - Trailing dose strings ("20 mg", "500 micrograms") are
 *     stripped before matching so "olanzapine 20 mg" matches
 *     "olanzapine" in the transcript
 *   - A medication is flagged as a hallucination ONLY when its
 *     root name is entirely absent from the transcript. This
 *     avoids false positives on legitimate paraphrasing while
 *     catching true fabrications.
 *
 * The validator does NOT autonomously delete or modify the note.
 * It returns a structured report the scribe pipeline uses to:
 *   1. Refuse to auto-save the note when any hallucination is
 *      detected — the clinician must explicitly review + accept
 *   2. Render an inline warning on the scribe review UI
 *   3. Persist the hallucination list as scribe_audit rows for
 *      forensic review after a clinical incident
 *
 * Standard satisfied: ISO 14971 HAZARD-010, IEC 62304 §5.1.1,
 *                     TGA AI Software Guidance 2026 §6.3
 *                     (post-hoc output verification), FDA Good
 *                     Machine Learning Practice principle #8
 *                     (deployed models monitored for
 *                     performance).
 */

export interface ScribeStructuredNote {
  medications?: Array<{
    /** LLM-extracted medication name, possibly with dose suffix. */
    name: string;
    dose?: string;
  }>;
  diagnoses?: Array<{
    display: string;
    code?: string;
  }>;
  allergies?: Array<{
    substance: string;
  }>;
  /**
   * Final clinician-facing note text after the formatting pass. Used to
   * detect post-format drift where the renderer mutates a verified
   * medication dose or invents one that never appeared in the
   * transcript/extraction layer.
   */
  noteText?: string;
}

export type HallucinationKind = 'medication' | 'diagnosis' | 'allergy';

export interface HallucinationFinding {
  kind: HallucinationKind;
  /** The exact string from the structured note that was not found. */
  value: string;
  /** The substring that was used for the transcript lookup. */
  rootTerm: string;
  /** Human-readable reason — goes straight to the scribe review UI. */
  reason: string;
}

export interface HallucinationReport {
  ok: boolean;
  findings: HallucinationFinding[];
}

// Terms we strip off the end of medication strings before matching.
// Keep this list stable — every addition changes the false-positive
// rate of the detector. New units must be added to the unit test
// matrix simultaneously.
const DOSE_SUFFIX_TOKENS = [
  'mg', 'mcg', 'microgram', 'micrograms',
  'g', 'gram', 'grams',
  'ml', 'millilitre', 'millilitres',
  'iu', 'units', 'unit',
  'tablet', 'tablets', 'tab', 'tabs',
  'capsule', 'capsules', 'cap', 'caps',
  'puff', 'puffs', 'spray', 'sprays',
  'daily', 'bd', 'tds', 'qid', 'prn', 'mane', 'nocte',
];

const DOSE_NUMBER_RE = /[\d.]+/;
const DOSE_CAPTURE_RE = /(\d+(?:\.\d+)?)\s*(mg|mcg|microgram|micrograms|g|gram|grams|ml|millilitre|millilitres|iu|unit|units)\b/i;

/**
 * Reduce a medication string to its root term for transcript lookup.
 * Strategy:
 *   1. lowercase + trim
 *   2. Split on whitespace
 *   3. Drop any trailing token that is a pure number, a known dose
 *      unit, or a frequency abbreviation
 *   4. The remaining leading tokens are the root name
 *
 * Examples:
 *   "Olanzapine 20 mg"       → "olanzapine"
 *   "Sodium Valproate 500mg" → "sodium valproate"
 *   "Paracetamol 500 mg bd"  → "paracetamol"
 */
export function extractMedicationRoot(raw: string): string {
  const tokens = raw.toLowerCase().trim().split(/\s+/);
  // Walk from the end and drop dose/frequency/number tokens.
  let end = tokens.length;
  while (end > 0) {
    const t = tokens[end - 1];
    const isNumber = DOSE_NUMBER_RE.test(t) && !/[a-z]/.test(t);
    const isUnit = DOSE_SUFFIX_TOKENS.includes(t);
    // Also catch "500mg" (number glued to unit) — strip it.
    const glued = /^[\d.]+(mg|mcg|g|ml|iu)$/.test(t);
    if (isNumber || isUnit || glued) {
      end -= 1;
      continue;
    }
    break;
  }
  // Guard: if we stripped everything, fall back to the first
  // original token. "500mg" alone → falls back to "500mg".
  if (end === 0) return tokens[0] ?? '';
  return tokens.slice(0, end).join(' ');
}

function extractDoseSnippet(raw: string): string | null {
  const match = raw.match(DOSE_CAPTURE_RE);
  if (!match) return null;
  return `${match[1]} ${match[2].toLowerCase()}`;
}

function normalizeDose(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const match = raw.trim().toLowerCase().match(DOSE_CAPTURE_RE);
  if (!match) return null;
  return `${match[1]} ${match[2]}`;
}

/**
 * Normalise a transcript for substring search. Collapses whitespace
 * and lowercases. Keeps punctuation so "olanzapine," still matches
 * "olanzapine".
 */
function normaliseTranscript(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Check whether `term` appears as a whole-word substring of the
 * (already-normalised) transcript. Uses a word-boundary regex so
 * "ola" does not match "olanzapine" (which would miss real
 * hallucinations).
 */
function transcriptContains(transcript: string, term: string): boolean {
  if (!term) return false;
  // Escape regex metacharacters in the term.
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\b${escaped}\\b`, 'i');
  return re.test(transcript);
}

function findMedicationDosesInText(text: string, root: string): string[] {
  if (!text.trim() || !root.trim()) return [];

  const escapedRoot = root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const mentionRe = new RegExp(
    `\\b${escapedRoot}\\b[^\\n.;:]{0,80}?${DOSE_CAPTURE_RE.source}`,
    'ig',
  );
  const doses = new Set<string>();
  for (const match of text.matchAll(mentionRe)) {
    const captured = `${match[1]} ${String(match[2]).toLowerCase()}`;
    doses.add(captured);
  }
  return [...doses];
}

/**
 * Run the detector. Pure function — no I/O, no DB. Callers wire it
 * into the scribe pipeline at the step where the LLM has returned
 * a structured note but the note has not yet been persisted.
 *
 * @param transcript  Raw transcript text from the STT step.
 * @param note        Structured note extracted by the LLM.
 * @returns           { ok: boolean, findings: HallucinationFinding[] }
 *                    ok=true when no hallucinations detected.
 */
export function detectScribeHallucinations(
  transcript: string,
  note: ScribeStructuredNote,
): HallucinationReport {
  const normalisedTranscript = normaliseTranscript(transcript);
  const normalisedNoteText = normaliseTranscript(note.noteText ?? '');
  const findings: HallucinationFinding[] = [];
  const findingKeys = new Set<string>();

  function pushFinding(finding: HallucinationFinding): void {
    const key = `${finding.kind}|${finding.value}|${finding.rootTerm}|${finding.reason}`;
    if (findingKeys.has(key)) return;
    findingKeys.add(key);
    findings.push(finding);
  }

  for (const med of note.medications ?? []) {
    const name = (med.name ?? '').trim();
    if (!name) continue;
    const root = extractMedicationRoot(name);
    const normalizedEmbeddedDose = normalizeDose(extractDoseSnippet(name));
    const normalizedExplicitDose = normalizeDose(med.dose);
    const normalizedExpectedDose = normalizedExplicitDose ?? normalizedEmbeddedDose;
    const rootFound = transcriptContains(normalisedTranscript, root);
    if (!rootFound) {
      pushFinding({
        kind: 'medication',
        value: name,
        rootTerm: root,
        reason: `Medication "${name}" is not substantiated by the transcript (root term "${root}" not found).`,
      });
      // Skip the dose check — the whole drug is already flagged,
      // a second finding on the dose would be noise.
      continue;
    }
    // Separately check the dose string — an LLM can keep the
    // correct medication name but invent a dose. If the dose is
    // present in the note but nowhere in the transcript, flag it.
    if (normalizedExpectedDose) {
      const dose = normalizedExpectedDose;
      // Dose should appear in the transcript either as-is OR with
      // the number alone. "20mg" in note → accept "20 mg" or "20"
      // in transcript as matching evidence.
      const number = dose.match(DOSE_NUMBER_RE)?.[0] ?? '';
      const hasDose =
        normalisedTranscript.includes(dose) ||
        (number && transcriptContains(normalisedTranscript, number));
      if (!hasDose) {
        pushFinding({
          kind: 'medication',
          value: `${name} ${dose}`,
          rootTerm: dose,
          reason: `Dose "${dose}" for ${name} is not substantiated by the transcript.`,
        });
      }
    }

    if (normalisedNoteText) {
      const renderedDoses = findMedicationDosesInText(normalisedNoteText, root)
        .map(normalizeDose)
        .filter((dose): dose is string => Boolean(dose));

      for (const renderedDose of renderedDoses) {
        if (normalizedExpectedDose && renderedDose !== normalizedExpectedDose) {
          pushFinding({
            kind: 'medication',
            value: `${name} -> ${renderedDose}`,
            rootTerm: root,
            reason: `Formatted note states ${renderedDose} for ${name}, but the verified extraction was ${normalizedExpectedDose}.`,
          });
          continue;
        }

        if (!normalizedExpectedDose) {
          const number = renderedDose.match(DOSE_NUMBER_RE)?.[0] ?? '';
          const hasRenderedDoseEvidence =
            normalisedTranscript.includes(renderedDose)
            || (number && transcriptContains(normalisedTranscript, number));
          if (!hasRenderedDoseEvidence) {
            pushFinding({
              kind: 'medication',
              value: `${name} -> ${renderedDose}`,
              rootTerm: root,
              reason: `Formatted note states ${renderedDose} for ${name}, but that dose is not substantiated by the transcript.`,
            });
          }
        }
      }
    }
  }

  for (const dx of note.diagnoses ?? []) {
    const display = (dx.display ?? '').trim();
    if (!display) continue;
    // Diagnoses: check the full display string as a case-insensitive
    // substring. We do NOT word-boundary this because ICD labels
    // often contain punctuation ("Schizophrenia, paranoid type").
    if (!normalisedTranscript.includes(display.toLowerCase())) {
      // Fall back to checking the first noun-like token — "paranoid
      // schizophrenia" in the transcript should match "schizophrenia"
      // in the note even if the exact phrase differs.
      const firstContent = display.toLowerCase().split(/[,\s]+/).find((t) => t.length > 3);
      if (!firstContent || !transcriptContains(normalisedTranscript, firstContent)) {
        findings.push({
          kind: 'diagnosis',
          value: display,
          rootTerm: firstContent ?? display,
          reason: `Diagnosis "${display}" is not substantiated by the transcript.`,
        });
      }
    }
  }

  for (const allergy of note.allergies ?? []) {
    const substance = (allergy.substance ?? '').trim();
    if (!substance) continue;
    const root = extractMedicationRoot(substance);
    if (!transcriptContains(normalisedTranscript, root)) {
      findings.push({
        kind: 'allergy',
        value: substance,
        rootTerm: root,
        reason: `Allergy "${substance}" is not substantiated by the transcript.`,
      });
    }
  }

  return { ok: findings.length === 0, findings };
}
