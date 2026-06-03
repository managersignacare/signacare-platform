// apps/api/src/config/config.ts
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  // Postgres
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive().default(5432),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(1),
  DB_NAME: z.string().min(1),
  DB_SSL: z.enum(["true", "false"]).optional().default("false"),
  DB_POOL_MAX: z.coerce.number().int().positive().optional(),
  // Separate app role for RLS-enforced runtime queries
  DB_APP_USER: z.string().min(1).optional(),
  DB_APP_PASSWORD: z.string().min(1).optional(),
  // JWT
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL_MINUTES: z.coerce.number().int().positive().default(60),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(7),
  // MFA
  MFA_ISSUER: z.string().default("Signacare EMR"),
  // CORS
  CORS_ORIGIN: z.string().min(1).default("http://localhost:5173"),
  // Redis
  REDIS_URL: z.string().optional().default("redis://localhost:6379"),
  // Proxy
  TRUST_PROXY: z.string().optional().default("0"),
  // Cookie
  COOKIE_DOMAIN: z.string().optional(),
  // Local LLM (Ollama)
  OLLAMA_BASE_URL: z.string().optional().default('http://localhost:11434'),
  OLLAMA_MODEL: z.string().optional().default('llama3.2'),
  // Rate limiting
  LLM_RATE_LIMIT: z.coerce.number().int().positive().optional(),
  // Azure / O365
  O365_TENANT_ID: z.string().optional(),
  O365_CLIENT_ID: z.string().optional(),
  O365_CLIENT_SECRET: z.string().optional(),
  O365_REDIRECT_URI: z.string().optional(),
  // Phase 13 — iCal subscription HMAC secret. Used to sign public
  // per-clinician webcal URLs so Outlook / Google Calendar / Apple
  // Calendar can subscribe without an Authorization header while
  // still keeping the feed tenant-isolated. Rotating the secret
  // invalidates every currently-subscribed URL, so rotation is
  // always a deliberate operator action. Min length matches the
  // JWT secrets so the HMAC has a fighting chance.
  CALENDAR_ICAL_SECRET: z.string().min(32).optional(),
  // PHI encryption — AES-256-GCM key (64 hex chars = 32 bytes)
  // Patient creation crashes if BLIND_INDEX_KEY is missing (Phase 0.7.1 C1).
  // Rotation-ready keyring optional path:
  //   PHI_ENCRYPTION_KEYRING_JSON='{"v1":"<hex>", "v2":"<hex>"}'
  //   PHI_ENCRYPTION_ACTIVE_KEY_VERSION='v2'
  PHI_ENCRYPTION_KEY: z.string().length(64).regex(/^[a-f0-9]+$/i, 'Must be 64 hex chars').optional(),
  PHI_ENCRYPTION_KEYRING_JSON: z.string().optional(),
  PHI_ENCRYPTION_ACTIVE_KEY_VERSION: z.string().optional(),
  BLIND_INDEX_KEY: z.string().length(64).regex(/^[a-f0-9]+$/i, 'Must be 64 hex chars').optional(),
  SESSION_SECRET: z.string().min(32).optional(),
  // SMART-on-FHIR launch + bulk-export download URLs are embedded
  // into OAuth redirect URIs, `iss` parameters, and
  // Content-Location headers. If this falls back to localhost in
  // production, every SMART app issues redirects to an unreachable
  // URL and every bulk-export client gets a broken download link.
  // Optional locally; production warning below pushes operators to
  // set it before a real rollout.
  API_BASE_URL: z.string().url().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error(
    "❌ Invalid environment variables for apps/api:",
    JSON.stringify(parsed.error.format(), null, 2)
  );
  process.exit(1);
}

const env = parsed.data;

