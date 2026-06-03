import { z } from 'zod';

export const ApiPaginationSchema = z.object({
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
});

export const ApiMetaSchema = z.record(z.string(), z.unknown());

export function buildApiListEnvelopeSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    data: z.array(itemSchema),
    pagination: ApiPaginationSchema.optional(),
    meta: ApiMetaSchema.optional(),
  });
}

export function buildApiDetailEnvelopeSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    data: itemSchema,
    meta: ApiMetaSchema.optional(),
  });
}

export function buildApiActionEnvelopeSchema<T extends z.ZodTypeAny>(itemSchema?: T) {
  return z.object({
    ok: z.literal(true),
    data: itemSchema ? itemSchema.optional() : z.unknown().optional(),
    message: z.string().optional(),
    meta: ApiMetaSchema.optional(),
  });
}

export type ApiPagination = z.infer<typeof ApiPaginationSchema>;
