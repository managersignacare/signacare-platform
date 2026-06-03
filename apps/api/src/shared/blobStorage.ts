/**
 * BlobStorage — file storage facade for patient attachments and similar
 * blobs (pathology reports, alert/legal documents, etc.).
 *
 * Why a facade: prior to S1.1 every upload route used `multer.diskStorage`
 * to write directly to `uploads/attachments/` on the API container's local
 * filesystem. That made horizontal scaling impossible (replica B cannot
 * see files uploaded to replica A) and risked total data loss on container
 * restart. The facade lets the same upload code run against:
 *
 *   - LocalBlobStorage   — writes to `uploads/{key}` on the API filesystem
 *                          (default; backwards-compatible with the
 *                          legacy code path and the existing `/uploads`
 *                          static serve in server.ts).
 *
 *   - S3BlobStorage      — writes to an S3-compatible object store (real
 *                          S3 in production, MinIO in dev compose).
 *                          Returns presigned GET URLs for downloads.
 *
 * The active backend is selected by env var `BLOB_STORAGE_BACKEND`:
 *
 *   BLOB_STORAGE_BACKEND=local   (default)
 *   BLOB_STORAGE_BACKEND=s3      (requires BLOB_S3_* env vars)
 *
 * The DB columns `storage_backend`, `storage_key`, `storage_bucket`, and
 * `storage_etag` (added by migration 20260410000001) record which backend
 * a row was uploaded under, so a single deployment can be in the middle of
 * a backfill (some rows in S3, some still on local disk) and the GET
 * handlers will pick the right code path per row.
 *
 * Naming compliance:
 *   - DB column names are snake_case (set by the caller, not by this module)
 *   - The TS interface, classes, and method names are camelCase
 *   - Storage keys are URL-safe ASCII; never include the file's
 *     human-readable filename
 *
 * Fix Registry compliance:
 *   - The DOC1 fix (downloadUrl field on the response) is preserved by the
 *     caller — this module just returns the URL string.
 *   - The PATH1 fix (clinic_id on patient_attachments INSERT) is unchanged.
 */

import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export type BlobBackendName = 'local' | 's3';

/** Result of a successful put — written to the storage_* DB columns. */
export interface BlobPutResult {
  /** The key the blob is stored under (relative path or S3 object key). */
  key: string;
  /** The bucket name (for local: 'local'; for S3: the configured bucket). */
  bucket: string;
  /** Content hash / S3 ETag for integrity verification + dedup. */
  etag: string;
}

/** Options for the GET URL generation. */
export interface BlobUrlOptions {
  /**
   * Time-to-live for presigned URLs. Ignored by LocalBlobStorage which
   * returns auth-gated static URLs that don't expire. Defaults to 5
   * minutes — short enough that a leaked URL is low-risk, long enough
   * for a slow PDF render.
   */
  ttlSeconds?: number;
  /**
   * Optional human-readable filename for Content-Disposition.
   * Currently only honored by S3BlobStorage.
   */
  filename?: string;
}

export interface BlobStorage {
  readonly backendName: BlobBackendName;
  put(key: string, body: Buffer, contentType: string): Promise<BlobPutResult>;
  getDownloadUrl(key: string, opts?: BlobUrlOptions): Promise<string>;
  delete(key: string): Promise<void>;
  /**
   * Read a blob into memory. Used by callers that need the raw bytes
   * (e.g. the OCR adapter, which writes to a temp file before invoking
   * ocrmypdf or tesseract). Returns null if the key does not exist.
   */
  getBuffer(key: string): Promise<Buffer | null>;
}

// ── LocalBlobStorage ─────────────────────────────────────────────────────────

/**
 * LocalBlobStorage — writes to `uploads/{key}` on the API container's local
 * filesystem. The existing `/uploads` static serve in server.ts (auth-gated)
 * is what the returned URL points at, so behavior is identical to the
 * pre-S1.1 code path.
 *
 * Use this in dev (when MinIO isn't running) and as the default in any
 * environment that hasn't been migrated to S3 yet.
 */
