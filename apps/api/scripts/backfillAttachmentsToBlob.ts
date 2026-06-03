/**
 * S1.1 — backfillAttachmentsToBlob
 *
 * Walks the three patient attachment tables and migrates any rows whose
 * `storage_key` is NULL (i.e. legacy rows that were written by the
 * pre-S1.1 disk-storage code path) into the active BlobStorage backend
 * (LocalBlobStorage or S3BlobStorage).
 *
 * Idempotent and resumable: each row is checked first; if `storage_key`
 * is already populated, it's skipped. The script can be killed mid-run
 * and re-started without re-uploading any rows.
 *
 * Order of operations per row:
 *   1. Read the file from `file_path` on the local filesystem.
 *   2. blobStorage.put(...) — writes to S3 (or back to local if backend=local).
 *   3. UPDATE the row to set storage_backend, storage_key, storage_bucket,
 *      storage_etag. file_path is left intact for one release cycle as a
 *      safety net so the legacy /uploads serve still works for any client
 *      that hasn't refreshed.
 *   4. (Optional) delete the original local file when --delete-local is set.
 *
 * Usage:
 *
 *     # Dry run (default) — no writes, prints what it WOULD do:
 *     ts-node apps/api/scripts/backfillAttachmentsToBlob.ts
 *
 *     # Real run, leave local files in place (safest):
 *     ts-node apps/api/scripts/backfillAttachmentsToBlob.ts --apply
 *
 *     # Real run, delete local files after successful upload:
 *     ts-node apps/api/scripts/backfillAttachmentsToBlob.ts --apply --delete-local
 *
 * The script processes one table at a time, in fixed batches of 100 rows,
 * so progress is visible and a kill-switch is always one Ctrl+C away.
 *
 * Naming compliance: DB columns snake_case, TS identifiers camelCase.
 * RLS: this script does NOT set tenant context, so it operates as the
 * pool's superuser. That is intentional — backfill must see all rows
 * across all tenants to be useful.
 */

import fs from 'fs';
import path from 'path';
import knex from 'knex';
import { config } from '../src/config/config';
import { blobStorage, buildAttachmentStorageKey } from '../src/shared/blobStorage';

const TABLES = ['patient_attachments', 'patient_legal_attachments', 'patient_alert_attachments'] as const;
const BATCH_SIZE = 100;

interface CliArgs {
  apply: boolean;
  deleteLocal: boolean;
}

interface AttachmentRow {
  id: string;
  filename: string | null;
  file_path: string;
  mime_type: string | null;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  return {
    apply: args.includes('--apply'),
    deleteLocal: args.includes('--delete-local'),
  };
}

function resolveLocalPath(filePath: string): string {
  // file_path may be either an absolute path (legacy) or a key (post-S1.1).
  // For backfill we only care about legacy absolute paths; relative
  // values that look like a storage key are skipped.
  if (filePath.startsWith('/')) return filePath;
  if (filePath.startsWith('attachments/')) return ''; // already a storage key
  return path.join(process.cwd(), 'uploads', filePath);
}

async function backfillTable(
  db: knex.Knex,
  table: string,
  args: CliArgs,
): Promise<{ scanned: number; migrated: number; skipped: number; failed: number }> {
  let scanned = 0;
  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  // Pull rows in batches that have a non-null file_path but no storage_key.
  // Order by created_at so progress is monotonic and resumable.
  let lastId: string | null = null;
  let hasMoreRows = true;
  while (hasMoreRows) {
    const q = db(table)
      .whereNull('storage_key')
      .whereNotNull('file_path')
      .orderBy('id', 'asc')
      .limit(BATCH_SIZE);
    if (lastId) q.where('id', '>', lastId);
    const rows = await q.select<AttachmentRow[]>('id', 'filename', 'file_path', 'mime_type');
    if (rows.length === 0) {
      hasMoreRows = false;
      continue;
    }

    for (const row of rows) {
      scanned++;
      lastId = row.id;
      const local = resolveLocalPath(row.file_path);
      if (!local) {
        skipped++;
        continue;
      }
      if (!fs.existsSync(local)) {
        console.warn(`[${table}] ${row.id}: local file missing at ${local} — skipping`);
        skipped++;
        continue;
      }
      try {
        const buffer = fs.readFileSync(local);
        const storageKey = buildAttachmentStorageKey(row.filename ?? path.basename(local));
        if (args.apply) {
          const putResult = await blobStorage.put(storageKey, buffer, row.mime_type ?? 'application/octet-stream');
          await db(table)
            .where({ id: row.id })
            .update({
              storage_backend: putResult.bucket === 'local' ? 'local' : 's3',
              storage_key: putResult.key,
              storage_bucket: putResult.bucket,
              storage_etag: putResult.etag,
            });
          if (args.deleteLocal && local !== path.join(process.cwd(), 'uploads', storageKey)) {
            // Only delete if the new key is genuinely different from the
            // old local path (LocalBlobStorage may have written to the
            // same place).
            try { fs.unlinkSync(local); } catch { /* best-effort */ }
          }
          migrated++;
          console.log(`[${table}] ${row.id} → ${storageKey} (${buffer.length} bytes)`);
        } else {
          console.log(`[${table}] WOULD migrate ${row.id} from ${local} → key=${storageKey}`);
          migrated++;
        }
      } catch (err) {
        failed++;
        console.error(`[${table}] ${row.id}: failed`, err);
      }
    }

    if (rows.length < BATCH_SIZE) break;
  }

  return { scanned, migrated, skipped, failed };
}

async function main() {
  const args = parseArgs();
  console.log('Backfill mode:', args.apply ? 'APPLY' : 'DRY RUN');
  console.log('Delete local after upload:', args.deleteLocal ? 'YES' : 'NO');
  console.log('Backend:', blobStorage.backendName);
  console.log();

  const db = knex({
    client: 'pg',
    connection: {
      host: config.database.host,
      port: config.database.port,
      user: config.database.user,
      password: config.database.password,
      database: config.database.database,
    },
  });

  const totals = { scanned: 0, migrated: 0, skipped: 0, failed: 0 };
  for (const table of TABLES) {
    console.log(`── ${table} ──`);
    const r = await backfillTable(db, table, args);
    console.log(`   scanned=${r.scanned} migrated=${r.migrated} skipped=${r.skipped} failed=${r.failed}`);
    totals.scanned += r.scanned;
    totals.migrated += r.migrated;
    totals.skipped += r.skipped;
    totals.failed += r.failed;
  }

  console.log();
  console.log('TOTAL', totals);
  if (!args.apply) {
    console.log('(dry run — no changes written. Re-run with --apply to commit.)');
  }

  await db.destroy();
  process.exit(totals.failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(2);
});
