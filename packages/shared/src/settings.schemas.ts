// packages/shared/src/settings.schemas.ts
import { z } from 'zod'

export const ThresholdKeyEnum = z.enum([
  'referralunattendeddays',
  'referralurgentunattendeddays',
  'referralemergencyunattendedhours',
  'patientmissedappointmentstrigger',
  'laioverduedays',
  'clozapinebloodoverduedays',
  'mhaexpirywarningdays',
  'aimsoverduedays',
  'taskoverduehours',
  'invoiceoverduedays',
  'appointmentreminderweekdays',
  'appointmentreminderdays',
  'appointmentreminderhours',
])
export type ThresholdKey = z.infer<typeof ThresholdKeyEnum>

export const SetThresholdSchema = z.object({
  key: z.string().min(1),
  value: z.number().nonnegative(),
})
export type SetThresholdDTO = z.infer<typeof SetThresholdSchema>

export const BulkSetThresholdsSchema = z.object({
  thresholds: z.record(z.string(), z.number().nonnegative()),
})
export type BulkSetThresholdsDTO = z.infer<typeof BulkSetThresholdsSchema>

export const ThresholdsResponseSchema = z.object({
  thresholds: z.record(z.string(), z.number()),
})
export type ThresholdsResponse = z.infer<typeof ThresholdsResponseSchema>

export const ClinicProfileUpdateSchema = z.object({
  name: z.string().min(1).max(200),
  abn: z.string().max(20).optional(),
  phone: z.string().max(30).optional(),
  email: z.string().email().optional().or(z.literal('')),
  addressStreet: z.string().max(200).optional(),
  addressSuburb: z.string().max(100).optional(),
  addressState: z.string().max(10).optional(),
  addressPostcode: z.string().max(10).optional(),
  website: z.string().url().optional().or(z.literal('')),
})
export type ClinicProfileUpdateDTO = z.infer<typeof ClinicProfileUpdateSchema>

export const ClinicProfileResponseSchema = ClinicProfileUpdateSchema.extend({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type ClinicProfileResponse = z.infer<typeof ClinicProfileResponseSchema>

