/**
 * NHSD Provider Directory routes
 *
 * GET  /api/v1/nhsd/status           — check if NHSD is configured
 * GET  /api/v1/nhsd/providers/search  — search providers by name, postcode, specialty
 * GET  /api/v1/nhsd/providers/:id     — get single provider/service by ID
 */

import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../../middleware/authMiddleware';
import { searchProviders, searchPractitionerFhir, getServiceById, isNhsdConfigured } from './nhsdClient';

const router = Router();
router.use(requireAuth);

// GET /api/v1/nhsd/status
router.get('/status', (_req: Request, res: Response) => {
  res.json({ configured: isNhsdConfigured() });
});

// GET /api/v1/nhsd/providers/search?name=Smith&postcode=3000&limit=20&offset=0
router.get('/providers/search', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, postcode, suburb, specialty, method, radius, limit, offset, mode } = req.query as Record<string, string>;

    // If mode=fhir, use FHIR endpoint instead
    if (mode === 'fhir') {
      const result = await searchPractitionerFhir(name ?? '', postcode);
      res.json(result);
      return;
    }

    const result = await searchProviders({
      name: name || undefined,
      postcode: postcode || undefined,
      suburb: suburb || undefined,
      specialtyCodes: specialty ? specialty.split(',') : undefined,
      serviceDeliveryMethod: (method === 'PHYSICAL' || method === 'VIRTUAL' || method === 'HOME_VISIT') ? method : undefined,
      radiusMeters: radius ? parseInt(radius, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : 20,
      offset: offset ? parseInt(offset, 10) : 0,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/nhsd/providers/:id
router.get('/providers/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const provider = await getServiceById(req.params.id);
    if (!provider) { res.status(404).json({ error: 'Provider not found' }); return; }
    res.json(provider);
  } catch (err) {
    next(err);
  }
});

export default router;
