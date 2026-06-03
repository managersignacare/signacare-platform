// apps/api/src/shared/aiDataResidencyCheck.ts
//
// Audit Tier 5.2 (HIGH-G5) — AI data residency boot check. ⚠ BREAKING.
//
// Enforces that every AI-endpoint env var points to localhost /
// 127.0.0.1 / a private-IP address, unless the hostname is explicitly
// whitelisted in AI_EXTERNAL_HOSTS. This runs during server boot in
// server.ts; if it throws, the process aborts with a structured error
// that names the offending env var + remediation steps.
//
// Why BREAKING: clinics running with a misconfigured env (e.g.
// OLLAMA_URL pointing to a public staging host by accident) will
// fail to start after the v1.2.0 upgrade. Release note MUST advise:
//   "Before v1.2.0, verify the four AI-endpoint env vars
//    (OLLAMA_URL, WHISPER_API_URL, HUGGINGFACE_URL, CHAT_LLM_URL) all
//    point to localhost / 127.0.0.1 / a private IP, OR add their
//    hostname to AI_EXTERNAL_HOSTS=comma,separated,list if they're
//    genuinely intended to use an external service."

const AI_ENDPOINT_ENV_VARS = [
  'OLLAMA_URL',
  'WHISPER_API_URL',
  'HUGGINGFACE_URL',
  'CHAT_LLM_URL',
] as const;

const LOCALHOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

/** RFC 1918 / RFC 4193 private ranges — covers typical k8s / docker networks. */
function isPrivateIPv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [, a, b] = m.map(Number) as [number, number, number, number, number];
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true; // link-local
  return false;
}

function isPrivateIPv6(host: string): boolean {
  // fc00::/7 (ULA) + fe80::/10 (link-local). Keep it cheap: prefix check.
  const lower = host.toLowerCase();
  return (
    lower.startsWith('fc') ||
    lower.startsWith('fd') ||
    lower.startsWith('fe8') ||
    lower.startsWith('fe9') ||
    lower.startsWith('fea') ||
    lower.startsWith('feb')
  );
}

function extractHostname(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.hostname;
  } catch {
    return null;
  }
}

function parseWhitelist(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0),
  );
}

export interface ResidencyViolation {
  envVar: string;
  url: string;
  hostname: string;
}

export function collectResidencyViolations(env = process.env): ResidencyViolation[] {
  const whitelist = parseWhitelist(env.AI_EXTERNAL_HOSTS);
  const violations: ResidencyViolation[] = [];
  for (const key of AI_ENDPOINT_ENV_VARS) {
    const url = env[key];
    if (!url) continue;  // unset is fine — no AI traffic happens for that endpoint
    const hostname = extractHostname(url);
    if (!hostname) {
      violations.push({ envVar: key, url, hostname: '<unparseable>' });
      continue;
    }
    const lower = hostname.toLowerCase();
    if (LOCALHOSTS.has(lower)) continue;
    if (isPrivateIPv4(lower)) continue;
    if (isPrivateIPv6(lower)) continue;
    if (whitelist.has(lower)) continue;
    violations.push({ envVar: key, url, hostname });
  }
  return violations;
}

/**
 * Call at boot from server.ts. Throws if any violation exists so the
 * process aborts before listening. Structured error names every
 * offending env var + the remediation.
 */
export function assertAiDataResidency(env = process.env): void {
  const violations = collectResidencyViolations(env);
  if (violations.length === 0) return;
  const lines = violations.map(
    (v) => `  - ${v.envVar} = ${v.url}  (hostname ${v.hostname} is not localhost / private / whitelisted)`,
  );
  const remediation =
    'Either (a) change the env var to point to localhost / 127.0.0.1 / a ' +
    'private-network address, OR (b) add the hostname to ' +
    'AI_EXTERNAL_HOSTS=comma,separated,list if the external endpoint is genuinely ' +
    'intended for this deployment. See CLAUDE.md §5 and the v1.2.0 release notes.';
  throw new Error(
    'AI_DATA_RESIDENCY_VIOLATION — boot aborted.\n' +
    'The following AI-endpoint env vars point outside localhost / private networks:\n' +
    lines.join('\n') +
    '\n\n' +
    remediation,
  );
}