// Runtime safety checks (non-test):
// PHI encryption-at-rest + blind-index search key must be present before
// serving traffic. We accept either the legacy single key or the
// rotation-ready keyring.
if (env.NODE_ENV !== 'test') {
  const hasPhiSingleKey = Boolean(env.PHI_ENCRYPTION_KEY);
  const hasPhiKeyring = Boolean(env.PHI_ENCRYPTION_KEYRING_JSON && env.PHI_ENCRYPTION_KEYRING_JSON.trim().length > 0);
  const missing: string[] = [];
  if (!hasPhiSingleKey && !hasPhiKeyring) {
    missing.push('PHI_ENCRYPTION_KEY or PHI_ENCRYPTION_KEYRING_JSON');
  }
  if (!env.BLIND_INDEX_KEY) {
    missing.push('BLIND_INDEX_KEY');
  }
  if (missing.length > 0) {
    // eslint-disable-next-line no-console
    console.error(`❌ Missing required runtime secrets for apps/api: ${missing.join(', ')}`);
    process.exit(1);
  }
}

// Production safety checks
if (env.NODE_ENV === "production") {
  const warnings: string[] = [];
  if (env.DB_SSL === "false") warnings.push("DB_SSL is false — database traffic is unencrypted");
  if (env.CORS_ORIGIN.includes("localhost")) warnings.push("CORS_ORIGIN contains localhost — set to production domain");
  if (env.TRUST_PROXY === "0") warnings.push("TRUST_PROXY is 0 — rate limiting will use server IP, not client IP");
  if (!process.env.SENTRY_DSN) warnings.push("SENTRY_DSN not set — error monitoring disabled");
  if (!env.CALENDAR_ICAL_SECRET) warnings.push("CALENDAR_ICAL_SECRET not set — iCal subscription endpoints will refuse to mint tokens");
  if (!env.API_BASE_URL) warnings.push("API_BASE_URL not set — SMART-on-FHIR redirects + bulk-export URLs will fall back to http://localhost:4000 which is almost certainly wrong in prod");
  if (!env.PHI_ENCRYPTION_KEY && !env.PHI_ENCRYPTION_KEYRING_JSON) warnings.push("PHI encryption key not set — patient PHI will NOT be encrypted at rest");
  if (!env.BLIND_INDEX_KEY) warnings.push("BLIND_INDEX_KEY not set — patient search by encrypted fields will fail (patient creation will crash)");
  if (!env.SESSION_SECRET) warnings.push("SESSION_SECRET not set — session security weakened");
  if (warnings.length > 0) {
    console.warn("⚠️  Production warnings:\n  - " + warnings.join("\n  - "));
  }
}

export const config = {
  NODE_ENV: env.NODE_ENV,
  PORT: env.PORT,
  CORS_ORIGIN: env.CORS_ORIGIN,
  database: {
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    ssl: env.DB_SSL === "true",
    poolMax: env.DB_POOL_MAX,
    // App role (RLS-enforced). Falls back to owner if not configured.
    appUser: env.DB_APP_USER ?? env.DB_USER,
    appPassword: env.DB_APP_PASSWORD ?? env.DB_PASSWORD,
  },
  jwt: {
    accessSecret: env.JWT_ACCESS_SECRET,
    refreshSecret: env.JWT_REFRESH_SECRET,
    accessTtlMinutes: env.JWT_ACCESS_TTL_MINUTES,
    refreshTtlDays: env.JWT_REFRESH_TTL_DAYS,
  },
  mfa: {
    issuer: env.MFA_ISSUER,
  },
  REDIS_URL: env.REDIS_URL,
  ollama: {
    baseUrl: env.OLLAMA_BASE_URL,
    model: env.OLLAMA_MODEL,
  },
  O365_TENANT_ID: env.O365_TENANT_ID,
  O365_CLIENT_ID: env.O365_CLIENT_ID,
  O365_CLIENT_SECRET: env.O365_CLIENT_SECRET,
  O365_REDIRECT_URI: env.O365_REDIRECT_URI,
  calendar: {
    icalSecret: env.CALENDAR_ICAL_SECRET ?? null,
  },
  // API_BASE_URL default is the same localhost value the 5 call
  // sites used to hardcode. The production warning above surfaces
  // the missing config at startup; the fallback keeps dev + test
  // working without additional env setup.
  apiBaseUrl: env.API_BASE_URL ?? 'http://localhost:4000',
} as const;
