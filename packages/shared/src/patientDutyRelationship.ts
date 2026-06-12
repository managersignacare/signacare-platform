import { hasClinicalAccess } from './permissions';
import { isPrescriberSystemRole } from './systemRoles';

export const DUTY_RELATIONSHIP_TYPES = [
  'duty_clinician',
  'duty_prescriber',
] as const;

export type DutyRelationshipType = (typeof DUTY_RELATIONSHIP_TYPES)[number];

export const DUTY_RELATIONSHIP_DURATION_HOURS = [4, 8, 12] as const;

export type DutyRelationshipDurationHours =
  (typeof DUTY_RELATIONSHIP_DURATION_HOURS)[number];

export function isDutyRelationshipType(
  value: string | null | undefined,
): value is DutyRelationshipType {
  return value !== null
    && value !== undefined
    && DUTY_RELATIONSHIP_TYPES.includes(value as DutyRelationshipType);
}

export function canRequestDutyClinicianRelationship(
  role: string | null | undefined,
): boolean {
  return hasClinicalAccess(role);
}

export function canRequestDutyPrescriberRelationship(
  role: string | null | undefined,
): boolean {
  return isPrescriberSystemRole(role);
}

export function getAllowedDutyRelationshipTypes(
  role: string | null | undefined,
): DutyRelationshipType[] {
  if (!canRequestDutyClinicianRelationship(role)) return [];

  const allowed: DutyRelationshipType[] = ['duty_clinician'];
  if (canRequestDutyPrescriberRelationship(role)) {
    allowed.push('duty_prescriber');
  }
  return allowed;
}

