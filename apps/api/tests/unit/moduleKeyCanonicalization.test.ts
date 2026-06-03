import { describe, expect, it } from 'vitest';
import { MODULE_KEYS, canonicalizeModuleKey } from '../../src/shared/moduleKeys';

describe('module key canonicalization', () => {
  it('maps legacy ambient and AI-agent aliases to canonical keys', () => {
    expect(canonicalizeModuleKey('ai_scribe')).toBe(MODULE_KEYS.MEDICAL_SCRIBE);
    expect(canonicalizeModuleKey('ai_agent')).toBe(MODULE_KEYS.AI_AGENT);
  });

  it('keeps canonical keys unchanged', () => {
    expect(canonicalizeModuleKey(MODULE_KEYS.MEDICAL_SCRIBE)).toBe(MODULE_KEYS.MEDICAL_SCRIBE);
    expect(canonicalizeModuleKey(MODULE_KEYS.AGENTIC_AI_SCRIBE)).toBe(MODULE_KEYS.AGENTIC_AI_SCRIBE);
  });
});
