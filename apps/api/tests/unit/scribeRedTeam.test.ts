import { describe, expect, it } from 'vitest';
import { ATTACKS, staticCheck } from '../../../../scripts/tests/scribe-red-team';

describe('red-team injection prompts', () => {
  it('covers 20+ adversarial prompts across 6 categories', () => {
    expect(ATTACKS.length).toBeGreaterThanOrEqual(20);
    const categories = new Set(ATTACKS.map((a) => a.category));
    expect(categories.size).toBe(6);
  });

  it('promptGuard blocks every attack in the static pass', () => {
    const results = ATTACKS.map(staticCheck);
    const failures = results.filter((r) => !r.blocked);
    expect(failures, `Prompts not blocked by promptGuard:\n${failures.map((f) => f.attack.id).join(', ')}`).toHaveLength(0);
  });
});
