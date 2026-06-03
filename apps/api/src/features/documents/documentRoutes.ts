// apps/api/src/features/documents/documentRoutes.ts
import { Router } from 'express';
import { authMiddleware } from '../../middleware/authMiddleware';
import { tenantMiddleware } from '../../middleware/tenantMiddleware';
import * as controller from './documentController';

const router = Router();
router.use(authMiddleware, tenantMiddleware);

// GET  /api/v1/documents/types  — list available document types
router.get('/types', controller.types);

// POST /api/v1/documents/generate  — generate a document draft
router.post('/generate', controller.generate);

export default router;
