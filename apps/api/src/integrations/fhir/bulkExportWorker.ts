/**
 * apps/api/src/integrations/fhir/bulkExportWorker.ts
 *
 * S3.2 — FHIR Bulk Data Access $export worker
 *
 * Picks up jobs enqueued by the /Patient/$export, /Group/[id]/$export
 * routes, streams matching DB rows through the FHIR serialisers, writes
 * one NDJSON file per resource type to BlobStorage (S1.1), and updates
 * the fhir_bulk_export_jobs row with the resulting manifest.
 *
 * The job is processed in fixed-size batches per resource type so that
 * memory usage is bounded regardless of how many patients exist. The
 * worker writes the entire NDJSON file in one BlobStorage.put call —
 * for very large clinics (>50k patients) we'd want chunked uploads, but
 * that's a follow-up; for now the per-type buffer is the simple,
 * correct shape.
 *
 * Naming: DB columns snake_case, function exports camelCase, NDJSON
 * field names camelCase per FHIR R4.
 */

import type { Knex } from 'knex';
import { db } from '../../db/db';
import { logger } from '../../utils/logger';
import { config } from '../../config/config';
import { blobStorage } from '../../shared/blobStorage';
import {
  patientToFhir,
  observationToFhir,
  conditionToFhir,
  medicationToFhir,
  isSupportedBulkType,
  type BulkResourceType,
} from './serializers';

interface BulkExportJobRow {
  id: string;
  clinic_id: string;
  requested_by_staff_id: string;
  types: string[];
  since: Date | string | null;
  request_url: string;
  group_id: string | null;
  status: string;
  output_files: Array<{ type: string; url: string; count: number; sizeBytes: number }>;
  total_resources: number | null;
  exported_resources: number;
}

interface OutputFile {
  type: string;
  url: string;
  count: number;
  sizeBytes: number;
}

/**
 * Stream-fetch rows for one resource type from the right table, given
 * the clinic_id and an optional `_since` cutoff. Yields one FHIR JSON
 * object per DB row. The query is paginated by id so the result set
 * never lives entirely in memory.
 */
async function* iterateResources(
  type: BulkResourceType,
  clinicId: string,
  since: Date | null,
  groupId: string | null,
): AsyncGenerator<Record<string, unknown>> {
  const PAGE = 500;
  let lastId: string | null = null;

  // Resolve the patient_id allow-list once for Group exports. A Group
  // here is implemented as the patient_team_assignments rows for an
  // org_unit_id (the closest analog the Signacare schema has to FHIR Group).
  let patientFilter: string[] | null = null;
  if (groupId) {
    const teamPatients = await db('patient_team_assignments')
      .where({ org_unit_id: groupId, is_active: true })
      .select('patient_id');
    patientFilter = teamPatients.map((r: { patient_id: string }) => r.patient_id);
    if (patientFilter.length === 0) return; // empty group
  }

  switch (type) {
    case 'Patient': {
      while (true) {
        const q: Knex.QueryBuilder = db('patients')
          .where({ clinic_id: clinicId })
          .whereNull('deleted_at')
          .orderBy('id', 'asc')
          .limit(PAGE);
        if (lastId) q.where('id', '>', lastId);
        if (since) q.where('updated_at', '>=', since);
        if (patientFilter) q.whereIn('id', patientFilter);
        const rows = await q;
        if (rows.length === 0) break;
        for (const row of rows) {
          yield patientToFhir(row);
          lastId = row.id;
        }
        if (rows.length < PAGE) break;
      }
      return;
    }
    case 'Observation': {
      while (true) {
        const q: Knex.QueryBuilder = db('structured_observations')
          .where({ clinic_id: clinicId })
          .orderBy('id', 'asc')
          .limit(PAGE);
        if (lastId) q.where('id', '>', lastId);
        if (since) q.where('observed_at', '>=', since);
        if (patientFilter) q.whereIn('patient_id', patientFilter);
        const rows = await q;
        if (rows.length === 0) break;
        for (const row of rows) {
          yield observationToFhir(row);
          lastId = row.id;
        }
        if (rows.length < PAGE) break;
      }
      return;
    }
    case 'Condition': {
      while (true) {
        const q: Knex.QueryBuilder = db('episodes')
          .where({ clinic_id: clinicId })
          .whereNull('deleted_at')
          .whereNotNull('primary_diagnosis')
          .orderBy('id', 'asc')
          .limit(PAGE);
        if (lastId) q.where('id', '>', lastId);
        if (since) q.where('updated_at', '>=', since);
        if (patientFilter) q.whereIn('patient_id', patientFilter);
        const rows = await q;
        if (rows.length === 0) break;
        for (const row of rows) {
          yield conditionToFhir({
            id: row.id,
            patient_id: row.patient_id,
            diagnosis: row.diagnosis,
            diagnosis_code: row.diagnosis_code ?? null,
            status: row.status,
            recorded_at: row.created_at,
          });
          lastId = row.id;
        }
        if (rows.length < PAGE) break;
      }
      return;
    }
    case 'MedicationStatement': {
      while (true) {
        const q: Knex.QueryBuilder = db('patient_medications')
          .where({ clinic_id: clinicId })
          .whereNull('deleted_at')
          .orderBy('id', 'asc')
          .limit(PAGE);
        if (lastId) q.where('id', '>', lastId);
        if (since) q.where('updated_at', '>=', since);
        if (patientFilter) q.whereIn('patient_id', patientFilter);
        const rows = await q;
        if (rows.length === 0) break;
        for (const row of rows) {
          yield medicationToFhir({
            id: row.id,
            patient_id: row.patient_id,
            drug_name: row.drug_name,
            dose: row.dose,
            frequency: row.frequency,
            status: row.status,
            started_at: row.started_at,
            ceased_at: row.ceased_at,
          });
          lastId = row.id;
        }
        if (rows.length < PAGE) break;
      }
      return;
    }
  }
}

