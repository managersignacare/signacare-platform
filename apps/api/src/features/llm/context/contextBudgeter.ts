/**
 * Context budgeter — pure function.
 *
 * Given a flat list of clinical facts + the per-document-type policy,
 * returns the subset that fits the token budget plus the list of
 * exclusions with reason.
 *
 * Load-bearing invariant: Tier-A facts (those whose `domain` appears in
 * `policy.required`) are NEVER silently dropped. If they alone exceed
 * the budget, the result reports `budgetExceeded: true` AND `kept` still
 * contains every Tier-A fact. The caller decides whether to raise
 * CONTEXT_OVERFLOW or to expand the budget — slice-1 just surfaces the
 * fact-of-overflow honestly.
 *
 * No side effects, no I/O, no clock reads — test-friendly and
 * deterministic. The contract test (apps/api/tests/unit/clinicalContextContract.test.ts)
 * proves the Tier-A floor cannot be silently violated.
 */
import type { BudgeterResult, ClinicalContextFact, ContextExclusion } from '@signacare/shared';
import type { ContextPolicy } from './contextPolicyRegistry';

type FactDomain = ClinicalContextFact['domain'];

function domainIn(domain: FactDomain, set: readonly FactDomain[]): boolean {
  return (set as readonly string[]).includes(domain);
}

export function budgetContext(
  facts: readonly ClinicalContextFact[],
  policy: ContextPolicy,
): BudgeterResult {
  const required = facts.filter((f) => domainIn(f.domain, policy.required));
  const recommended = facts.filter((f) => domainIn(f.domain, policy.recommended));
  const optional = facts.filter((f) => domainIn(f.domain, policy.optional));

  // Tier-A floor: include every required fact unconditionally. If they
  // overflow the budget we report it; we never silently drop them.
  const kept: ClinicalContextFact[] = [...required];
  const excluded: ContextExclusion[] = [];

  let runningTokens = required.reduce((acc, f) => acc + f.tokenCost, 0);
  const requiredTokens = runningTokens;

  // Tier-B: drop oldest-first within domain. ISO datetime strings sort
  // lexicographically — newer string > older string.
  const recommendedByFreshness = [...recommended].sort((a, b) =>
    b.freshness.sourceCapturedAt.localeCompare(a.freshness.sourceCapturedAt),
  );
  for (const fact of recommendedByFreshness) {
    if (runningTokens + fact.tokenCost <= policy.defaultTokenBudget) {
      kept.push(fact);
      runningTokens += fact.tokenCost;
    } else {
      excluded.push({ domain: fact.domain, reason: 'token-budget' });
    }
  }

  // Tier-C: caller-supplied opt-ins. Applied last under the same budget.
  for (const fact of optional) {
    if (runningTokens + fact.tokenCost <= policy.defaultTokenBudget) {
      kept.push(fact);
      runningTokens += fact.tokenCost;
    } else {
      excluded.push({ domain: fact.domain, reason: 'token-budget' });
    }
  }

  return {
    kept,
    excluded,
    totalTokens: runningTokens,
    budgetExceeded: requiredTokens > policy.defaultTokenBudget,
  };
}