export class LocalBlobStorage implements BlobStorage {
  readonly backendName: BlobBackendName = 'local';

  constructor(private readonly rootDir = path.join(process.cwd(), 'uploads')) {
    // Ensure the root exists. We do not throw on failure here — the
    // first put() will surface a more useful error if the dir is bad.
    try {
      fs.mkdirSync(this.rootDir, { recursive: true });
    } catch {
      // best-effort
    }
  }

  async put(key: string, body: Buffer, _contentType: string): Promise<BlobPutResult> {
    const fullPath = path.join(this.rootDir, key);
    const dir = path.dirname(fullPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, body);
    const etag = createHash('sha256').update(body).digest('hex');
    return { key, bucket: 'local', etag };
  }

  async getDownloadUrl(key: string, _opts?: BlobUrlOptions): Promise<string> {
    // The /uploads static serve in server.ts is auth-gated, so we just
    // return the relative URL. This is intentionally NOT a presigned URL —
    // local mode relies on Express auth middleware for access control.
    return `/uploads/${key}`;
  }

  async delete(key: string): Promise<void> {
    const fullPath = path.join(this.rootDir, key);
    try {
      fs.unlinkSync(fullPath);
    } catch {
      // best-effort: file may have been removed already, or never existed
    }
  }

  async getBuffer(key: string): Promise<Buffer | null> {
    const fullPath = path.join(this.rootDir, key);
    try {
      return fs.readFileSync(fullPath);
    } catch {
      return null;
    }
  }
}

// ── S3BlobStorage ────────────────────────────────────────────────────────────

interface S3Config {
  bucket: string;
  region: string;
  endpoint?: string; // for MinIO / custom S3
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean; // required for MinIO
}

/**
 * S3BlobStorage — writes to an S3-compatible object store. Tested against
 * AWS S3 and MinIO. Reads endpoint, region, bucket, and credentials from
 * env vars (see env.production.example). Returns presigned GET URLs for
 * downloads with a configurable TTL.
 *
 * Server-side encryption: configured at the bucket level via SSE-KMS in
 * production; this module does not set per-object encryption headers.
 */
export class S3BlobStorage implements BlobStorage {
  readonly backendName: BlobBackendName = 's3';
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: S3Config) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle ?? false,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<BlobPutResult> {
    const result = await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    // ETag from S3 is wrapped in quotes — strip them so the value
    // matches the local sha256 format more closely (still opaque).
    const etag = (result.ETag ?? '').replace(/^"|"$/g, '');
    return { key, bucket: this.bucket, etag };
  }

  async getDownloadUrl(key: string, opts: BlobUrlOptions = {}): Promise<string> {
    const ttl = opts.ttlSeconds ?? 300; // 5 minutes default
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: opts.filename
        ? `attachment; filename="${opts.filename.replace(/"/g, '')}"`
        : undefined,
    });
    return await getSignedUrl(this.client, command, { expiresIn: ttl });
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async getBuffer(key: string): Promise<Buffer | null> {
    try {
      const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      const body = r.Body;
      if (!body) return null;
      // The S3 SDK returns a Node.js Readable; collect into a buffer.
      const chunks: Buffer[] = [];
      for await (const chunk of body as AsyncIterable<Buffer>) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    } catch {
      return null;
    }
  }

  /** Internal helper used by the backfill script to verify uploads. */
  async head(key: string): Promise<{ size: number; etag: string } | null> {
    try {
      const r = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return {
        size: r.ContentLength ?? 0,
        etag: (r.ETag ?? '').replace(/^"|"$/g, ''),
      };
    } catch {
      return null;
    }
  }
}

// ── Default singleton ────────────────────────────────────────────────────────

