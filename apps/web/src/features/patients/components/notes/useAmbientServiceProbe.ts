/**
 * Phase 8 UI refactor — service probe extraction from AmbientAiRecorder.
 *
 * Responsibility: probe API health, Whisper status, Ollama model
 * availability, and microphone permission as a 4-stage pre-flight
 * check before recording can start. State is owned here; consumers
 * read `serviceStatus` and call `checkServices()` / `restartWhisper()`
 * as needed.
 *
 * Behavior preserved 1:1 with the original AmbientAiRecorder logic:
 *  - 5-second AbortSignal timeout on each probe
 *  - mic probe requests getUserMedia then immediately stops tracks
 *  - the auto-fire on mount that the original useEffect performed
 *  - returns a `ServiceProbeResults` snapshot from checkServices so the
 *    caller can decide whether to abort startup (matches the original
 *    `await checkServices()` consumer in `handleClick`)
 */
import { useCallback, useEffect, useState } from 'react';

export interface ServiceProbeResults {
  api: boolean;
  whisper: boolean | null;
  ollama: boolean;
  mic: boolean;
}

export interface ServiceProbeStatus {
  api: boolean | null;
  whisper: boolean | null;
  ollama: boolean | null;
  mic: boolean | null;
  checking: boolean;
  lastChecked: string | null;
}

interface LlmModelCatalogResponse {
  models?: Array<{ available?: unknown }>;
}

interface WhisperStatusResponse {
  running?: unknown;
}

function getApiBaseUrl(): string {
  return import.meta.env.VITE_API_URL ?? '/api/v1';
}

function getApiHealthBaseUrl(): string {
  return getApiBaseUrl().replace(/\/api\/v1\/?$/, '');
}

function hasAvailableOllamaModel(payload: unknown): boolean {
  if (typeof payload !== 'object' || payload === null) return false;
  const parsed = payload as LlmModelCatalogResponse;
  return Array.isArray(parsed.models) && parsed.models.some((model) => model.available === true);
}

function isWhisperRunning(payload: unknown): boolean {
  if (typeof payload !== 'object' || payload === null) return false;
  return (payload as WhisperStatusResponse).running === true;
}

export interface UseAmbientServiceProbeReturn {
  serviceStatus: ServiceProbeStatus;
  checkServices: () => Promise<ServiceProbeResults>;
  restartWhisper: () => Promise<void>;
}

export function useAmbientServiceProbe(onLog?: (msg: string) => void): UseAmbientServiceProbeReturn {
  const [serviceStatus, setServiceStatus] = useState<ServiceProbeStatus>({
    api: null,
    whisper: null,
    ollama: null,
    mic: null,
    checking: false,
    lastChecked: null,
  });

  const checkServices = useCallback(async (): Promise<ServiceProbeResults> => {
    setServiceStatus((s) => ({ ...s, checking: true }));
    const results: ServiceProbeResults = { api: false, whisper: false, ollama: false, mic: false };
    const apiBaseUrl = getApiBaseUrl();

    try {
      const resp = await fetch(`${getApiHealthBaseUrl()}/health`, { signal: AbortSignal.timeout(5000) });
      results.api = resp.ok;
    } catch {
      results.api = false;
    }

    try {
      const resp = await fetch(`${apiBaseUrl}/llm/whisper/status`, {
        credentials: 'include',
        signal: AbortSignal.timeout(5000),
      });
      results.whisper = resp.ok ? isWhisperRunning(await resp.json()) : false;
    } catch {
      results.whisper = false;
    }

    try {
      const resp = await fetch(`${apiBaseUrl}/llm/models`, {
        credentials: 'include',
        signal: AbortSignal.timeout(5000),
      });
      results.ollama = resp.ok ? hasAvailableOllamaModel(await resp.json()) : false;
    } catch {
      results.ollama = false;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      results.mic = true;
    } catch {
      results.mic = false;
    }

    const now = new Date().toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setServiceStatus({ ...results, checking: false, lastChecked: now });
    return results;
  }, []);

  const restartWhisper = useCallback(async (): Promise<void> => {
    try {
      onLog?.('Starting Whisper server...');
      const baseUrl = getApiBaseUrl();
      await fetch(`${baseUrl}/llm/whisper/start`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': '1' },
      });
      onLog?.('Whisper start triggered — waiting for model load (15-20s)...');
      setTimeout(() => {
        void checkServices();
      }, 15000);
    } catch {
      onLog?.('Failed to start Whisper');
    }
  }, [checkServices, onLog]);

  // Auto-fire on mount — matches original AmbientAiRecorder useEffect.
  useEffect(() => {
    void checkServices();
  }, [checkServices]);

  return { serviceStatus, checkServices, restartWhisper };
}
