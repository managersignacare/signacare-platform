import { v5 as uuidv5 } from 'uuid';

// Phase 0.8 — Good Health deterministic demo seed.
//
// Every seeded entity derives its UUID from a canonical name string via
// uuidv5 against this namespace. This lets re-running the seed upsert
// rows in place, and lets tests hard-assert "row X exists with id Y" by
// recomputing the same hash. Do NOT change NAMESPACE after the first
// successful seed run — every id in the seeded database would move.
const NAMESPACE = '1f3c9a4e-0000-5000-8000-000000000001';

const id = (canonical: string): string => uuidv5(canonical, NAMESPACE);

export const orgId = (): string => id('good-health.org');
export const departmentId = (slug: string): string =>
  id(`good-health.department.${slug}`);
export const hospitalId = (slug: string): string =>
  id(`good-health.hospital.${slug}`);
export const clinicId = (slug: string): string =>
  id(`good-health.clinic.${slug}`);
export const teamId = (clinicSlug: string, teamSlug: string): string =>
  id(`good-health.clinic.${clinicSlug}.team.${teamSlug}`);
export const programId = (slug: string): string =>
  id(`good-health.program.${slug}`);
export const staffId = (clinicSlug: string, staffSlug: string): string =>
  id(`good-health.staff.${clinicSlug}.${staffSlug}`);
export const patientId = (
  clinicSlug: string,
  teamSlug: string,
  index: number,
): string =>
  id(
    `good-health.patient.${clinicSlug}.${teamSlug}.${index.toString().padStart(3, '0')}`,
  );
export const episodeId = (patientUuid: string, index: number): string =>
  id(`${patientUuid}.episode.${index}`);
export const noteId = (episodeUuid: string, index: number): string =>
  id(`${episodeUuid}.note.${index}`);

// Escape hatch for ad-hoc child rows whose parent id is already uuidv5.
export const derive = (parent: string, suffix: string): string =>
  id(`${parent}.${suffix}`);
