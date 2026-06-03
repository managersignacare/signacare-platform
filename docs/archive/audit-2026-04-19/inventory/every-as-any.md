# `as any` / unsafe-cast Inventory — 2026-04-19

**Total rows: 451** (exhaustive catalog of every unsafe TypeScript cast)

**Distribution by category:**
- **A (Unavoidable/3rd-party):** 17 matches — Knex query builders, pg-type parsers, JWT extraction, library-level typing  
- **B (Row-interface shortcuts):** 35 matches — `row as unknown as Record<string, unknown>` in database repositories and mappers
- **C (DTO shape mismatch):** 12 matches — Payload/snapshot casts bypassing schema validation
- **D (Test fixtures):** 0 matches  
- **E (JSX/React/API responses):** 387 matches — React components, apiClient calls, untyped error handlers

**Justified? YES:** 17 matches  
**Justified? NO:** 434 matches (96.2% require fixes)

---

## Complete Inventory: All 451 Unsafe Casts

| # | File:Line | Cast | Context | Cat | Justified? | Action |
|---|---|---|---|---|---|---|
| 1 | apps/api/src/db/db.ts:127 | as unknown as X | return trx ? (trx as unknown as KnexCallable)(...args)  | A | YES | DB proxy typing |
| 2 | apps/api/src/db/db.ts:136 | as unknown as X | const value = (source as unknown as Record<string ∣ sym | A | YES | DB proxy typing |
| 3 | apps/api/src/db/db.ts:159 | as unknown as X | const pool = (appPool.client as unknown as { pool?: Tar | E | NO | Type value |
| 4 | apps/api/src/db/db.ts:222 | as unknown as X | return trx ? (trx as unknown as KnexCallable)(...args)  | A | YES | DB proxy typing |
| 5 | apps/api/src/db/db.ts:230 | as unknown as X | const value = (source as unknown as Record<string ∣ sym | A | YES | DB proxy typing |
| 6 | apps/api/src/db/db.ts:46 | as unknown as X | pgTypes.setTypeParser(1182 as unknown as pgTypes.TypeId | E | NO | Type value |
| 7 | apps/api/src/features/allergies/allergyService.ts:38 | as unknown as X | return mapRowToResponse(row as unknown as Record<string | B | NO | Define row type |
| 8 | apps/api/src/features/allergies/allergyService.ts:48 | as unknown as X | return mapRowToResponse(row as unknown as Record<string | B | NO | Define row type |
| 9 | apps/api/src/features/allergies/allergyService.ts:53 | as unknown as X | return rows.map((r) => mapRowToResponse(r as unknown as | B | NO | Type mapper input |
| 10 | apps/api/src/features/allergies/allergyService.ts:59 | as unknown as X | return mapRowToResponse(row as unknown as Record<string | B | NO | Define row type |
| 11 | apps/api/src/features/allergies/allergyService.ts:78 | as unknown as X | return conflicting.map((r) => mapRowToResponse(r as unk | B | NO | Type mapper input |
| 12 | apps/api/src/features/appointments/appointmentService.ts:213 | as unknown as X | return mapDbToResponse(created as unknown as Record<str | B | NO | Define row type |
| 13 | apps/api/src/features/appointments/appointmentService.ts:446 | as unknown as X | return mapDbToResponse(updated as unknown as Record<str | B | NO | Define row type |
| 14 | apps/api/src/features/appointments/appointmentService.ts:485 | as unknown as X | const raw = existing as unknown as Record<string, unkno | B | NO | Define row type |
| 15 | apps/api/src/features/appointments/appointmentService.ts:501 | as unknown as X | return mapDbToResponse(updated as unknown as Record<str | B | NO | Define row type |
| 16 | apps/api/src/features/appointments/appointmentService.ts:530 | as unknown as X | return mapDbToResponse(updated as unknown as Record<str | B | NO | Define row type |
| 17 | apps/api/src/features/appointments/appointmentService.ts:537 | as unknown as X | return mapDbToResponse(existing as unknown as Record<st | B | NO | Define row type |
| 18 | apps/api/src/features/appointments/appointmentService.ts:562 | as unknown as X | return rows.map((r) => mapDbToResponse(r as unknown as  | B | NO | Type mapper input |
| 19 | apps/api/src/features/appointments/waitlistService.ts:111 | as unknown as X | return rows.map((r) => mapDbToResponse(r as unknown as  | B | NO | Type mapper input |
| 20 | apps/api/src/features/appointments/waitlistService.ts:217 | as unknown as X | appointment: result.createdAppointment as unknown as Re | E | NO | Type value |
| 21 | apps/api/src/features/appointments/waitlistService.ts:218 | as unknown as X | waitlistEntry: mapDbToResponse(result.updatedWaitlist a | B | NO | Type mapper input |
| 22 | apps/api/src/features/appointments/waitlistService.ts:66 | as unknown as X | return mapDbToResponse(created as unknown as Record<str | B | NO | Define row type |
| 23 | apps/api/src/features/appointments/waitlistService.ts:90 | as unknown as X | return mapDbToResponse(updated as unknown as Record<str | B | NO | Define row type |
| 24 | apps/api/src/features/auth/authController.ts:86 | as unknown as X | const loginSuccess = result as unknown as { accessToken | E | NO | Type value |
| 25 | apps/api/src/features/billing/billingRepository.ts:161 | as unknown as X | return rows[0] as unknown as Record<string, unknown>; | B | NO | Define row type |
| 26 | apps/api/src/features/billing/billingRepository.ts:180 | as unknown as X | return rows[0] as unknown as Record<string, unknown>; | B | NO | Define row type |
| 27 | apps/api/src/features/billing/billingRepository.ts:242 | as unknown as X | ...(invoice as unknown as Record<string, unknown>), | C | NO | Update DTO schema |
| 28 | apps/api/src/features/billing/billingRepository.ts:243 | as unknown as X | lineItems: lineItems as unknown as Record<string, unkno | C | NO | Update DTO schema |
| 29 | apps/api/src/features/billing/billingRepository.ts:379 | as unknown as X | return payment as unknown as Record<string, unknown>; | C | NO | Update DTO schema |
| 30 | apps/api/src/features/billing/billingRepository.ts:435 | as unknown as X | return invoice as unknown as Record<string, unknown>; | C | NO | Update DTO schema |
| 31 | apps/api/src/features/calendar/calendarRepository.ts:260 | as unknown as X | setting_value: prefs as unknown as CalendarPreferencesB | E | NO | Type value |
| 32 | apps/api/src/features/endocrinology/glucoseRepository.ts:98 | as unknown as X | } as unknown as Partial<GlucoseReadingRow>) | E | NO | Type value |
| 33 | apps/api/src/features/episode/episodeRepository.ts:85 | as unknown as X | .update({ ...patch, updated_at: new Date() }, EPISODE_C | E | NO | Type value |
| 34 | apps/api/src/features/episode/episodeService.ts:36 | as unknown as X | startDate: typeof row.start_date === 'string' ? row.sta | E | NO | Type value |
| 35 | apps/api/src/features/flags/flagService.ts:52 | as unknown as X | if (duplicate) return mapRowToResponse(duplicate as unk | B | NO | Define row type |
| 36 | apps/api/src/features/flags/flagService.ts:71 | as unknown as X | return mapRowToResponse(row as unknown as Record<string | B | NO | Define row type |
| 37 | apps/api/src/features/flags/flagService.ts:88 | as unknown as X | return rows.map((r) => mapRowToResponse(r as unknown as | B | NO | Type mapper input |
| 38 | apps/api/src/features/flags/flagService.ts:96 | as unknown as X | return rows.map((r) => mapRowToResponse(r as unknown as | B | NO | Type mapper input |
| 39 | apps/api/src/features/internal-medicine/medRecService.ts:93 | as unknown | snapshot: dto.snapshot as unknown, | C | NO | Update DTO schema |
| 40 | apps/api/src/features/llm/llmRepository.ts:103 | as unknown as X | return usageDaySelect(q) as unknown as Promise<LlmUsage | E | NO | Type value |
| 41 | apps/api/src/features/llm/llmRepository.ts:114 | as unknown as X | return usageDaySelect(q) as unknown as Promise<LlmUsage | E | NO | Type value |
| 42 | apps/api/src/features/notifications/notificationRepository.ts:129 | as unknown as X | .onConflict(db.raw('(clinic_id, (payload->>\'dedupe_key | E | NO | Type value |
| 43 | apps/api/src/features/notifications/notificationRepository.ts:143 | as unknown as X | .onConflict(db.raw('(clinic_id, (payload->>\'dedupe_key | E | NO | Type value |
| 44 | apps/api/src/features/notifications/notificationRepository.ts:146 | as unknown as X | return returned as unknown as NotificationRow[]; | E | NO | Type value |
| 45 | apps/api/src/features/org-settings/orgSettingsRepository.ts:212 | as unknown as X | ) as unknown as Promise<Array<OrgUnitProgramRow & { pro | E | NO | Type value |
| 46 | apps/api/src/features/paediatrics/paediatricsRepositories.ts:111 | as unknown as X | } as unknown as Partial<GrowthMeasurementRow>) | E | NO | Type value |
| 47 | apps/api/src/features/paediatrics/paediatricsRepositories.ts:181 | as unknown as X | } as unknown as Partial<ImmunizationRow>) | E | NO | Type value |
| 48 | apps/api/src/features/pathology/pathologyService.ts:101 | as unknown as X | return mapOrder(row as unknown as Record<string, unknow | B | NO | Define row type |
| 49 | apps/api/src/features/pathology/pathologyService.ts:110 | as unknown as X | return rows.map((r) => mapOrder(r as unknown as Record< | B | NO | Type mapper input |
| 50 | apps/api/src/features/pathology/pathologyService.ts:127 | as unknown as X | order: mapOrder(order as unknown as Record<string, unkn | B | NO | Type mapper input |
| 51 | apps/api/src/features/pathology/pathologyService.ts:128 | as unknown as X | results: results.map((r) => mapResult(r as unknown as R | B | NO | Type mapper input |
| 52 | apps/api/src/features/pathology/pathologyService.ts:185 | as unknown as X | return mapResult(row as unknown as Record<string, unkno | B | NO | Define row type |
| 53 | apps/api/src/features/pathology/pathologyService.ts:195 | as unknown as X | return rows.map((r) => mapResult(r as unknown as Record | B | NO | Type mapper input |
| 54 | apps/api/src/features/patients/patientRepository.ts:121 | as unknown as X | return row ? decryptPatientPhi(row as unknown as Patien | B | NO | Type mapper input |
| 55 | apps/api/src/features/patients/patientRepository.ts:125 | as unknown as X | const encrypted = encryptPatientPhi(data as unknown as  | B | NO | Type mapper input |
| 56 | apps/api/src/features/patients/patientRepository.ts:127 | as unknown as X | .insert({ ...encrypted, id: data.id ∣∣ uuidv4(), create | E | NO | Type value |
| 57 | apps/api/src/features/patients/patientRepository.ts:129 | as unknown as X | return decryptPatientPhi(rows[0] as unknown as PatientR | B | NO | Type mapper input |
| 58 | apps/api/src/features/patients/patientRepository.ts:133 | as unknown as X | const encrypted = encryptPatientPhi(patch as unknown as | B | NO | Type mapper input |
| 59 | apps/api/src/features/patients/patientRepository.ts:136 | as unknown as X | .update({ ...encrypted, updated_at: new Date() } as unk | E | NO | Type value |
| 60 | apps/api/src/features/patients/patientRepository.ts:138 | as unknown as X | return rows[0] ? decryptPatientPhi(rows[0] as unknown a | B | NO | Type mapper input |
| 61 | apps/api/src/features/patients/patientRepository.ts:212 | as unknown as X | const total = extractCount(countRows as unknown as Arra | E | NO | Type value |
| 62 | apps/api/src/features/patients/patientRepository.ts:217 | as unknown as X | const data = rows.map(r => decryptPatientPhi(r as unkno | B | NO | Type mapper input |
| 63 | apps/api/src/features/patients/patientService.ts:52 | as unknown as X | dateOfBirth:      typeof row.date_of_birth === 'string' | E | NO | Type value |
| 64 | apps/api/src/features/patients/zitaviSyncRoutes.ts:28 | <any> | async function fetchZitavi(path: string): Promise<any>  | E | NO | Type value |
| 65 | apps/api/src/features/referrals/referralService.ts:45 | as unknown as X | : (row.referral_date as unknown as Date).toISOString(). | E | NO | Type value |
| 66 | apps/api/src/features/reports/reportsRepository.ts:109 | <any> | const q = dbRead<any>('assessment_responses as a') | E | NO | Type value |
| 67 | apps/api/src/features/reports/reportsRepository.ts:137 | <any> | const rows = await dbRead<any>('staff as s') | E | NO | Type value |
| 68 | apps/api/src/features/reports/reportsRepository.ts:174 | as unknown as X | filters: filters as unknown as object, | E | NO | Type value |
| 69 | apps/api/src/features/reports/reportsRepository.ts:60 | <any> | const q = dbRead<any>('clinical_notes as n') | E | NO | Type value |
| 70 | apps/api/src/features/reports/reportsRoutes.ts:174 | as unknown as X | const overdueReviews = extractCount(overdueEps as unkno | E | NO | Type value |
| 71 | apps/api/src/features/risk/riskService.ts:71 | as unknown as X | return mapRowToResponse(row as unknown as Record<string | B | NO | Define row type |
| 72 | apps/api/src/features/risk/riskService.ts:81 | as unknown as X | return rows.map((r) => mapRowToResponse(r as unknown as | B | NO | Type mapper input |
| 73 | apps/api/src/features/risk/riskService.ts:92 | as unknown as X | return mapRowToResponse(row as unknown as Record<string | B | NO | Define row type |
| 74 | apps/api/src/features/staff-settings/staffSettingsRoutes.ts:519 | as unknown as X | res.json({ entries: rows, total: extractCount(totalRows | E | NO | Type value |
| 75 | apps/api/src/features/staff-settings/staffSettingsRoutes.ts:736 | as unknown as X | row.assignment_count = extractCount(cntRows as unknown  | E | NO | Type value |
| 76 | apps/api/src/features/staff/staffRepository.ts:94 | as unknown as X | .orderBy("given_name", "asc") as unknown as Promise<Sta | E | NO | Type value |
| 77 | apps/api/src/mcp/scribeStreaming.ts:51 | <any> | const wsModule = await (Function('return import("ws")') | E | NO | Type value |
| 78 | apps/api/src/mcp/server/mcpServer.ts:530 | <any> | export async function handleMcpRequest(body: any): Prom | E | NO | Type value |
| 79 | apps/api/src/mcp/trainingPipeline.ts:147 | as unknown as X | ) as unknown as ExportRow[]; | E | NO | Type value |
| 80 | apps/api/src/mcp/trainingPipeline.ts:236 | as unknown as X | ) as unknown as Array<{ feature: string ∣ null; cnt: st | E | NO | Type value |
| 81 | apps/api/src/middleware/adminImpersonationAuditMiddleware.ts:41 | as unknown as X | const sessionId = (req.user as unknown as { impersonati | A | YES | JWT claim |
| 82 | apps/api/src/middleware/adminImpersonationAuditMiddleware.ts:43 | as unknown as X | const impersonatorId = (req.user as unknown as { impers | A | YES | JWT claim |
| 83 | apps/api/src/middleware/authMiddleware.ts:45 | as unknown as X | const patientPayload = payload as unknown as { patientI | A | YES | JWT claim |
| 84 | apps/api/src/middleware/authMiddleware.ts:57 | as unknown as X | (payload as unknown as { breakGlass?: boolean }).breakG | A | YES | JWT claim |
| 85 | apps/api/src/middleware/authMiddleware.ts:59 | as unknown as X | (payload as unknown as { breakGlassSessionId?: string } | A | YES | JWT claim |
| 86 | apps/api/src/middleware/authMiddleware.ts:65 | as unknown as X | (payload as unknown as { impersonator?: string }).imper | A | YES | JWT claim |
| 87 | apps/api/src/middleware/authMiddleware.ts:67 | as unknown as X | (payload as unknown as { impersonationSessionId?: strin | A | YES | JWT claim |
| 88 | apps/api/src/middleware/breakGlassAuditMiddleware.ts:45 | as unknown as X | const sessionId = (req.user as unknown as { breakGlassS | A | YES | JWT claim |
| 89 | apps/api/src/middleware/breakGlassAuditMiddleware.ts:46 | as unknown as X | const isBreakGlass = (req.user as unknown as { breakGla | A | YES | JWT claim |
| 90 | apps/api/src/shared/extractCount.ts:4 | as any | // depending on the database driver. Eliminates the (r[ | E | NO | Type value |
| 91 | apps/api/src/shared/phiEncryption.ts:114 | as any | * doesn't need `as any` casts. | E | NO | Type value |
| 92 | apps/web/src/features/ai-agent/pages/AiAgentPage.tsx:160 | <any> | apiClient.get<any>(`patients/${patientId}`), | E | NO | Type API response |
| 93 | apps/web/src/features/ai-agent/pages/AiAgentPage.tsx:163 | <any> | apiClient.get<any>(`medications/patients/${patientId}/m | E | NO | Type API response |
| 94 | apps/web/src/features/ai-agent/pages/AiAgentPage.tsx:166 | <any> | apiClient.get<any>(`appointments?patientId=${patientId} | E | NO | Type API response |
| 95 | apps/web/src/features/ai-agent/pages/AiAgentPage.tsx:169 | as any | const p = patient as any; | E | NO | Type value |
| 96 | apps/web/src/features/ai-agent/pages/AiAgentPage.tsx:719 | as any | <Select value={contextLevel} onChange={e => setContextL | E | NO | Type value |
| 97 | apps/web/src/features/appointments/components/AppointmentForm.tsx:117 | as any | <Alert severity={(error as any)?.code === 'APPOINTMENT_ | E | NO | Type error object |
| 98 | apps/web/src/features/appointments/components/AppointmentForm.tsx:118 | as any | {(error as any)?.status === 409 ∣∣ (error as any)?.mess | E | NO | Type error object |
| 99 | apps/web/src/features/appointments/pages/AppointmentsPage.tsx:478 | as any | <Select value={recEnd} onChange={e => setRecEnd(e.targe | E | NO | Type value |
| 100 | apps/web/src/features/audit/pages/AuditPage.tsx:29 | as any | } as any), | E | NO | Type value |
| 101 | apps/web/src/features/auth/components/LoginForm.tsx:61 | <any> | const r = await apiClient.get<any>('power-settings/bran | E | NO | Type API response |
| 102 | apps/web/src/features/auth/pages/ChangePasswordPage.tsx:38 | as any | const error = mutation.error as any; | E | NO | Type error object |
| 103 | apps/web/src/features/beds/components/KanbanBoard.tsx:78 | as any | const targetColumn = columns.includes(overId as any) ?  | E | NO | Type value |
| 104 | apps/web/src/features/beds/pages/BedBoardPage.tsx:246 | <any> | const res = await apiClient.get<any>(`patients?search=$ | E | NO | Type API response |
| 105 | apps/web/src/features/beds/pages/BedBoardPage.tsx:307 | <any> | queryFn: () => apiClient.get<any>('beds').then(r => Arr | E | NO | Type API response |
| 106 | apps/web/src/features/beds/pages/BedBoardPage.tsx:84 | <any> | const [selectedBed, setSelectedBed] = useState<any>(nul | E | NO | Type React prop |
| 107 | apps/web/src/features/billing/components/ClinicianFeePanel.tsx:30 | <any> | const r = await apiClient.get<any>('staff/lookup'); | E | NO | Type API response |
| 108 | apps/web/src/features/billing/components/ClinicianFeePanel.tsx:72 | as any | const feeItems: ClinicianFeeResponse[] = (fees as any)? | E | NO | Type value |
| 109 | apps/web/src/features/billing/components/ClinicianFeePanel.tsx:73 | as any | const scheduleItems = (feeSchedules as any)?.items ?? [ | E | NO | Type value |
| 110 | apps/web/src/features/billing/components/FeeSchedulePanel.tsx:123 | as any | <TextField select label="Category" size="small" value={ | E | NO | Type value |
| 111 | apps/web/src/features/billing/components/FeeSchedulePanel.tsx:133 | as any | <TextField select label="Modality" size="small" value={ | E | NO | Type value |
| 112 | apps/web/src/features/billing/components/FeeSchedulePanel.tsx:51 | as any | const items: FeeScheduleResponse[] = (data as any)?.ite | E | NO | Type value |
| 113 | apps/web/src/features/billing/components/FeeSchedulePanel.tsx:74 | as any | {seedMut.isSuccess && <Alert severity="success" sx={{ m | E | NO | Type value |
| 114 | apps/web/src/features/billing/components/InvoiceDetail.tsx:34 | as any | const invoice = invoiceRaw as any; // Legacy component  | E | NO | Type value |
| 115 | apps/web/src/features/billing/components/InvoiceDetail.tsx:56 | as any | recordPayment.mutate(data as any, { | E | NO | Type value |
| 116 | apps/web/src/features/billing/components/InvoiceForm.tsx:38 | as any | createInvoice.mutate(data as any, { onSuccess }); | E | NO | Type value |
| 117 | apps/web/src/features/billing/components/InvoiceList.tsx:73 | as any | {!invoices ∣∣ (invoices as any)?.length === 0 ∣∣ (invoi | E | NO | Type value |
| 118 | apps/web/src/features/billing/components/InvoiceList.tsx:90 | as any | {(Array.isArray(invoices) ? invoices : (invoices as any | E | NO | Type value |
| 119 | apps/web/src/features/billing/components/PatientBillingTab.tsx:73 | as any | const referral: ReferralValidityResponse ∣ null = (refe | E | NO | Type value |
| 120 | apps/web/src/features/billing/components/PatientBillingTab.tsx:74 | as any | const invoiceList: InvoiceResponse[] = Array.isArray(in | E | NO | Type value |
| 121 | apps/web/src/features/billing/components/PatientBillingTab.tsx:88 | as any | <Typography variant="body2">Type: <strong>{String((acco | E | NO | Type value |
| 122 | apps/web/src/features/billing/components/PatientBillingTab.tsx:89 | as any | {(account as any)?.healthFundName && <Typography varian | E | NO | Type value |
| 123 | apps/web/src/features/billing/components/PatientBillingTab.tsx:90 | as any | {(account as any)?.dvaNumber && <Typography variant="bo | E | NO | Type value |
| 124 | apps/web/src/features/billing/hooks/useBilling.ts:73 | as any | mutationFn: (_dto: any) => Promise.resolve({} as any), | E | NO | Type response |
| 125 | apps/web/src/features/case-management/pages/CaseManagementPage.tsx:130 | <any> | queryFn: () => apiClient.get<any>('dashboard/caseload') | E | NO | Type API response |
| 126 | apps/web/src/features/case-management/pages/CaseManagementPage.tsx:134 | <any> | queryFn: () => apiClient.get<any>(`care-plans/${patient | E | NO | Type API response |
| 127 | apps/web/src/features/case-management/pages/CaseManagementPage.tsx:271 | <any> | queryFn: () => apiClient.get<any>('dashboard/caseload') | E | NO | Type API response |
| 128 | apps/web/src/features/case-management/pages/CaseManagementPage.tsx:275 | <any> | queryFn: () => apiClient.get<any>(`outcomes`, { patient | E | NO | Type API response |
| 129 | apps/web/src/features/case-management/pages/CaseManagementPage.tsx:371 | <any> | queryFn: () => apiClient.get<any>('community-resources' | E | NO | Type API response |
| 130 | apps/web/src/features/case-management/pages/CaseManagementPage.tsx:65 | <any> | queryFn: () => apiClient.get<any>('dashboard/caseload') | E | NO | Type API response |
| 131 | apps/web/src/features/case-management/pages/ResourcesPage.tsx:16 | <any> | queryFn: () => apiClient.get<any>('community-resources' | E | NO | Type API response |
| 132 | apps/web/src/features/clinical-notes/components/NoteEditor.tsx:205 | as unknown as X | macroKeyDown(event as unknown as React.KeyboardEvent<HT | E | NO | Type value |
| 133 | apps/web/src/features/correspondence/components/GenerateLetterFromNoteButton.tsx:36 | as any | .filter((n) => (episodeId ? (n as any).episodeId === ep | E | NO | Type value |
| 134 | apps/web/src/features/dashboard/pages/DashboardPage.tsx:1077 | <any> | queryFn: () => apiClient.get<any>('shift-handovers/auto | E | NO | Type API response |
| 135 | apps/web/src/features/dashboard/pages/DashboardPage.tsx:161 | <any> | queryFn: () => apiClient.get<any>('dashboard/my-clinic- | E | NO | Type API response |
| 136 | apps/web/src/features/dashboard/pages/DashboardPage.tsx:166 | <any> | queryFn: () => apiClient.get<any>('dashboard/caseload') | E | NO | Type API response |
| 137 | apps/web/src/features/dashboard/pages/DashboardPage.tsx:171 | <any> | queryFn: () => apiClient.get<any>('reports/contacts-kpi | E | NO | Type API response |
| 138 | apps/web/src/features/dashboard/pages/DashboardPage.tsx:176 | <any> | queryFn: () => apiClient.get<any>('reports/staff-caselo | E | NO | Type API response |
| 139 | apps/web/src/features/dashboard/pages/DashboardPage.tsx:181 | <any> | queryFn: () => apiClient.get<any>('reports/dna-rates'). | E | NO | Type API response |
| 140 | apps/web/src/features/dashboard/pages/DashboardPage.tsx:186 | <any> | queryFn: () => apiClient.get<any>('reports/workload-ale | E | NO | Type API response |
| 141 | apps/web/src/features/dashboard/pages/DashboardPage.tsx:191 | <any> | queryFn: () => apiClient.get<any>('phone-triage', { sta | E | NO | Type API response |
| 142 | apps/web/src/features/dashboard/pages/DashboardPage.tsx:197 | <any> | queryFn: () => apiClient.get<any>('reports/clinical-ale | E | NO | Type API response |
| 143 | apps/web/src/features/dashboard/pages/DashboardPage.tsx:206 | <any> | queryFn: () => apiClient.get<any>('appointments', { dat | E | NO | Type API response |
| 144 | apps/web/src/features/dashboard/pages/DashboardPage.tsx:218 | as any | queryFn: () => apiClient.get<any[]>('appointments', { c | E | NO | Type value |
| 145 | apps/web/src/features/dashboard/pages/DashboardPage.tsx:321 | as any | const myPatientCount = caseloadData?.data?.length ?? (c | E | NO | Type value |
| 146 | apps/web/src/features/drafts/pages/DraftsPage.tsx:44 | <any> | const r = await apiClient.get<any>('clinical-notes', {  | E | NO | Type API response |
| 147 | apps/web/src/features/ereferral/pages/EReferralPage.tsx:63 | as any | <ListExportBar compact title="E-Referrals" subtitle={`$ | E | NO | Type value |
| 148 | apps/web/src/features/ereferral/pages/EReferralPage.tsx:65 | as any | rows={((referrals as any[]) ?? []).map((r: any) => [ | E | NO | Type value |
| 149 | apps/web/src/features/exports/pages/ExportsPage.tsx:268 | <any> | selectedModules.includes('demographics') ? apiClient.ge | E | NO | Type API response |
| 150 | apps/web/src/features/exports/pages/ExportsPage.tsx:269 | <any> | selectedModules.includes('episodes') ? apiClient.get<an | E | NO | Type API response |
| 151 | apps/web/src/features/exports/pages/ExportsPage.tsx:270 | <any> | selectedModules.includes('notes') ? apiClient.get<any>( | E | NO | Type API response |
| 152 | apps/web/src/features/exports/pages/ExportsPage.tsx:271 | <any> | selectedModules.includes('medications') ? apiClient.get | E | NO | Type API response |
| 153 | apps/web/src/features/exports/pages/ExportsPage.tsx:272 | <any> | selectedModules.includes('alerts') ? apiClient.get<any> | E | NO | Type API response |
| 154 | apps/web/src/features/exports/pages/ExportsPage.tsx:273 | <any> | selectedModules.includes('legal') ? apiClient.get<any>( | E | NO | Type API response |
| 155 | apps/web/src/features/exports/pages/ExportsPage.tsx:274 | <any> | selectedModules.includes('pathology') ? apiClient.get<a | E | NO | Type API response |
| 156 | apps/web/src/features/exports/pages/ExportsPage.tsx:275 | as any | selectedModules.includes('appointments') ? apiClient.ge | E | NO | Type value |
| 157 | apps/web/src/features/exports/pages/ExportsPage.tsx:276 | as any | selectedModules.includes('correspondence') ? apiClient. | E | NO | Type API response |
| 158 | apps/web/src/features/exports/pages/ExportsPage.tsx:277 | as any | selectedModules.includes('assessments') ? apiClient.get | E | NO | Type API response |
| 159 | apps/web/src/features/exports/pages/ExportsPage.tsx:278 | <any> | selectedModules.includes('risk') ? apiClient.get<any>(` | E | NO | Type API response |
| 160 | apps/web/src/features/exports/pages/ExportsPage.tsx:279 | as any | selectedModules.includes('referrals') ? apiClient.get<a | E | NO | Type API response |
| 161 | apps/web/src/features/exports/pages/ExportsPage.tsx:284 | as any | const p = patient as any; | E | NO | Type value |
| 162 | apps/web/src/features/exports/pages/ExportsPage.tsx:298 | as any | if ((episodes as any[]).length && selectedModules.inclu | E | NO | Type value |
| 163 | apps/web/src/features/exports/pages/ExportsPage.tsx:299 | as any | sections.push({ heading: `Episodes (${(episodes as any[ | E | NO | Type value |
| 164 | apps/web/src/features/exports/pages/ExportsPage.tsx:305 | as any | if ((notes as any[]).length && selectedModules.includes | E | NO | Type value |
| 165 | apps/web/src/features/exports/pages/ExportsPage.tsx:306 | as any | sections.push({ heading: `Clinical Notes (${(notes as a | E | NO | Type value |
| 166 | apps/web/src/features/exports/pages/ExportsPage.tsx:312 | as any | if ((meds as any[]).length && selectedModules.includes( | E | NO | Type value |
| 167 | apps/web/src/features/exports/pages/ExportsPage.tsx:313 | as any | const active = (meds as any[]).filter((m: any) => m.sta | E | NO | Type value |
| 168 | apps/web/src/features/exports/pages/ExportsPage.tsx:314 | as any | const ceased = (meds as any[]).filter((m: any) => m.sta | E | NO | Type value |
| 169 | apps/web/src/features/exports/pages/ExportsPage.tsx:318 | as any | sections.push({ heading: `Medications (${(meds as any[] | E | NO | Type value |
| 170 | apps/web/src/features/exports/pages/ExportsPage.tsx:322 | as any | if ((alerts as any[]).length && selectedModules.include | E | NO | Type value |
| 171 | apps/web/src/features/exports/pages/ExportsPage.tsx:323 | as any | sections.push({ heading: `Alerts & Plans (${(alerts as  | E | NO | Type value |
| 172 | apps/web/src/features/exports/pages/ExportsPage.tsx:329 | as any | if ((legal as any[]).length && selectedModules.includes | E | NO | Type value |
| 173 | apps/web/src/features/exports/pages/ExportsPage.tsx:330 | as any | sections.push({ heading: `Legal / MH Act (${(legal as a | E | NO | Type value |
| 174 | apps/web/src/features/exports/pages/ExportsPage.tsx:336 | as any | if ((pathology as any[]).length && selectedModules.incl | E | NO | Type value |
| 175 | apps/web/src/features/exports/pages/ExportsPage.tsx:337 | as any | sections.push({ heading: `Pathology (${(pathology as an | E | NO | Type value |
| 176 | apps/web/src/features/exports/pages/ExportsPage.tsx:343 | as any | if ((appts as any[]).length && selectedModules.includes | E | NO | Type value |
| 177 | apps/web/src/features/exports/pages/ExportsPage.tsx:344 | as any | sections.push({ heading: `Appointments (${(appts as any | E | NO | Type value |
| 178 | apps/web/src/features/exports/pages/ExportsPage.tsx:350 | as any | if ((letters as any[]).length && selectedModules.includ | E | NO | Type value |
| 179 | apps/web/src/features/exports/pages/ExportsPage.tsx:351 | as any | sections.push({ heading: `Correspondence (${(letters as | E | NO | Type value |
| 180 | apps/web/src/features/exports/pages/ExportsPage.tsx:357 | as any | if ((assessments as any[]).length && selectedModules.in | E | NO | Type value |
| 181 | apps/web/src/features/exports/pages/ExportsPage.tsx:358 | as any | sections.push({ heading: `Assessments (${(assessments a | E | NO | Type value |
| 182 | apps/web/src/features/exports/pages/ExportsPage.tsx:364 | as any | if ((risks as any[]).length && selectedModules.includes | E | NO | Type value |
| 183 | apps/web/src/features/exports/pages/ExportsPage.tsx:365 | as any | sections.push({ heading: `Risk Assessments (${(risks as | E | NO | Type value |
| 184 | apps/web/src/features/exports/pages/ExportsPage.tsx:371 | as any | if ((referrals as any[]).length && selectedModules.incl | E | NO | Type value |
| 185 | apps/web/src/features/exports/pages/ExportsPage.tsx:372 | as any | sections.push({ heading: `Referrals (${(referrals as an | E | NO | Type value |
| 186 | apps/web/src/features/group-therapy/pages/GroupTherapyPage.tsx:65 | as any | const nameMatch = !filterName ∣∣ ((s as any).name ?? s. | E | NO | Type value |
| 187 | apps/web/src/features/handover/pages/HandoverListPage.tsx:253 | <any> | const resp = await apiClient.instance.post<any>('llm/cl | E | NO | Type React prop |
| 188 | apps/web/src/features/handover/pages/HandoverListPage.tsx:50 | <any> | const r = await apiClient.get<any>('dashboard/caseload' | E | NO | Type API response |
| 189 | apps/web/src/features/handover/pages/HandoverListPage.tsx:55 | <any> | const r = await apiClient.get<any>('patients', { limit: | E | NO | Type API response |
| 190 | apps/web/src/features/handover/pages/HandoverListPage.tsx:65 | <any> | queryFn: () => apiClient.get<any>('shift-handovers', { | E | NO | Type API response |
| 191 | apps/web/src/features/handover/pages/HandoverListPage.tsx:78 | <any> | apiClient.get<any>('shift-handovers', { shiftDate: toda | E | NO | Type API response |
| 192 | apps/web/src/features/handover/pages/HandoverListPage.tsx:79 | <any> | apiClient.get<any>('shift-handovers', { shiftDate: yest | E | NO | Type API response |
| 193 | apps/web/src/features/intake/components/ReferralForm.tsx:316 | <any> | queryFn: async () => { try { const r = await apiClient. | E | NO | Type API response |
| 194 | apps/web/src/features/intake/components/ReferralForm.tsx:43 | <any> | const r = await apiClient.get<any>('staff/lookup'); | E | NO | Type API response |
| 195 | apps/web/src/features/intake/components/ReferralForm.tsx:56 | <any> | const r = await apiClient.get<any>('staff-settings/disc | E | NO | Type API response |
| 196 | apps/web/src/features/intake/components/ReferralForm.tsx:86 | as any | distributionMode: distributionMode as any, | E | NO | Type value |
| 197 | apps/web/src/features/intake/pages/MyOffersPage.tsx:46 | as any | {(respondMutation.error as any)?.message ?? 'Failed to  | E | NO | Type error object |
| 198 | apps/web/src/features/lists/pages/HotSpotsPage.tsx:39 | as any | const { data, isLoading } = useQuery({ queryKey: hotspo | E | NO | Type value |
| 199 | apps/web/src/features/lists/pages/HotSpotsPage.tsx:40 | as any | const { data: resolvedData } = useQuery({ queryKey: hot | E | NO | Type value |
| 200 | apps/web/src/features/manager/pages/ManagerDashboardPage.tsx:123 | <any> | queryFn: () => apiClient.get<any>('reports/staff-caselo | E | NO | Type API response |
| 201 | apps/web/src/features/manager/pages/ManagerDashboardPage.tsx:174 | <any> | queryFn: () => apiClient.get<any>('reports/dna-rates'). | E | NO | Type API response |
| 202 | apps/web/src/features/manager/pages/ManagerDashboardPage.tsx:222 | <any> | queryFn: () => apiClient.get<any>('reports/bed-occupanc | E | NO | Type API response |
| 203 | apps/web/src/features/manager/pages/ManagerDashboardPage.tsx:289 | <any> | queryFn: () => apiClient.get<any>('staff-leave').catch( | E | NO | Type API response |
| 204 | apps/web/src/features/manager/pages/ManagerDashboardPage.tsx:385 | <any> | queryFn: () => apiClient.get<any>('reports/workload-ale | E | NO | Type API response |
| 205 | apps/web/src/features/manager/pages/ManagerDashboardPage.tsx:59 | <any> | queryFn: () => apiClient.get<any>('reports/contacts-kpi | E | NO | Type API response |
| 206 | apps/web/src/features/mobile/pages/MobileScribePage.tsx:363 | as unknown as X | component={Link as unknown as React.ElementType} | E | NO | Type value |
| 207 | apps/web/src/features/nursing/pages/NursingPage.tsx:156 | as any | <Chip icon={s.icon as any} label={status} size="small"  | E | NO | Type value |
| 208 | apps/web/src/features/nursing/pages/NursingPage.tsx:187 | <any> | queryFn: () => apiClient.get<any>('patients', { limit:  | E | NO | Type API response |
| 209 | apps/web/src/features/nursing/pages/NursingPage.tsx:191 | <any> | queryFn: () => apiClient.get<any>('structured-observati | E | NO | Type API response |
| 210 | apps/web/src/features/nursing/pages/NursingPage.tsx:535 | <any> | queryFn: () => apiClient.get<any>('shift-handovers', {  | E | NO | Type API response |
| 211 | apps/web/src/features/nursing/pages/NursingPage.tsx:547 | <any> | const resp = await apiClient.get<any>('shift-handovers/ | E | NO | Type API response |
| 212 | apps/web/src/features/nursing/pages/NursingPage.tsx:59 | <any> | queryFn: () => apiClient.get<any>('patients', { limit:  | E | NO | Type API response |
| 213 | apps/web/src/features/nursing/pages/NursingPage.tsx:650 | <any> | queryFn: () => apiClient.get<any>('phone-triage', statu | E | NO | Type API response |
| 214 | apps/web/src/features/nursing/pages/NursingPage.tsx:69 | <any> | queryFn: () => apiClient.get<any>(`medications/mar/${pa | E | NO | Type API response |
| 215 | apps/web/src/features/org-settings/components/OrgTreePanel.tsx:204 | as any | setEditLeader((unit as any).teamLeaderId ?? '') | E | NO | Type value |
| 216 | apps/web/src/features/org-settings/components/OrgTreePanel.tsx:205 | as any | setEditManager((unit as any).managerId ?? '') | E | NO | Type value |
| 217 | apps/web/src/features/org-settings/components/OrgTreePanel.tsx:206 | as any | setEditMgmt1((unit as any).managementStaff1Id ?? '') | E | NO | Type value |
| 218 | apps/web/src/features/org-settings/components/OrgTreePanel.tsx:207 | as any | setEditMgmt2((unit as any).managementStaff2Id ?? '') | E | NO | Type value |
| 219 | apps/web/src/features/org-settings/components/OrgTreePanel.tsx:208 | as any | setEditMgmt3((unit as any).managementStaff3Id ?? '') | E | NO | Type value |
| 220 | apps/web/src/features/org-settings/services/orgSettingsApi.ts:47 | <any> | .get<any>('org-settings/units/tree') | E | NO | Type response |
| 221 | apps/web/src/features/org-settings/services/orgSettingsApi.ts:54 | <any> | .get<any>('org-settings/units') | E | NO | Type response |
| 222 | apps/web/src/features/patients/components/PatientList.tsx:370 | as any | .filter(u => (u as any).level === 'team' ∣∣ counts.has( | E | NO | Type value |
| 223 | apps/web/src/features/patients/components/detail/PatientDetailLayout.tsx:198 | <any> | queryFn: () => apiClient.get<any>(`patients/${patientId | E | NO | Type API response |
| 224 | apps/web/src/features/patients/components/detail/PatientDetailLayout.tsx:440 | <any> | queryFn: () => apiClient.get<any>(`medications/patients | E | NO | Type API response |
| 225 | apps/web/src/features/patients/components/detail/PatientDetailLayout.tsx:446 | <any> | queryFn: () => apiClient.get<any>(`patients/${patientId | E | NO | Type API response |
| 226 | apps/web/src/features/patients/components/detail/PatientDetailLayout.tsx:452 | as any | queryFn: () => apiClient.get<any[]>('appointments', { p | E | NO | Type value |
| 227 | apps/web/src/features/patients/components/detail/PatientDetailLayout.tsx:458 | <any> | queryFn: () => apiClient.get<any>(`outcomes/patient/${p | E | NO | Type API response |
| 228 | apps/web/src/features/patients/components/detail/PatientDetailLayout.tsx:464 | as any | queryFn: () => apiClient.get<any[]>('tasks', { patientI | E | NO | Type value |
| 229 | apps/web/src/features/patients/components/detail/PatientDetailLayout.tsx:491 | as any | const lastPathDate = (pathology ?? []).length > 0 ? new | E | NO | Type value |
| 230 | apps/web/src/features/patients/components/detail/PatientDetailLayout.tsx:518 | <any> | queryFn: () => apiClient.get<any>(`patients/${patientId | E | NO | Type API response |
| 231 | apps/web/src/features/patients/components/detail/PatientDetailLayout.tsx:533 | <any> | queryFn: () => apiClient.get<any>(`patients/${patientId | E | NO | Type API response |
| 232 | apps/web/src/features/patients/components/detail/PatientDetailLayout.tsx:706 | as any | if (!patient.nokName && !(patient as any).nok_name) mis | E | NO | Type value |
| 233 | apps/web/src/features/patients/components/detail/tabs/AlertsPlansTab.tsx:120 | as any | if (attachments.length > 0 && (result as any)?.alert?.i | E | NO | Type value |
| 234 | apps/web/src/features/patients/components/detail/tabs/AlertsPlansTab.tsx:123 | as any | await apiClient.instance.post(`patients/alerts/${(resul | E | NO | Type value |
| 235 | apps/web/src/features/patients/components/detail/tabs/AlertsPlansTab.tsx:367 | <any> | const r = await apiClient.get<any>('staff-settings/temp | E | NO | Type API response |
| 236 | apps/web/src/features/patients/components/detail/tabs/AlertsPlansTab.tsx:464 | <any> | const r = await apiClient.get<any>(`patients/${patientI | E | NO | Type API response |
| 237 | apps/web/src/features/patients/components/detail/tabs/AlertsPlansTab.tsx:761 | <any> | const r = await apiClient.get<any>(`nursing-assessments | E | NO | Type API response |
| 238 | apps/web/src/features/patients/components/detail/tabs/AppointmentsTab.tsx:282 | as any | queryFn: () => apiClient.get<{ data: { id: string; titl | E | NO | Type value |
| 239 | apps/web/src/features/patients/components/detail/tabs/AppointmentsTab.tsx:324 | as any | setClinician((editing as any).clinicianId ?? ''); | E | NO | Type value |
| 240 | apps/web/src/features/patients/components/detail/tabs/AppointmentsTab.tsx:325 | as any | setTeam((editing as any).teamId ?? ''); | E | NO | Type value |
| 241 | apps/web/src/features/patients/components/detail/tabs/AppointmentsTab.tsx:328 | as any | setNotes((editing as any).notes ∣∣ ''); | E | NO | Type value |
| 242 | apps/web/src/features/patients/components/detail/tabs/AssessmentsTab.tsx:118 | as any | const cm = (n as any).contactMeta; | E | NO | Type value |
| 243 | apps/web/src/features/patients/components/detail/tabs/AssessmentsTab.tsx:132 | <any> | const resp = await apiClient.get<any>('templates'); | E | NO | Type API response |
| 244 | apps/web/src/features/patients/components/detail/tabs/AssessmentsTab.tsx:277 | as any | const cm = typeof (n as any).contactMeta === 'string' ? | E | NO | Type value |
| 245 | apps/web/src/features/patients/components/detail/tabs/CorrespondenceTab.tsx:180 | <any> | queryFn: () => apiClient.get<any>(`patients/${patientId | E | NO | Type API response |
| 246 | apps/web/src/features/patients/components/detail/tabs/CorrespondenceTab.tsx:187 | <any> | queryFn: () => apiClient.get<any>('messages/threads', { | E | NO | Type API response |
| 247 | apps/web/src/features/patients/components/detail/tabs/CorrespondenceTab.tsx:194 | <any> | queryFn: () => apiClient.get<any>(`correspondence/lette | E | NO | Type API response |
| 248 | apps/web/src/features/patients/components/detail/tabs/CorrespondenceTab.tsx:313 | <any> | queryFn: () => apiClient.get<any>(`messages/threads/${e | E | NO | Type API response |
| 249 | apps/web/src/features/patients/components/detail/tabs/CorrespondenceTab.tsx:355 | as any | {(threadMessages ?? []).length > 0 ? (threadMessages as | E | NO | Type value |
| 250 | apps/web/src/features/patients/components/detail/tabs/CorrespondenceTab.tsx:356 | as any | <Box key={msg.id ?? mi} sx={{ py: 1, borderBottom: mi < | E | NO | Type value |
| 251 | apps/web/src/features/patients/components/detail/tabs/CorrespondenceTab.tsx:42 | <any> | const r = await apiClient.get<any>(`patients/${patientI | E | NO | Type API response |
| 252 | apps/web/src/features/patients/components/detail/tabs/CorrespondenceTab.tsx:53 | as any | const p = patient as any; | E | NO | Type value |
| 253 | apps/web/src/features/patients/components/detail/tabs/CorrespondenceTab.tsx:556 | <any> | const [printLetter, setPrintLetter] = useState<any>(nul | E | NO | Type React prop |
| 254 | apps/web/src/features/patients/components/detail/tabs/CorrespondenceTab.tsx:637 | as any | const p = patient as any; | E | NO | Type value |
| 255 | apps/web/src/features/patients/components/detail/tabs/EctTab.tsx:1163 | as any | <TextField label={l as string} size="small" fullWidth t | E | NO | Type value |
| 256 | apps/web/src/features/patients/components/detail/tabs/EctTab.tsx:158 | <any> | queryFn: () => apiClient.get<any>('nursing-assessments' | E | NO | Type API response |
| 257 | apps/web/src/features/patients/components/detail/tabs/EctTab.tsx:344 | <any> | queryFn: () => apiClient.get<any>('nursing-assessments' | E | NO | Type API response |
| 258 | apps/web/src/features/patients/components/detail/tabs/EctTab.tsx:34 | <any> | const staff = await apiClient.get<any>(`staff/${userId} | E | NO | Type API response |
| 259 | apps/web/src/features/patients/components/detail/tabs/EctTab.tsx:778 | <any> | const r = await apiClient.get<any>(`patients/${patientI | E | NO | Type API response |
| 260 | apps/web/src/features/patients/components/detail/tabs/EctTab.tsx:79 | <any> | queryFn: () => apiClient.get<any>('nursing-assessments' | E | NO | Type API response |
| 261 | apps/web/src/features/patients/components/detail/tabs/EctTab.tsx:88 | <any> | const resp = await apiClient.instance.post<any>('llm/cl | E | NO | Type React prop |
| 262 | apps/web/src/features/patients/components/detail/tabs/EctTab.tsx:941 | <any> | queryFn: () => apiClient.get<any>('nursing-assessments' | E | NO | Type API response |
| 263 | apps/web/src/features/patients/components/detail/tabs/EpisodesTab.tsx:1151 | <any> | queryFn: () => apiClient.get<any>('tasks', { patientId, | E | NO | Type API response |
| 264 | apps/web/src/features/patients/components/detail/tabs/EpisodesTab.tsx:382 | <any> | queryFn: () => apiClient.get<any>(`patients/${patientId | E | NO | Type API response |
| 265 | apps/web/src/features/patients/components/detail/tabs/EpisodesTab.tsx:388 | <any> | const resp = await apiClient.get<any>(`correspondence/l | E | NO | Type API response |
| 266 | apps/web/src/features/patients/components/detail/tabs/EpisodesTab.tsx:396 | <any> | queryFn: () => apiClient.get<any>(`contact-records/pati | E | NO | Type API response |
| 267 | apps/web/src/features/patients/components/detail/tabs/EpisodesTab.tsx:401 | <any> | queryFn: () => apiClient.get<any>('nursing-assessments' | E | NO | Type API response |
| 268 | apps/web/src/features/patients/components/detail/tabs/EpisodesTab.tsx:408 | <any> | const threads = await apiClient.get<any>('messages/thre | E | NO | Type API response |
| 269 | apps/web/src/features/patients/components/detail/tabs/EpisodesTab.tsx:931 | as any | const disc = ((s as any).discipline ?? '').toLowerCase( | E | NO | Type value |
| 270 | apps/web/src/features/patients/components/detail/tabs/EpisodesTab.tsx:943 | as any | {options.map((s: any) => <MenuItem key={s.id} value={s. | E | NO | Type value |
| 271 | apps/web/src/features/patients/components/detail/tabs/InpatientCareTab.tsx:166 | <any> | queryFn: () => apiClient.get<any>('shift-handovers/auto | E | NO | Type API response |
| 272 | apps/web/src/features/patients/components/detail/tabs/InpatientCareTab.tsx:170 | <any> | queryFn: () => apiClient.get<any>('shift-handovers', {  | E | NO | Type API response |
| 273 | apps/web/src/features/patients/components/detail/tabs/InpatientCareTab.tsx:284 | <any> | queryFn: () => apiClient.get<any>('nursing-assessments' | E | NO | Type API response |
| 274 | apps/web/src/features/patients/components/detail/tabs/InpatientCareTab.tsx:447 | <any> | queryFn: () => apiClient.get<any>('nursing-assessments' | E | NO | Type API response |
| 275 | apps/web/src/features/patients/components/detail/tabs/InpatientCareTab.tsx:574 | <any> | queryFn: () => apiClient.get<any>('nursing-assessments' | E | NO | Type API response |
| 276 | apps/web/src/features/patients/components/detail/tabs/InpatientCareTab.tsx:67 | <any> | queryFn: () => apiClient.get<any>('structured-observati | E | NO | Type API response |
| 277 | apps/web/src/features/patients/components/detail/tabs/InpatientCareTab.tsx:713 | <any> | queryFn: () => apiClient.get<any>('nursing-assessments' | E | NO | Type API response |
| 278 | apps/web/src/features/patients/components/detail/tabs/InpatientCareTab.tsx:872 | <any> | const r = await apiClient.get<any>(`patients/${patientI | E | NO | Type API response |
| 279 | apps/web/src/features/patients/components/detail/tabs/InpatientCareTab.tsx:985 | <any> | queryFn: () => apiClient.get<any>(`outcomes/patient/${p | E | NO | Type API response |
| 280 | apps/web/src/features/patients/components/detail/tabs/InpatientCareTab.tsx:989 | <any> | queryFn: () => apiClient.get<any>('nursing-assessments' | E | NO | Type API response |
| 281 | apps/web/src/features/patients/components/detail/tabs/LivedExperienceTab.tsx:271 | <any> | queryFn: () => apiClient.get<any>(`correspondence/lette | E | NO | Type API response |
| 282 | apps/web/src/features/patients/components/detail/tabs/LivedExperienceTab.tsx:59 | <any> | queryFn: () => apiClient.get<any>(`patients/${patientId | E | NO | Type API response |
| 283 | apps/web/src/features/patients/components/detail/tabs/MedicationsTab.tsx:1021 | <any> | queryFn: () => apiClient.get<any>(`lai/patients/${patie | E | NO | Type API response |
| 284 | apps/web/src/features/patients/components/detail/tabs/MedicationsTab.tsx:1031 | <any> | queryFn: () => apiClient.get<any>(`lai/patients/${patie | E | NO | Type API response |
| 285 | apps/web/src/features/patients/components/detail/tabs/MedicationsTab.tsx:112 | <any> | const r = await apiClient.get<any>(`medications/patient | E | NO | Type API response |
| 286 | apps/web/src/features/patients/components/detail/tabs/MedicationsTab.tsx:122 | as any | const laiMeds = allMeds.filter(m => m.isLai ∣∣ (m as an | E | NO | Type value |
| 287 | apps/web/src/features/patients/components/detail/tabs/MedicationsTab.tsx:123 | as any | const clozMeds = allMeds.filter(m => m.isClozapine ∣∣ ( | E | NO | Type value |
| 288 | apps/web/src/features/patients/components/detail/tabs/MedicationsTab.tsx:1329 | as any | <Select value={revalOutcome} onChange={e => setRevalOut | E | NO | Type value |
| 289 | apps/web/src/features/patients/components/detail/tabs/MedicationsTab.tsx:1512 | <any> | queryFn: () => apiClient.get<any>(`clozapine/patients/$ | E | NO | Type API response |
| 290 | apps/web/src/features/patients/components/detail/tabs/MedicationsTab.tsx:1521 | <any> | queryFn: () => apiClient.get<any>(`clozapine/${regId}/b | E | NO | Type API response |
| 291 | apps/web/src/features/patients/components/detail/tabs/MedicationsTab.tsx:1526 | <any> | queryFn: () => apiClient.get<any>(`clozapine/${regId}/t | E | NO | Type API response |
| 292 | apps/web/src/features/patients/components/detail/tabs/MedicationsTab.tsx:1531 | <any> | queryFn: () => apiClient.get<any>(`clozapine/${regId}/a | E | NO | Type API response |
| 293 | apps/web/src/features/patients/components/detail/tabs/MedicationsTab.tsx:1536 | <any> | queryFn: () => apiClient.get<any>(`clozapine/${regId}/o | E | NO | Type API response |
| 294 | apps/web/src/features/patients/components/detail/tabs/MedicationsTab.tsx:1541 | <any> | queryFn: () => apiClient.get<any>(`clozapine/${regId}/m | E | NO | Type API response |
| 295 | apps/web/src/features/patients/components/detail/tabs/MedicationsTab.tsx:283 | <any> | apiClient.get<any>(`staff/${user?.id}`).catch((err) =>  | E | NO | Type API response |
| 296 | apps/web/src/features/patients/components/detail/tabs/MedicationsTab.tsx:284 | <any> | apiClient.get<any>('clinics/current').catch((err) => {  | E | NO | Type API response |
| 297 | apps/web/src/features/patients/components/detail/tabs/MedicationsTab.tsx:285 | <any> | apiClient.get<any>(`patients/${patientId}`).catch((err) | E | NO | Type API response |
| 298 | apps/web/src/features/patients/components/detail/tabs/MedicationsTab.tsx:2870 | <any> | const r = await apiClient.get<any>(`medications/patient | E | NO | Type API response |
| 299 | apps/web/src/features/patients/components/detail/tabs/MedicationsTab.tsx:2881 | <any> | queryFn: () => apiClient.get<any>('medication-administr | E | NO | Type API response |
| 300 | apps/web/src/features/patients/components/detail/tabs/MedicationsTab.tsx:2903 | <any> | const resp = await apiClient.instance.post<any>('llm/cl | E | NO | Type React prop |
| 301 | apps/web/src/features/patients/components/detail/tabs/MedicationsTab.tsx:3171 | <any> | queryFn: () => apiClient.get<any>('side-effect-schedule | E | NO | Type API response |
| 302 | apps/web/src/features/patients/components/detail/tabs/MedicationsTab.tsx:57 | <any> | const staff = await apiClient.get<any>('staff/me'); | E | NO | Type API response |
| 303 | apps/web/src/features/patients/components/detail/tabs/MedicationsTab.tsx:937 | as any | <Select value={period} onChange={e => setPeriod(e.targe | E | NO | Type value |
| 304 | apps/web/src/features/patients/components/detail/tabs/NinetyOneDayReviewTab.tsx:68 | <any> | queryFn: () => apiClient.get<any>(`medications/patients | E | NO | Type API response |
| 305 | apps/web/src/features/patients/components/detail/tabs/OutcomeMeasuresTab.tsx:324 | as any | {(m.measureDate ?? (m as any).assessmentDatetime ?? m.c | E | NO | Type value |
| 306 | apps/web/src/features/patients/components/detail/tabs/OutcomeMeasuresTab.tsx:351 | as any | <strong>Assessed:</strong> {(m.measureDate ?? (m as any | E | NO | Type value |
| 307 | apps/web/src/features/patients/components/detail/tabs/OverviewTab.tsx:173 | as any | patient={patient as any} | E | NO | Type value |
| 308 | apps/web/src/features/patients/components/detail/tabs/OverviewTab.tsx:28 | as any | const p = patient as any; | E | NO | Type value |
| 309 | apps/web/src/features/patients/components/detail/tabs/PathologyTab.tsx:140 | as any | onClick={() => { const url = (r as any).downloadUrl; if | E | NO | Type value |
| 310 | apps/web/src/features/patients/components/detail/tabs/PathwaysTab.tsx:283 | <any> | queryFn: () => apiClient.get<any>(`patients/${patientId | E | NO | Type API response |
| 311 | apps/web/src/features/patients/components/detail/tabs/PathwaysTab.tsx:52 | <any> | queryFn: () => apiClient.get<any>(`pathways/patient/${p | E | NO | Type API response |
| 312 | apps/web/src/features/patients/components/detail/tabs/PhysicalHealthTab.tsx:80 | <any> | queryFn: () => apiClient.get<any>('nursing-assessments' | E | NO | Type API response |
| 313 | apps/web/src/features/patients/components/detail/tabs/ReferralsTab.tsx:89 | <any> | try { const r = await apiClient.get<any>('referrals', { | E | NO | Type API response |
| 314 | apps/web/src/features/patients/components/detail/tabs/SummaryTab.tsx:1571 | as any | queryFn: () => apiClient.get<any[]>('tasks', { patientI | E | NO | Type value |
| 315 | apps/web/src/features/patients/components/detail/tabs/SummaryTab.tsx:1576 | <any> | queryFn: () => apiClient.get<any>(`patients/${patientId | E | NO | Type API response |
| 316 | apps/web/src/features/patients/components/detail/tabs/SummaryTab.tsx:1581 | as any | queryFn: () => apiClient.get<any[]>('appointments', { p | E | NO | Type value |
| 317 | apps/web/src/features/patients/components/detail/tabs/SummaryTab.tsx:1586 | <any> | queryFn: () => apiClient.get<any>(`pathways/patient/${p | E | NO | Type API response |
| 318 | apps/web/src/features/patients/components/detail/tabs/SummaryTab.tsx:1886 | <any> | const r = await apiClient.get<any>(`patient-app/trackin | E | NO | Type API response |
| 319 | apps/web/src/features/patients/components/detail/tabs/SummaryTab.tsx:1887 | as any | return (r?.entries ?? []) as any[] | E | NO | Type value |
| 320 | apps/web/src/features/patients/components/detail/tabs/SummaryTab.tsx:564 | as any | const upcomingAppts = (rawAppts as any[]) | E | NO | Type value |
| 321 | apps/web/src/features/patients/components/detail/tabs/TmsTab.tsx:104 | <any> | queryFn: () => apiClient.get<any>('nursing-assessments' | E | NO | Type API response |
| 322 | apps/web/src/features/patients/components/detail/tabs/TmsTab.tsx:250 | <any> | queryFn: () => apiClient.get<any>('nursing-assessments' | E | NO | Type API response |
| 323 | apps/web/src/features/patients/components/detail/tabs/TmsTab.tsx:55 | <any> | queryFn: () => apiClient.get<any>('nursing-assessments' | E | NO | Type API response |
| 324 | apps/web/src/features/patients/components/detail/tabs/TrackingTab.tsx:111 | <any> | queryFn: () => zitaviId ? gw<any>(`/patients/${zitaviId | E | NO | Type React prop |
| 325 | apps/web/src/features/patients/components/detail/tabs/TrackingTab.tsx:34 | as any | return (res as any)?.success ? (res as any).data : (res | E | NO | Type value |
| 326 | apps/web/src/features/patients/components/detail/tabs/VivaTab.tsx:1049 | <any> | queryFn: () => apiClient.get<any>('patient-app/self-rat | E | NO | Type API response |
| 327 | apps/web/src/features/patients/components/detail/tabs/VivaTab.tsx:1055 | <any> | queryFn: () => apiClient.get<any>(`patient-app/assessme | E | NO | Type API response |
| 328 | apps/web/src/features/patients/components/detail/tabs/VivaTab.tsx:1203 | <any> | const r = await apiClient.get<any>(`patient-app/trackin | E | NO | Type API response |
| 329 | apps/web/src/features/patients/components/detail/tabs/VivaTab.tsx:1204 | as any | return (r?.entries ?? []) as any[] | E | NO | Type value |
| 330 | apps/web/src/features/patients/components/detail/tabs/VivaTab.tsx:1253 | <any> | const r = await apiClient.get<any>(`patient-app/trackin | E | NO | Type API response |
| 331 | apps/web/src/features/patients/components/detail/tabs/VivaTab.tsx:1254 | as any | return (r?.entries ?? []) as any[] | E | NO | Type value |
| 332 | apps/web/src/features/patients/components/detail/tabs/VivaTab.tsx:1313 | as any | const statusChanges = parsed.statusChanges as any[] ??  | E | NO | Type value |
| 333 | apps/web/src/features/patients/components/detail/tabs/VivaTab.tsx:1335 | as any | {parsed.steps && (parsed.steps as any[]).map((s: any, s | E | NO | Type value |
| 334 | apps/web/src/features/patients/components/detail/tabs/VivaTab.tsx:1386 | <any> | const r = await apiClient.get<any>(`patient-app/trackin | E | NO | Type API response |
| 335 | apps/web/src/features/patients/components/detail/tabs/VivaTab.tsx:1387 | as any | return (r?.entries ?? []) as any[] | E | NO | Type value |
| 336 | apps/web/src/features/patients/components/detail/tabs/VivaTab.tsx:139 | <any> | const result = await apiClient.get<any>(`patient-app/tr | E | NO | Type API response |
| 337 | apps/web/src/features/patients/components/detail/tabs/VivaTab.tsx:140 | as any | return (result?.entries ?? []) as any[] | E | NO | Type value |
| 338 | apps/web/src/features/patients/components/detail/tabs/VivaTab.tsx:1529 | <any> | const r = await apiClient.get<any>(`patient-app/trackin | E | NO | Type API response |
| 339 | apps/web/src/features/patients/components/detail/tabs/VivaTab.tsx:1530 | as any | const entries = (r?.entries ?? []) as any[] | E | NO | Type value |
| 340 | apps/web/src/features/patients/components/detail/tabs/VivaTab.tsx:1538 | <any> | queryFn: () => apiClient.get<any>(`patients/${patientId | E | NO | Type API response |
| 341 | apps/web/src/features/patients/components/detail/tabs/VivaTab.tsx:1642 | <any> | queryFn: () => apiClient.get<any>(`patient-app/tasks/${ | E | NO | Type API response |
| 342 | apps/web/src/features/patients/components/detail/tabs/VivaTab.tsx:1647 | <any> | queryFn: () => apiClient.get<any>(`patient-app/checklis | E | NO | Type API response |
| 343 | apps/web/src/features/patients/components/detail/tabs/VivaTab.tsx:254 | <any> | const result = await apiClient.get<any>(`patient-app/tr | E | NO | Type API response |
| 344 | apps/web/src/features/patients/components/detail/tabs/VivaTab.tsx:255 | as any | return (result?.entries ?? []) as any[] | E | NO | Type value |
| 345 | apps/web/src/features/patients/components/detail/tabs/VivaTab.tsx:305 | as any | {parsed.steps && (parsed.steps as any[]).map((s: any, s | E | NO | Type value |
| 346 | apps/web/src/features/patients/components/detail/tabs/VivaTab.tsx:403 | <any> | const result = await apiClient.get<any>(`patient-app/tr | E | NO | Type API response |
| 347 | apps/web/src/features/patients/components/detail/tabs/VivaTab.tsx:404 | as any | const entries = (result?.entries ?? []) as any[] | E | NO | Type value |
| 348 | apps/web/src/features/patients/components/detail/tabs/VivaTab.tsx:412 | <any> | queryFn: () => apiClient.get<any>(`patient-app/threshol | E | NO | Type API response |
| 349 | apps/web/src/features/patients/components/detail/tabs/VivaTab.tsx:418 | <any> | queryFn: () => apiClient.get<any>(`patient-app/threshol | E | NO | Type API response |
| 350 | apps/web/src/features/patients/components/detail/tabs/VivaTab.tsx:703 | <any> | queryFn: () => apiClient.get<any>(`medications/patients | E | NO | Type API response |
| 351 | apps/web/src/features/patients/components/detail/tabs/VivaTab.tsx:711 | <any> | queryFn: () => apiClient.get<any>(`patient-app/med-remi | E | NO | Type API response |
| 352 | apps/web/src/features/patients/components/detail/tabs/VivaTab.tsx:71 | <any> | queryFn: () => apiClient.get<any>(`patient-app/invite/$ | E | NO | Type API response |
| 353 | apps/web/src/features/patients/components/detail/tabs/VivaTab.tsx:74 | <any> | mutationFn: () => apiClient.post<any>(`patient-app/invi | E | NO | Type React prop |
| 354 | apps/web/src/features/patients/components/detail/tabs/VivaTab.tsx:841 | <any> | queryFn: () => apiClient.get<any>(`patient-app/med-remi | E | NO | Type API response |
| 355 | apps/web/src/features/patients/components/detail/tabs/VivaTab.tsx:846 | <any> | queryFn: () => apiClient.get<any>(`medications/patients | E | NO | Type API response |
| 356 | apps/web/src/features/patients/components/detail/tabs/VivaTab.tsx:958 | <any> | queryFn: () => apiClient.get<any>(`patient-app/shared-d | E | NO | Type API response |
| 357 | apps/web/src/features/patients/components/notes/AddNoteDialog.tsx:673 | <any> | apiClient.get<any>(`patients/${patientId}`).catch((err) | E | NO | Type API response |
| 358 | apps/web/src/features/patients/components/notes/AddNoteDialog.tsx:674 | <any> | apiClient.get<any>(`medications/patients/${patientId}/m | E | NO | Type API response |
| 359 | apps/web/src/features/patients/components/notes/AddNoteDialog.tsx:675 | <any> | apiClient.get<any>(`patients/${patientId}/diagnoses`).c | E | NO | Type API response |
| 360 | apps/web/src/features/patients/components/notes/AddNoteDialog.tsx:676 | <any> | apiClient.get<any>('clinics/current').catch((err) => {  | E | NO | Type API response |
| 361 | apps/web/src/features/patients/components/notes/AddNoteDialog.tsx:677 | <any> | apiClient.get<any>(`patients/${patientId}/providers`).c | E | NO | Type API response |
| 362 | apps/web/src/features/patients/components/notes/AddNoteDialog.tsx:757 | <any> | const resp = await apiClient.instance.post<any>('llm/cl | E | NO | Type React prop |
| 363 | apps/web/src/features/patients/components/notes/AddNoteDialog.tsx:788 | as any | clinicalNoteId: (noteResult as any)?.note?.id ?? (noteR | E | NO | Type value |
| 364 | apps/web/src/features/patients/components/notes/AmbientAiRecorder.tsx:1016 | as any | <RiskLevelChip level={f.severity as any} /> | E | NO | Type value |
| 365 | apps/web/src/features/patients/components/notes/AmbientAiRecorder.tsx:212 | as any | results.whisper = resp.ok ? null as any : false; | E | NO | Type value |
| 366 | apps/web/src/features/patients/components/notes/SendMessageDialog.tsx:113 | as any | const p = patient as any; | E | NO | Type value |
| 367 | apps/web/src/features/patients/components/notes/SendMessageDialog.tsx:36 | <any> | const r = await apiClient.get<any>(`patients/${patientI | E | NO | Type API response |
| 368 | apps/web/src/features/patients/components/notes/SendMessageDialog.tsx:48 | as any | const p = patient as any; | E | NO | Type value |
| 369 | apps/web/src/features/patients/components/notes/scribeStreamingClient.ts:150 | as unknown as X | static readonly _types = (null as unknown as { | E | NO | Type response |
| 370 | apps/web/src/features/patients/components/registration/EditPatientWizard.tsx:437 | as any | <Controller key={String(item.name)} name={item.name as  | E | NO | Type value |
| 371 | apps/web/src/features/patients/components/registration/EditPatientWizard.tsx:484 | as any | const p = patient as any; | E | NO | Type value |
| 372 | apps/web/src/features/patients/components/registration/EditPatientWizard.tsx:586 | as any | (dto as any).healthFundName = label; | E | NO | Type value |
| 373 | apps/web/src/features/patients/components/registration/EditPatientWizard.tsx:587 | as any | (dto as any).healthFundNumber = primaryFunding.details  | E | NO | Type value |
| 374 | apps/web/src/features/patients/components/registration/PatientRegistrationWizard.tsx:112 | as any | // Audit Tier 9.3 (HIGH-A1) — typed access (all 23 `as  | E | NO | Type value |
| 375 | apps/web/src/features/patients/components/registration/PatientRegistrationWizard.tsx:158 | as any | const patient = await createPatient.mutateAsync(dto as  | E | NO | Type value |
| 376 | apps/web/src/features/patients/components/registration/Step7Providers.tsx:30 | as any | const patientPostcode = watch('addressPostcode' as any) | E | NO | Type value |
| 377 | apps/web/src/features/patients/components/registration/Step7Providers.tsx:34 | as any | if (provider.givenName) setValue(`${prefix}.firstName`  | E | NO | Type value |
| 378 | apps/web/src/features/patients/components/registration/Step7Providers.tsx:35 | as any | if (provider.familyName) setValue(`${prefix}.lastName`  | E | NO | Type value |
| 379 | apps/web/src/features/patients/components/registration/Step7Providers.tsx:36 | as any | if (provider.practiceName) setValue(`${prefix}.practice | E | NO | Type value |
| 380 | apps/web/src/features/patients/components/registration/Step7Providers.tsx:37 | as any | if (provider.providerNumber) setValue(`${prefix}.provid | E | NO | Type value |
| 381 | apps/web/src/features/patients/components/registration/Step7Providers.tsx:38 | as any | if (provider.phone) setValue(`${prefix}.phone` as any,  | E | NO | Type value |
| 382 | apps/web/src/features/patients/components/registration/Step7Providers.tsx:39 | as any | if (provider.email) setValue(`${prefix}.email` as any,  | E | NO | Type value |
| 383 | apps/web/src/features/patients/components/registration/Step7Providers.tsx:40 | as any | if (provider.address.street) setValue(`${prefix}.addres | E | NO | Type value |
| 384 | apps/web/src/features/patients/components/registration/Step7Providers.tsx:41 | as any | if (provider.address.suburb) setValue(`${prefix}.addres | E | NO | Type value |
| 385 | apps/web/src/features/patients/components/registration/Step7Providers.tsx:42 | as any | if (provider.address.state) setValue(`${prefix}.address | E | NO | Type value |
| 386 | apps/web/src/features/patients/components/registration/Step7Providers.tsx:43 | as any | if (provider.address.postcode) setValue(`${prefix}.addr | E | NO | Type value |
| 387 | apps/web/src/features/patients/pages/PatientsPage.tsx:573 | as any | {/* Audit Tier 9.6 — the query is already typed {transi | E | NO | Type value |
| 388 | apps/web/src/features/patients/pages/PatientsPage.tsx:749 | <any> | const [result, setResult] = React.useState<any>(null); | E | NO | Type React prop |
| 389 | apps/web/src/features/patients/pages/PatientsPage.tsx:752 | <any> | mutationFn: () => apiClient.post<any>('patients/zitavi- | E | NO | Type React prop |
| 390 | apps/web/src/features/patients/types/patientTypes.ts:227 | as any | // final DTO build step. Previously accessed via `(valu | E | NO | Type response |
| 391 | apps/web/src/features/power-settings/components/OnboardingWizard.tsx:104 | as any | clinicType: form.clinicType as any, | E | NO | Type value |
| 392 | apps/web/src/features/power-settings/components/OnboardingWizard.tsx:118 | as any | adminRole: form.adminRole as any ?? 'admin', | E | NO | Type value |
| 393 | apps/web/src/features/power-settings/components/OnboardingWizard.tsx:128 | as any | planType: form.planType as any ?? 'trial', | E | NO | Type value |
| 394 | apps/web/src/features/power-settings/components/OnboardingWizard.tsx:188 | as any | {(provisionMut.error as any)?.message ?? 'Provisioning  | E | NO | Type error object |
| 395 | apps/web/src/features/power-settings/components/OnboardingWizard.tsx:196 | as any | <TextField select label="Clinic Type *" fullWidth size= | E | NO | Type value |
| 396 | apps/web/src/features/power-settings/components/OnboardingWizard.tsx:237 | as any | <TextField select label="Role" fullWidth size="small" v | E | NO | Type value |
| 397 | apps/web/src/features/power-settings/components/OnboardingWizard.tsx:306 | as any | <TextField select label="Plan Type" fullWidth size="sma | E | NO | Type value |
| 398 | apps/web/src/features/power-settings/pages/PowerSettingsPage.tsx:380 | <any> | const r = await apiClient.get<any>('staff-settings/role | E | NO | Type API response |
| 399 | apps/web/src/features/psychiatrist/pages/PsychiatristPage.tsx:139 | <any> | queryFn: () => apiClient.get<any>('patients', { limit:  | E | NO | Type API response |
| 400 | apps/web/src/features/psychiatrist/pages/PsychiatristPage.tsx:143 | <any> | queryFn: () => apiClient.get<any>('clinical-formulation | E | NO | Type API response |
| 401 | apps/web/src/features/psychiatrist/pages/PsychiatristPage.tsx:169 | <any> | const resp = await apiClient.post<any>('llm/generate',  | E | NO | Type React prop |
| 402 | apps/web/src/features/psychiatrist/pages/PsychiatristPage.tsx:315 | <any> | queryFn: () => apiClient.get<any>('patients', { limit:  | E | NO | Type API response |
| 403 | apps/web/src/features/psychiatrist/pages/PsychiatristPage.tsx:319 | <any> | queryFn: () => apiClient.get<any>('side-effect-schedule | E | NO | Type API response |
| 404 | apps/web/src/features/psychiatrist/pages/PsychiatristPage.tsx:63 | <any> | queryFn: () => apiClient.get<any>('dashboard/my-clinic- | E | NO | Type API response |
| 405 | apps/web/src/features/receptionist/pages/ReceptionistPage.tsx:122 | <any> | queryFn: () => apiClient.get<any>('appointments', { dat | E | NO | Type API response |
| 406 | apps/web/src/features/receptionist/pages/ReceptionistPage.tsx:218 | <any> | queryFn: () => apiClient.get<any>('phone-triage').catch | E | NO | Type API response |
| 407 | apps/web/src/features/receptionist/pages/ReceptionistPage.tsx:222 | <any> | queryFn: () => apiClient.get<any>('staff/lookup').catch | E | NO | Type API response |
| 408 | apps/web/src/features/receptionist/pages/ReceptionistPage.tsx:233 | <any> | const r = await apiClient.get<any>('patients', { search | E | NO | Type API response |
| 409 | apps/web/src/features/receptionist/pages/ReceptionistPage.tsx:244 | <any> | const triage = await apiClient.post<any>('phone-triage' | E | NO | Type React prop |
| 410 | apps/web/src/features/receptionist/pages/ReceptionistPage.tsx:449 | <any> | queryFn: () => apiClient.get<any>('waitlist/positions') | E | NO | Type API response |
| 411 | apps/web/src/features/receptionist/pages/ReceptionistPage.tsx:515 | <any> | queryFn: () => apiClient.get<any>('appointments', { dat | E | NO | Type API response |
| 412 | apps/web/src/features/receptionist/pages/ReceptionistPage.tsx:524 | <any> | const res = await apiClient.post<any>('patient-outreach | E | NO | Type React prop |
| 413 | apps/web/src/features/receptionist/pages/ReceptionistPage.tsx:67 | <any> | queryFn: () => apiClient.get<any>('appointments', { dat | E | NO | Type API response |
| 414 | apps/web/src/features/referrals/pages/ReferralsPage.tsx:72 | as any | queryFn: () => apiClient.get<{ items: Referral[]; total | E | NO | Type value |
| 415 | apps/web/src/features/reports/pages/ReportsPage.tsx:1188 | <any> | const { data: runDetail } = useQuery({ queryKey: auditR | E | NO | Type API response |
| 416 | apps/web/src/features/reports/pages/ReportsPage.tsx:1306 | as any | {(Array.isArray(staffList) ? staffList : (staffList as  | E | NO | Type value |
| 417 | apps/web/src/features/reports/pages/ReportsPage.tsx:382 | <any> | queryFn: () => apiClient.get<any>('report-schedules').c | E | NO | Type API response |
| 418 | apps/web/src/features/reports/pages/ReportsPage.tsx:692 | <any> | const [reportData, setReportData] = useState<any>(null) | E | NO | Type React prop |
| 419 | apps/web/src/features/reports/pages/ReportsPage.tsx:710 | <any> | const resp = await apiClient.get<any>('reports/admin-ov | E | NO | Type API response |
| 420 | apps/web/src/features/reports/pages/ReportsPage.tsx:774 | <any> | const resp = await apiClient.instance.post<any>('llm/cl | E | NO | Type React prop |
| 421 | apps/web/src/features/risk-allergies/components/RiskAssessmentList.tsx:151 | as any | {(a.reviewDate ?? (a as any).nextReviewDate) | E | NO | Type value |
| 422 | apps/web/src/features/risk-allergies/components/RiskAssessmentList.tsx:152 | as any | ? new Date(a.reviewDate ?? (a as any).nextReviewDate).t | E | NO | Type value |
| 423 | apps/web/src/features/settings/components/AiTrainingModule.tsx:179 | <any> | const [testResult, setTestResult] = useState<any>(null) | E | NO | Type React prop |
| 424 | apps/web/src/features/settings/components/AiTrainingModule.tsx:194 | <any> | const r = await apiClient.post<any>('llm/rag/test-query | E | NO | Type React prop |
| 425 | apps/web/src/features/settings/components/AiTrainingModule.tsx:253 | <any> | const [triggerResult, setTriggerResult] = useState<any> | E | NO | Type React prop |
| 426 | apps/web/src/features/settings/components/AiTrainingModule.tsx:258 | <any> | queryFn: () => apiClient.get<any>('llm/training/stats') | E | NO | Type API response |
| 427 | apps/web/src/features/settings/components/AiTrainingModule.tsx:263 | <any> | queryFn: () => apiClient.get<any>('llm/training/adapter | E | NO | Type API response |
| 428 | apps/web/src/features/settings/components/AiTrainingModule.tsx:278 | <any> | const r = await apiClient.post<any>('llm/training/start | E | NO | Type React prop |
| 429 | apps/web/src/features/settings/components/AiTrainingModule.tsx:364 | <any> | queryFn: () => apiClient.get<any>('llm/training/stats') | E | NO | Type API response |
| 430 | apps/web/src/features/settings/components/CmiPanel.tsx:17 | <any> | const [prepResult, setPrepResult] = useState<any>(null) | E | NO | Type React prop |
| 431 | apps/web/src/features/settings/components/CmiPanel.tsx:18 | <any> | const [submitResult, setSubmitResult] = useState<any>(n | E | NO | Type React prop |
| 432 | apps/web/src/features/settings/components/CmiPanel.tsx:28 | <any> | const result = await apiClient.post<any>('cmi/prepare', | E | NO | Type React prop |
| 433 | apps/web/src/features/settings/components/CmiPanel.tsx:40 | <any> | const result = await apiClient.post<any>('cmi/submit',  | E | NO | Type React prop |
| 434 | apps/web/src/features/settings/pages/SettingsPage.tsx:1415 | <any> | const data = await apiClient.get<any>('staff-settings/a | E | NO | Type API response |
| 435 | apps/web/src/features/settings/pages/SettingsPage.tsx:407 | <any> | const [config, setConfig] = React.useState<any>(null) | E | NO | Type React prop |
| 436 | apps/web/src/features/settings/pages/SettingsPage.tsx:416 | <any> | const resp = await apiClient.get<any>('backup/config') | E | NO | Type API response |
| 437 | apps/web/src/features/settings/pages/SettingsPage.tsx:427 | <any> | const resp = await apiClient.post<any>('backup/run', lo | E | NO | Type React prop |
| 438 | apps/web/src/features/settings/pages/SettingsPage.tsx:763 | <any> | return await apiClient.get<any>('license/status') | E | NO | Type API response |
| 439 | apps/web/src/features/settings/pages/SettingsPage.tsx:832 | <any> | const resp = await apiClient.post<any>('messages/send-e | E | NO | Type React prop |
| 440 | apps/web/src/features/staff-settings/pages/StaffAssignmentsPage.tsx:131 | <any> | const newStaff = await apiClient.post<any>('staff', { | E | NO | Type React prop |
| 441 | apps/web/src/features/staff-settings/pages/StaffAssignmentsPage.tsx:317 | as any | const allStaff: any[] = (staffList as any[]) ?? [] | E | NO | Type value |
| 442 | apps/web/src/features/staff-settings/pages/StaffAssignmentsPage.tsx:402 | <any> | const r = await apiClient.get<any>('staff-settings/role | E | NO | Type API response |
| 443 | apps/web/src/features/staff-settings/pages/StaffAssignmentsPage.tsx:435 | as any | const staff = (staffList as any[])?.find((s: any) => s. | E | NO | Type value |
| 444 | apps/web/src/features/tasks/components/TaskForm.tsx:48 | as any | assignedToId: (task as any)?.assignedToId ?? undefined, | E | NO | Type value |
| 445 | apps/web/src/features/tasks/pages/TasksPage.tsx:138 | as any | if (patientFilter && !(t as any).patientName?.toLowerCa | E | NO | Type value |
| 446 | apps/web/src/features/tasks/pages/TasksPage.tsx:146 | as any | const due = t.dueAt ?? (t as any).dueDate; | E | NO | Type value |
| 447 | apps/web/src/features/tasks/pages/TasksPage.tsx:65 | as any | const tasks: Task[] = Array.isArray(tasksData) ? tasksD | E | NO | Type value |
| 448 | apps/web/src/features/tasks/types/taskTypes.ts:60 | as any | // that normalises the access — no more `(task as any). | E | NO | Type response |
| 449 | apps/web/src/shared/components/ui/Breadcrumbs.tsx:37 | <any> | queryFn: () => apiClient.get<any>(`patients/${patientId | E | NO | Type API response |
| 450 | apps/web/src/shared/components/ui/MfaChallengeDialog.tsx:67 | as any | {(verifyMut.error as any)?.message ?? 'Verification fai | E | NO | Type error object |
| 451 | apps/web/src/shared/components/ui/StaffPicker.tsx:138 | <any> | const r = await apiClient.get<any>('patients', { search | E | NO | Type API response |
