/**
 * BUG-SA-006 — Assignment drift reconciliation protocol
 *
 * Reconciles active episode ownership (episodes.team_id + primary_clinician_id)
 * with patient_team_assignments.
 *
 * Defaults to DRY-RUN.
 *
 * Usage:
 *   npx tsx apps/api/scripts/reconcile-assignment-drift.ts
 *   npx tsx apps/api/scripts/reconcile-assignment-drift.ts --clinic <clinicId>
 *   npx tsx apps/api/scripts/reconcile-assignment-drift.ts --apply
 *   npx tsx apps/api/scripts/reconcile-assignment-drift.ts --apply --deactivate-stale
 */

import { randomUUID } from 'node:crypto';
import { dbAdmin } from '../src/db/db';

type EpisodeAssignment = {
  episode_id: string;
  patient_id: string;
  clinic_id: string;
  org_unit_id: string;
  primary_clinician_id: string;
};

type ExistingAssignment = {
  id: string;
  patient_id: string;
  org_unit_id: string;
  primary_clinician_id: string | null;
  is_active: boolean;
  referral_status: string | null;
};

type CliOptions = {
  apply: boolean;
  deactivateStale: boolean;
  clinicId: string | null;
};

function parseArgs(argv: string[]): CliOptions {
  const apply = argv.includes('--apply');
  const deactivateStale = argv.includes('--deactivate-stale');
  const clinicIndex = argv.indexOf('--clinic');
  const clinicId = clinicIndex >= 0 ? (argv[clinicIndex + 1] ?? null) : null;
  if (clinicIndex >= 0 && !clinicId) {
    throw new Error('Missing value for --clinic');
  }
  if (deactivateStale && !apply) {
    throw new Error('--deactivate-stale requires --apply');
  }
  return { apply, deactivateStale, clinicId };
}

function key(patientId: string, orgUnitId: string): string {
  return `${patientId}::${orgUnitId}`;
}

async function loadActiveEpisodeAssignments(clinicId: string | null): Promise<EpisodeAssignment[]> {
  const query = dbAdmin('episodes as e')
    .join('patients as p', 'p.id', 'e.patient_id')
    .where('e.status', 'active')
    .whereNull('e.deleted_at')
    .whereNotNull('e.team_id')
    .whereNotNull('e.primary_clinician_id')
    .select<EpisodeAssignment[]>(
      'e.id as episode_id',
      'e.patient_id',
      'e.clinic_id',
      'e.team_id as org_unit_id',
      'e.primary_clinician_id',
    );
  if (clinicId) query.where('e.clinic_id', clinicId);
  return query;
}

async function loadAllAssignments(clinicId: string | null): Promise<ExistingAssignment[]> {
  const query = dbAdmin('patient_team_assignments as pta')
    .join('patients as p', 'p.id', 'pta.patient_id')
    .join('org_units as ou', 'ou.id', 'pta.org_unit_id')
    .select<ExistingAssignment[]>(
      'pta.id',
      'pta.patient_id',
      'pta.org_unit_id',
      'pta.primary_clinician_id',
      'pta.is_active',
      'pta.referral_status',
    );
  if (clinicId) query.where('p.clinic_id', clinicId).andWhere('ou.clinic_id', clinicId);
  return query;
}

async function run(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const now = new Date();
  const episodes = await loadActiveEpisodeAssignments(opts.clinicId);
  const allAssignments = await loadAllAssignments(opts.clinicId);

  const byPatientTeam = new Map<string, ExistingAssignment>();
  for (const row of allAssignments) byPatientTeam.set(key(row.patient_id, row.org_unit_id), row);

  const episodeKeys = new Set<string>();
  const inserts: EpisodeAssignment[] = [];
  const reactivateOrUpdate: Array<{ expected: EpisodeAssignment; current: ExistingAssignment }> = [];

  for (const episode of episodes) {
    const k = key(episode.patient_id, episode.org_unit_id);
    episodeKeys.add(k);
    const current = byPatientTeam.get(k);
    if (!current) {
      inserts.push(episode);
      continue;
    }
    const clinicianMismatch = current.primary_clinician_id !== episode.primary_clinician_id;
    if (!current.is_active || clinicianMismatch) {
      reactivateOrUpdate.push({ expected: episode, current });
    }
  }

  const staleActive = allAssignments.filter((row) => row.is_active && !episodeKeys.has(key(row.patient_id, row.org_unit_id)));

  const summary = {
    mode: opts.apply ? 'apply' : 'dry-run',
    clinicId: opts.clinicId ?? 'ALL',
    activeEpisodesConsidered: episodes.length,
    assignmentRowsScanned: allAssignments.length,
    missingAssignmentRows: inserts.length,
    rowsNeedingReactivationOrClinicianSync: reactivateOrUpdate.length,
    staleActiveAssignmentRows: staleActive.length,
    staleDeactivationEnabled: opts.deactivateStale,
  };

  console.log('\nBUG-SA-006 assignment drift reconciliation');
  console.table(summary);

  if (inserts.length > 0) {
    console.log('\nSample missing rows (first 10):');
    console.table(
      inserts.slice(0, 10).map((row) => ({
        episodeId: row.episode_id,
        patientId: row.patient_id,
        orgUnitId: row.org_unit_id,
        clinicianId: row.primary_clinician_id,
      })),
    );
  }

  if (reactivateOrUpdate.length > 0) {
    console.log('\nSample rows requiring reactivation/clinician sync (first 10):');
    console.table(
      reactivateOrUpdate.slice(0, 10).map(({ expected, current }) => ({
        assignmentId: current.id,
        patientId: expected.patient_id,
        orgUnitId: expected.org_unit_id,
        fromClinician: current.primary_clinician_id,
        toClinician: expected.primary_clinician_id,
        fromActive: current.is_active,
      })),
    );
  }

  if (staleActive.length > 0) {
    console.log('\nSample stale active assignment rows (first 10):');
    console.table(
      staleActive.slice(0, 10).map((row) => ({
        assignmentId: row.id,
        patientId: row.patient_id,
        orgUnitId: row.org_unit_id,
        clinicianId: row.primary_clinician_id,
      })),
    );
  }

  if (!opts.apply) {
    console.log('\nDry-run only. Re-run with --apply to write changes.');
    return;
  }

  await dbAdmin.transaction(async (trx) => {
    for (const row of inserts) {
      await trx('patient_team_assignments').insert({
        id: randomUUID(),
        patient_id: row.patient_id,
        org_unit_id: row.org_unit_id,
        primary_clinician_id: row.primary_clinician_id,
        is_active: true,
        referral_status: 'accepted',
        created_at: now,
        updated_at: now,
      });
    }
    for (const row of reactivateOrUpdate) {
      await trx('patient_team_assignments')
        .where({ id: row.current.id })
        .update({
          primary_clinician_id: row.expected.primary_clinician_id,
          is_active: true,
          updated_at: now,
        });
    }
    if (opts.deactivateStale) {
      for (const row of staleActive) {
        await trx('patient_team_assignments')
          .where({ id: row.id })
          .update({
            is_active: false,
            updated_at: now,
          });
      }
    }
  });

  console.log('\nApply mode completed successfully.');
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nAssignment reconciliation failed:', err);
    process.exit(1);
  });
