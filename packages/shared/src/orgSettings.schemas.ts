import { z } from 'zod'

// --- Level Labels ---
export const OrgLevelLabelSchema = z.object({
  level: z.number().int().min(1).max(10),
  label: z.string().min(1).max(100),
})
export type OrgLevelLabelDTO = z.infer<typeof OrgLevelLabelSchema>

export const OrgLevelLabelResponseSchema = OrgLevelLabelSchema.extend({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
})
export type OrgLevelLabelResponse = z.infer<typeof OrgLevelLabelResponseSchema>

export const BulkSetLevelLabelsSchema = z.object({
  labels: z.array(OrgLevelLabelSchema).min(1).max(10),
})
export type BulkSetLevelLabelsDTO = z.infer<typeof BulkSetLevelLabelsSchema>

// --- Org Units ---
export const OrgUnitCreateSchema = z.object({
  parentId: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(200),
  level: z.number().int().min(1).max(10),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
})
export type OrgUnitCreateDTO = z.infer<typeof OrgUnitCreateSchema>

export const OrgUnitUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
})
export type OrgUnitUpdateDTO = z.infer<typeof OrgUnitUpdateSchema>

export const OrgUnitResponseSchema: z.ZodType<OrgUnitResponse> = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  parentId: z.string().uuid().nullable(),
  name: z.string(),
  level: z.number(),
  sortOrder: z.number(),
  isActive: z.boolean(),
  children: z.array(z.lazy(() => OrgUnitResponseSchema)).optional(),
  programs: z.array(z.object({
    id: z.string().uuid(),
    name: z.string(),
  })).optional(),
})

export interface OrgUnitResponse {
  id: string
  clinicId: string
  parentId: string | null
  name: string
  level: number
  sortOrder: number
  isActive: boolean
  children?: OrgUnitResponse[]
  programs?: { id: string; name: string }[]
}

// --- Programs ---
export const ProgramCreateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
})
export type ProgramCreateDTO = z.infer<typeof ProgramCreateSchema>

export const ProgramUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  isActive: z.boolean().optional(),
})
export type ProgramUpdateDTO = z.infer<typeof ProgramUpdateSchema>

export const ProgramResponseSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  isActive: z.boolean(),
})
export type ProgramResponse = z.infer<typeof ProgramResponseSchema>

// --- Program Assignment ---
export const ProgramAssignmentSchema = z.object({
  orgUnitId: z.string().uuid(),
  programId: z.string().uuid(),
})
export type ProgramAssignmentDTO = z.infer<typeof ProgramAssignmentSchema>
