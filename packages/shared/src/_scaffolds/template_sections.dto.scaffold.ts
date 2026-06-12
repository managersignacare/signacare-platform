// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const TemplateSectionsDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  templateId: z.string().uuid(),
  sectionType: z.string().max(50).nullable().optional(),
  label: z.string().max(200).nullable().optional(),
  options: z.unknown().nullable().optional(),
  sortOrder: z.number().int().nullable().optional(),
  isRequired: z.boolean().nullable().optional(),
  createdAt: z.string().datetime(),
  fieldType: z.string().max(50).nullable().optional(),
  soapField: z.string().max(50).nullable().optional(),
  required: z.boolean(),
  position: z.number().int(),
  minValue: z.number().int().nullable().optional(),
  maxValue: z.number().int().nullable().optional(),
  placeholder: z.string().max(255).nullable().optional(),
  updatedAt: z.string().datetime(),
});

export type TemplateSectionsDtoScaffold = z.infer<typeof TemplateSectionsDtoScaffoldSchema>;
