// apps/api/src/features/llm/letterDraftSafety.ts
//
// BUG-425 — downstream safety filter for AI-generated letter drafts.
//
// Why this exists:
// - Letter body generation is model output and can include unintended
//   identifiers copied from prior context windows or stale prompt state.
// - We keep the full header (patient/recipient identifiers) outside the
//   AI body and assemble it in controlled UI/API paths.
// - This filter strips high-risk identifier/contact/header lines from
//   model output before it is returned to clients.

import { AppError } from '../../shared/errors';
import { logger } from '../../utils/logger';

export interface LetterDraftSafetyResult {
  sanitisedBody: string;
  removedLineCount: number;
  redactionSummary: Record<string, number>;
  hadSensitiveContent: boolean;
}

export interface LetterDraftContractResult {
  result: string;
  applied: boolean;
  removedLineCount: number;
  redactionSummary: Record<string, number>;
}

interface LetterDraftRouteSafetyInput {
  action: string;
  patientId: string | undefined;
  rawResult: string;
  bypassEnabled: boolean;
  clinicId: string | null;
  staffId: string | null;
  bypassFlagName: string;
}

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const LONG_NUMBER_PATTERN = /\b\d{8,}\b/;
const PHONE_PATTERN = /\b(?:\+?\d[\d().\s-]{7,}\d)\b/;

const SENSITIVE_LINE_RULES: Array<{ key: string; pattern: RegExp }> = [
  { key: 'identifier_dob', pattern: /\b(?:dob|date of birth)\b/i },
  { key: 'identifier_mrn', pattern: /\b(?:mrn|urno?|ur\b|medical\s*record)\b/i },
  { key: 'identifier_hi', pattern: /\b(?:medicare|ihi|hpi[-\s]?i|hpio)\b/i },
  { key: 'contact_email', pattern: /\b(?:email|e-mail)\b/i },
  { key: 'contact_phone', pattern: /\b(?:phone|mobile|fax|tel)\b/i },
  { key: 'address_line', pattern: /\b(?:address|street|road|avenue|postcode)\b/i },
  { key: 'header_re', pattern: /^\s*re\s*:/i },
  { key: 'header_dear', pattern: /^\s*dear\s+/i },
  { key: 'header_signoff', pattern: /^\s*(?:yours sincerely|kind regards|regards|thank you)\b/i },
];

function increment(summary: Record<string, number>, key: string): void {
  summary[key] = (summary[key] ?? 0) + 1;
}

function collapseBlankLines(lines: string[]): string[] {
  const out: string[] = [];
  let blankRun = 0;
  for (const line of lines) {
    if (line.trim().length === 0) {
      blankRun += 1;
      if (blankRun <= 1) out.push('');
      continue;
    }
    blankRun = 0;
    out.push(line);
  }
  return out;
}

export function applyLetterDraftSafetyFilter(rawBody: string): LetterDraftSafetyResult {
  const source = typeof rawBody === 'string' ? rawBody : '';
  const lines = source.split(/\r?\n/);
  const kept: string[] = [];
  const redactionSummary: Record<string, number> = {};
  let removedLineCount = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    let redactedBy: string | null = null;

    for (const rule of SENSITIVE_LINE_RULES) {
      if (rule.pattern.test(trimmed)) {
        redactedBy = rule.key;
        break;
      }
    }

    if (!redactedBy && EMAIL_PATTERN.test(trimmed)) {
      redactedBy = 'contact_email_literal';
    }
    if (!redactedBy && PHONE_PATTERN.test(trimmed) && /(?:phone|mobile|fax|tel)/i.test(trimmed)) {
      redactedBy = 'contact_phone_literal';
    }
    if (!redactedBy && LONG_NUMBER_PATTERN.test(trimmed) && /(?:dob|mrn|ur|medicare|ihi|hpi)/i.test(trimmed)) {
      redactedBy = 'identifier_numeric_literal';
    }

    if (redactedBy) {
      removedLineCount += 1;
      increment(redactionSummary, redactedBy);
      continue;
    }

    kept.push(line);
  }

  const collapsed = collapseBlankLines(kept);
  let sanitisedBody = collapsed.join('\n').trim();
  if (!sanitisedBody) {
    sanitisedBody =
      'Clinical summary drafted from consultation notes. Please review source notes and complete recipient-specific wording manually.';
  }

  return {
    sanitisedBody,
    removedLineCount,
    redactionSummary,
    hadSensitiveContent: removedLineCount > 0,
  };
}

export function applyLetterDraftContract(params: {
  action: string;
  patientId: string | undefined;
  rawResult: string;
  bypassEnabled: boolean;
}): LetterDraftContractResult {
  if (params.action !== 'letter') {
    return {
      result: params.rawResult,
      applied: false,
      removedLineCount: 0,
      redactionSummary: {},
    };
  }

  if (!params.patientId) {
    throw new AppError(
      'patientId is required for letter generation safety controls.',
      400,
      'VALIDATION_ERROR',
    );
  }

  if (params.bypassEnabled) {
    return {
      result: params.rawResult,
      applied: false,
      removedLineCount: 0,
      redactionSummary: {},
    };
  }

  const safety = applyLetterDraftSafetyFilter(params.rawResult);
  return {
    result: safety.sanitisedBody,
    applied: true,
    removedLineCount: safety.removedLineCount,
    redactionSummary: safety.redactionSummary,
  };
}

export function applyLetterDraftSafetyForRoute(params: LetterDraftRouteSafetyInput): string {
  if (params.bypassEnabled && params.action === 'letter') {
    logger.warn(
      {
        clinicId: params.clinicId,
        staffId: params.staffId,
        flag: params.bypassFlagName,
      },
      'BUG-425: letter draft sensitive filter bypass is enabled',
    );
  }

  const safety = applyLetterDraftContract({
    action: params.action,
    patientId: params.patientId,
    rawResult: params.rawResult,
    bypassEnabled: params.bypassEnabled,
  });

  if (safety.applied && safety.removedLineCount > 0) {
    logger.warn(
      {
        clinicId: params.clinicId,
        staffId: params.staffId,
        removedLineCount: safety.removedLineCount,
        redactionSummary: safety.redactionSummary,
      },
      'BUG-425: letter draft safety filter removed sensitive fields',
    );
  }

  return safety.result;
}
