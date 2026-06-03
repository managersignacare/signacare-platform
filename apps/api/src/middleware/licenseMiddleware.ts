/**
 * License Check Middleware
 *
 * Checks the Signacare EMR license on:
 *   - Server startup
 *   - Every request (cached — rechecks every 60 minutes)
 *
 * When license is expired (past grace period):
 *   - API returns 402 Payment Required on all routes
 *   - Except: /health, /api/v1/auth/login, /api/v1/license
 *
 * When in grace period (14 days after expiry):
 *   - API works normally but adds X-License-Warning header
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { config } from '../config/config';

interface LicenseStatus {
  valid: boolean;
  expired: boolean;
  daysRemaining: number;
  expiryDate: string;
  edition: string;
  maxUsers: number;
  customerName: string;
  organisationName: string;
  features: string[];
  gracePeroid: boolean;
  error?: string;
}

let cachedStatus: LicenseStatus | null = null;
let lastCheckTime = 0;
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // Recheck every hour

// Exempted paths that work even without a license
const EXEMPT_PATHS = ['/health', '/api/v1/auth/login', '/api/v1/license'];

// BUG-444 — fail-closed shape used in production when the license module
// can't be imported OR `checkLicense()` itself throws. Pre-fix, ANY catch
// here laundered into `valid:true, edition:'development'` which silently
// granted unlimited-user dev-edition bypass on every prod deploy with a
// corrupt installer/. The dev-mode comment captured the right intent for
// development envs but the catch had no NODE_ENV guard and no logger.
const FAIL_CLOSED_STATUS: LicenseStatus = {
  valid: false,
  expired: true,
  daysRemaining: 0,
  expiryDate: '',
  edition: 'unknown',
  maxUsers: 0,
  customerName: '',
  organisationName: '',
  features: [],
  gracePeroid: false,
  error: 'License module unavailable.',
};

const DEV_FALLBACK_STATUS: LicenseStatus = {
  valid: true,
  expired: false,
  daysRemaining: 999,
  expiryDate: '2099-12-31',
  edition: 'development',
  maxUsers: 999,
  customerName: 'Development',
  organisationName: 'Development',
  features: ['all'],
  gracePeroid: false,
};

async function getLicenseStatus(): Promise<LicenseStatus> {
  const now = Date.now();
  if (cachedStatus && (now - lastCheckTime) < CHECK_INTERVAL_MS) {
    return cachedStatus;
  }

  // Split try blocks: distinguish "module not available" (acceptable in
  // dev, must fail-closed in prod) from "checkLicense() threw" (always
  // fail-closed because the real module ran and exploded). Pre-fix a
  // single catch laundered both paths into a permissive dev license.
  let mod: { checkLicense: () => LicenseStatus };
  try {
    mod = (await import('../../../installer/license' as string)) as {
      checkLicense: () => LicenseStatus;
    };
  } catch (err) {
    if (config.NODE_ENV === 'production') {
      logger.error(
        { err, kind: 'license_module_unavailable' },
        'BUG-444: license module import failed in production — server will refuse non-exempt requests until resolved',
      );
      cachedStatus = { ...FAIL_CLOSED_STATUS };
    } else {
      logger.warn(
        { err, kind: 'license_module_unavailable_dev' },
        'BUG-444: license module unavailable in development — using dev fallback. This would 402-fail in production.',
      );
      cachedStatus = { ...DEV_FALLBACK_STATUS };
    }
    lastCheckTime = now;
    return cachedStatus;
  }

  try {
    cachedStatus = mod.checkLicense();
  } catch (err) {
    // Module imported successfully but checkLicense() threw — file
    // corrupt, signature exception, FS error mid-read, etc. ALWAYS
    // fail-closed regardless of env: a real-module-throw is a hard
    // failure, not a missing-installer ergonomic gap.
    logger.error(
      { err, kind: 'license_check_threw' },
      'BUG-444: checkLicense() threw — license file may be corrupt or signature invalid',
    );
    cachedStatus = { ...FAIL_CLOSED_STATUS, error: 'License check failed.' };
  }
  lastCheckTime = now;
  return cachedStatus;
}

// BUG-444 — test seam. Exposed so unit tests can drive `getLicenseStatus`
// directly with mocked `installer/license` imports + stubbed NODE_ENV
// without going through the Express middleware machinery. NOT for
// production callers; the middleware and `checkLicenseOnStartup` are the
// real entry points.
export const __getLicenseStatusForTest = getLicenseStatus;

export async function licenseMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  // Skip license check for exempted paths
  if (EXEMPT_PATHS.some(p => req.path === p || req.path.startsWith(p))) {
    next();
    return;
  }

  const status = await getLicenseStatus();

  if (!status.valid && !status.gracePeroid) {
    res.status(402).json({
      error: 'License expired or invalid',
      message: status.error ?? 'Please renew your Signacare EMR license to continue.',
      expiryDate: status.expiryDate,
      code: 'LICENSE_EXPIRED',
    });
    return;
  }

  // Add warning headers during grace period
  if (status.gracePeroid) {
    res.setHeader('X-License-Warning', `License expired. Grace period ends in ${Math.max(0, status.daysRemaining + 14)} days. Please renew.`);
  } else if (status.daysRemaining <= 30) {
    res.setHeader('X-License-Warning', `License expires in ${status.daysRemaining} days (${status.expiryDate}). Please renew.`);
  }

  // Add license info headers
  res.setHeader('X-License-Edition', status.edition);
  res.setHeader('X-License-Org', status.organisationName);

  next();
}

// License info endpoint
export async function getLicenseInfo(_req: Request, res: Response): Promise<void> {
  const status = await getLicenseStatus();
  res.json({
    valid: status.valid,
    expired: status.expired,
    daysRemaining: status.daysRemaining,
    expiryDate: status.expiryDate,
    edition: status.edition,
    maxUsers: status.maxUsers,
    customerName: status.customerName,
    organisationName: status.organisationName,
    features: status.features,
    gracePeroid: status.gracePeroid,
    warning: status.gracePeroid ? 'License is in grace period. Please renew.' :
             status.daysRemaining <= 30 ? `License expires in ${status.daysRemaining} days.` : undefined,
  });
}

// Startup check — logs license status
export async function checkLicenseOnStartup(): Promise<void> {
  const status = await getLicenseStatus();
  if (!status.valid && !status.gracePeroid) {
    logger.error({
      error: status.error,
      expiryDate: status.expiryDate,
    }, 'LICENSE: Signacare EMR license is invalid or expired. The application will not serve requests.');
  } else if (status.gracePeroid) {
    logger.warn({
      expiryDate: status.expiryDate,
      daysRemaining: status.daysRemaining,
    }, 'LICENSE: Signacare EMR license has expired but is in 14-day grace period. Please renew urgently.');
  } else if (status.daysRemaining <= 30) {
    logger.warn({
      daysRemaining: status.daysRemaining,
      expiryDate: status.expiryDate,
    }, `LICENSE: Signacare EMR license expires in ${status.daysRemaining} days. Please renew.`);
  } else {
    logger.info({
      edition: status.edition,
      organisation: status.organisationName,
      expiryDate: status.expiryDate,
      daysRemaining: status.daysRemaining,
      maxUsers: status.maxUsers,
    }, 'LICENSE: Signacare EMR license is valid.');
  }
}
