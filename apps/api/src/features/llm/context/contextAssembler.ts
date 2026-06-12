import { createHash } from 'node:crypto';
import {
  ClinicalContextEnvelopeSchema,
  type ClinicalContextEnvelope,
  type ClinicalContextFact,
  type ContextDocumentType,
  type ContextExclusion,
  type ContextFactDomain,
  type ContextPhiClass,
} from '@signacare/shared';
import { budgetContext } from './contextBudgeter';
import { getContextPolicy, type ContextPolicy } from './contextPolicyRegistry';

type CanonicalJson =
  | null
  | boolean
  | number
  | string
  | CanonicalJson[]
  | { [key: string]: CanonicalJson };

export interface AssembleClinicalContextEnvelopeInput {
  readonly envelopeId: string;
  readonly documentType: ContextDocumentType;
  readonly builtAt: string;
  readonly facts: readonly ClinicalContextFact[];
  readonly requestedOptionalDomains?: readonly ContextFactDomain[];
  readonly tokenBudgetOverride?: number;
  readonly phiClassOverride?: ContextPhiClass;
  readonly preExcluded?: readonly ContextExclusion[];
}

function domainRankMap(policy: ContextPolicy): Map<ContextFactDomain, number> {
  const orderedDomains: ContextFactDomain[] = [
    ...policy.required,
    ...policy.recommended,
    ...policy.optional,
  ];

  return new Map(orderedDomains.map((domain, index) => [domain, index]));
}

function compareFacts(a: ClinicalContextFact, b: ClinicalContextFact, policy: ContextPolicy): number {
  const ranks = domainRankMap(policy);
  const rankA = ranks.get(a.domain) ?? Number.MAX_SAFE_INTEGER;
  const rankB = ranks.get(b.domain) ?? Number.MAX_SAFE_INTEGER;
  if (rankA !== rankB) {
    return rankA - rankB;
  }

  if (a.domain !== b.domain) {
    return a.domain.localeCompare(b.domain);
  }

  const capturedOrder = b.freshness.sourceCapturedAt.localeCompare(a.freshness.sourceCapturedAt);
  if (capturedOrder !== 0) {
    return capturedOrder;
  }

  const sourceDateOrder = b.lineage.sourceDate.localeCompare(a.lineage.sourceDate);
  if (sourceDateOrder !== 0) {
    return sourceDateOrder;
  }

  const sourceIdOrder = a.lineage.sourceId.localeCompare(b.lineage.sourceId);
  if (sourceIdOrder !== 0) {
    return sourceIdOrder;
  }

  const lineageOrder = a.lineage.lineageKey.localeCompare(b.lineage.lineageKey);
  if (lineageOrder !== 0) {
    return lineageOrder;
  }

  return a.factId.localeCompare(b.factId);
}

function canonicalizeUnknown(value: unknown): CanonicalJson {
  if (value === null) {
    return null;
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : String(value);
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeUnknown(item));
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Buffer.isBuffer(value)) {
    return value.toString('base64');
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const orderedKeys = Object.keys(record).sort((a, b) => a.localeCompare(b));
    const output: Record<string, CanonicalJson> = {};
    for (const key of orderedKeys) {
      const child = record[key];
      if (child !== undefined) {
        output[key] = canonicalizeUnknown(child);
      }
    }
    return output;
  }

  return String(value);
}

function canonicalizeFactForHash(fact: ClinicalContextFact): CanonicalJson {
  return {
    domain: fact.domain,
    lineage: {
      citationRequired: fact.lineage.citationRequired,
      lineageKey: fact.lineage.lineageKey,
      sourceDate: fact.lineage.sourceDate,
      sourceId: fact.lineage.sourceId,
      sourceTable: fact.lineage.sourceTable,
    },
    payload: canonicalizeUnknown(fact.payload),
    tier: fact.tier,
    trustLevel: fact.trustLevel,
  };
}

function isDomainIn(domain: ContextFactDomain, values: readonly ContextFactDomain[]): boolean {
  return (values as readonly string[]).includes(domain);
}

function sortExcluded(excluded: readonly ContextExclusion[], policy: ContextPolicy): ContextExclusion[] {
  const ranks = domainRankMap(policy);
  return [...excluded].sort((a, b) => {
    const rankA = ranks.get(a.domain) ?? Number.MAX_SAFE_INTEGER;
    const rankB = ranks.get(b.domain) ?? Number.MAX_SAFE_INTEGER;
    if (rankA !== rankB) {
      return rankA - rankB;
    }
    const domainOrder = a.domain.localeCompare(b.domain);
    if (domainOrder !== 0) {
      return domainOrder;
    }
    const reasonOrder = a.reason.localeCompare(b.reason);
    if (reasonOrder !== 0) {
      return reasonOrder;
    }
    return (a.note ?? '').localeCompare(b.note ?? '');
  });
}

export function sortFactsForStableOrder(
  facts: readonly ClinicalContextFact[],
  policy: ContextPolicy,
): ClinicalContextFact[] {
  return [...facts].sort((a, b) => compareFacts(a, b, policy));
}

export function createClinicalContextHash(
  facts: readonly ClinicalContextFact[],
  policy: ContextPolicy,
): string {
  const canonicalFacts = sortFactsForStableOrder(facts, policy).map((fact) => canonicalizeFactForHash(fact));
  const canonicalJson = JSON.stringify(canonicalFacts);
  return createHash('sha256').update(canonicalJson).digest('hex');
}

export function assembleClinicalContextEnvelope(
  input: AssembleClinicalContextEnvelopeInput,
): ClinicalContextEnvelope {
  const policy = getContextPolicy(input.documentType);
  const effectiveTokenBudget = input.tokenBudgetOverride ?? policy.defaultTokenBudget;
  const requestedOptional = new Set<ContextFactDomain>(input.requestedOptionalDomains ?? []);
  const allowedFacts: ClinicalContextFact[] = [];
  const excluded: ContextExclusion[] = [...(input.preExcluded ?? [])];

  for (const fact of input.facts) {
    if (isDomainIn(fact.domain, policy.required) || isDomainIn(fact.domain, policy.recommended)) {
      allowedFacts.push(fact);
      continue;
    }

    if (isDomainIn(fact.domain, policy.optional)) {
      if (requestedOptional.has(fact.domain)) {
        allowedFacts.push(fact);
      } else {
        excluded.push({ domain: fact.domain, reason: 'tier-c-not-requested' });
      }
      continue;
    }

    excluded.push({ domain: fact.domain, reason: 'policy-not-allowed' });
  }

  const effectivePolicy: ContextPolicy = {
    ...policy,
    defaultTokenBudget: effectiveTokenBudget,
    optional: policy.optional.filter((domain) => requestedOptional.has(domain)),
  };

  const budgeted = budgetContext(allowedFacts, effectivePolicy);
  const facts = sortFactsForStableOrder(budgeted.kept, effectivePolicy);
  const finalExcluded = sortExcluded([...excluded, ...budgeted.excluded], policy);

  return ClinicalContextEnvelopeSchema.parse({
    envelopeId: input.envelopeId,
    documentType: input.documentType,
    schemaVersion: '1.0.0',
    builtAt: input.builtAt,
    facts,
    phiClass: input.phiClassOverride ?? policy.defaultPhiClass,
    estimatedTokens: budgeted.totalTokens,
    tokenBudget: effectiveTokenBudget,
    contextHash: createClinicalContextHash(facts, effectivePolicy),
    excluded: finalExcluded,
  });
}
