import { z } from 'zod';

export const SectionTypeSchema = z.enum([
  'text',
  'yes_no',
  'single_select',
  'multi_select',
  'likert',
  'numeric',
  'date',
  'heading',
]);
export type SectionType = z.infer<typeof SectionTypeSchema>;

export const TemplateStatusSchema = z.enum(['draft', 'published', 'retired']);
export type TemplateStatus = z.infer<typeof TemplateStatusSchema>;

export const SoapFieldSchema = z.enum([
  'subjective',
  'objective',
  'assessment',
  'plan',
]);
export type SoapFieldType = z.infer<typeof SoapFieldSchema>;

export const SectionOptionSchema = z.object({
  value: z.string(),
  label: z.string(),
  score: z.number().optional(),
});
export type SectionOption = z.infer<typeof SectionOptionSchema>;

export const TemplateSectionSchema = z.object({
  id:          z.string().uuid().optional(),
  label:       z.string().min(1, 'Label is required'),
  fieldType:   SectionTypeSchema,
  soapField:   SoapFieldSchema.optional(),
  required:    z.boolean().default(false),
  position:    z.number().int().min(0).default(0),
  options:     z.array(SectionOptionSchema).optional(),
  minValue:    z.number().int().optional(),
  maxValue:    z.number().int().optional(),
  placeholder: z.string().optional(),
});
export type TemplateSection = z.infer<typeof TemplateSectionSchema>;

export const CreateTemplateSchema = z.object({
  name:        z.string().min(1, 'Name is required').max(255),
  description: z.string().optional(),
  category:    z.string().min(1, 'Category is required').max(100),
  sections:    z.array(TemplateSectionSchema).default([]),
});
export type CreateTemplateDTO = z.infer<typeof CreateTemplateSchema>;

export const UpdateTemplateSchema = CreateTemplateSchema.partial();
export type UpdateTemplateDTO = z.infer<typeof UpdateTemplateSchema>;

export const TemplateSectionResponseSchema = TemplateSectionSchema.extend({
  id:         z.string().uuid(),
  templateId: z.string().uuid(),
  createdAt:  z.string().datetime(),
  updatedAt:  z.string().datetime(),
});
export type TemplateSectionResponse = z.infer<typeof TemplateSectionResponseSchema>;

export const TemplateResponseSchema = z.object({
  id:          z.string().uuid(),
  clinicId:    z.string().uuid(),
  name:        z.string(),
  description: z.string().nullable(),
  category:    z.string(),
  status:      TemplateStatusSchema,
  createdById: z.string().uuid(),
  publishedAt: z.string().datetime().nullable(),
  retiredAt:   z.string().datetime().nullable(),
  createdAt:   z.string().datetime(),
  updatedAt:   z.string().datetime(),
  sections:    z.array(TemplateSectionResponseSchema),
});
export type TemplateResponse = z.infer<typeof TemplateResponseSchema>;
