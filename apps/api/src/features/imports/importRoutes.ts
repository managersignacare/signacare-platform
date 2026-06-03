/**
 * @admin-only — bulk CSV import workflow, no UI caller yet
 *
 * Rationale (DEAD-MOUNT exemption per Phase 0.7 PR2): bulk patient/clinician/
 * org-unit CSV imports are an operator task during clinic onboarding — done
 * once per new tenant, never by clinical end-users. The routes are gated
 * behind requireModuleWrite(MODULE_KEYS.IMPORTS) and the import_jobs table
 * persists every dry-run + commit attempt for audit. Operators run these via
 * curl with the CSV as multipart form data. A dedicated ops admin UI would
 * be a Phase 13+ deliverable. See docs/admin-routes.md.
 *
 * POST /imports/:kind/dry-run — upload a CSV, parse + validate.
 *                               Returns an import_jobs row with
 *                               status 'validated' or 'rejected'.
 * POST /imports/:kind/commit  — commit an already-validated job by
 *                               id. Body: { jobId }.
 * GET  /imports/jobs          — list recent jobs for the clinic
 *                               (?kind= to filter).
 * GET  /imports/jobs/:id      — fetch one job (errors, sample rows).
 *
 * Every route is gated behind authMiddleware + tenantMiddleware
 * (same chain as the rest of the feature routes) PLUS the new
 * requireModuleWrite(MODULE_KEYS.IMPORTS) from Phase 4 — which means only
 * staff with staff_module_access.access_level = 'write' on the
 * 'imports' module can run this at all. Read-only staff can still
 * LIST historical jobs but cannot create or commit.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/authMiddleware';
import { tenantMiddleware } from '../../middleware/tenantMiddleware';
import { multerUpload } from '../../middleware/uploadMiddleware';
import { requireModuleRead, requireModuleWrite } from '../../middleware/moduleAccessMiddleware';
import { MODULE_KEYS } from '../../shared/moduleKeys';
import { importService } from './importService';
import type { ImportKind } from './importTypes';

const router = Router();
router.use(authMiddleware, tenantMiddleware);

const KNOWN_KINDS: ReadonlySet<ImportKind> = new Set<ImportKind>([
  'patients', 'lai', 'clozapine', 'clinical_notes',
]);

const CommitImportBodySchema = z.object({
  jobId: z.string().uuid(),
});

const ImportKindQuerySchema = z.object({
  kind: z.enum(['patients', 'lai', 'clozapine', 'clinical_notes']).optional(),
});

const ImportJobIdParamSchema = z.object({
  id: z.string().uuid(),
});

function parseKind(raw: string): ImportKind | null {
  return KNOWN_KINDS.has(raw as ImportKind) ? (raw as ImportKind) : null;
}

// ── Dry-run ────────────────────────────────────────────────────────────
router.post(
  '/:kind/dry-run',
  requireModuleWrite(MODULE_KEYS.IMPORTS),
  multerUpload.single('file'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const kind = parseKind(req.params.kind);
      if (!kind) {
        res.status(400).json({ error: `Unknown import kind '${req.params.kind}'` });
        return;
      }
      const file = (req as Request & { file?: Express.Multer.File }).file;
      if (!file) {
        res.status(400).json({ error: 'CSV file is required (form field: file)' });
        return;
      }
      const csvText = file.buffer.toString('utf8');
      const result = await importService.createDryRun({
        clinicId: req.clinicId,
        uploadedByStaffId: req.user!.id,
        kind,
        filename: file.originalname ?? null,
        csvText,
      });
      res.status(201).json(result);
    } catch (err) { next(err); }
  },
);

// ── Commit ─────────────────────────────────────────────────────────────
router.post(
  '/:kind/commit',
  requireModuleWrite(MODULE_KEYS.IMPORTS),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const kind = parseKind(req.params.kind);
      if (!kind) {
        res.status(400).json({ error: `Unknown import kind '${req.params.kind}'` });
        return;
      }
      const { jobId } = CommitImportBodySchema.parse(req.body ?? {});
      const result = await importService.commit({
        clinicId: req.clinicId,
        actorStaffId: req.user!.id,
        jobId,
      });
      res.json(result);
    } catch (err) { next(err); }
  },
);

// ── Job inspection ─────────────────────────────────────────────────────
router.get(
  '/jobs',
  requireModuleRead(MODULE_KEYS.IMPORTS),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = ImportKindQuerySchema.parse(req.query ?? {});
      const rows = await importService.listJobs(req.clinicId, parsed.kind);
      res.json({ jobs: rows });
    } catch (err) { next(err); }
  },
);

router.get(
  '/jobs/:id',
  requireModuleRead(MODULE_KEYS.IMPORTS),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = ImportJobIdParamSchema.parse(req.params ?? {});
      const row = await importService.getJob(req.clinicId, id);
      if (!row) {
        res.status(404).json({ error: 'Import job not found' });
        return;
      }
      res.json(row);
    } catch (err) { next(err); }
  },
);

export default router;
