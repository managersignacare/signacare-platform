// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const InvoiceLineItemsDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  invoiceId: z.string().uuid().nullable().optional(),
  mbsItemCode: z.string().max(20).nullable().optional(),
  description: z.string().max(300).nullable().optional(),
  feeCents: z.number().int().nullable().optional(),
  quantity: z.number().int().nullable().optional(),
  createdAt: z.string().datetime(),
  unitPriceCents: z.number().int().nullable().optional(),
  discountCents: z.number().int().nullable().optional(),
  lineTotalCents: z.number().int().nullable().optional(),
  scheduleFeeCents: z.number().int().nullable().optional(),
  updatedAt: z.string().datetime().nullable().optional(),
});

export type InvoiceLineItemsDtoScaffold = z.infer<typeof InvoiceLineItemsDtoScaffoldSchema>;
