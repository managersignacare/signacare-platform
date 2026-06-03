// apps/api/src/ocr/ocrAdapter.ts
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { blobStorage } from '../shared/blobStorage';
import logger from '../utils/logger';
import { resolveBinary } from '../shared/binaryResolver';

const execFileAsync = promisify(execFile);

export interface OcrResult {
  fields: {
    patientName?: string | null;
    givenName?: string | null;
    familyName?: string | null;
    dob?: string | null; // ISO YYYY-MM-DD
    medicareNumber?: string | null;
    referrerName?: string | null;
    reason?: string | null;
    [key: string]: unknown;
  };
  rawText: string;
  provider: string;
}

interface RunOcrParams {
  storageKey: string;
  mimeType: string;
  language?: string;
}

/**
 * Resolve a storageKey to a local file path. ocrmypdf and tesseract both
 * need a real path on disk, so for the S3 backend we materialise the blob
 * to a temp file. For the local backend we read it via blobStorage.getBuffer
 * (which goes through LocalBlobStorage's `uploads/` rootDir) and write it
 * to the same temp dir; this avoids hardcoding any path layout assumptions.
 *
 * Callers MUST clean up the returned path with cleanupResolvedPath().
 */
async function resolveToLocalPath(storageKey: string): Promise<string> {
  // First, try the legacy direct read for backward-compatibility with any
  // OCR jobs whose storage_key is still a literal disk path from before
  // S1.1-DEFERRED-A. This branch can be deleted once the backfill is run.
  const legacyBase = process.env.UPLOAD_BASE_DIR;
  if (legacyBase) {
    try {
      const legacyPath = path.join(legacyBase, storageKey);
      await fs.access(legacyPath);
      return legacyPath;
    } catch {
      // not present at the legacy path — fall through to blobStorage
    }
  }

  const buffer = await blobStorage.getBuffer(storageKey);
  if (!buffer) {
    throw new Error(`ocrAdapter: storageKey not found in blob storage: ${storageKey}`);
  }
  const ext = path.extname(storageKey) || '.bin';
  const tmpPath = path.join(os.tmpdir(), `signacare-ocr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  await fs.writeFile(tmpPath, buffer);
  return tmpPath;
}

async function cleanupResolvedPath(p: string): Promise<void> {
  // Only delete files we created in os.tmpdir() — never touch the legacy
  // UPLOAD_BASE_DIR files which are still the source of truth.
  if (p.startsWith(os.tmpdir())) {
    try { await fs.unlink(p); } catch { /* best-effort */ }
  }
}

async function runOcrmypdf(inputPath: string, lang: string): Promise<string> {
  const tmpOut = `${inputPath}.ocr.pdf`;
  await execFileAsync(resolveBinary('ocrmypdf'), ['--skip-text', '--language', lang, inputPath, tmpOut]);

  try {
    const txtOut = `${inputPath}.ocr.txt`;
    await execFileAsync(resolveBinary('pdftotext'), [tmpOut, txtOut]);
    const text = await fs.readFile(txtOut, 'utf8');
    return text;
  } catch (err) {
    logger.warn({ err }, 'pdftotext not available, falling back to Tesseract on PDF');
    return runTesseract(inputPath, lang);
  }
}

async function runTesseract(inputPath: string, lang: string): Promise<string> {
  const txtOutBase = `${inputPath}.txt`;
  const baseWithoutExt = txtOutBase.replace(/\.txt$/, '');
  await execFileAsync(resolveBinary('tesseract'), [inputPath, baseWithoutExt, '-l', lang]);
  const text = await fs.readFile(`${baseWithoutExt}.txt`, 'utf8');
  return text;
}

/**
 * Try to normalise an AU-style DOB (e.g. 01/02/1990, 1-2-90) to YYYY-MM-DD.
 */
function normaliseDob(raw: string): string | null {
  const m = raw.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (!m) return null;

  const day = m[1].padStart(2, '0');
  const month = m[2].padStart(2, '0');
  let year = m[3];

  if (year.length === 2) {
    const n = Number(year);
    year = n > 30 ? `19${year}` : `20${year}`;
  }

  return `${year}-${month}-${day}`;
}

/**
 * Simple heuristic extractors for AU referrals.
 */
function extractFieldsFromText(rawText: string): OcrResult['fields'] {
  const text = rawText.replace(/\r/g, '');
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  let medicareNumber: string | null = null;
  let dob: string | null = null;
  let patientName: string | null = null;
  let givenName: string | null = null;
  let familyName: string | null = null;
  let referrerName: string | null = null;
  let reason: string | null = null;

  // Medicare number e.g. 1234 56789 1 or 1234567891
  const medicareMatch =
    text.match(/\b(\d{4}\s?\d{5}\s?\d)\b/) || text.match(/\b(\d{10})\b/);
  if (medicareMatch) {
    medicareNumber = medicareMatch[1].replace(/\s+/g, '');
  }

  // DOB e.g. DOB: 01/02/1990 or Date of Birth 1-2-90
  const dobLine =
    lines.find((l) => /dob[:\s]/i.test(l)) ||
    lines.find((l) => /date of birth/i.test(l));
  if (dobLine) {
    const m = dobLine.match(/(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/);
    if (m) {
      dob = normaliseDob(m[1]);
    }
  } else {
    // fallback: first date-like thing in text
    const m = text.match(/(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/);
    if (m) dob = normaliseDob(m[1]);
  }

  // Patient name – look for "Patient: Name" or "Name: ..." near DOB line
  const patientLine =
    lines.find((l) => /^patient[:\s]/i.test(l)) ||
    lines.find((l) => /patient name[:\s]/i.test(l));

  if (patientLine) {
    const cleaned = patientLine.replace(/patient name?[:\s]*/i, '').trim();
    if (cleaned) {
      patientName = cleaned;
    }
  } else if (dobLine) {
    // try line immediately above DOB line
    const idx = lines.indexOf(dobLine);
    if (idx > 0) {
      const candidate = lines[idx - 1];
      if (candidate && candidate.split(' ').length <= 4) {
        patientName = candidate;
      }
    }
  }

  if (patientName) {
    const parts = patientName.split(/\s+/);
    if (parts.length >= 2) {
      givenName = parts[0];
      familyName = parts[parts.length - 1];
    }
  }

  // Referrer name – look for "Referrer:" or "Dr ..."
  const refLine =
    lines.find((l) => /^referrer[:\s]/i.test(l)) ||
    lines.find((l) => /^referring doctor[:\s]/i.test(l));
  if (refLine) {
    referrerName = refLine
      .replace(/referr(er|ing doctor)[:\s]*/i, '')
      .trim();
  } else {
    const drLine = lines.find((l) => /^dr\s+/i.test(l));
    if (drLine) {
      referrerName = drLine.trim();
    }
  }

  // Reason – very rough: block after "Reason for referral" or "Reason:"
  const reasonIdx =
    lines.findIndex((l) => /reason for referral/i.test(l)) ??
    lines.findIndex((l) => /^reason[:\s]/i.test(l));

  if (reasonIdx !== -1 && reasonIdx < lines.length - 1) {
    const buf: string[] = [];
    for (let i = reasonIdx + 1; i < lines.length; i++) {
      const line = lines[i];
      if (/^(yours sincerely|regards|thank you)/i.test(line)) break;
      if (/^referr(er|ing doctor)/i.test(line)) break;
      buf.push(line);
      if (buf.length >= 5) break;
    }
    if (buf.length) {
      reason = buf.join(' ');
    }
  }

  return {
    patientName,
    givenName,
    familyName,
    dob,
    medicareNumber,
    referrerName,
    reason,
    fullText: rawText,
  };
}

export async function runOcr(params: RunOcrParams): Promise<OcrResult> {
  const { storageKey, mimeType, language } = params;
  const lang = language ?? process.env.OCR_LANGUAGE ?? 'en';
  const provider = process.env.OCR_PROVIDER ?? 'local_tesseract';

  if (provider !== 'local_tesseract') {
    throw new Error(`Unsupported OCR_PROVIDER: ${provider}`);
  }

  const localPath = await resolveToLocalPath(storageKey);

  try {
    let rawText: string;
    if (mimeType === 'application/pdf') {
      rawText = await runOcrmypdf(localPath, lang);
    } else {
      rawText = await runTesseract(localPath, lang);
    }

    const fields = extractFieldsFromText(rawText);

    return {
      fields,
      rawText,
      provider,
    };
  } finally {
    // Always delete the temp file we created (no-op for legacy paths
    // outside os.tmpdir).
    await cleanupResolvedPath(localPath);
  }
}
