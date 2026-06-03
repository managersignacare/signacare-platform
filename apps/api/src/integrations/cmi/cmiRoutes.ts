import { Router } from 'express';
import { authMiddleware } from '../../middleware/authMiddleware';
import { requireRoles } from '../../middleware/rbacMiddleware';

const router = Router();
router.use(authMiddleware);

// GET /api/v1/cmi/status — check CMI configuration
router.get('/status', requireRoles(['admin', 'manager', 'superadmin']), async (_req, res) => {
  const { isCmiConfigured } = await import('./cmiService');
  res.json({
    configured: isCmiConfigured(),
    mode: process.env.CMI_SUBMISSION_MODE ?? 'test',
    orgCode: process.env.CMI_ORG_CODE ?? 'Not set',
  });
});

// POST /api/v1/cmi/prepare — prepare submission (validate without submitting)
router.post('/prepare', requireRoles(['admin', 'manager', 'superadmin']), async (req, res, next) => {
  try {
    const { prepareCmiSubmission } = await import('./cmiService');
    const { dateFrom, dateTo } = req.body;
    if (!dateFrom || !dateTo) { res.status(400).json({ error: 'dateFrom and dateTo required' }); return; }
    const result = await prepareCmiSubmission(req.clinicId, dateFrom, dateTo);
    res.json(result);
  } catch (err) { next(err); }
});

// POST /api/v1/cmi/submit — submit to CMI
router.post('/submit', requireRoles(['admin', 'superadmin']), async (req, res, next) => {
  try {
    const { submitToCmi, prepareCmiSubmission } = await import('./cmiService');
    const { dateFrom, dateTo } = req.body;
    if (!dateFrom || !dateTo) { res.status(400).json({ error: 'dateFrom and dateTo required' }); return; }
    const { payload } = await prepareCmiSubmission(req.clinicId, dateFrom, dateTo);
    const result = await submitToCmi(req.clinicId, req.user!.id, payload);
    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/v1/cmi/export — download CSV files for manual upload
router.get('/export', requireRoles(['admin', 'manager', 'superadmin']), async (req, res, next) => {
  try {
    const { prepareCmiSubmission, exportEpisodesToCsv, exportContactsToCsv, exportOutcomesToCsv } = await import('./cmiService');
    const dateFrom = (req.query.dateFrom as string) ?? new Date(Date.now() - 91 * 86400000).toISOString().split('T')[0];
    const dateTo = (req.query.dateTo as string) ?? new Date().toISOString().split('T')[0];
    const type = (req.query.type as string) ?? 'episodes';
    const { payload } = await prepareCmiSubmission(req.clinicId, dateFrom, dateTo);

    let csv = '';
    let filename = '';
    switch (type) {
      case 'episodes': csv = exportEpisodesToCsv(payload.episodes); filename = `cmi_episodes_${dateFrom}_${dateTo}.csv`; break;
      case 'contacts': csv = exportContactsToCsv(payload.contacts); filename = `cmi_contacts_${dateFrom}_${dateTo}.csv`; break;
      case 'outcomes': csv = exportOutcomesToCsv(payload.outcomes); filename = `cmi_outcomes_${dateFrom}_${dateTo}.csv`; break;
      default: res.status(400).json({ error: 'type must be episodes, contacts, or outcomes' }); return;
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) { next(err); }
});

export default router;
