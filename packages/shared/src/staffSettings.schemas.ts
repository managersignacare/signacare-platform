import { z } from 'zod'

// --- Professional Disciplines ---
export const DisciplineCreateSchema = z.object({
  name: z.string().min(1).max(200),
  sortOrder: z.number().int().optional(),
})
export type DisciplineCreateDTO = z.infer<typeof DisciplineCreateSchema>

export const DisciplineResponseSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  name: z.string(),
  isActive: z.boolean(),
  sortOrder: z.number(),
})
export type DisciplineResponse = z.infer<typeof DisciplineResponseSchema>

// --- Clinical Roles ---
export const ClinicalRoleCreateSchema = z.object({
  name: z.string().min(1).max(200),
  sortOrder: z.number().int().optional(),
})
export type ClinicalRoleCreateDTO = z.infer<typeof ClinicalRoleCreateSchema>

export const ClinicalRoleResponseSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  name: z.string(),
  isActive: z.boolean(),
  sortOrder: z.number(),
})
export type ClinicalRoleResponse = z.infer<typeof ClinicalRoleResponseSchema>

// --- Employment type ---
export const EmploymentTypeEnum = z.enum(['full_time', 'part_time'])
export type EmploymentType = z.infer<typeof EmploymentTypeEnum>

export const WorkerTypeEnum = z.enum(['permanent', 'shift', 'casual'])
export type WorkerType = z.infer<typeof WorkerTypeEnum>

// --- Role type within a team ---
export const RoleTypeEnum = z.enum(['primary', 'additional', 'delegated'])
export type RoleType = z.infer<typeof RoleTypeEnum>

// --- Staff Team Assignment ---
export const StaffTeamAssignmentCreateSchema = z.object({
  staffId: z.string().uuid(),
  orgUnitId: z.string().uuid(),
  startDate: z.string().min(1), // ISO date
  endDate: z.string().nullable().optional(),
})
export type StaffTeamAssignmentCreateDTO = z.infer<typeof StaffTeamAssignmentCreateSchema>

export const StaffTeamAssignmentResponseSchema = z.object({
  id: z.string().uuid(),
  staffId: z.string().uuid(),
  orgUnitId: z.string().uuid(),
  orgUnitName: z.string().optional(),
  startDate: z.string(),
  endDate: z.string().nullable(),
  isActive: z.boolean(),
})
export type StaffTeamAssignmentResponse = z.infer<typeof StaffTeamAssignmentResponseSchema>

// --- Staff Role Assignment ---
export const StaffRoleAssignmentCreateSchema = z.object({
  staffId: z.string().uuid(),
  orgUnitId: z.string().uuid(),
  clinicalRoleId: z.string().uuid(),
  roleType: RoleTypeEnum,
  startDate: z.string().min(1),
  endDate: z.string().nullable().optional(),
})
export type StaffRoleAssignmentCreateDTO = z.infer<typeof StaffRoleAssignmentCreateSchema>

export const StaffRoleAssignmentResponseSchema = z.object({
  id: z.string().uuid(),
  staffId: z.string().uuid(),
  orgUnitId: z.string().uuid(),
  orgUnitName: z.string().optional(),
  clinicalRoleId: z.string().uuid(),
  clinicalRoleName: z.string().optional(),
  roleType: RoleTypeEnum,
  startDate: z.string(),
  endDate: z.string().nullable(),
  isActive: z.boolean(),
})
export type StaffRoleAssignmentResponse = z.infer<typeof StaffRoleAssignmentResponseSchema>
