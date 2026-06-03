import { describe, expect, it } from 'vitest';
import { MseStructuredSchema } from '@signacare/shared';
import { buildMseStructuredContract } from '../../src/features/llm/mseStructured';

describe('BUG-SCRIBE25-004 — mse_structured contract', () => {
  it('builds schemaVersion=1.0 payload with citation cardinality for assessed domains', () => {
    const payload = buildMseStructuredContract({
      sourceSessionId: null,
      mentalStateExam: {
        mood: 'Low mood with psychomotor retardation.',
        speech: 'Soft, slowed speech.',
      },
      citedFacts: [
        {
          text: 'Patient reports low mood and poor energy.',
          transcriptOffset: 21,
          transcriptSnippet: '... reports low mood and poor energy over 3 weeks ...',
          confidence: 0.92,
        },
      ],
    });

    const parsed = MseStructuredSchema.parse(payload);
    expect(parsed.schemaVersion).toBe('1.0');
    expect(parsed.domains.mood?.citations.length).toBeGreaterThan(0);
    expect(parsed.domains.speech?.citations.length).toBeGreaterThan(0);
    expect(parsed.domains.appearance?.certainty).toBe('not_assessed');
    expect(parsed.domains.appearance?.citations).toHaveLength(0);
  });

  it('rejects assessed domains without citations', () => {
    expect(() => MseStructuredSchema.parse({
      schemaVersion: '1.0',
      generatedAt: new Date().toISOString(),
      sourceSessionId: null,
      domains: {
        mood: {
          finding: 'Depressed',
          certainty: 'observed',
          citations: [],
        },
      },
    })).toThrow();
  });
});
