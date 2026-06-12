import { config } from '../config';

const DEFAULT_OLLAMA_LIST_TIMEOUT_MS = 5_000;

export interface OllamaGenerateResponse {
  model?: string;
  response?: string;
  done?: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
  eval_duration?: number;
}

export interface OllamaTag {
  name?: string;
  modified_at?: string;
  size?: number;
}

export interface OllamaTagsResponse {
  models?: OllamaTag[];
}

function resolveOllamaBaseUrl(): string {
  return config.ollama?.baseUrl ?? 'http://localhost:11434';
}

export async function generateOllamaText(args: {
  model: string;
  prompt: string;
  system?: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
}): Promise<OllamaGenerateResponse> {
  const response = await fetch(`${resolveOllamaBaseUrl()}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: args.model,
      prompt: args.prompt,
      system: args.system,
      stream: false,
      options: {
        temperature: args.temperature,
        num_predict: args.maxTokens,
      },
    }),
    signal: AbortSignal.timeout(args.timeoutMs),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Ollama error ${response.status}: ${errText || response.statusText}`);
  }

  return (await response.json()) as OllamaGenerateResponse;
}

export async function listOllamaTags(
  timeoutMs = DEFAULT_OLLAMA_LIST_TIMEOUT_MS,
): Promise<OllamaTagsResponse> {
  const response = await fetch(`${resolveOllamaBaseUrl()}/api/tags`, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`Ollama tags error ${response.status}: ${response.statusText}`);
  }
  return (await response.json()) as OllamaTagsResponse;
}
