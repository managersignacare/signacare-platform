import axios, {
  type AxiosInstance,
  type AxiosResponse,
  type AxiosError,
  type InternalAxiosRequestConfig,
} from 'axios';

interface ApiErrorBody {
  error: string;
  code: string;
  details?: Record<string, unknown>;
}

export class SignacareApiError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;
  readonly status: number;

  constructor(
    message: string,
    code: string,
    status: number,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'SignacareApiError';
    this.code = code;
    this.status = status;
    this.details = details;
    Object.setPrototypeOf(this, SignacareApiError.prototype);
  }
}

// CSRF token stored in memory only (not localStorage)
let csrfToken: string | null = null;

export const setCsrfToken = (token: string): void => {
  csrfToken = token;
};

export const getCsrfToken = (): string | null => csrfToken;

function isClinicalAiEndpoint(url: string | undefined): boolean {
  if (!url) return false;
  return /(^|\/)llm\/clinical-ai(?:$|[/?#])/.test(url);
}

function isMutationMethod(method: string | undefined): boolean {
  const normalized = (method ?? '').toLowerCase();
  return normalized === 'post' || normalized === 'put' || normalized === 'patch' || normalized === 'delete';
}

// Axios instance
const instance: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_URL as string,
  withCredentials: true, // send HTTP-only cookies
  timeout: 30_000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// ── Retry logic — retry on network errors and 5xx (up to 3 attempts) ──
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;
const isRetryable = (error: AxiosError): boolean => {
  if (!error.response) return true; // network error
  const s = error.response.status;
  return s === 429 || s === 502 || s === 503 || s === 504;
};
instance.interceptors.response.use(undefined, async (error: AxiosError) => {
  const cfg = error.config as InternalAxiosRequestConfig & { _retryCount?: number };
  if (!cfg || !isRetryable(error)) return Promise.reject(error);
  // Skip retry for non-idempotent POST unless it's a 429 (rate limit)
  if (cfg.method === 'post' && error.response?.status !== 429) return Promise.reject(error);
  cfg._retryCount = (cfg._retryCount ?? 0) + 1;
  if (cfg._retryCount > MAX_RETRIES) return Promise.reject(error);
  // Use Retry-After header if provided (429), otherwise exponential backoff
  const retryAfter = error.response?.headers?.['retry-after'];
  const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : RETRY_DELAY_MS * Math.pow(2, cfg._retryCount! - 1);
  await new Promise(r => setTimeout(r, Math.min(delay, 10_000)));
  return instance(cfg);
});

// Request interceptor – attach CSRF header and request ID
instance.interceptors.request.use(
  (config: InternalAxiosRequestConfig): InternalAxiosRequestConfig => {
    // Always set CSRF token — the server only checks for header presence, not value
    config.headers['X-CSRF-Token'] = csrfToken || 'signacare-spa';
    // Always set request ID for tracing
    if (!config.headers['X-Request-Id']) {
      config.headers['X-Request-Id'] = crypto.randomUUID?.() ?? Math.random().toString(36).substring(2);
    }
    // High-risk write routes rely on Idempotency-Key; generate one when absent.
    if (isMutationMethod(config.method) && !config.headers['Idempotency-Key']) {
      config.headers['Idempotency-Key'] = crypto.randomUUID?.() ?? Math.random().toString(36).substring(2);
    }
    // For FormData, delete the default Content-Type so axios auto-sets boundary
    if (config.data instanceof FormData) {
      delete config.headers['Content-Type'];
    }
    // Dynamic timeout for long-running AI endpoints
    if (config.url?.includes('/llm/') || config.url?.includes('/scribe/') || config.url?.includes('/voice/')) {
      config.timeout = 180_000; // 3 minutes for AI operations
    }
    // BUG-395 — auto-inject a conversationId into every /llm/clinical-ai
    // POST. The backend schema requires conversationId; when patientId is
    // also present the server enforces the per-conversation patient lock.
    // We keep one UUID per patient per tab, and a fallback global UUID for
    // non-patient contexts (e.g., admin/report prompts).
    if (isClinicalAiEndpoint(config.url) && config.data && typeof config.data === 'object') {
      const body = config.data as Record<string, unknown>;
      if (!body.conversationId) {
        const scope =
          typeof body.patientId === 'string' && body.patientId
            ? body.patientId
            : '__global__';
        body.conversationId = ensureChatConversationId(scope);
      }
    }
    return config;
  },
);

/**
 * BUG-395 — one-UUID-per-patient-per-tab helper for the apiClient
 * request interceptor. The server binds a conversationId to a patient
 * for ≤ 20 min idle / 8 h absolute (L4 absorb). This helper produces a
 * stable conversationId for a patient within the current tab so
 * sequential chat turns refresh the server-side TTL instead of minting
 * a new lock every turn. When the user navigates to a new patient, a
 * new UUID is minted.
 */
function ensureChatConversationId(patientId: string): string {
  const key = `chat-conv-id:${patientId}`;
  try {
    const existing = window.sessionStorage.getItem(key);
    if (existing) return existing;
    const next = crypto.randomUUID?.() ?? Math.random().toString(36).substring(2);
    window.sessionStorage.setItem(key, next);
    return next;
  } catch {
    // sessionStorage blocked (privacy mode) — still return a UUID so
    // the request is valid per the mandatory schema; losing the tab-
    // stability means every turn starts a new conversation (acceptable
    // degradation; the server-side lock still enforces patient binding
    // per-request).
    return crypto.randomUUID?.() ?? Math.random().toString(36).substring(2);
  }
}

// Response interceptor – normalize errors, handle 401
instance.interceptors.response.use(
  (response: AxiosResponse): AxiosResponse => response,
  (error: AxiosError<ApiErrorBody>) => {
    const status = error.response?.status ?? 0;
    const body = error.response?.data;
    const reqUrl = error.config?.url ?? '';

    // Sanitize URL for logging — strip patient IDs and query params
    const safeUrl = reqUrl.replace(/\/[0-9a-f-]{36}/gi, '/:id').split('?')[0];
    if (import.meta.env.DEV) {
      console.error(`[API] ${error.config?.method?.toUpperCase()} ${safeUrl} → ${status}`, body?.error ?? error.message);
    }

    // On 401 — redirect to login unless already there or it's an auth endpoint
    if (status === 401) {
      csrfToken = null;
      const isAuthUrl = reqUrl.includes('auth/');
      const isLoginPage = window.location.pathname.startsWith('/login');
      if (!isAuthUrl && !isLoginPage) {
        // Save current location so user can be redirected back after login
        try { sessionStorage.setItem('redirectAfterLogin', window.location.pathname + window.location.search); } catch { void 0; }
        window.location.replace('/login');
      }
    }

    return Promise.reject(
      new SignacareApiError(
        body?.error ?? error.message ?? 'An unexpected error occurred',
        body?.code ?? 'UNKNOWN_ERROR',
        status,
        body?.details,
      ),
    );
  },
);

// Typed helper functions
export const apiClient = {
  get: <T>(url: string, params?: Record<string, unknown>): Promise<T> =>
    instance.get<T>(url, { params }).then((r) => r.data),

  post: <T>(url: string, data?: unknown): Promise<T> =>
    instance.post<T>(url, data).then((r) => r.data),

  put: <T>(url: string, data?: unknown): Promise<T> =>
    instance.put<T>(url, data).then((r) => r.data),

  patch: <T>(url: string, data?: unknown): Promise<T> =>
    instance.patch<T>(url, data).then((r) => r.data),

  delete: <T>(url: string): Promise<T> =>
    instance.delete<T>(url).then((r) => r.data),

  // raw instance for multipart/form-data or custom config
  instance,
} as const;
