import { describe, expect, test } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const episodeRoutesSource = readFileSync(
  resolve(__dirname, '..', '..', 'src', 'features', 'episode', 'episodeRoutes.ts'),
  'utf8',
);

describe('BUG-EPISODE-MDT-LOOKUP-CLINIC-ID source guards', () => {
  test('patients-by-team membership lookup includes clinic_id', () => {
    expect(episodeRoutesSource).toMatch(
      /staff_team_assignments'\)\s*\n\s*\.where\(\{\s*clinic_id:\s*req\.clinicId,\s*staff_id:\s*user\.id,\s*org_unit_id:\s*req\.params\.team,\s*is_active:\s*true\s*\}\)/,
    );
  });

  test('existing MDT assignment preload includes clinic_id', () => {
    expect(episodeRoutesSource).toMatch(
      /const existingAssignments = await trx\('staff_role_assignments'\)\s*\n\s*\.where\(\{\s*clinic_id:\s*clinicId,\s*org_unit_id:\s*dto\.orgUnitId\s*\}\)/,
    );
  });

  test('allocation roster lookup includes clinic_id', () => {
    expect(episodeRoutesSource).toContain(".where('staff_role_assignments.clinic_id', clinicId)");
  });

  test('patients-by-clinician roster query scopes joined patients to clinic and soft-delete', () => {
    expect(episodeRoutesSource).toContain(".where('patients.clinic_id', req.clinicId)");
    expect(episodeRoutesSource).toContain(".whereNull('patients.deleted_at')");
  });

  test('allocation team name lookup scopes org_units by clinic_id', () => {
    expect(episodeRoutesSource).toContain("db('org_units').where({ id: orgUnitId, clinic_id: clinicId }).first()");
  });
});
