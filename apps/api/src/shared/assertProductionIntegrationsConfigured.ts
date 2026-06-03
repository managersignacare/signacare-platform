// apps/api/src/shared/assertProductionIntegrationsConfigured.ts
//
// BUG-043 — production integration-config boot-time assertion.
//
// Problem (pre-fix):
//   Several integrations had silent MOCK / fallback behaviour when env
//   vars were missing:
//     fcm/fcmClient.ts   — returned fake success when FCM_SERVICE_ACCOUNT_PATH unset
//     acs/acsClient.ts   — returned MOCK-<uuid> when ACS_CONNECTION_STRING unset
//     escript/erxRestClient.ts — used `?? ''` so empty strings passed gates
//     escript/npdsClient.ts    — logged "stub mode" at WARN when mTLS cert missing
//   A clinician believed real eRx / SMS / push was being sent while the
//   integration silently returned fake success. CLAUDE.md §6.2 requires
//   secrets fail loudly when missing — this was violated.
//
// Solution:
//   Boot-time assertion that runs BEFORE `app.listen()`. If production
//   lacks required integration config, the process crashes with a
//   structured remediation message and k8s CrashLoopBackoff kicks in
//   so the pod NEVER becomes Ready — no traffic routes to a half-
//   configured instance.
//
//   CrashLoopBackoff IS the intended policy enforcement mechanism,
//   analogous to the existing assertAiDataResidency() check. Not an
//   "operational failure" — safety-first refusal-to-start.
//
// Scope:
//   - Trusts existing isXxxConfigured() semantics per integration
//     (Review 2 R3). Gate strengthening is each integration's own bug.
//   - Process-global check only (clinicId=null for feature flags).
//     Per-clinic drift tracked as BUG-310.
//   - Error message names env vars + doc paths only — never secret
//     VALUES. No PHI in the boot error path.

import { logger } from '../utils/logger';
import { isFeatureEnabled } from './featureFlags';

/**
 * Structured error for boot-time config failure. server.ts catches
 * this and formats it via pino as a single JSON log line with missing
 * + remediation fields, then calls process.exit(1). Without this
 * wrapper, a raw throw at module load gives Node's default ugly stack
 * trace instead of a parseable DevOps-friendly message.
 */
export class ProductionConfigError extends Error {
  public readonly missing: MissingIntegration[];
  public readonly remediation: string;

  constructor(missing: MissingIntegration[]) {
    const remediation = buildRemediationMessage(missing);
    super(`[BOOT] Production integration config incomplete — ${missing.length} integration(s) missing. See remediation field.`);
    this.name = 'ProductionConfigError';
    this.missing = missing;
    this.remediation = remediation;
  }
}

export interface MissingIntegration {
  /** Integration name for operator logs. */
  name: string;
  /** Env vars the operator must set. */
  envVars: string[];
  /** Extra guidance (choice of pathways, doc reference, etc.). */
  note?: string;
}

/**
 * Boot-time production integration-config assertion. Call from
 * server.ts immediately after assertAiDataResidency(). Wrap the call
 * site in try/catch + process.exit(1) for clean log output.
 *
 * In NODE_ENV !== 'production', logs missing-integration warnings at
 * WARN and returns without throwing (dev / test workflows unaffected).
 */
