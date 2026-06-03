/**
 * BUG-034 regression — scribe LLM prompt must NOT invite diagnostic inference.
 *
 * Three prompt sites in apps/api/src/mcp/medicalScribe.ts previously
 * instructed the LLM to emit structured diagnosis content:
 *   - SCRIBE_PASS3_SYSTEM Rule 9: "Use ICD-10-AM codes where diagnosis is mentioned."
 *   - SCRIBE_SOAP_FORMAT Assessment: "Working diagnosis (ICD-10-AM code if stated)"
 *   - SCRIBE_MSE_FORMAT Clinical Impression: "[Working diagnosis and formulation]"
 *
 * The file header declares TGA non-device classification predicated on
 * "No Pass infers, diagnoses, recommends treatment" (medicalScribe.ts:25-34).
 * These prompts contradicted the header's own declaration.
 *
 * This file pins:
 *   (1/3/5) absence of the pre-fix inference-inviting strings
 *   (2/4/6) presence of explicit "NEVER infer" language
 *   (7)     absence of inference-synonym phrasing outside NEGATIVE-rule prose
 *
 * Red-first trace in commit body: 6 of 7 tests FAIL against pre-fix prompts;
 * all 7 PASS post-fix.
 */

import { describe, it, expect, vi } from 'vitest';

// medicalScribe.ts doesn't hit config / db at import time (pure string
// constants + utilities), but tests pulled it via the shared module root
// may drag in transitive imports. Defensive stubs.
vi.mock('../../src/config', () => ({
  config: {
    database: { host: 'localhost', port: 5433, user: 't', password: 't', name: 't', ssl: false, poolMax: 5 },
    jwt: { accessSecret: 'x'.repeat(32), refreshSecret: 'y'.repeat(32), accessTtlMinutes: 60, refreshTtlDays: 7 },
  },
}));
vi.mock('../../src/db/db', () => ({ db: vi.fn(), dbAdmin: vi.fn(), dbRead: vi.fn() }));

import {
  SCRIBE_PASS3_SYSTEM,
  SCRIBE_SOAP_FORMAT,
  SCRIBE_MSE_FORMAT,
} from '../../src/mcp/medicalScribe';

describe('BUG-034 — scribe prompt must not invite diagnostic inference', () => {
  it('(1) Pass 3 system does NOT contain the pre-fix inference-inviting string', () => {
    expect(
      SCRIBE_PASS3_SYSTEM,
      'Pass 3 system still contains pre-fix string "Use ICD-10-AM codes where diagnosis is mentioned" — BUG-034 not applied',
    ).not.toMatch(/Use ICD-10-AM codes where diagnosis is mentioned/);
  });

  it('(2) Pass 3 system contains explicit "NEVER infer" diagnosis rule', () => {
    expect(
      SCRIBE_PASS3_SYSTEM,
      'Pass 3 system must contain explicit "NEVER infer" discipline rule',
    ).toMatch(/NEVER infer.*diagnosis/i);
  });

  it('(3) SOAP Assessment format does NOT contain pre-fix "Working diagnosis (ICD-10-AM code if stated)"', () => {
    expect(
      SCRIBE_SOAP_FORMAT,
      'SOAP Assessment still contains pre-fix "Working diagnosis (ICD-10-AM code if stated)" — BUG-034 not applied',
    ).not.toMatch(/Working diagnosis \(ICD-10-AM code if stated\)/);
  });

  it('(4) SOAP Assessment format contains explicit no-inference instruction', () => {
    expect(
      SCRIBE_SOAP_FORMAT,
      'SOAP Assessment must contain explicit "NEVER infer" instruction',
    ).toMatch(/NEVER infer/i);
  });

  it('(5) MSE Clinical Impression does NOT contain pre-fix "Working diagnosis and formulation"', () => {
    expect(
      SCRIBE_MSE_FORMAT,
      'MSE Clinical Impression still contains pre-fix "Working diagnosis and formulation" — BUG-034 not applied',
    ).not.toMatch(/Working diagnosis and formulation/);
  });

  it('(6) MSE Clinical Impression contains explicit "Do NOT infer" instruction with synonym block', () => {
    expect(
      SCRIBE_MSE_FORMAT,
      'MSE Clinical Impression must contain explicit "Do NOT infer" instruction',
    ).toMatch(/Do NOT infer/i);
    // Synonym block (Critique 2.2) — explicitly names prohibited drift words
    expect(
      SCRIBE_MSE_FORMAT,
      'MSE Clinical Impression must name the prohibited drift words (likely / probable / implied / suggestive)',
    ).toMatch(/likely[\s\S]*probable[\s\S]*implied[\s\S]*suggestive/i);
  });

  it('(7) Synonym-drift sweep — no inference-inviting phrasing outside NEGATIVE-rule prose', () => {
    // Critique 2.3 — regression defence. Future-proofs against a
    // developer rewording the prompt with inference-inviting synonyms.
    //
    // L5 review item 3: the original sentence-level strip (pattern
    // /(?:Do NOT|NEVER)[^.]*\./) only removed the first sentence of a
    // multi-sentence rule. Pass 3 Rule 9 has 6 sentences — sentences
    // 2-6 survived the strip and happened to pass by luck, not design.
    //
    // Fixed approach: strip whole PARAGRAPHS containing a NEGATIVE
    // marker. A paragraph in these prompts is delimited by a blank line
    // OR a numbered-rule boundary ("\n<digit>. "). Any paragraph whose
    // text contains "Do NOT" or "NEVER" (case-insensitive) is the
    // NEGATIVE rule — strip the entire paragraph.
    const combined = [SCRIBE_PASS3_SYSTEM, SCRIBE_SOAP_FORMAT, SCRIBE_MSE_FORMAT]
      .join('\n\n---PROMPT-BOUNDARY---\n\n')
      // Split on blank lines OR numbered-rule boundaries. \n followed by
      // a digit-period marker is the start of the next numbered rule.
      .split(/\n\s*\n|\n(?=\d+\.\s)/)
      // Drop any chunk that is a NEGATIVE rule (contains Do NOT / NEVER).
      .filter((chunk) => !/(?:Do NOT|NEVER)/i.test(chunk))
      .join('\n\n');

    const inferenceInvitingPhrases = [
      /likely diagnosis/i,
      /probable diagnosis/i,
      /implied diagnosis/i,
      /suggestive of/i,
      /apparent diagnosis/i,
      /working diagnosis/i, // Pre-fix string; absence verified in tests 3+5 too, this is the belt-and-braces check.
    ];

    for (const pattern of inferenceInvitingPhrases) {
      expect(
        combined,
        `prompt prose (after stripping NEGATIVE rules) contains inference-inviting phrase ${pattern}`,
      ).not.toMatch(pattern);
    }
  });
});
