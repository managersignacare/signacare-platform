import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const LOCAL_LLM_AGENT_PATH = join(
  __dirname,
  '..',
  '..',
  'src',
  'mcp',
  'localLlmAgent.ts',
);
const TRAINING_ROUTES_PATH = join(
  __dirname,
  '..',
  '..',
  'src',
  'features',
  'llm',
  'llmTrainingRoutes.ts',
);
const OLLAMA_HTTP_CLIENT_PATH = join(
  __dirname,
  '..',
  '..',
  'src',
  'shared',
  'ollamaHttpClient.ts',
);

describe('ollama provider boundary', () => {
  it('keeps low-level Ollama HTTP calls centralized in the shared adapter', () => {
    const localLlmAgentSource = readFileSync(LOCAL_LLM_AGENT_PATH, 'utf8');
    const trainingRoutesSource = readFileSync(TRAINING_ROUTES_PATH, 'utf8');
    const ollamaHttpClientSource = readFileSync(OLLAMA_HTTP_CLIENT_PATH, 'utf8');

    expect(localLlmAgentSource).toContain("from '../shared/ollamaHttpClient'");
    expect(localLlmAgentSource).not.toMatch(/fetch\(/);

    expect(trainingRoutesSource).toContain("from '../../shared/ollamaHttpClient'");
    expect(trainingRoutesSource).not.toMatch(/http:\/\/localhost:11434\/api\/tags/);

    expect(ollamaHttpClientSource).toMatch(/\/api\/generate/);
    expect(ollamaHttpClientSource).toMatch(/\/api\/tags/);
  });
});
