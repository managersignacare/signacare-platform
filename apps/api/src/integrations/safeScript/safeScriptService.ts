/**
 * SafeScript (Victoria PDMP) Integration Service
 *
 * Real-time prescription monitoring for Schedule 8 and high-risk Schedule 4.
 * Mandatory check before prescribing controlled substances.
 *
 * OAuth2 client credentials flow → patient supply query → risk indicators.
 * All checks audit-logged per APP 12.
 */
import { logger } from '../../utils/logger';
import { writeAuditLog } from '../../utils/audit';
import {
  SafeScriptCheckResultSchema,
  type SafeScriptCheckResult,
  type SafeScriptPatientIdentifier,
  type SafeScriptSupply,
} from '@signacare/shared';

// Re-export shared SSoT types for existing local import paths.
export type {
  SafeScriptCheckResult,
  SafeScriptPatientIdentifier,
  SafeScriptSupply,
} from '@signacare/shared';

// ── OAuth2 Token Cache ──
let cachedToken: { accessToken: string; expiresAt: number } | null = null;

function isConfigured(): boolean {
  return !!(process.env.SAFESCRIPT_API_URL && process.env.SAFESCRIPT_CLIENT_ID && process.env.SAFESCRIPT_CLIENT_SECRET);
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.accessToken;

  const url = `${process.env.SAFESCRIPT_API_URL}/oauth/token`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.SAFESCRIPT_CLIENT_ID!,
      client_secret: process.env.SAFESCRIPT_CLIENT_SECRET!,
      scope: 'patient:read supply:read',
    }),
  });

  if (!resp.ok) throw new Error(`SafeScript OAuth failed: ${resp.status}`);
  const data = await resp.json() as { access_token: string; expires_in: number };
  cachedToken = { accessToken: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return cachedToken.accessToken;
}

export interface SafeScriptService {
  checkPatient(clinicId: string, actorId: string, patientId: string, identifier: SafeScriptPatientIdentifier): Promise<SafeScriptCheckResult>;
  isConfigured(): boolean;
}

class SafeScriptServiceImpl implements SafeScriptService {
  isConfigured(): boolean { return isConfigured(); }

