import type { MseCitation, MseStructured } from '@signacare/shared';
import { MseStructuredSchema } from '@signacare/shared';

type MseDomainKey = keyof NonNullable<MseStructured['domains']>;

const DOMAIN_KEYS: MseDomainKey[] = [
  'appearance',
  'behaviour',
  'speech',
  'mood',
  'affect',
  'thoughtForm',
  'thoughtContent',
  'perception',
  'cognition',
  'insight',
  'judgement',
];

interface CitedFactLike {
  text: string;
  transcriptOffset: number;
  transcriptSnippet: string;
  confidence: number;
}

type MentalStateExamLike = Partial<Record<MseDomainKey, string>> | undefined;

function isAssessedFinding(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v.length > 0 && v !== 'not assessed' && v !== '—';
}

function chooseCitation(
  domain: MseDomainKey,
  finding: string,
  citedFacts: CitedFactLike[],
): MseCitation {
  const lowerFinding = finding.toLowerCase();
  const byFinding = citedFacts.find((f) => f.text.toLowerCase().includes(lowerFinding.slice(0, 24)));
  const byDomain = citedFacts.find((f) => f.text.toLowerCase().includes(domain.toLowerCase()));
  const fallback = citedFacts.find((f) => f.confidence >= 0.2) ?? citedFacts[0];

  if (!fallback && !byFinding && !byDomain) {
    return {
      sourceType: 'other',
      sourceId: null,
      excerpt: 'Evidence extraction unavailable; clinician review required.',
      startOffset: null,
      endOffset: null,
    };
  }

  const chosen = byFinding ?? byDomain ?? fallback!;
  return {
    sourceType: 'transcript',
    sourceId: null,
    excerpt: chosen.transcriptSnippet?.trim() || chosen.text.slice(0, 120),
    startOffset: chosen.transcriptOffset,
    endOffset: chosen.transcriptOffset + Math.max(0, chosen.text.length - 1),
  };
}

export function buildMseStructuredContract(input: {
  sourceSessionId?: string | null;
  mentalStateExam?: MentalStateExamLike;
  citedFacts?: CitedFactLike[];
}): MseStructured {
  const citedFacts = input.citedFacts ?? [];
  const domains: MseStructured['domains'] = {};

  for (const key of DOMAIN_KEYS) {
    const finding = input.mentalStateExam?.[key];
    if (isAssessedFinding(finding)) {
      domains[key] = {
        finding: finding!.trim(),
        certainty: 'observed',
        citations: [chooseCitation(key, finding!, citedFacts)],
      };
      continue;
    }
    domains[key] = {
      finding: 'Not assessed',
      certainty: 'not_assessed',
      citations: [],
    };
  }

  return MseStructuredSchema.parse({
    schemaVersion: '1.0',
    generatedAt: new Date().toISOString(),
    sourceSessionId: input.sourceSessionId ?? null,
    domains,
  });
}
