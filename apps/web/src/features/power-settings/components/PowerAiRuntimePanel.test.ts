import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('PowerAiRuntimePanel', () => {
  it('keeps Ollama as the default text lane and OpenAI as an explicit opt-in', () => {
    const source = readFileSync(
      resolve(__dirname, 'PowerAiRuntimePanel.tsx'),
      'utf8',
    );

    expect(source).toContain('Whisper remains the default transcription runtime');
    expect(source).toContain('Ollama (default)');
    expect(source).toContain('OpenAI (Azure-hosted, explicit opt-in)');
    expect(source).toContain('disabled={!azureReady}');
    expect(source).toContain('Whisper Sync remains the transcription backend either way.');
  });
});
