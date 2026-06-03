/**
 * Signacare EMR — License Validation System
 *
 * License key format: SIGNACARE-XXXX-XXXX-XXXX-XXXX
 * Encoded payload (base64 in segments 2-4):
 *   - customerName, customerEmail, maxUsers, edition
 *   - licenseStart (ISO date), licenseEnd (ISO date)
 *   - machineId binding (optional)
 *   - HMAC-SHA256 signature
 *
 * The license file is stored at ~/.signacare/license.json
 * The API server checks on startup and periodically (daily).
 */

import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

// ── License signing secret (in production, this would be in a secure HSM) ──
const LICENSE_SECRET = process.env.SIGNACARE_LICENSE_SECRET ?? 'signacare-emr-license-signing-key-2026';

// ── Types ──

export interface SignacareLicense {
  licenseKey: string;
  customerName: string;
  customerEmail: string;
  organisationName: string;
  edition: 'single-user' | 'team' | 'enterprise';
  maxUsers: number;
  features: string[];         // e.g. ['ai-scribe', 'emr-gateway', 'eRx', 'safescript']
  licenseStart: string;       // ISO date
  licenseEnd: string;         // ISO date
  machineId?: string;         // Hardware binding (optional)
  signature: string;          // HMAC-SHA256
  issuedAt: string;
  version: string;
}

export interface LicenseStatus {
  valid: boolean;
  expired: boolean;
  daysRemaining: number;
  expiryDate: string;
  edition: string;
  maxUsers: number;
  customerName: string;
  organisationName: string;
  features: string[];
  error?: string;
  gracePeroid: boolean;       // 14-day grace after expiry
}

// ── License file location ──

const LICENSE_DIR = path.join(os.homedir(), '.signacare');
const LICENSE_FILE = path.join(LICENSE_DIR, 'license.json');

// ── Machine fingerprint ──

export function getMachineId(): string {
  const parts = [
    os.hostname(),
    os.platform(),
    os.arch(),
    os.cpus()[0]?.model ?? 'unknown',
    os.totalmem().toString(),
  ];
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex').substring(0, 16);
}

// ── License generation (used by admin/sales tool) ──

export function generateLicense(params: {
  customerName: string;
  customerEmail: string;
  organisationName: string;
  edition: SignacareLicense['edition'];
  maxUsers: number;
  features: string[];
  licenseStart: string;
  licenseEnd: string;
  machineId?: string;
}): SignacareLicense {
  const licenseKey = `SIGNACARE-${randomSegment()}-${randomSegment()}-${randomSegment()}-${randomSegment()}`;

  const payload: Omit<SignacareLicense, 'signature'> = {
    licenseKey,
    customerName: params.customerName,
    customerEmail: params.customerEmail,
    organisationName: params.organisationName,
    edition: params.edition,
    maxUsers: params.maxUsers,
    features: params.features,
    licenseStart: params.licenseStart,
    licenseEnd: params.licenseEnd,
    machineId: params.machineId,
    issuedAt: new Date().toISOString(),
    version: '1.0',
  };

  const signature = signLicense(payload);

  return { ...payload, signature };
}

function randomSegment(): string {
  return crypto.randomBytes(2).toString('hex').toUpperCase();
}

function signLicense(payload: Omit<SignacareLicense, 'signature'>): string {
  const data = JSON.stringify({
    licenseKey: payload.licenseKey,
    customerEmail: payload.customerEmail,
    edition: payload.edition,
    maxUsers: payload.maxUsers,
    licenseStart: payload.licenseStart,
    licenseEnd: payload.licenseEnd,
    machineId: payload.machineId,
  });
  return crypto.createHmac('sha256', LICENSE_SECRET).update(data).digest('hex');
}

function parseEdition(value: string | undefined): SignacareLicense['edition'] {
  if (value === 'team' || value === 'enterprise' || value === 'single-user') {
    return value;
  }
  return 'single-user';
}

// ── License validation ──

