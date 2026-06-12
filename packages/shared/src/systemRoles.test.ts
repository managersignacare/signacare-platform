import { describe, expect, it } from 'vitest';
import {
  canApproveEctTmsForms,
  canCompleteEctTmsForms,
  expandRoleMembership,
  isPrescriberSystemRole,
  requiresConsultantApprovalForEctTms,
  roleHasManagerPrivileges,
  roleSatisfiesRequirement,
} from './systemRoles';

describe('systemRoles', () => {
  it('treats all new prescriber roles as prescriber system roles', () => {
    expect(isPrescriberSystemRole('prescriber_consultant')).toBe(true);
    expect(isPrescriberSystemRole('prescriber_registrar')).toBe(true);
    expect(isPrescriberSystemRole('prescriber_hmo')).toBe(true);
    expect(isPrescriberSystemRole('prescriber_nurse_practitioner')).toBe(true);
    expect(isPrescriberSystemRole('clinician')).toBe(false);
  });

  it('grants clinician access to all prescriber roles and manager access to consultant only', () => {
    expect(expandRoleMembership('prescriber_consultant')).toEqual(
      new Set(['prescriber_consultant', 'clinician', 'manager']),
    );
    expect(expandRoleMembership('prescriber_registrar')).toEqual(
      new Set(['prescriber_registrar', 'clinician']),
    );
    expect(roleHasManagerPrivileges('prescriber_consultant')).toBe(true);
    expect(roleHasManagerPrivileges('prescriber_registrar')).toBe(false);
  });

  it('lets inherited role checks pass through legacy clinician and manager gates', () => {
    expect(roleSatisfiesRequirement('prescriber_registrar', 'clinician')).toBe(true);
    expect(roleSatisfiesRequirement('prescriber_hmo', 'clinician')).toBe(true);
    expect(roleSatisfiesRequirement('prescriber_consultant', 'manager')).toBe(true);
    expect(roleSatisfiesRequirement('prescriber_registrar', 'manager')).toBe(false);
  });

  it('splits ECT/TMS completion from consultant approval', () => {
    expect(canCompleteEctTmsForms('prescriber_consultant')).toBe(true);
    expect(canCompleteEctTmsForms('prescriber_registrar')).toBe(true);
    expect(canCompleteEctTmsForms('prescriber_hmo')).toBe(true);
    expect(canCompleteEctTmsForms('prescriber_nurse_practitioner')).toBe(false);
    expect(canApproveEctTmsForms('prescriber_consultant')).toBe(true);
    expect(canApproveEctTmsForms('prescriber_registrar')).toBe(false);
    expect(requiresConsultantApprovalForEctTms('prescriber_registrar')).toBe(true);
    expect(requiresConsultantApprovalForEctTms('prescriber_consultant')).toBe(false);
  });
});
