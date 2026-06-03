import { describe, expect, it } from 'vitest';
import {
  filterStaffDirectory,
  getRoleVisual,
  getUniqueStaffRoles,
  getUniqueStaffTeams,
  type StaffDirectoryRow,
} from './staffDirectoryViewModel';

const FIXTURE_ROWS: StaffDirectoryRow[] = [
  {
    id: '1',
    givenName: 'Alice',
    familyName: 'Ng',
    email: 'alice.ng@demo.local',
    role: 'clinician',
    discipline: 'Psychiatry',
    teams: ['North Intake Team', 'Crisis Response'],
  },
  {
    id: '2',
    givenName: 'Brian',
    familyName: 'Cole',
    email: 'brian.cole@demo.local',
    role: 'receptionist',
    discipline: 'Administrative Support',
    teams: ['Reception Hub'],
  },
  {
    id: '3',
    givenName: 'Carla',
    familyName: 'Perry',
    email: 'carla.perry@demo.local',
    role: 'manager',
    discipline: 'Mental Health Nursing',
    teams: ['North Intake Team'],
  },
];

describe('staffDirectoryViewModel', () => {
  it('filters by role using normalized values', () => {
    const out = filterStaffDirectory(
      FIXTURE_ROWS,
      '',
      'CLINICIAN',
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe('1');
  });

  it('applies search over full name and email', () => {
    expect(filterStaffDirectory(FIXTURE_ROWS, 'carla', '')).toHaveLength(1);
    expect(filterStaffDirectory(FIXTURE_ROWS, 'demo.local', '')).toHaveLength(3);
  });

  it('returns stable unique role filters', () => {
    expect(getUniqueStaffRoles(FIXTURE_ROWS)).toEqual(['clinician', 'manager', 'receptionist']);
  });

  it('returns stable unique team filters', () => {
    expect(getUniqueStaffTeams(FIXTURE_ROWS)).toEqual(['Crisis Response', 'North Intake Team', 'Reception Hub']);
  });

  it('filters by team using normalized values', () => {
    const out = filterStaffDirectory(FIXTURE_ROWS, '', '', 'north intake team');
    expect(out).toHaveLength(2);
    expect(out.map((row) => row.id)).toEqual(['1', '3']);
  });

  it('maps role to visual token with safe fallback', () => {
    expect(getRoleVisual('admin').fg).toBe('#9A3412');
    expect(getRoleVisual('unknown').border).toBe('#D1D5DB');
  });
});
