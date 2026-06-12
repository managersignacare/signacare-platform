import { dbAdmin } from '../../db/db';
import type { TemplateRowLike } from '../assessments/assessmentRegistry';
import {
  findAvailableRatingScaleDefinition,
  listAvailableRatingScaleDefinitions,
} from '../assessments/builtinAssessmentDefinitions';

async function loadClinicRatingScaleTemplates(clinicId: string): Promise<TemplateRowLike[]> {
  return await dbAdmin('templates')
    .where({ clinic_id: clinicId, category: 'Rating Scales', is_active: true })
    .whereIn('type', ['assessment', 'rating_scale'])
    .whereNull('deleted_at')
    .orderBy('name') as TemplateRowLike[];
}

export async function listClinicSelfRatingDefinitions(clinicId: string) {
  const rows = await loadClinicRatingScaleTemplates(clinicId);
  return listAvailableRatingScaleDefinitions(rows, {
    family: 'rating_scale',
    raterType: 'self_rated',
  });
}

export async function findClinicSelfRatingDefinition(clinicId: string, definitionId: string) {
  const rows = await loadClinicRatingScaleTemplates(clinicId);
  return findAvailableRatingScaleDefinition(rows, definitionId, {
    family: 'rating_scale',
    raterType: 'self_rated',
  });
}
