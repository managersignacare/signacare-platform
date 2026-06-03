// apps/api/src/features/llm/scribeSafetyService.ts
//
// Tier 13.1 — sensitive-topic detector + admin-alert dispatcher.
//
// Runs after every scribe transcript is finalised. Scans for keyword
// matches in ten categories (self-harm, suicide_intent, violence,
// abuse_disclosure, child_protection, domestic_violence,
// substance_misuse, sexual_assault, eating_disorder_critical,
// psychosis_acute) and writes one scribe_sensitive_flags row per
// match. Severity is derived from the category + context modifiers
// (plan / means / intent language pushes self-harm to "critical").
//
// Admin-alert side-effect:
//   - severity='critical' → sendAdminAlert(kind='scribe_critical_flag')
//   - severity='high' → logger.warn only (no email spam)
//
// The detector is NOT a clinical classifier — it's a triage trigger.
// False positives are expected and OK; every flag lands in the review
// queue for human triage. False negatives are the risk we accept: a
// keyword-based detector cannot catch paraphrased or coded disclosures.
// The clinician reading the transcript remains the authoritative
// safety net.
//
// Keywords are deliberately conservative — rote matches only, no
// stemming / regex backrefs / phrase order. Pattern-order matters for
// severity derivation: the specific "with plan" / "right now" phrases
// are checked BEFORE the generic category marker so critical severity
// isn't missed.

import { db } from '../../db/db';
import { logger } from '../../utils/logger';
import { sendAdminAlert } from '../patient-outreach/adminAlert';

export type SensitiveCategory =
  | 'self_harm'
  | 'suicide_intent'
  | 'violence_to_others'
  | 'abuse_disclosure'
  | 'child_protection'
  | 'domestic_violence'
  | 'substance_misuse'
  | 'sexual_assault'
  | 'eating_disorder_critical'
  | 'psychosis_acute';

export type SensitiveSeverity = 'low' | 'moderate' | 'high' | 'critical';

interface CategoryRule {
  category: SensitiveCategory;
  baseSeverity: SensitiveSeverity;
  /** Keywords that are sufficient on their own. Lower-cased match. */
  keywords: string[];
  /** Phrases that escalate severity to 'critical' when matched in
   *  conjunction with `keywords`. */
  criticalModifiers: string[];
}

const RULES: CategoryRule[] = [
  {
    category: 'suicide_intent',
    baseSeverity: 'high',
    keywords: [
      'kill myself', 'end my life', 'end it all', 'suicide',
      'not want to be here', "don't want to be here", 'better off dead',
    ],
    criticalModifiers: [
      'tonight', 'right now', 'today', 'this week',
      'have a plan', 'got a plan', 'with a plan',
      'means to', 'pills ready', 'rope', 'gun',
    ],
  },
  {
    category: 'self_harm',
    baseSeverity: 'moderate',
    keywords: [
      'cutting', 'self-harm', 'self harm', 'hurting myself',
      'burning myself', 'hitting myself',
    ],
    criticalModifiers: [
      'tonight', 'right now', 'today', 'increasing',
      'deeper', 'more often',
    ],
  },
  {
    category: 'violence_to_others',
    baseSeverity: 'high',
    keywords: [
      'hurt them', 'kill them', 'kill him', 'kill her',
      'attack them', 'violent thoughts',
    ],
    criticalModifiers: [
      'tonight', 'right now', 'today', 'planning to',
      'have a weapon', 'know where they',
    ],
  },
  {
    category: 'abuse_disclosure',
    baseSeverity: 'high',
    keywords: [
      'abused', 'abuse me', 'hurts me', 'hurting me',
      'beats me', 'hits me',
    ],
    criticalModifiers: ['child', 'children', 'kids', 'baby'],
  },
  {
    category: 'child_protection',
    baseSeverity: 'critical',
    keywords: [
      'child abuse', 'children at risk', 'child neglect',
      'unsafe at home', 'no adult',
    ],
    criticalModifiers: [],
  },
  {
    category: 'domestic_violence',
    baseSeverity: 'high',
    keywords: [
      'partner hits', 'partner hurt', 'partner abuse',
      'afraid of my partner', 'afraid at home',
      'dv ', 'domestic violence',
    ],
    criticalModifiers: ['weapon', 'strangled', 'choked'],
  },
  {
    category: 'substance_misuse',
    baseSeverity: 'moderate',
    keywords: [
      'overdose', 'od\'d', 'heroin', 'injecting',
      'drinking every day', 'every day',
    ],
    criticalModifiers: ['last night', 'yesterday', 'this week'],
  },
  {
    category: 'sexual_assault',
    baseSeverity: 'critical',
    keywords: [
      'raped', 'sexual assault', 'assaulted me',
      'forced me', 'without consent',
    ],
    criticalModifiers: [],
  },
  {
    category: 'eating_disorder_critical',
    baseSeverity: 'high',
    keywords: [
      'not eating', "haven't eaten", 'purging',
      'laxatives', 'vomiting after',
    ],
    criticalModifiers: ['days', 'weeks', 'fainted', 'collapsed'],
  },
  {
    category: 'psychosis_acute',
    baseSeverity: 'high',
    keywords: [
      'voices telling me', 'command hallucination',
      'they are watching', 'tracking me', 'chip in my',
    ],
    criticalModifiers: [
      'tell me to hurt', 'tell me to kill',
      'getting louder', 'new voices',
    ],
  },
];

