import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolvePositiveIntEnv } from '../../src/shared/positiveIntEnv';

const LOCAL_LLM_AGENT_PATH = join(
  __dirname,
  '..',
  '..',
  'src',
  'mcp',
  'localLlmAgent.ts',
);
const CONFIG_PATH = join(
  __dirname,
  '..',
  '..',
  'src',
  'config',
  'config.ts',
);

describe('local LLM timeout contract', () => {
  const src = readFileSync(LOCAL_LLM_AGENT_PATH, 'utf8');

  it('does not keep the legacy 150-second Ollama generation cap', () => {
    expect(src).not.toMatch(/AbortSignal\.timeout\(\s*150_000\s*\)/);
    expect(src).toMatch(/resolveLocalLlmGenerateTimeoutMs/);
  });

  it('exposes separate ambient and general Ollama timeout knobs', () => {
    expect(src).toMatch(/AMBIENT_OLLAMA_TIMEOUT_MS/);
    expect(src).toMatch(/LOCAL_LLM_GENERATE_TIMEOUT_MS/);
    expect(src).toMatch(/action:\s*'ambient'/);
  });

  it('keeps OLLAMA_URL as the preferred runtime endpoint with OLLAMA_BASE_URL fallback', () => {
    const configSource = readFileSync(CONFIG_PATH, 'utf8');

    expect(configSource).toMatch(/OLLAMA_URL:\s*z\.string\(\)\.optional\(\)/);
    expect(configSource).toMatch(/baseUrl:\s*env\.OLLAMA_URL\s*\?\?\s*env\.OLLAMA_BASE_URL/);
  });

  it('rejects non-decimal timeout values instead of parseInt truncation', () => {
    for (const value of ['1e6', '1.5', '+600000', '600000ms', '0', '-1']) {
      expect(
        resolvePositiveIntEnv('LOCAL_LLM_GENERATE_TIMEOUT_MS', {
          env: { LOCAL_LLM_GENERATE_TIMEOUT_MS: value } as NodeJS.ProcessEnv,
          fallback: 600000,
          max: 1800000,
          loggerContext: { testValue: value },
        }),
      ).toBe(600000);
    }

    expect(
      resolvePositiveIntEnv('LOCAL_LLM_GENERATE_TIMEOUT_MS', {
        env: { LOCAL_LLM_GENERATE_TIMEOUT_MS: '900000' } as NodeJS.ProcessEnv,
        fallback: 600000,
        max: 1800000,
      }),
    ).toBe(900000);
  });

  it('fails closed on malformed production timeout values', () => {
    expect(() =>
      resolvePositiveIntEnv('LOCAL_LLM_GENERATE_TIMEOUT_MS', {
        env: {
          NODE_ENV: 'production',
          LOCAL_LLM_GENERATE_TIMEOUT_MS: '1e6',
        } as NodeJS.ProcessEnv,
        fallback: 600000,
        max: 1800000,
      }),
    ).toThrow(/Invalid positive integer/);

    expect(() =>
      resolvePositiveIntEnv('LOCAL_LLM_GENERATE_TIMEOUT_MS', {
        env: {
          NODE_ENV: 'production',
          LOCAL_LLM_GENERATE_TIMEOUT_MS: '9999999999999',
        } as NodeJS.ProcessEnv,
        fallback: 600000,
        max: 1800000,
      }),
    ).toThrow(/exceeds safety cap/);
  });
});