/**
 * Top-level processor — exported so the route handler can call it
 * directly (for inline test runs) and the BullMQ worker can wire it
 * up via JobBus in a follow-up. We do not require BullMQ for the basic
 * functionality; the worker is invoked synchronously after kickoff in
 * a setImmediate so the kickoff request returns 202 immediately.
 */
export async function processBulkExportJob(jobId: string): Promise<void> {
  const job = await db<BulkExportJobRow>('fhir_bulk_export_jobs').where({ id: jobId }).first();
  if (!job) {
    logger.warn({ jobId }, 'bulkExportWorker: job not found');
    return;
  }
  if (job.status !== 'accepted') {
    logger.info({ jobId, status: job.status }, 'bulkExportWorker: job not in accepted state, skipping');
    return;
  }

  await db('fhir_bulk_export_jobs')
    .where({ id: jobId })
    .update({ status: 'in_progress', started_at: new Date() });

  const since = job.since ? new Date(job.since) : null;
  const baseUrl = config.apiBaseUrl;
  const output: OutputFile[] = [];
  let totalExported = 0;

  try {
    for (const type of job.types) {
      if (!isSupportedBulkType(type)) {
        logger.warn({ type, jobId }, 'bulkExportWorker: unsupported _type, skipping');
        continue;
      }

      // Buffer the NDJSON for this type. Each line is one FHIR resource.
      const lines: string[] = [];
      for await (const resource of iterateResources(type, job.clinic_id, since, job.group_id)) {
        lines.push(JSON.stringify(resource));
      }
      if (lines.length === 0) continue;

      const ndjson = lines.join('\n') + '\n';
      const buffer = Buffer.from(ndjson, 'utf8');
      // Bulk exports go under bulk-exports/<clinic>/<job-id>/<type>.ndjson
      const key = `bulk-exports/${job.clinic_id}/${jobId}/${type}.ndjson`;
      const put = await blobStorage.put(key, buffer, 'application/fhir+ndjson');
      const url = await blobStorage.getDownloadUrl(put.key, { ttlSeconds: 24 * 60 * 60 });
      output.push({
        type,
        url: url.startsWith('/') ? `${baseUrl}${url}` : url,
        count: lines.length,
        sizeBytes: buffer.byteLength,
      });
      totalExported += lines.length;

      // Update progress so the polling endpoint can show X-Progress
      await db('fhir_bulk_export_jobs')
        .where({ id: jobId })
        .update({
          exported_resources: totalExported,
          output_files: JSON.stringify(output),
        });
    }

    await db('fhir_bulk_export_jobs').where({ id: jobId }).update({
      status: 'completed',
      finished_at: new Date(),
      total_resources: totalExported,
      exported_resources: totalExported,
      output_files: JSON.stringify(output),
    });
    logger.info({ jobId, totalExported, types: job.types }, 'bulkExportWorker: completed');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ jobId, err: message }, 'bulkExportWorker: failed');
    await db('fhir_bulk_export_jobs').where({ id: jobId }).update({
      status: 'failed',
      finished_at: new Date(),
      error_text: message,
    });
  }
}