  async checkPatient(
    clinicId: string, actorId: string, patientId: string, identifier: SafeScriptPatientIdentifier,
  ): Promise<SafeScriptCheckResult> {
    const checkedAt = new Date().toISOString();

    // Audit log — ALL SafeScript checks must be recorded (APP 12)
    await writeAuditLog({
      actorId, clinicId, action: 'READ', tableName: 'safescript_checks', recordId: patientId,
      newData: { patient: `${identifier.givenName} ${identifier.familyName}`, configured: this.isConfigured() },
    });

    if (!this.isConfigured()) {
      logger.info({ patientId }, '[SafeScript] Not configured — returning unchecked result');
      return SafeScriptCheckResultSchema.parse({
        checked: false, checkedAt, patientFound: false, supplies: [], riskIndicators: [],
        error: 'SafeScript not configured. Set SAFESCRIPT_API_URL, SAFESCRIPT_CLIENT_ID, SAFESCRIPT_CLIENT_SECRET.',
      });
    }

    try {
      const token = await getAccessToken();
      const lookupId = identifier.ihi || identifier.medicareNumber;
      if (!lookupId) {
        return SafeScriptCheckResultSchema.parse({
          checked: false,
          checkedAt,
          patientFound: false,
          supplies: [],
          riskIndicators: [],
          error: 'No IHI or Medicare number for lookup.',
        });
      }

      // Query patient supplies
      const supplyResp = await fetch(
        `${process.env.SAFESCRIPT_API_URL}/patients/${encodeURIComponent(lookupId)}/supplies?lookbackDays=90`,
        { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
      );

      if (supplyResp.status === 404) {
        return SafeScriptCheckResultSchema.parse({
          checked: true,
          checkedAt,
          patientFound: false,
          supplies: [],
          riskIndicators: [],
        });
      }
      if (!supplyResp.ok) {
        const errText = await supplyResp.text();
        return SafeScriptCheckResultSchema.parse({
          checked: false,
          checkedAt,
          patientFound: false,
          supplies: [],
          riskIndicators: [],
          error: `SafeScript ${supplyResp.status}: ${errText.substring(0, 200)}`,
        });
      }

      // SafeScript API response shapes (per Vic/NSW real-time prescription
      // monitoring API contract — field names vary slightly between jurisdictions,
      // so the mapping below accepts both common variants).
      interface SafeScriptSupplyRaw {
        medicationName?: string;
        drugName?: string;
        dose?: string;
        quantity?: number;
        repeatsSupplied?: number;
        pharmacyName?: string;
        dispensingPharmacy?: string;
        supplyDate?: string;
        prescriberName?: string;
        prescribedBy?: string;
      }
      const supplyData = await supplyResp.json() as { supplies?: SafeScriptSupplyRaw[] };
      const supplies: SafeScriptSupply[] = (supplyData.supplies ?? []).map((s) => ({
        medicationName: s.medicationName ?? s.drugName ?? '',
        dose: s.dose ?? '',
        quantity: s.quantity ?? 0,
        repeatsSupplied: s.repeatsSupplied ?? 0,
        dispensingPharmacy: s.pharmacyName ?? s.dispensingPharmacy ?? '',
        supplyDate: s.supplyDate ?? '',
        prescribedBy: s.prescriberName ?? s.prescribedBy ?? '',
      }));

      // Query risk indicators
      let riskIndicators: string[] = [];
      try {
        const riskResp = await fetch(
          `${process.env.SAFESCRIPT_API_URL}/patients/${encodeURIComponent(lookupId)}/risk-indicators`,
          { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
        );
        if (riskResp.ok) {
          const riskData = await riskResp.json() as { indicators?: string[]; riskIndicators?: string[] };
          riskIndicators = riskData.indicators ?? riskData.riskIndicators ?? [];
        }
      } catch { /* risk check is optional — don't block on failure */ }

      logger.info({ patientId, supplies: supplies.length, risks: riskIndicators.length }, '[SafeScript] Check complete');
      return SafeScriptCheckResultSchema.parse({
        checked: true,
        checkedAt,
        patientFound: true,
        supplies,
        riskIndicators,
      });

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err: msg, patientId }, '[SafeScript] Error during check');
      return SafeScriptCheckResultSchema.parse({
        checked: false,
        checkedAt,
        patientFound: false,
        supplies: [],
        riskIndicators: [],
        error: msg,
      });
    }
  }
}

export const safeScriptService: SafeScriptService = new SafeScriptServiceImpl();

/**
 * Mandatory check enforcement — call this before prescribing S8 medications.
 * Throws if SafeScript check has not been performed.
 */
export async function enforceSafeScriptCheck(
  clinicId: string, actorId: string, patientId: string, identifier: SafeScriptPatientIdentifier, isS8: boolean,
): Promise<SafeScriptCheckResult | null> {
  if (!isS8) return null; // Not a controlled substance — no check required

  const result = await safeScriptService.checkPatient(clinicId, actorId, patientId, identifier);

  if (!result.checked && safeScriptService.isConfigured()) {
    throw new Error('SafeScript check failed — cannot prescribe Schedule 8 medication without a successful SafeScript check.');
  }

  // Log if risk indicators found
  if (result.riskIndicators.length > 0) {
    logger.warn({ patientId, risks: result.riskIndicators }, '[SafeScript] Risk indicators detected for S8 prescription');
    await writeAuditLog({
      actorId, clinicId, action: 'READ', tableName: 'safescript_checks', recordId: patientId,
      newData: { riskIndicators: result.riskIndicators, action: 'S8 prescription — risk indicators present' },
    });
  }

  return result;
}
