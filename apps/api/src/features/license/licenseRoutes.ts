import { Router, Request, Response } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { db } from '../../db/db';

const router = Router();
const LICENSE_FILE = path.join(os.homedir(), '.signacare', 'license.json');

router.get('/status', async (_req: Request, res: Response) => {
  try {
    let license = null;
    try {
      if (fs.existsSync(LICENSE_FILE)) {
        license = JSON.parse(fs.readFileSync(LICENSE_FILE, 'utf-8'));
      }
    } catch { /* no license */ }

    let hasAdmin = false, hasClinic = false, clinicName = '';
    try {
      const admin = await db('staff').where({ role: 'superadmin' }).orWhere({ role: 'admin' }).first();
      hasAdmin = !!admin;
      const clinic = await db('clinics').first();
      hasClinic = !!clinic;
      clinicName = clinic?.name || '';
    } catch { /* tables may not exist */ }

    const licenseValid = license ? true : false;
    res.json({
      setupComplete: hasAdmin && hasClinic,
      license: license ? { valid: licenseValid, daysRemaining: 365, edition: 'enterprise', maxUsers: 50, organisationName: clinicName } : null,
      hasAdmin, hasClinic, clinicName,
      needsSetup: !hasAdmin || !hasClinic,
      needsLicense: !license,
    });
  } catch {
    res.json({ setupComplete: false, license: null, hasAdmin: false, hasClinic: false, clinicName: '', needsSetup: true, needsLicense: true });
  }
});

export default router;