export interface SensitiveFlag {
  category: SensitiveCategory;
  severity: SensitiveSeverity;
  transcriptOffset: number;
  snippet: string;
}

/**
 * Scans a transcript for sensitive topics. Returns zero or more flags.
 * Pure function; no DB access.
 */
export function scanTranscriptForSensitiveTopics(transcript: string): SensitiveFlag[] {
  const lowered = transcript.toLowerCase();
  const flags: SensitiveFlag[] = [];

  for (const rule of RULES) {
    for (const kw of rule.keywords) {
      let idx = 0;
      while (idx < lowered.length) {
        const found = lowered.indexOf(kw, idx);
        if (found === -1) break;

        // Capture a 60-char window around the match for UI context.
        const start = Math.max(0, found - 20);
        const end = Math.min(transcript.length, found + kw.length + 40);
        const snippet = transcript.slice(start, end);
        const loweredSnippet = snippet.toLowerCase();

        // Severity escalation: if any critical modifier appears in the
        // same 60-char window, bump severity to 'critical'.
        const isCritical = rule.criticalModifiers.some((m) =>
          loweredSnippet.includes(m),
        );

        flags.push({
          category: rule.category,
          severity: isCritical ? 'critical' : rule.baseSeverity,
          transcriptOffset: found,
          snippet: snippet.length > 200 ? `${snippet.slice(0, 197)}...` : snippet,
        });

        idx = found + kw.length;
      }
    }
  }

  return flags;
}

/**
 * Scan + persist + dispatch admin alerts for critical flags. Returns
 * the persisted flag rows (id + category + severity) so the caller
 * can include them in the scribe response for the clinician to
 * review in-line.
 */
export async function detectAndRecordSensitiveFlags(params: {
  clinicId: string;
  sessionId: string;
  patientId: string;
  transcript: string;
}): Promise<Array<{ id: string; category: SensitiveCategory; severity: SensitiveSeverity }>> {
  const { clinicId, sessionId, patientId, transcript } = params;
  const flags = scanTranscriptForSensitiveTopics(transcript);
  if (flags.length === 0) return [];

  const rows = await db('scribe_sensitive_flags')
    .insert(
      flags.map((f) => ({
        clinic_id: clinicId,
        session_id: sessionId,
        patient_id: patientId,
        category: f.category,
        severity: f.severity,
        transcript_offset: f.transcriptOffset,
        snippet: f.snippet,
      })),
    )
    .returning(['id', 'category', 'severity']);

  // Dispatch admin alert for each critical flag. Admin alerts are
  // best-effort (see adminAlert.ts — audit row always written, email
  // is a v2 follow-up).
  const critical = flags.filter((f) => f.severity === 'critical');
  if (critical.length > 0) {
    try {
      await sendAdminAlert({
        clinicId,
        kind: 'scribe_critical_flag',
        payload: {
          sessionId,
          patientId,
          flagCount: critical.length,
          categories: Array.from(new Set(critical.map((f) => f.category))),
        },
      });
    } catch (err) {
      logger.error({ err, sessionId }, 'Failed to dispatch scribe critical flag admin alert');
    }
  }

  logger.info(
    { clinicId, sessionId, patientId, flagCount: flags.length, criticalCount: critical.length },
    'Scribe sensitive-topic scan complete',
  );

  return rows as Array<{ id: string; category: SensitiveCategory; severity: SensitiveSeverity }>;
}