export async function assertProductionIntegrationsConfigured(): Promise<void> {
  const isProd = process.env.NODE_ENV === 'production';
  const missing: MissingIntegration[] = [];

  // Check 1 — eRx: at least ONE pathway configured.
  // Belt-and-suspenders for NPDS / Adapter (they use requireEnv at
  // first request); sole defence for erxRestClient until Layer 2 fix.
  const { isNpdsConfigured } = await import('../integrations/escript/npdsClient');
  const { isErxAdapterConfigured } = await import('../integrations/escript/erxAdapterClient');
  const { isConfigured: isErxRestConfigured } = await import('../integrations/escript/erxRestClient');
  const erxAny = isNpdsConfigured() || isErxAdapterConfigured() || isErxRestConfigured();
  if (!erxAny) {
    missing.push({
      name: 'eRx',
      envVars: ['NPDS_API_URL+ADHA_CERT_PATH (conformance-id now per-clinic via clinics.npds_conformance_id — BUG-302)', 'ERX_ADAPTER_URL+ERX_SITE_CERT_PATH', 'ERX_REST_ENTITY_ID+ERX_REST_CERT_PATH'],
      note: 'Configure AT LEAST ONE of the three pathways (NPDS / Adapter / REST). See docs/INTEGRATION_GUIDE.md §3.',
    });
  }

  // Check 2 — SafeScript: S8 prescribing requires real-time PDMP check.
  const { safeScriptService } = await import('../integrations/safeScript/safeScriptService');
  if (!safeScriptService.isConfigured()) {
    missing.push({
      name: 'SafeScript',
      envVars: ['SAFESCRIPT_API_URL', 'SAFESCRIPT_CLIENT_ID', 'SAFESCRIPT_CLIENT_SECRET'],
      note: 'Schedule 8 (controlled drug) prescribing requires real-time PDMP lookup. See docs/INTEGRATION_GUIDE.md §5.',
    });
  }

  // Check 3 — HL7 lab protocol consistency (only if HL7_LAB_PROTOCOL set).
  // The protocol dispatcher at hl7Transport.ts already throws on
  // protocol-unsupported at request time; this boot check surfaces
  // the misconfiguration earlier.
  const hl7Protocol = process.env.HL7_LAB_PROTOCOL;
  if (hl7Protocol === 'mllp') {
    const missingHl7 = [] as string[];
    if (!process.env.HL7_MLLP_HOST) missingHl7.push('HL7_MLLP_HOST');
    if (!process.env.HL7_MLLP_PORT) missingHl7.push('HL7_MLLP_PORT');
    if (missingHl7.length > 0) {
      missing.push({
        name: 'HL7 (MLLP)',
        envVars: missingHl7,
        note: 'HL7_LAB_PROTOCOL=mllp is set but transport host/port missing.',
      });
    }
  }

  // Check 4 — FCM push notifications. Sole defence.
  if (!process.env.FCM_SERVICE_ACCOUNT_PATH || process.env.FCM_SERVICE_ACCOUNT_PATH.trim() === '') {
    missing.push({
      name: 'FCM (push notifications)',
      envVars: ['FCM_SERVICE_ACCOUNT_PATH'],
      note: 'Without FCM, patient appointment reminders + alerts silently drop in production. See docs/runbooks/push-notifications.md.',
    });
  }

  // Check 5 — ACS SMS. Sole defence.
  // Mirror acsConfig.loadAcsConfig().mockMode: mock mode when EITHER
  // var is unset. Asserting only ACS_CONNECTION_STRING at boot would
  // let ACS_FROM_PHONE-only misconfigurations pass boot and fail at
  // first send (L4 clinical-safety review finding).
  const acsMissing: string[] = [];
  if (!process.env.ACS_CONNECTION_STRING || process.env.ACS_CONNECTION_STRING.trim() === '') {
    acsMissing.push('ACS_CONNECTION_STRING');
  }
  if (!process.env.ACS_FROM_PHONE || process.env.ACS_FROM_PHONE.trim() === '') {
    acsMissing.push('ACS_FROM_PHONE');
  }
  if (acsMissing.length > 0) {
    missing.push({
      name: 'ACS (SMS)',
      envVars: acsMissing,
      note: 'Without ACS, patient SMS (2FA tokens + appointment reminders) silently drop in production.',
    });
  }

  // Check 6 — Consistency: if eRx configured, HI Service (IHI lookup)
  // must be configured. ETP2 submission needs a validated IHI.
  if (erxAny) {
    const { isHiServiceConfigured } = await import('../integrations/hiService/hiServiceClient');
    if (!isHiServiceConfigured()) {
      missing.push({
        name: 'HI Service (required when eRx is configured)',
        envVars: ['HI_SERVICE_URL', 'HI_SERVICE_CERT_PATH'],
        note: 'eRx ETP2 submission requires IHI lookup via Services Australia HI Service. Configure NASH cert + URL.',
      });
    }
  }

  // Check 7.5 (BUG-295) — clinics.hpio populated for every tenant
  // (when eRx is configured). HPI-O is mandatory under HI Service
  // for any clinic participating in eRx. Two-mode rollout:
  //
  //   WARN mode (STRICT_ERX_HPIO != 'true'): log a WARN for every
  //     clinic with NULL hpio + continue boot. Default for ≥30 days
  //     post-deploy so ops can backfill without downtime.
  //
  //   STRICT mode (STRICT_ERX_HPIO === 'true'): any clinic with NULL
  //     hpio adds to the missing list → production boot fails. Flip
  //     once ops confirms all tenants backfilled.
  //
  // Per-clinic graceful degrade: erxRestPayloads.buildFullPrescriptionXml
  // hard-throws ERX_NOT_CONFIGURED for the specific clinic at request
  // time regardless of this boot-mode, so NULL-hpio clinics can't
  // submit eRx even in WARN mode. This is belt-and-suspenders: the
  // boot assertion surfaces the misconfiguration early; the request-
  // time throw protects clinical-safety per-call.
  if (erxAny) {
    try {
      const { db } = await import('../db/db');
      const nullHpioClinics = await db('clinics')
        .whereNull('hpio')
        .select<{ id: string; name: string }[]>('id', 'name');
      if (nullHpioClinics.length > 0) {
        const strict = process.env.STRICT_ERX_HPIO === 'true';
        const names = nullHpioClinics.map((c) => c.name ?? c.id).join(', ');
        if (strict) {
          missing.push({
            name: 'clinics.hpio (HPI-O)',
            envVars: ['STRICT_ERX_HPIO=true → requires all clinics.hpio populated'],
            note: `${nullHpioClinics.length} clinic(s) have NULL hpio: ${names}. Populate via admin UI before boot. See BUG-295.`,
          });
        } else {
          logger.warn(
            { count: nullHpioClinics.length, clinics: names, strictModeEnv: 'STRICT_ERX_HPIO' },
            '[BUG-295] clinic(s) have NULL hpio — eRx submissions for these clinics will 503 ERX_NOT_CONFIGURED until backfilled. Set STRICT_ERX_HPIO=true to fail boot instead.',
          );
        }
      }
    } catch (err) {
      // DB unreachable at boot — the primary database-connection path
      // will surface this via DATABASE_URL error. Don't double-fail
      // here; log and move on.
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        '[BUG-295] clinics.hpio check skipped — DB lookup failed',
      );
    }
  }

  // Check 7.6 (BUG-302) — clinics.npds_conformance_id populated for
  // every tenant when NPDS is configured. Mirrors Check 7.5 (BUG-295
  // HPI-O) shape: WARN-before-FAIL via STRICT_NPDS_CONFORMANCE env.
  //
  // Per-clinic graceful degrade: npdsClient.resolveNpdsConformanceId
  // falls back to the NPDS_CONFORMANCE_ID env var for clinics with
  // NULL column (with a WARN log). Ops flip STRICT_NPDS_CONFORMANCE=
  // true only after every clinic is backfilled via admin UI (BUG-339).
  const { isNpdsConfigured: npdsOn } = await import('../integrations/escript/npdsClient');
  if (npdsOn()) {
    try {
      const { db } = await import('../db/db');
      const nullConformanceClinics = await db('clinics')
        .whereNull('npds_conformance_id')
        .select<{ id: string; name: string }[]>('id', 'name');
      if (nullConformanceClinics.length > 0) {
        const strict = process.env.STRICT_NPDS_CONFORMANCE === 'true';
        const names = nullConformanceClinics.map((c) => c.name ?? c.id).join(', ');
        if (strict) {
          missing.push({
            name: 'clinics.npds_conformance_id',
            envVars: ['STRICT_NPDS_CONFORMANCE=true → requires all clinics.npds_conformance_id populated'],
            note: `${nullConformanceClinics.length} clinic(s) have NULL npds_conformance_id: ${names}. Populate via admin UI before boot. See BUG-302.`,
          });
        } else {
          logger.warn(
            { count: nullConformanceClinics.length, clinics: names, strictModeEnv: 'STRICT_NPDS_CONFORMANCE' },
            '[BUG-302] clinic(s) have NULL npds_conformance_id — NPDS submissions will fall back to env NPDS_CONFORMANCE_ID (if set) or 503 ERX_NOT_CONFIGURED. Set STRICT_NPDS_CONFORMANCE=true to fail boot.',
          );
        }
      }
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        '[BUG-302] clinics.npds_conformance_id check skipped — DB lookup failed',
      );
    }
  }

  // Check 7.6b (BUG-WF81) — NPDS payload security posture.
  //
  // Modes:
  //   off          -> legacy mTLS-only transport
  //   sign         -> detached PKI signature headers + digest
  //   encrypt_sign -> AES-256-GCM envelope + PKI signature
  //
  // STRICT_NPDS_PAYLOAD_SECURITY=true forces encrypt_sign mode at boot.
  // This allows staged rollout without silently accepting a weaker mode
  // once strict is flipped in production.
  if (npdsOn()) {
    const payloadModeRaw = (process.env.NPDS_PAYLOAD_SECURITY_MODE ?? 'off').trim().toLowerCase();
    const payloadMode = payloadModeRaw === '' ? 'off' : payloadModeRaw;
    const validMode = payloadMode === 'off' || payloadMode === 'sign' || payloadMode === 'encrypt_sign';
    if (!validMode) {
      missing.push({
        name: 'NPDS payload security mode',
        envVars: ['NPDS_PAYLOAD_SECURITY_MODE=off|sign|encrypt_sign'],
        note: `Invalid NPDS_PAYLOAD_SECURITY_MODE='${payloadModeRaw}'.`,
      });
    } else {
      const strictPayload = process.env.STRICT_NPDS_PAYLOAD_SECURITY === 'true';
      if (strictPayload && payloadMode !== 'encrypt_sign') {
        missing.push({
          name: 'NPDS payload security strict mode',
          envVars: ['STRICT_NPDS_PAYLOAD_SECURITY=true', 'NPDS_PAYLOAD_SECURITY_MODE=encrypt_sign'],
          note: 'STRICT_NPDS_PAYLOAD_SECURITY requires encrypt_sign mode.',
        });
      }
      if (payloadMode === 'sign' || payloadMode === 'encrypt_sign') {
        const privateKeyPem = process.env.NPDS_PAYLOAD_SIGNING_PRIVATE_KEY_PEM?.trim() ?? '';
        if (!privateKeyPem) {
          missing.push({
            name: 'NPDS payload signing key',
            envVars: ['NPDS_PAYLOAD_SIGNING_PRIVATE_KEY_PEM'],
            note: 'Required when NPDS payload security mode is sign or encrypt_sign.',
          });
        }
      }
      if (payloadMode === 'encrypt_sign') {
        const encryptionKeyHex = process.env.NPDS_PAYLOAD_ENCRYPTION_KEY_HEX?.trim() ?? '';
        if (!/^[a-f0-9]{64}$/i.test(encryptionKeyHex)) {
          missing.push({
            name: 'NPDS payload encryption key',
            envVars: ['NPDS_PAYLOAD_ENCRYPTION_KEY_HEX (64 hex chars)'],
            note: 'AES-256-GCM requires a 32-byte key (64 hex chars) for encrypt_sign mode.',
          });
        }
      }
    }
  }

  // Check 7.7 (BUG-282 / BUG-ARCH-PHI-KEY-MANDATORY) — PHI key
  // material must be configured in production for AES-256-GCM
  // encryption of PHI-bearing columns (including llm_prompts_outputs).
  //
  // Accept either:
  //   - PHI_ENCRYPTION_KEY (legacy single key, 64 hex chars), or
  //   - PHI_ENCRYPTION_KEYRING_JSON (rotation-ready keyring object
  //     containing one or more 64-hex keys).
  //
  // A missing or malformed key path would cause crypto failure at
  // runtime. Boot refusal is the primary defence.
  if (isProd) {
    const phiKey = process.env.PHI_ENCRYPTION_KEY?.trim() ?? '';
    const hasLegacyKey = /^[a-f0-9]{64}$/i.test(phiKey);

    const phiKeyringRaw = process.env.PHI_ENCRYPTION_KEYRING_JSON?.trim() ?? '';
    let hasValidKeyring = false;
    let keyringMalformed = false;
    if (phiKeyringRaw.length > 0) {
      try {
        const parsed = JSON.parse(phiKeyringRaw) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const entries = Object.values(parsed as Record<string, unknown>);
          hasValidKeyring = entries.length > 0 && entries.every((v) => typeof v === 'string' && /^[a-f0-9]{64}$/i.test(v));
          keyringMalformed = !hasValidKeyring;
        } else {
          keyringMalformed = true;
        }
      } catch {
        keyringMalformed = true;
      }
    }

    if (keyringMalformed) {
      missing.push({
        name: 'PHI_ENCRYPTION_KEYRING_JSON',
        envVars: ['PHI_ENCRYPTION_KEYRING_JSON={"v1":"<64hex>",...}'],
        note: 'Rotation-ready keyring JSON is malformed. Every value must be a 64-hex key.',
      });
    }

    if (!hasLegacyKey && !hasValidKeyring) {
      missing.push({
        name: 'PHI encryption key material',
        envVars: ['PHI_ENCRYPTION_KEY (64 hex chars) or PHI_ENCRYPTION_KEYRING_JSON'],
        note: 'AES-256-GCM key material for encrypted PHI columns is missing. Configure either legacy single-key or rotation-ready keyring.',
      });
    }
  }

  // Check 7 — Feature-flag-first obligations.
  // If an integration feature flag is ON, the corresponding env vars
  // must be set. Feature flags live in DB; the DB pool lazy-connects
  // on the first query, so this await triggers that connection. If
  // DB is unreachable, the existing DATABASE_URL error path fires
  // first — no new ordering risk.
  const FEATURE_FLAGGED_INTEGRATIONS = [
    {
      flag: 'integration-mhr-docref',
      name: 'MHR (My Health Record document push)',
      envVars: ['MHR_API_URL', 'MHR_NASH_CERT_PATH', 'MHR_CONFORMANCE_ID'],
      check: async () => {
        const { isMhrDocumentApiConfigured } = await import('../integrations/mhr/mhrDocumentClient');
        return isMhrDocumentApiConfigured();
      },
    },
    {
      flag: 'integration-radiology-hl7',
      name: 'Radiology (RIS HL7)',
      envVars: ['RIS_MLLP_HOST', 'RIS_MLLP_PORT'],
      check: async () => {
        const { isRadiologyConfigured } = await import('../integrations/radiology/radiologyClient');
        return isRadiologyConfigured();
      },
    },
    {
      flag: 'integration-healthlink',
      name: 'HealthLink (secure messaging)',
      envVars: ['HEALTHLINK_SMD_ID', 'HEALTHLINK_SMD_URL'],
      check: async () => {
        const { isHealthLinkConfigured } = await import('../integrations/healthlink/healthLinkClient');
        return isHealthLinkConfigured();
      },
    },
  ];
  for (const fi of FEATURE_FLAGGED_INTEGRATIONS) {
    try {
      const enabled = await isFeatureEnabled(fi.flag, null);
      if (enabled) {
        const configured = await fi.check();
        if (!configured) {
          missing.push({
            name: fi.name,
            envVars: fi.envVars,
            note: `Feature flag '${fi.flag}' is ON but integration env vars are unset.`,
          });
        }
      }
    } catch (err) {
      // Feature-flag read failed (DB unreachable, etc.). Not a config
      // error per se — log and move on. The DB reachability issue
      // will surface via the existing DATABASE_URL / connection path.
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), flag: fi.flag },
        '[assertProductionIntegrationsConfigured] feature-flag lookup failed — skipping obligation check',
      );
    }
  }

  // Production: throw. Dev/test: warn and return.
  if (missing.length === 0) return;

  if (!isProd) {
    logger.warn(
      { missingCount: missing.length, integrations: missing.map((m) => m.name) },
      '[BOOT] NODE_ENV!=production — missing integration config tolerated; production boot would fail.',
    );
    return;
  }

  throw new ProductionConfigError(missing);
}

/**
 * Build a structured remediation message listing env vars and doc
 * paths. NEVER prints secret values (only variable names).
 */
function buildRemediationMessage(missing: MissingIntegration[]): string {
  const lines: string[] = [
    '[BOOT] Production integration config incomplete. Missing:',
    '',
  ];
  for (const m of missing) {
    lines.push(`  - ${m.name}`);
    for (const ev of m.envVars) {
      lines.push(`      ${ev}`);
    }
    if (m.note) lines.push(`      → ${m.note}`);
    lines.push('');
  }
  lines.push('Fix the env vars and restart. CrashLoopBackoff is the');
  lines.push('intended enforcement mechanism — pods never become Ready');
  lines.push('against a half-configured integration surface.');
  return lines.join('\n');
}
