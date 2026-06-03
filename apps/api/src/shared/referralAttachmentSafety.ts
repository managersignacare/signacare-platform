import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { AppError } from './errors';
import { logger } from '../utils/logger';

const execFileAsync = promisify(execFile);

const ALLOWED_REFERRAL_MIMES = new Set<string>([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'text/plain',
  'application/rtf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

type ReferralAvMode = 'off' | 'optional' | 'required';

function resolveReferralAvMode(): ReferralAvMode {
  const raw = String(process.env['REFERRAL_UPLOAD_ANTIVIRUS_MODE'] ?? 'optional')
    .trim()
    .toLowerCase();
  if (raw === 'off' || raw === 'optional' || raw === 'required') return raw;
  return 'optional';
}

function startsWithBytes(buf: Buffer, sig: number[]): boolean {
  if (buf.length < sig.length) return false;
  for (let i = 0; i < sig.length; i += 1) {
    if (buf[i] !== sig[i]) return false;
  }
  return true;
}

function isLikelyAsciiText(buf: Buffer): boolean {
  if (buf.length === 0) return false;
  let printable = 0;
  const sample = buf.subarray(0, Math.min(buf.length, 2048));
  for (const b of sample) {
    if (
      b === 9 || // \t
      b === 10 || // \n
      b === 13 || // \r
      (b >= 32 && b <= 126)
    ) {
      printable += 1;
    }
  }
  return printable / sample.length >= 0.95;
}

function assertMimeAndSignature(mime: string, originalName: string, buffer: Buffer): void {
  if (!ALLOWED_REFERRAL_MIMES.has(mime)) {
    throw new AppError(
      `Unsupported referral attachment MIME type: ${mime}`,
      422,
      'REFERRAL_ATTACHMENT_MIME_NOT_ALLOWED',
      { mime, allowed: Array.from(ALLOWED_REFERRAL_MIMES.values()) },
    );
  }

  const ext = path.extname(originalName).toLowerCase();
  const isPdf = startsWithBytes(buffer, [0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
  const isPng = startsWithBytes(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const isJpeg = startsWithBytes(buffer, [0xff, 0xd8, 0xff]);
  const isWebp =
    startsWithBytes(buffer, [0x52, 0x49, 0x46, 0x46]) && // RIFF
    buffer.length >= 12 &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  const isZip = startsWithBytes(buffer, [0x50, 0x4b, 0x03, 0x04]);
  const isCfbf = startsWithBytes(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  const isRtf = buffer.subarray(0, Math.min(buffer.length, 16)).toString('ascii').startsWith('{\\rtf');
  const isText = isLikelyAsciiText(buffer);

  const matchesMime =
    (mime === 'application/pdf' && isPdf) ||
    (mime === 'image/png' && isPng) ||
    (mime === 'image/jpeg' && isJpeg) ||
    (mime === 'image/webp' && isWebp) ||
    (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' && isZip) ||
    (mime === 'application/msword' && isCfbf) ||
    (mime === 'application/rtf' && isRtf) ||
    (mime === 'text/plain' && isText);

  if (!matchesMime) {
    throw new AppError(
      'Referral attachment content does not match declared MIME type',
      422,
      'REFERRAL_ATTACHMENT_SIGNATURE_MISMATCH',
      { mime, ext },
    );
  }
}

async function scanWithClamAv(originalName: string, buffer: Buffer): Promise<void> {
  const mode = resolveReferralAvMode();
  if (mode === 'off') return;

  const scannerCmd = String(process.env['ANTIVIRUS_SCAN_CMD'] ?? 'clamscan').trim() || 'clamscan';
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'signacare-referral-av-'));
  const tempFile = path.join(baseDir, `${randomUUID()}${path.extname(originalName)}`);

  try {
    await fs.writeFile(tempFile, buffer);

    try {
      await execFileAsync(scannerCmd, ['--no-summary', tempFile], { timeout: 20_000 });
    } catch (err) {
      const execErr = err as { code?: number | string; stdout?: string; stderr?: string };
      if (execErr.code === 1) {
        throw new AppError(
          'Referral attachment blocked by antivirus scan',
          422,
          'REFERRAL_ATTACHMENT_MALWARE_DETECTED',
        );
      }

      const scannerMissing = execErr.code === 'ENOENT';
      if (scannerMissing && mode === 'optional') {
        logger.warn(
          {
            cmd: scannerCmd,
            kind: 'referral_attachment_antivirus_scanner_unavailable',
          },
          'Referral attachment antivirus scanner unavailable; continuing (optional mode)',
        );
        return;
      }

      if (mode === 'required') {
        throw new AppError(
          'Referral attachment antivirus scanning unavailable',
          503,
          'REFERRAL_ATTACHMENT_SCAN_UNAVAILABLE',
        );
      }

      logger.warn(
        {
          err,
          cmd: scannerCmd,
          kind: 'referral_attachment_antivirus_scan_failed',
        },
        'Referral attachment antivirus scan failed; continuing (optional mode)',
      );
    }
  } finally {
    await fs.rm(baseDir, { recursive: true, force: true });
  }
}

export async function assertReferralAttachmentSafe(input: {
  originalName: string;
  mimeType: string;
  buffer: Buffer;
}): Promise<void> {
  assertMimeAndSignature(input.mimeType, input.originalName, input.buffer);
  await scanWithClamAv(input.originalName, input.buffer);
}

