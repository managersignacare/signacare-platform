import type { AuthContext } from '@signacare/shared';
import { HttpError } from './errors';

const DEFAULT_SUPERADMIN_EMAIL_DOMAINS = ['signacare.net', 'signacare.local'] as const;

function normalizeDomain(domain: string): string | null {
  const trimmed = domain.trim().toLowerCase();
  if (!trimmed) return null;
  return trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
}

function parseAllowedDomains(raw: string | undefined): string[] {
  if (!raw || raw.trim().length === 0) {
    return [...DEFAULT_SUPERADMIN_EMAIL_DOMAINS];
  }

  const domains = raw
    .split(',')
    .map(normalizeDomain)
    .filter((value): value is string => Boolean(value));

  if (domains.length === 0) {
    return [...DEFAULT_SUPERADMIN_EMAIL_DOMAINS];
  }

  return Array.from(new Set(domains));
}

function getEmailDomain(email: string): string | null {
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf('@');
  if (at <= 0 || at === normalized.length - 1) return null;
  return normalized.slice(at + 1);
}

export function getAllowedSuperadminEmailDomains(): string[] {
  return parseAllowedDomains(process.env.SUPERADMIN_ALLOWED_EMAIL_DOMAINS);
}

export function isAllowedSuperadminEmail(email: string): boolean {
  const domain = getEmailDomain(email);
  if (!domain) return false;
  return getAllowedSuperadminEmailDomains().includes(domain);
}

export function assertSuperadminSessionEligibility(input: {
  role: string;
  email: string;
}): void {
  if (input.role.toLowerCase() !== 'superadmin') return;
  if (isAllowedSuperadminEmail(input.email)) return;
  throw new HttpError(
    403,
    'FORBIDDEN',
    `Superadmin access requires an approved Signacare staff email domain (${getAllowedSuperadminEmailDomains().join(', ')})`,
  );
}

export function assertSuperadminRoleMutationAllowed(input: {
  actorAuth: AuthContext | undefined;
  existingRole?: string | null;
  targetRole: string;
  targetEmail: string;
}): void {
  const existingIsSuperadmin = input.existingRole?.toLowerCase() === 'superadmin';
  const targetIsSuperadmin = input.targetRole.toLowerCase() === 'superadmin';
  if (!existingIsSuperadmin && !targetIsSuperadmin) return;

  if (!input.actorAuth || input.actorAuth.role.toLowerCase() !== 'superadmin') {
    throw new HttpError(
      403,
      'FORBIDDEN',
      'Only platform superadmin may assign or modify superadmin accounts',
    );
  }

  if (!isAllowedSuperadminEmail(input.targetEmail)) {
    throw new HttpError(
      422,
      'VALIDATION_ERROR',
      `Superadmin accounts must use an approved Signacare staff email domain (${getAllowedSuperadminEmailDomains().join(', ')})`,
    );
  }
}
