// packages/shared/src/hiService.schemas.ts
import { z } from "zod";

/**
 * BUG-336 — HPI-I verify request. Admin-facing endpoint wrapping
 * the server-side verifyHpii helper (NASH mTLS to HI Service when
 * configured; format+Luhn-only in stub mode). Server runs the
 * authoritative validateHiNumber check; this client-side regex is
 * a fail-fast guard before the POST.
 */
const HPII_FORMAT = /^800361\d{10}$/;
const HPIO_FORMAT = /^800362\d{10}$/;

export const HpiiVerifyRequestSchema = z.object({
  hpii: z.string().regex(HPII_FORMAT, 'HPI-I must be 16 digits starting with 800361'),
});
export type HpiiVerifyRequestDTO = z.infer<typeof HpiiVerifyRequestSchema>;

export const HpiiVerifyResponseSchema = z.object({
  found: z.boolean(),
  hpii: z.string().optional(),
  name: z.string().optional(),
  qualification: z.string().optional(),
  error: z.string().optional(),
});
export type HpiiVerifyResponse = z.infer<typeof HpiiVerifyResponseSchema>;

/**
 * BUG-339 — HPI-O verify request. Admin-facing endpoint for clinic
 * settings. Same stub/configured split as verifyHpii.
 */
export const HpioVerifyRequestSchema = z.object({
  hpio: z.string().regex(HPIO_FORMAT, 'HPI-O must be 16 digits starting with 800362'),
});
export type HpioVerifyRequestDTO = z.infer<typeof HpioVerifyRequestSchema>;

export const HpioVerifyResponseSchema = z.object({
  found: z.boolean(),
  hpio: z.string().optional(),
  name: z.string().optional(),
  organisationType: z.string().optional(),
  error: z.string().optional(),
});
export type HpioVerifyResponse = z.infer<typeof HpioVerifyResponseSchema>;
