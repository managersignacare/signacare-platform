import type { AuthContext } from '@signacare/shared';
import { AppError } from '../../../shared/errors';

const SCRIPT_TAG_PATTERN = /<script[\s\S]*?>[\s\S]*?<\/script>/gi;
const FILE_PATH_PATTERN = /\/Users\/[^\s]+/g;
const RISK_SIGNAL_PATTERN = /\b(?:suicid\w*|self[\s-]?harm\w*|homicid\w*|violence|agitation|psychosis|hallucinat\w*|delusion\w*|mania|hypomania|severe depression|catatoni\w*|relapse|withdrawal|overdose)\b/i;
const NON_DIAGNOSTIC_QUALIFIER_PATTERN = /\b(non[\s-]?diagnostic|clinical signal for clinician review|for clinician review|not a diagnosis|insufficient evidence for diagnostic conclusion)\b/i;
const NON_DIAGNOSTIC_PREFIX =
  'Clinical signal for clinician review (non-diagnostic): potential risk indicators identified; confirm with direct clinical assessment.';

interface GuardAiTextEgressInput {
  routeId: 'suggest' | 'clinical-ai' | 'agent' | 'mcp';
  auth: AuthContext;
  text: string;
}

export interface GuardAiTextEgressResult {
  safeText: string;
  riskLabels: string[];
}

function stripControlChars(value: string): string {
  let out = '';
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    const isControl = (code >= 0 && code <= 8) || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127;
    if (!isControl) out += ch;
  }
  return out;
}

function sanitizeText(value: string): string {
  const normalized = value
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/ {2,}/g, ' ')
    .trim()
    .replace(SCRIPT_TAG_PATTERN, '[redacted-script]')
    .replace(FILE_PATH_PATTERN, '[redacted-path]')
    .trim();
  return stripControlChars(normalized);
}

function assertScopeSafeOutput(input: GuardAiTextEgressInput, safeText: string): void {
  const scopeLevel = input.auth.aiScope?.level;
  if (scopeLevel !== 'patient') return;

  const clinicWidePattern = /\b(organisation statistics|team breakdown|staff directory|clinic-wide)\b/i;
  if (clinicWidePattern.test(safeText)) {
    throw new AppError(
      `AI egress blocked: patient scope cannot emit clinic-wide analytics (${input.routeId})`,
      403,
      'AI_EGRESS_SCOPE_BLOCKED',
    );
  }
}

function enforceNonDiagnosticRiskPosture(value: string): {
  text: string;
  qualifierAlreadyPresent: boolean;
  qualifierInjected: boolean;
} {
  if (!RISK_SIGNAL_PATTERN.test(value)) {
    return { text: value, qualifierAlreadyPresent: false, qualifierInjected: false };
  }

  if (NON_DIAGNOSTIC_QUALIFIER_PATTERN.test(value)) {
    return { text: value, qualifierAlreadyPresent: true, qualifierInjected: false };
  }

  const prefixed = value.startsWith(NON_DIAGNOSTIC_PREFIX)
    ? value
    : `${NON_DIAGNOSTIC_PREFIX}\n\n${value}`;
  return { text: prefixed, qualifierAlreadyPresent: false, qualifierInjected: true };
}

export function guardAiTextEgress(input: GuardAiTextEgressInput): GuardAiTextEgressResult {
  const riskLabels: string[] = [];
  const sanitized = sanitizeText(input.text);

  if (sanitized.length === 0) {
    throw new AppError('AI output is empty after safety sanitization', 502, 'AI_EGRESS_EMPTY');
  }

  if (sanitized.length > 150_000) {
    throw new AppError('AI output exceeds safe response size', 413, 'AI_EGRESS_TOO_LARGE');
  }

  const nonDiagnostic = enforceNonDiagnosticRiskPosture(sanitized);
  const safeText = nonDiagnostic.text;

  if (/\b(approximately|roughly|estimated)\b/i.test(safeText)) {
    riskLabels.push('uncertainty-language');
  }
  if (/\[redacted-script\]/.test(safeText)) {
    riskLabels.push('script-redaction');
  }
  if (/\[redacted-path\]/.test(safeText)) {
    riskLabels.push('path-redaction');
  }
  if (nonDiagnostic.qualifierAlreadyPresent) {
    riskLabels.push('non-diagnostic-risk-qualified');
  }
  if (nonDiagnostic.qualifierInjected) {
    riskLabels.push('non-diagnostic-risk-label-injected');
  }

  assertScopeSafeOutput(input, safeText);
  return { safeText, riskLabels };
}
