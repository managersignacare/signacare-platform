import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('AgenticScribePage recorder wiring', () => {
  const source = readFileSync(resolve(__dirname, './AgenticScribePage.tsx'), 'utf8');

  it('uses the shared ambient recorder instead of introducing a second scribe implementation', () => {
    expect(source).toContain("import { AmbientAiRecorder }");
    expect(source).toContain('<AmbientAiRecorder');
  });

  it('requires patient context before starting embedded medical scribe', () => {
    expect(source).toContain('Select a patient to start Medical Scribe from this page');
    expect(source).toContain('patientId={selectedPatient.id}');
  });

  it('pipes recorder output straight into the transcript field for draft generation', () => {
    expect(source).toContain('onTranscriptReady={(nextTranscript) => setTranscript(nextTranscript)}');
    expect(source).toContain('Record with Medical Scribe or paste transcript content');
  });
});
