import { RoleEnum, isPrescriberSystemRole } from '@signacare/shared';

export const STAFF_SYSTEM_ROLES = RoleEnum.options;

export type StaffSystemRole = (typeof STAFF_SYSTEM_ROLES)[number];
export { isPrescriberSystemRole };

export const STAFF_PROVIDER_TYPES = [
  'Medicare',
  'DVA',
  'WorkCover',
] as const;

export interface StaffProviderNumber {
  number: string;
  location: string;
  type: string;
}

export function parseProviderNumbersFromQualifications(
  qualifications: string | null | undefined,
): StaffProviderNumber[] {
  if (!qualifications) return [];
  try {
    const parsed: unknown = JSON.parse(qualifications);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row) => {
        if (!row || typeof row !== 'object') return null;
        const rec = row as Record<string, unknown>;
        return {
          number: typeof rec.number === 'string' ? rec.number : '',
          location: typeof rec.location === 'string' ? rec.location : '',
          type: typeof rec.type === 'string' ? rec.type : 'Medicare',
        };
      })
      .filter((row): row is StaffProviderNumber => row !== null && row.number.trim().length > 0);
  } catch {
    return [];
  }
}
