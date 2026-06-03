import { z } from 'zod';

export const ErxAuthorityModeSchema = z.enum([
  'general',
  'streamlined',
  'phone',
  'written',
  'private',
]);

export type ErxAuthorityMode = z.infer<typeof ErxAuthorityModeSchema>;

export const ErxSubmitContractSchema = z.object({
  prescriptionId: z.string().uuid(),
  patientIhi: z.string().min(1),
  prescriberHpii: z.string().min(1),
  prescriberHpio: z.string().min(1),
  medicationName: z.string().min(1),
  dose: z.string().min(1),
  route: z.string().min(1),
  frequency: z.string().min(1),
  quantity: z.number().int().positive(),
  repeats: z.number().int().nonnegative(),
  pbsItemCode: z.string().max(20).optional(),
  isS8: z.boolean(),
  directions: z.string().optional(),
  prescribedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD required'),
  authorityMode: ErxAuthorityModeSchema.optional(),
  authorityApprovalNumber: z.string().trim().min(1).max(50).optional(),
  isPrivateScript: z.boolean().optional(),
  privateScriptNumber: z.string().trim().min(1).max(80).optional(),
  privatePriceCents: z.number().int().positive().optional(),
  repeatIntervalDays: z.number().int().min(0).max(90).optional(),
  deferredUntilDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD required').optional(),
}).superRefine((v, ctx) => {
  const authorityMode = v.authorityMode ?? 'general';
  const explicitAuthorityMode = v.authorityMode !== undefined;
  const hasPbs = !!v.pbsItemCode;
  const isPrivate = authorityMode === 'private' || !!v.isPrivateScript;

  if (explicitAuthorityMode && authorityMode !== 'private' && !isPrivate && !hasPbs) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['pbsItemCode'],
      message: 'PBS item code is required for non-private prescriptions.',
    });
  }

  if (authorityMode === 'phone' || authorityMode === 'written') {
    if (!v.authorityApprovalNumber) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['authorityApprovalNumber'],
        message: 'Authority approval number is required for phone/written authority scripts.',
      });
    }
  }

  if (authorityMode === 'private' || isPrivate) {
    if (hasPbs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pbsItemCode'],
        message: 'Private scripts must not carry PBS item code.',
      });
    }
    if (!v.privateScriptNumber) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['privateScriptNumber'],
        message: 'Private scripts require a private script number.',
      });
    }
    if (!v.privatePriceCents) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['privatePriceCents'],
        message: 'Private scripts require explicit private price in cents.',
      });
    }
  }

  if (v.repeatIntervalDays !== undefined && v.repeats < 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['repeatIntervalDays'],
      message: 'repeatIntervalDays is only valid when repeats are present.',
    });
  }

  if (v.deferredUntilDate) {
    if (v.repeats < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['deferredUntilDate'],
        message: 'Deferred dispensing requires at least one repeat.',
      });
    }
    const prescribed = new Date(`${v.prescribedDate}T00:00:00.000Z`);
    const deferred = new Date(`${v.deferredUntilDate}T00:00:00.000Z`);
    const ninetyDays = 90 * 24 * 60 * 60 * 1000;
    if (Number.isNaN(prescribed.getTime()) || Number.isNaN(deferred.getTime())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['deferredUntilDate'],
        message: 'Invalid deferred date.',
      });
    } else {
      if (deferred.getTime() < prescribed.getTime()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['deferredUntilDate'],
          message: 'Deferred dispensing date cannot be before prescribed date.',
        });
      }
      if (deferred.getTime() - prescribed.getTime() > ninetyDays) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['deferredUntilDate'],
          message: 'Deferred dispensing date cannot exceed 90 days from prescribed date.',
        });
      }
    }
  }
});

export type ErxSubmitContract = z.infer<typeof ErxSubmitContractSchema>;
