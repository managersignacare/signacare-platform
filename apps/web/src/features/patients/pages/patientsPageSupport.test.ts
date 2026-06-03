import { describe, expect, it } from 'vitest';
import {
  resolvePrimaryClinicianId,
  rowIncludesClinician,
} from './patientsPageSupport';

describe('patientsPageSupport clinician resolution', () => {
  it('resolves effective clinician id in priority order', () => {
    expect(resolvePrimaryClinicianId({
      effectivePrimaryClinicianId: 'staff-effective',
      openEpisodePrimaryClinicianId: 'staff-primary',
      primaryClinicianId: 'staff-assignment',
      openEpisodeKeyWorkerId: 'staff-keyworker',
      keyWorkerId: 'staff-keyworker-assignment',
    })).toBe('staff-effective');

    expect(resolvePrimaryClinicianId({
      effectivePrimaryClinicianId: null,
      openEpisodePrimaryClinicianId: 'staff-primary',
      primaryClinicianId: 'staff-assignment',
    })).toBe('staff-primary');
  });

  it('matches clinician involvement across primary and key-worker fields', () => {
    const row = {
      primaryClinicianId: 'staff-primary',
      openEpisodePrimaryClinicianId: 'staff-primary-open',
      effectivePrimaryClinicianId: 'staff-effective',
      openEpisodeKeyWorkerId: 'staff-key-worker',
      keyWorkerId: 'staff-key-worker-assignment',
    };

    expect(rowIncludesClinician(row, 'staff-primary')).toBe(true);
    expect(rowIncludesClinician(row, 'staff-key-worker')).toBe(true);
    expect(rowIncludesClinician(row, 'staff-key-worker-assignment')).toBe(true);
    expect(rowIncludesClinician(row, 'staff-missing')).toBe(false);
    expect(rowIncludesClinician(row, '')).toBe(false);
    expect(rowIncludesClinician(row, null)).toBe(false);
  });

  it('matches clinician involvement from MDT role assignments', () => {
    const row = {
      primaryClinicianId: null,
      openEpisodePrimaryClinicianId: null,
      effectivePrimaryClinicianId: null,
      openEpisodeKeyWorkerId: null,
      keyWorkerId: null,
      mdt: [
        { staff_id: 'staff-consultant', role_name: 'Consultant Psychiatrist' },
        { staffId: 'staff-registrar', role_name: 'Junior Medical Staff / Registrar' },
      ],
    };

    expect(rowIncludesClinician(row, 'staff-consultant')).toBe(true);
    expect(rowIncludesClinician(row, 'staff-registrar')).toBe(true);
    expect(rowIncludesClinician(row, 'staff-missing')).toBe(false);
  });
});
