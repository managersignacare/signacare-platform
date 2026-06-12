#!/usr/bin/env tsx
/**
 * Clinical Context Orchestrator — contract guard (slice 1).
 *
 * Static drift detector. Mirrors check-ai-scribe-parity-contract.ts shape.
 * Verifies that:
 *   - shared schema declares the typed envelope + lineage + freshness + warning,
 *   - the document-type enum and the policy registry stay in lockstep,
 *   - the budgeter preserves Tier-A by structure (kept seeded from required),
 *   - the sanitizer wraps text with the canonical untrusted-source warning.
 *
 * Scope: schema + policy + guard only. No model router, no provider adapters,
 * no live DB. Future slices (live builder, route wiring, llm_interactions
 * lineage stamp) will extend this guard.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..', '..');

function read(path: string): string {
  return readFileSync(resolve(ROOT, path), 'utf8');
}

const DOCUMENT_TYPES = [
  'scribe-pass2',
  'avs',
  'referral-letter',
  'mht-treatment-order',
  'ndis-access-letter',
  'ndis-supporting-evidence',
  'gp-letter',
  'pharmacy-letter',
  'ndis-support-letter',
  'ndis-review-letter',
] as const;

const checks: Array<{ path: string; patterns: Array<[RegExp | string, string]> }> = [
  {
    path: 'packages/shared/src/clinicalContext.schemas.ts',
    patterns: [
      ['ClinicalContextEnvelopeSchema', 'shared contract must export the typed envelope schema'],
      ['ClinicalContextFactSchema', 'shared contract must export the typed fact schema'],
      ['ContextLineageSchema', 'shared contract must export the lineage schema'],
      ['ContextFreshnessSchema', 'shared contract must export the freshness schema'],
      ['ContextTrustLevelSchema', 'shared contract must export the trust-level schema'],
      ['SanitizedSourceBlockSchema', 'shared contract must export the sanitized source block schema'],
      ['SANITIZED_SOURCE_BLOCK_WARNING', 'shared contract must export the canonical untrusted-source warning constant'],
      ["z.literal('1.0.0')", 'shared contract must pin schemaVersion to 1.0.0'],
      ['sourceTable', 'fact lineage must carry sourceTable'],
      ['sourceId', 'fact lineage must carry sourceId'],
      ['sourceDate', 'fact lineage must carry sourceDate'],
      ['lineageKey', 'fact lineage must carry lineageKey'],
      ['citationRequired', 'fact lineage must carry citationRequired'],
      ['trustLevel', 'fact must carry trustLevel'],
      ['freshness', 'fact must carry freshness'],
      [/contextHash:\s*z\.string\(\)\.regex\(\/\^\[a-f0-9\]\{64\}\$\//, 'envelope contextHash must be pinned to sha256-hex'],
      [/facts:\s*z\.array\(ClinicalContextFactSchema\)\.min\(1\)/, 'envelope must require at least one fact (no empty contexts)'],
      ['UNTRUSTED SOURCE', 'warning string must include UNTRUSTED SOURCE marker'],
    ],
  },
  {
    path: 'packages/shared/src/index.ts',
    patterns: [
      ["export * from './clinicalContext.schemas'", 'shared index must re-export the clinical context schema module'],
    ],
  },
  {
    path: 'apps/api/src/features/llm/context/contextPolicyRegistry.ts',
    patterns: [
      ['CONTEXT_POLICY_REGISTRY', 'policy registry must export CONTEXT_POLICY_REGISTRY'],
      ['getContextPolicy', 'policy registry must export getContextPolicy'],
      ['listRegisteredDocumentTypes', 'policy registry must export listRegisteredDocumentTypes'],
      ['required:', 'each policy must declare a required (Tier-A) array'],
      ['recommended:', 'each policy must declare a recommended (Tier-B) array'],
      ['optional:', 'each policy must declare an optional (Tier-C) array'],
      ['defaultLookbackDays', 'each policy must declare defaultLookbackDays'],
      ['defaultTokenBudget', 'each policy must declare defaultTokenBudget'],
      ['citationRequiredFor', 'each policy must declare citationRequiredFor'],
      ['defaultPhiClass', 'each policy must declare defaultPhiClass'],
      ["schemaVersion: '1.0.0'", 'policy schemaVersion must be pinned to 1.0.0'],
    ],
  },
  {
    path: 'apps/api/src/features/llm/context/contextBudgeter.ts',
    patterns: [
      ['budgetContext', 'budgeter must export budgetContext'],
      [/const kept:\s*ClinicalContextFact\[\]\s*=\s*\[\.\.\.required\]/, 'budgeter must seed kept[] from required[] (Tier-A floor)'],
      ['budgetExceeded', 'budgeter result must include budgetExceeded'],
      ["reason: 'token-budget'", 'budgeter must record token-budget exclusion reason'],
    ],
  },
  {
    path: 'apps/api/src/features/llm/context/contextSanitizer.ts',
    patterns: [
      ['wrapAsUntrustedSource', 'sanitizer must export wrapAsUntrustedSource'],
      ['renderSourceBlockForPrompt', 'sanitizer must export renderSourceBlockForPrompt'],
      ['SANITIZED_SOURCE_BLOCK_WARNING', 'sanitizer must reuse the canonical warning constant'],
      ['stripAsciiControlChars', 'sanitizer must strip ASCII control characters'],
      ['<<<UNTRUSTED-SOURCE', 'sanitizer must wrap text in a labelled fence'],
      ['<<<END-UNTRUSTED-SOURCE', 'sanitizer must close the fence with a matched end-marker'],
    ],
  },
];

const violations: string[] = [];

for (const check of checks) {
  let source: string;
  try {
    source = read(check.path);
  } catch (err) {
    violations.push(`${check.path}: file missing (${(err as Error).message})`);
    continue;
  }
  for (const [pattern, reason] of check.patterns) {
    const pass = typeof pattern === 'string' ? source.includes(pattern) : pattern.test(source);
    if (!pass) violations.push(`${check.path}: ${reason}`);
  }
}

// Cross-file drift: every DOCUMENT_TYPE literal must appear in BOTH the
// shared schema enum AND the policy registry. If a doc type is added in
// one place without the other, this catches it.
const sharedSchemaSource = (() => {
  try { return read('packages/shared/src/clinicalContext.schemas.ts'); }
  catch { return ''; }
})();
const policyRegistrySource = (() => {
  try { return read('apps/api/src/features/llm/context/contextPolicyRegistry.ts'); }
  catch { return ''; }
})();

for (const docType of DOCUMENT_TYPES) {
  if (!sharedSchemaSource.includes(`'${docType}'`)) {
    violations.push(`packages/shared/src/clinicalContext.schemas.ts: ContextDocumentTypeSchema must include '${docType}' (drift vs policy registry)`);
  }
  if (!policyRegistrySource.includes(`'${docType}'`)) {
    violations.push(`apps/api/src/features/llm/context/contextPolicyRegistry.ts: CONTEXT_POLICY_REGISTRY must include '${docType}' (drift vs shared enum)`);
  }
}

if (violations.length > 0) {
  console.error('Clinical context contract failed:');
  for (const violation of violations) console.error(`  - ${violation}`);
  process.exit(1);
}

console.log('Clinical context contract passed.');
