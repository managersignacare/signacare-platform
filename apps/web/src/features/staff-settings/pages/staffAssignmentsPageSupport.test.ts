import { describe, expect, it } from 'vitest';
import {
  ASSIGNABLE_ROLE_TYPES,
  normalizeAssignableRoleType,
} from './staffAssignmentsPageSupport';

describe('staffAssignmentsPageSupport', () => {
  it('normalizes assignable role types and common aliases', () => {
    expect(normalizeAssignableRoleType('Primary')).toBe('primary');
    expect(normalizeAssignableRoleType('delegated')).toBe('delegated');
    expect(normalizeAssignableRoleType('Acting')).toBe('additional');
    expect(normalizeAssignableRoleType('Secondment')).toBe('additional');
  });

  it('returns null for unsupported role type labels', () => {
    expect(normalizeAssignableRoleType('team_leader')).toBeNull();
    expect(normalizeAssignableRoleType('manager')).toBeNull();
    expect(normalizeAssignableRoleType('')).toBeNull();
    expect(normalizeAssignableRoleType(undefined)).toBeNull();
  });

  it('exposes canonical role type catalog from shared contract', () => {
    expect([...ASSIGNABLE_ROLE_TYPES]).toEqual(['primary', 'additional', 'delegated']);
  });
});
