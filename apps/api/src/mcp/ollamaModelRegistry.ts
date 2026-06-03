// apps/api/src/mcp/ollamaModelRegistry.ts
//
// Audit Tier 4.4 (CRIT-G3 part 1) — minimal model-version registry.
//
// Every scribe / AI-generated artefact must record which Ollama model
// (name + content digest) produced it so that when a model is swapped
// under the hood, clinical reviewers can tell which notes were
// generated under the new weights. This module:
//
//   - Queries Ollama `/api/tags` and `/api/show` at startup + lazily
//     on first use, caching the (modelName → 'sha256:digest') map in
//     memory.
//   - Exposes `getModelVersion(name)` used by writeLlmInteraction to
//     stamp `metadata.modelVersion`.
//   - Degrades gracefully: if Ollama is unreachable we return
//     `<name>@unknown` rather than failing the LLM write-path. The
//     full model registry + startup-fail semantics land in Tier 19.
//
// NOT in scope here: enforcement (refuse to run unapproved model),
// admin approval UI, per-clinic overrides. Those are Tier 19.10.

import logger from '../utils/logger';
import { config } from '../config/config';

interface OllamaTagsResponse {
  models?: Array<{
    name: string;
    model?: string;
    digest?: string;
    size?: number;
    modified_at?: string;
  }>;
}

interface OllamaShowResponse {
  modelfile?: string;
  parameters?: string;
  template?: string;
  details?: {
    digest?: string;
    format?: string;
    parameter_size?: string;
  };
}

const UNKNOWN = 'unknown';

class OllamaModelRegistry {
  private digests = new Map<string, string>();
  private startupLogged = false;

  private get baseUrl(): string {
    return config.ollama?.baseUrl ?? 'http://localhost:11434';
  }

  /** Returns a stable version string `name@digest`. */
  async getModelVersion(name: string): Promise<string> {
    if (!name) return `${UNKNOWN}@${UNKNOWN}`;
    const cached = this.digests.get(name);
    if (cached) return `${name}@${cached}`;
    const digest = await this.fetchDigest(name);
    this.digests.set(name, digest);
    return `${name}@${digest}`;
  }

  /**
   * Startup health check — called once from server boot. Logs every
   * installed model's digest so deployments have an audit baseline
   * without tying boot success to Ollama reachability.
   */
  async logStartupSnapshot(): Promise<void> {
    if (this.startupLogged) return;
    this.startupLogged = true;
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`);
      if (!res.ok) {
        logger.warn({ status: res.status }, 'ollamaModelRegistry: /api/tags non-200');
        return;
      }
      const data = (await res.json()) as OllamaTagsResponse;
      const installed = data.models ?? [];
      for (const m of installed) {
        if (m.name && m.digest) this.digests.set(m.name, m.digest);
      }
      logger.info(
        {
          action: 'llm_startup_model_snapshot',
          count: installed.length,
          models: installed.map((m) => ({ name: m.name, digest: m.digest })),
        },
        'Ollama model snapshot recorded',
      );
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'ollamaModelRegistry: startup snapshot skipped (Ollama unreachable)',
      );
    }
  }

  private async fetchDigest(name: string): Promise<string> {
    try {
      const res = await fetch(`${this.baseUrl}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) return UNKNOWN;
      const data = (await res.json()) as OllamaShowResponse;
      return data.details?.digest ?? UNKNOWN;
    } catch {
      return UNKNOWN;
    }
  }
}

export const ollamaModelRegistry = new OllamaModelRegistry();
