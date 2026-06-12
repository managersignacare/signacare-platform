import { z } from 'zod';

const OUTCOME_INSTRUMENT_RULES = {
  honos: { items: 12, min: 0, max: 4 },
  honos65: { items: 12, min: 0, max: 4 },
  honosca: { items: 13, min: 0, max: 4 },
  k10: { items: 10, min: 1, max: 5 },
  k10plus: { items: 14, min: 1, max: 5 },
  lsp16: { items: 16, min: 0, max: 4 },
} as const;

function coerceNumericItem(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export const CreateOutcomeMeasureSchema = z.object({
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().optional(),
  measureType: z.string().min(1).max(100),
  collectionOccasion: z.string().max(100).optional(),
  items: z.record(z.unknown()),
  totalScore: z.number().optional(),
  notes: z.string().max(5000).optional(),
}).superRefine((dto, ctx) => {
  const rule =
    OUTCOME_INSTRUMENT_RULES[dto.measureType as keyof typeof OUTCOME_INSTRUMENT_RULES];
  if (!rule) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['measureType'],
      message: `${dto.measureType} is not a supported outcome-measure instrument`,
    });
    return;
  }

  let derivedTotal = 0;
  for (let itemIndex = 1; itemIndex <= rule.items; itemIndex += 1) {
    const key = String(itemIndex);
    const raw = dto.items[key];
    const coerced = coerceNumericItem(raw);

    if (coerced === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['items', key],
        message: `${dto.measureType} item ${itemIndex} is required`,
      });
      continue;
    }
    if (!Number.isInteger(coerced) || coerced < rule.min || coerced > rule.max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['items', key],
        message: `${dto.measureType} item ${itemIndex} must be an integer between ${rule.min} and ${rule.max}`,
      });
      continue;
    }
    derivedTotal += coerced;
  }

  if (dto.totalScore !== undefined && dto.totalScore !== derivedTotal) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['totalScore'],
      message: `${dto.measureType} totalScore must equal the sum of all item scores`,
    });
  }
});
export type CreateOutcomeMeasureDTO = z.infer<typeof CreateOutcomeMeasureSchema>;
