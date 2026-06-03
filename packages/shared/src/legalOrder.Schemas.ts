import { z } from 'zod';

export const CreateLegalOrderSchema = z.object({
  orderTypeId: z.string().uuid(),
  // DB contract: patient_legal_orders.order_number / legal_orders.order_number are varchar(50)
  // Keep API validation fail-closed before DB insert/update to prevent SQLSTATE 22001.
  orderNumber: z.string().max(50).optional(),
  startDate: z.string().min(1),
  endDate: z.string().optional(),
  reviewDate: z.string().optional(),
  nextApplicationDate: z.string().optional(),
  status: z.enum(['active', 'expired', 'revoked', 'pending', 'draft']).default('active'),
  notes: z.string().max(5000).optional(),
});
export type CreateLegalOrderDTO = z.infer<typeof CreateLegalOrderSchema>;

export const UpdateLegalOrderSchema = z.object({
  // BUG-566 — REQUIRED for optimistic-lock safe PATCH updates.
  // R-FIX-BUG-566-ZOD-REQUIRED
  expectedLockVersion: z.number().int().positive(),
  orderNumber: z.string().max(50).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  reviewDate: z.string().optional(),
  nextApplicationDate: z.string().optional(),
  status: z.enum(['active', 'expired', 'revoked', 'pending', 'draft']).optional(),
  notes: z.string().max(5000).optional(),
  aiSummary: z.string().max(10000).optional(),
});
export type UpdateLegalOrderDTO = z.infer<typeof UpdateLegalOrderSchema>;

// @scaffold-divergence: This response schema models patient_legal_orders CRUD
// payloads (enteredById/nextApplicationDate/aiSummary) while the generated
// LegalOrders scaffold currently models legacy legal_orders table shape.
export const LegalOrderResponseSchema = z.object({
  id: z.string().uuid(),
  patientId: z.string().uuid(),
  clinicId: z.string().uuid(),
  lockVersion: z.number().int().nonnegative(),
  orderTypeId: z.string().uuid(),
  enteredById: z.string().uuid().nullable(),
  orderNumber: z.string().nullable(),
  startDate: z.string(),
  endDate: z.string().nullable(),
  reviewDate: z.string().nullable(),
  nextApplicationDate: z.string().nullable(),
  status: z.string(),
  notes: z.string().nullable(),
  aiSummary: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type LegalOrderResponse = z.infer<typeof LegalOrderResponseSchema>;

export const LegalOrderListItemResponseSchema = LegalOrderResponseSchema.extend({
  orderTypeName: z.string(),
  orderCategory: z.string(),
  enteredByName: z.string(),
});
export type LegalOrderListItemResponse = z.infer<typeof LegalOrderListItemResponseSchema>;

export const LegalOrderListResponseSchema = z.object({
  orders: z.array(LegalOrderListItemResponseSchema),
});
export type LegalOrderListResponse = z.infer<typeof LegalOrderListResponseSchema>;

export const ActiveLegalOrderClinicListItemResponseSchema =
  LegalOrderListItemResponseSchema.extend({
    patientGivenName: z.string(),
    patientFamilyName: z.string(),
    patientDob: z.string().nullable(),
  });
export type ActiveLegalOrderClinicListItemResponse = z.infer<
  typeof ActiveLegalOrderClinicListItemResponseSchema
>;

export const ActiveLegalOrderClinicListResponseSchema = z.object({
  orders: z.array(ActiveLegalOrderClinicListItemResponseSchema),
});
export type ActiveLegalOrderClinicListResponse = z.infer<
  typeof ActiveLegalOrderClinicListResponseSchema
>;

export const LegalOrderCreateResponseSchema = z.object({
  order: LegalOrderResponseSchema,
});
export type LegalOrderCreateResponse = z.infer<typeof LegalOrderCreateResponseSchema>;

export const LegalOrderUpdateResponseSchema = z.object({
  order: LegalOrderResponseSchema.nullable(),
});
export type LegalOrderUpdateResponse = z.infer<typeof LegalOrderUpdateResponseSchema>;