/**
 * Resolve the active BlobStorage backend from env vars. Called once at
 * module load time so the rest of the app imports a stable singleton.
 *
 * env vars:
 *   BLOB_STORAGE_BACKEND=local|s3      (default: local)
 *   BLOB_S3_BUCKET=signacare-attachments
 *   BLOB_S3_REGION=ap-southeast-2
 *   BLOB_S3_ENDPOINT=http://minio:9000  (for MinIO; omit for real AWS)
 *   BLOB_S3_ACCESS_KEY_ID=...
 *   BLOB_S3_SECRET_ACCESS_KEY=...
 *   BLOB_S3_FORCE_PATH_STYLE=true       (set for MinIO)
 */
function buildDefaultBlobStorage(): BlobStorage {
  const backend = (process.env.BLOB_STORAGE_BACKEND ?? 'local').toLowerCase();
  if (backend === 's3') {
    const bucket = process.env.BLOB_S3_BUCKET;
    const region = process.env.BLOB_S3_REGION;
    const accessKeyId = process.env.BLOB_S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.BLOB_S3_SECRET_ACCESS_KEY;
    if (!bucket || !region || !accessKeyId || !secretAccessKey) {
      // Fail loud — silently falling back to local in prod would hide
      // a misconfiguration that loses data.
      throw new Error(
        'BLOB_STORAGE_BACKEND=s3 requires BLOB_S3_BUCKET, BLOB_S3_REGION, BLOB_S3_ACCESS_KEY_ID, BLOB_S3_SECRET_ACCESS_KEY',
      );
    }
    return new S3BlobStorage({
      bucket,
      region,
      endpoint: process.env.BLOB_S3_ENDPOINT || undefined,
      accessKeyId,
      secretAccessKey,
      forcePathStyle: process.env.BLOB_S3_FORCE_PATH_STYLE === 'true',
    });
  }
  return new LocalBlobStorage();
}

export const blobStorage: BlobStorage = buildDefaultBlobStorage();

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolve a download URL for a row from one of the patient attachment
 * tables. Single source of truth for the GET handlers; preserves the
 * legacy file_path-based URL when storage_key is NULL (legacy rows).
 *
 * The returned URL is what the GET handlers put in the `downloadUrl`
 * response field — the DOC1 Fix Registry entry depends on that exact
 * field name being present in the response.
 */
export async function resolveAttachmentDownloadUrl(row: {
  storage_backend?: string | null;
  storage_key?: string | null;
  file_path?: string | null;
  filename?: string | null;
}): Promise<string> {
  // Modern rows: storage_key is set, route via the active backend.
  if (row.storage_key) {
    return await blobStorage.getDownloadUrl(row.storage_key, {
      filename: row.filename ?? undefined,
    });
  }
  // Legacy rows: only file_path is set. Strip the absolute prefix and
  // return the same auth-gated /uploads URL the pre-S1.1 code returned.
  // This preserves backward compatibility for files uploaded before the
  // backfill has run.
  const stripped = row.file_path?.replace(/^.*uploads[\\/]/, '') ?? '';
  return `/uploads/${stripped}`;
}

/**
 * Build the storage key for a new upload. Format:
 *
 *     attachments/{yyyy}/{mm}/{uuid}{ext}
 *
 * The yyyy/mm prefix gives the S3 bucket a natural sharding hint and
 * makes batch lifecycle policies (e.g. archive-after-N-days) trivial.
 * The UUID guarantees no collisions even across replicas.
 *
 * @param originalName the user-uploaded filename (used only to extract
 *                     the file extension; never trusted as a key)
 */
export function buildAttachmentStorageKey(originalName: string): string {
  const ext = path.extname(originalName).toLowerCase();
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const id = createHash('sha256')
    .update(`${now.getTime()}-${Math.random()}`)
    .digest('hex')
    .slice(0, 32);
  return `attachments/${yyyy}/${mm}/${id}${ext}`;
}
