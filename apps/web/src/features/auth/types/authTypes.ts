// apps/web/src/features/auth/types/authTypes.ts
import { z } from 'zod';

export type { AuthUser } from '@signacare/shared';

export const PasswordResetRequestSchema = z.object({
  email: z.string().email('Invalid email address'),
});
export type PasswordResetRequestDTO = z.infer<typeof PasswordResetRequestSchema>;

export const PasswordResetConfirmSchema = z
  .object({
    token: z.string().min(1, 'Reset token is required'),
    newPassword: z
      .string()
      .min(12, 'Minimum 12 characters')
      .regex(/[A-Z]/, 'Must contain an uppercase letter')
      .regex(/[a-z]/, 'Must contain a lowercase letter')
      .regex(/[0-9]/, 'Must contain a number')
      .regex(/[^A-Za-z0-9]/, 'Must contain a special character'),
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });
export type PasswordResetConfirmDTO = z.infer<typeof PasswordResetConfirmSchema>;

export const MFA_TEMP_KEY = 'signacare_mfa_temp' as const;
