// apps/api/src/features/documents/documentController.ts
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { generateDocument, listDocumentTypes } from './documentService';
import type { DocumentType } from './documentTemplates';
import { buildAuthContext } from '../../shared/buildAuthContext';

const GenerateSchema = z.object({
  patientId:         z.string().uuid(),
  documentType:      z.enum(['mht_treatment_order', 'ndis_access_letter', 'ndis_supporting_evidence', 'gp_letter', 'pharmacy_letter', 'ndis_support_letter', 'ndis_review_letter']),
  additionalContext: z.string().max(2000).optional(),
});

export async function generate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const dto = GenerateSchema.parse(req.body);
    const auth = buildAuthContext(req, dto.patientId);
    const result = await generateDocument(
      auth,
      { ...dto, documentType: dto.documentType as DocumentType },
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export function types(_req: Request, res: Response, next: NextFunction): void {
  try {
    res.json({ documentTypes: listDocumentTypes() });
  } catch (err) {
    next(err);
  }
}