export function validateLicense(license: SignacareLicense): LicenseStatus {
  const now = new Date();
  const endDate = new Date(license.licenseEnd);
  const startDate = new Date(license.licenseStart);
  const graceEnd = new Date(endDate.getTime() + 14 * 24 * 60 * 60 * 1000); // 14-day grace
  const daysRemaining = Math.ceil((endDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));

  const base: Omit<LicenseStatus, 'valid' | 'error'> = {
    expired: now > endDate,
    daysRemaining,
    expiryDate: license.licenseEnd,
    edition: license.edition,
    maxUsers: license.maxUsers,
    customerName: license.customerName,
    organisationName: license.organisationName,
    features: license.features,
    gracePeroid: now > endDate && now <= graceEnd,
  };

  // Verify signature
  const expectedSig = signLicense(license);
  if (license.signature !== expectedSig) {
    return { ...base, valid: false, error: 'Invalid license signature. The license file may have been tampered with.' };
  }

  // Check start date
  if (now < startDate) {
    return { ...base, valid: false, error: `License not yet active. Starts ${license.licenseStart}.` };
  }

  // Check expiry (with 14-day grace period)
  if (now > graceEnd) {
    return { ...base, valid: false, error: `License expired on ${license.licenseEnd}. Grace period has ended. Please renew.` };
  }

  // Check machine binding (if set)
  if (license.machineId) {
    const currentMachine = getMachineId();
    if (license.machineId !== currentMachine) {
      return { ...base, valid: false, error: 'License is bound to a different machine. Contact support to transfer.' };
    }
  }

  return { ...base, valid: true };
}

// ── File I/O ──

export function saveLicense(license: SignacareLicense): void {
  fs.mkdirSync(LICENSE_DIR, { recursive: true });
  fs.writeFileSync(LICENSE_FILE, JSON.stringify(license, null, 2), 'utf-8');
}

export function loadLicense(): SignacareLicense | null {
  try {
    if (!fs.existsSync(LICENSE_FILE)) return null;
    const raw = fs.readFileSync(LICENSE_FILE, 'utf-8');
    return JSON.parse(raw) as SignacareLicense;
  } catch {
    return null;
  }
}

export function checkLicense(): LicenseStatus {
  const license = loadLicense();
  if (!license) {
    return {
      valid: false, expired: true, daysRemaining: 0, expiryDate: '',
      edition: '', maxUsers: 0, customerName: '', organisationName: '',
      features: [], gracePeroid: false,
      error: 'No license file found. Please activate with a valid license key.',
    };
  }
  return validateLicense(license);
}

// ── License activation from key string ──

export function activateLicense(licenseJson: string): LicenseStatus {
  try {
    const license = JSON.parse(licenseJson) as SignacareLicense;
    const status = validateLicense(license);
    if (status.valid || status.gracePeroid) {
      saveLicense(license);
    }
    return status;
  } catch {
    return {
      valid: false, expired: true, daysRemaining: 0, expiryDate: '',
      edition: '', maxUsers: 0, customerName: '', organisationName: '',
      features: [], gracePeroid: false,
      error: 'Invalid license format. Please provide a valid license file.',
    };
  }
}

// ── CLI: Generate a license (run directly) ──

if (require.main === module) {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (cmd === 'generate') {
    const license = generateLicense({
      customerName: args[1] ?? 'Demo Customer',
      customerEmail: args[2] ?? 'demo@example.com',
      organisationName: args[3] ?? 'Demo Organisation',
      edition: parseEdition(args[4]),
      maxUsers: parseInt(args[5] ?? '1', 10),
      features: ['ai-scribe', 'emr-gateway', 'eRx', 'safescript', 'reports', 'mbs-billing'],
      licenseStart: new Date().toISOString().split('T')[0],
      licenseEnd: args[6] ?? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    });
    console.log(JSON.stringify(license, null, 2));
  } else if (cmd === 'check') {
    const status = checkLicense();
    console.log(JSON.stringify(status, null, 2));
  } else if (cmd === 'machine-id') {
    console.log('Machine ID:', getMachineId());
  } else {
    console.log('Usage:');
    console.log('  npx ts-node license.ts generate [name] [email] [org] [edition] [maxUsers] [endDate]');
    console.log('  npx ts-node license.ts check');
    console.log('  npx ts-node license.ts machine-id');
  }
}
