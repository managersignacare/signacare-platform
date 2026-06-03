import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth } from '../../middleware/authMiddleware';
import { requireRoles } from '../../middleware/rbacMiddleware';
import { db } from '../../db/db';
import { CreateChecklistSchema, UpdateChecklistSchema } from '@signacare/shared';

// ── Local Zod schemas (Phase R3b / CLAUDE.md §12) ────────────────────────────
const CreateInstanceSchema = z.object({
  templateId: z.string().uuid(),
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().optional(),
});

// checked_items is a free-form map { [itemId]: { checked: boolean, ... } }.
// Zod keeps the shape minimal and uses passthrough so clinician-added
// metadata flows through without schema churn.
const UpdateInstanceSchema = z.object({
  checkedItems: z.record(
    z.string(),
    z.object({ checked: z.boolean() }).passthrough(),
  ).optional(),
  notes: z.string().max(10000).optional(),
});

interface ChecklistTemplateItem {
  id: string;
  required?: boolean;
}

interface ChecklistCheckedItem {
  checked?: boolean;
}

const router = Router();
router.use(requireAuth);

const ADMIN = ['admin', 'superadmin'];
const CLINICAL = ['clinician', 'admin', 'manager', 'superadmin', 'nurse'];

// ── Default Checklist Templates (seeded on first access) ─────────────────────

const DEFAULT_TEMPLATES = [
  {
    name: 'Discharge Checklist', trigger_point: 'discharge', enforcement: 'mandatory',
    description: 'Required before discharging a patient from inpatient or community episode',
    items: [
      { id: 'd1', section: 'Medication', label: 'Medication reconciliation completed', required: true, helpText: 'Review all medications, document changes, ensure supply arranged' },
      { id: 'd2', section: 'Medication', label: 'Discharge prescriptions written and dispensed', required: true },
      { id: 'd3', section: 'Medication', label: 'Clozapine/LAI arrangements confirmed (if applicable)', required: false },
      { id: 'd4', section: 'Communication', label: 'GP discharge letter sent', required: true, helpText: 'Include medication list, follow-up plan, monitoring requirements' },
      { id: 'd5', section: 'Communication', label: 'Patient/carer informed of discharge plan', required: true },
      { id: 'd6', section: 'Communication', label: 'Community mental health team notified', required: true },
      { id: 'd7', section: 'Risk & Safety', label: 'Risk assessment updated at discharge', required: true },
      { id: 'd8', section: 'Risk & Safety', label: 'Safety plan reviewed with patient', required: true },
      { id: 'd9', section: 'Risk & Safety', label: 'Crisis contact numbers provided', required: true },
      { id: 'd10', section: 'Follow-up', label: 'Follow-up appointment booked', required: true, helpText: 'Within 7 days for high-risk patients' },
      { id: 'd11', section: 'Follow-up', label: 'Post-discharge phone call scheduled (48-72 hours)', required: false },
      { id: 'd12', section: 'Documentation', label: 'Discharge summary completed', required: true },
      { id: 'd13', section: 'Documentation', label: 'Discharge summary signed by consultant', required: true },
      { id: 'd14', section: 'Physical Health', label: 'Physical health follow-up arranged', required: false },
    ],
  },
  {
    name: '91-Day Review Checklist', trigger_point: '91_day_review', enforcement: 'mandatory',
    description: 'Required at each 91-day care plan review',
    items: [
      { id: 'r1', section: 'Clinical Review', label: 'Consultant psychiatrist review completed', required: true },
      { id: 'r2', section: 'Clinical Review', label: 'Treatment goals reviewed and updated', required: true },
      { id: 'r3', section: 'Clinical Review', label: 'Risk assessment updated', required: true },
      { id: 'r4', section: 'Medication', label: 'Medication review completed', required: true, helpText: 'Efficacy, side effects, adherence, polypharmacy check' },
      { id: 'r5', section: 'Medication', label: 'Metabolic monitoring current (if on antipsychotics)', required: false },
      { id: 'r6', section: 'Outcome Measures', label: 'HoNOS completed', required: true },
      { id: 'r7', section: 'Outcome Measures', label: 'K10/DASS completed', required: false },
      { id: 'r8', section: 'Outcome Measures', label: 'LSP-16 completed', required: false },
      { id: 'r9', section: 'Community Linkages', label: 'NDIS plan reviewed (if applicable)', required: false },
      { id: 'r10', section: 'Community Linkages', label: 'Housing, employment, social supports reviewed', required: true },
      { id: 'r11', section: 'Legal', label: 'MHA order status reviewed', required: false, helpText: 'Check if order requires renewal, tribunal date' },
      { id: 'r12', section: 'Documentation', label: '91-day review note signed', required: true },
    ],
  },
  {
    name: 'Admission Checklist', trigger_point: 'admission', enforcement: 'mandatory',
    description: 'Required when admitting a patient to an inpatient unit',
    items: [
      { id: 'a1', section: 'Identification', label: 'Patient identity verified (3-point check)', required: true },
      { id: 'a2', section: 'Identification', label: 'Patient rights explained (IMHA, complaints, legal)', required: true },
      { id: 'a3', section: 'Assessment', label: 'Mental Health Act status documented', required: true },
      { id: 'a4', section: 'Assessment', label: 'Risk assessment completed', required: true },
      { id: 'a5', section: 'Assessment', label: 'Physical health assessment completed', required: true, helpText: 'Vitals, physical examination, allergies' },
      { id: 'a6', section: 'Assessment', label: 'Falls risk assessment completed', required: false },
      { id: 'a7', section: 'Medication', label: 'Medication reconciliation — home medications documented', required: true },
      { id: 'a8', section: 'Medication', label: 'Inpatient medication chart commenced', required: true },
      { id: 'a9', section: 'Safety', label: 'Belongings search and documentation (per policy)', required: false },
      { id: 'a10', section: 'Safety', label: 'Observation level set', required: true },
      { id: 'a11', section: 'Communication', label: 'Next of kin / carer notified', required: true },
      { id: 'a12', section: 'Communication', label: 'GP notified of admission', required: false },
    ],
  },
  {
    name: 'Pre-ECT Checklist', trigger_point: 'pre_ect', enforcement: 'mandatory',
    description: 'Required before each ECT treatment session',
    items: [
      { id: 'e1', section: 'Consent', label: 'Valid consent form on file', required: true },
      { id: 'e2', section: 'Consent', label: 'Patient/substitute decision maker informed', required: true },
      { id: 'e3', section: 'Pre-procedure', label: 'Fasting status confirmed (≥6 hours solids, ≥2 hours clear fluids)', required: true },
      { id: 'e4', section: 'Pre-procedure', label: 'Vital signs recorded', required: true },
      { id: 'e5', section: 'Pre-procedure', label: 'Anaesthetic review completed', required: true },
      { id: 'e6', section: 'Medication', label: 'Relevant medications withheld (lithium, benzodiazepines per protocol)', required: true },
      { id: 'e7', section: 'Medication', label: 'Seizure threshold medications reviewed', required: false },
      { id: 'e8', section: 'Documentation', label: 'Previous ECT response documented', required: false },
    ],
  },
  {
    name: 'Clozapine Initiation Checklist', trigger_point: 'clozapine_initiation', enforcement: 'mandatory',
    description: 'Required before commencing clozapine titration',
    items: [
      { id: 'c1', section: 'Registration', label: 'Registered with Clozapine Monitoring Centre', required: true },
      { id: 'c2', section: 'Registration', label: 'Clozapine Patient Number (CPN) obtained', required: true },
      { id: 'c3', section: 'Baseline Investigations', label: 'FBC with differential (WBC, ANC, neutrophils)', required: true },
      { id: 'c4', section: 'Baseline Investigations', label: 'Metabolic panel (fasting glucose, HbA1c, lipids)', required: true },
      { id: 'c5', section: 'Baseline Investigations', label: 'ECG performed', required: true },
      { id: 'c6', section: 'Baseline Investigations', label: 'Troponin and CRP baseline', required: true },
      { id: 'c7', section: 'Baseline Investigations', label: 'LFT and U&E', required: true },
      { id: 'c8', section: 'Baseline Investigations', label: 'Weight, height, BMI, waist measured', required: true },
      { id: 'c9', section: 'Clinical', label: 'Smoking status assessed and documented', required: true },
      { id: 'c10', section: 'Clinical', label: 'Bowel habits assessed (constipation baseline)', required: true },
      { id: 'c11', section: 'Communication', label: 'Patient/carer education provided (clozapine brochure)', required: true },
      { id: 'c12', section: 'Communication', label: 'Pharmacist informed (blood results + prescription)', required: true },
      { id: 'c13', section: 'Documentation', label: 'High cost eligibility form completed', required: false },
    ],
  },
  {
    name: 'Restrictive Intervention Checklist', trigger_point: 'restrictive_intervention', enforcement: 'mandatory',
    description: 'Required documentation for seclusion or restraint events',
    items: [
      { id: 'ri1', section: 'Authorisation', label: 'Authorised by authorised psychiatrist', required: true },
      { id: 'ri2', section: 'Authorisation', label: 'Least restrictive alternative considered and documented', required: true },
      { id: 'ri3', section: 'Monitoring', label: 'Continuous observation commenced', required: true },
      { id: 'ri4', section: 'Monitoring', label: '15-minute physical observations documented', required: true },
      { id: 'ri5', section: 'Monitoring', label: 'Duration recorded (maximum 4 hours seclusion)', required: true },
      { id: 'ri6', section: 'Patient Care', label: 'Patient offered food, fluids, toileting', required: true },
      { id: 'ri7', section: 'Patient Care', label: 'De-escalation attempted and documented', required: true },
      { id: 'ri8', section: 'Notification', label: 'Family/carer notified (unless contraindicated)', required: false },
      { id: 'ri9', section: 'Notification', label: 'Chief Psychiatrist notification lodged', required: true },
      { id: 'ri10', section: 'Post-incident', label: 'Post-incident debrief with patient', required: true },
      { id: 'ri11', section: 'Post-incident', label: 'Post-incident debrief with staff', required: true },
      { id: 'ri12', section: 'Documentation', label: 'Incident report completed within 2 hours', required: true },
    ],
  },
];

// ── Checklist Template CRUD ──────────────────────────────────────────────────

router.get('/templates', requireRoles(CLINICAL), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await db('checklist_templates').where({ clinic_id: req.clinicId }).orderBy('sort_order', 'asc');
    res.json({ templates: rows });
  } catch (err) { next(err); }
});

router.get('/templates/:triggerPoint', requireRoles(CLINICAL), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const row = await db('checklist_templates')
      .where({ clinic_id: req.clinicId, trigger_point: req.params.triggerPoint, is_active: true })
      .orderBy('sort_order', 'asc')
      .first();
    res.json({ template: row ?? null });
  } catch (err) { next(err); }
});

// Phase 0.7.5 c24 D12 — explicit .returning() column lists (12 + 14 cols).
const CHECKLIST_TEMPLATE_COLUMNS = [
  'id', 'clinic_id', 'name', 'description', 'trigger_point', 'enforcement',
  'items', 'is_active', 'sort_order', 'created_by_staff_id',
  'created_at', 'updated_at',
] as const;
const CHECKLIST_INSTANCE_COLUMNS = [
  'id', 'clinic_id', 'template_id', 'patient_id', 'episode_id',
  'completed_by_staff_id', 'status', 'checked_items', 'total_items',
  'completed_items', 'notes', 'completed_at', 'created_at', 'updated_at',
] as const;

router.post('/templates', requireRoles(ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dto = CreateChecklistSchema.parse(req.body);
    const { name, description, triggerPoint, enforcement, items } = dto;
    const [row] = await db('checklist_templates').insert({
      id: uuidv4(), clinic_id: req.clinicId, name, description: description ?? null,
      trigger_point: triggerPoint, enforcement: enforcement ?? 'advisory',
      items: JSON.stringify(items ?? []), is_active: true,
      created_by_staff_id: req.user!.id, created_at: new Date(), updated_at: new Date(),
    }).returning(CHECKLIST_TEMPLATE_COLUMNS);
    res.status(201).json({ template: row });
  } catch (err) { next(err); }
});

router.patch('/templates/:id', requireRoles(ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dto = UpdateChecklistSchema.parse(req.body);
    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.enforcement !== undefined) patch.enforcement = dto.enforcement;
    if (dto.items !== undefined) patch.items = JSON.stringify(dto.items);
    if (req.body.isActive !== undefined) patch.is_active = req.body.isActive;
    const [row] = await db('checklist_templates').where({ id: req.params.id, clinic_id: req.clinicId }).update(patch).returning(CHECKLIST_TEMPLATE_COLUMNS);
    res.json({ template: row });
  } catch (err) { next(err); }
});

router.delete('/templates/:id', requireRoles(ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await db('checklist_templates').where({ id: req.params.id, clinic_id: req.clinicId }).delete();
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Seed defaults
router.post('/templates/seed-defaults', requireRoles(ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    let seeded = 0;
    for (const tmpl of DEFAULT_TEMPLATES) {
      const existing = await db('checklist_templates').where({ clinic_id: req.clinicId, trigger_point: tmpl.trigger_point }).first();
      if (!existing) {
        await db('checklist_templates').insert({
          id: uuidv4(), clinic_id: req.clinicId, name: tmpl.name, description: tmpl.description,
          trigger_point: tmpl.trigger_point, enforcement: tmpl.enforcement,
          items: JSON.stringify(tmpl.items), is_active: true,
          created_by_staff_id: req.user!.id, created_at: new Date(), updated_at: new Date(),
        });
        seeded++;
      }
    }
    res.json({ seeded });
  } catch (err) { next(err); }
});

// ── Checklist Instances (per-patient completion) ─────────────────────────────

router.post('/instances', requireRoles(CLINICAL), async (req: Request, res: Response, next: NextFunction) => {
  try {
    // checklist_instances is a first-class baseline table (R2b). The
    // pre-R2 `hasTable` guard has been removed per CLAUDE.md §7.3.
    const { templateId, patientId, episodeId } = CreateInstanceSchema.parse(req.body);
    const template = await db('checklist_templates').where({ id: templateId, clinic_id: req.clinicId }).first();
    if (!template) { res.status(404).json({ error: 'Checklist template not found' }); return; }
    const items = typeof template.items === 'string' ? JSON.parse(template.items) : (template.items ?? []);
    const [row] = await db('checklist_instances').insert({
      id: uuidv4(), clinic_id: req.clinicId, template_id: templateId,
      patient_id: patientId, episode_id: episodeId ?? null,
      completed_by_staff_id: req.user!.id, status: 'in_progress',
      checked_items: JSON.stringify({}), total_items: items.length, completed_items: 0,
      created_at: new Date(), updated_at: new Date(),
    }).returning(CHECKLIST_INSTANCE_COLUMNS);
    res.status(201).json({ instance: row });
  } catch (err) { next(err); }
});

router.get('/instances', requireRoles(CLINICAL), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = db('checklist_instances')
      .join('checklist_templates', 'checklist_templates.id', 'checklist_instances.template_id')
      .where('checklist_instances.clinic_id', req.clinicId)
      .select('checklist_instances.*', 'checklist_templates.name as template_name', 'checklist_templates.trigger_point', 'checklist_templates.enforcement');
    if (req.query.patientId) q.where('checklist_instances.patient_id', req.query.patientId as string);
    if (req.query.episodeId) q.where('checklist_instances.episode_id', req.query.episodeId as string);
    if (req.query.status) q.where('checklist_instances.status', req.query.status as string);
    q.orderBy('checklist_instances.created_at', 'desc');
    res.json({ instances: await q });
  } catch (err) { next(err); }
});

// Update checked items on an instance
router.patch('/instances/:id', requireRoles(CLINICAL), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { checkedItems, notes } = UpdateInstanceSchema.parse(req.body);
    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (checkedItems !== undefined) {
      patch.checked_items = JSON.stringify(checkedItems);
      const completedCount = Object.values(checkedItems).filter((v) => v?.checked).length;
      patch.completed_items = completedCount;
    }
    if (notes !== undefined) patch.notes = notes;
    const [row] = await db('checklist_instances').where({ id: req.params.id, clinic_id: req.clinicId }).update(patch).returning(CHECKLIST_INSTANCE_COLUMNS);
    res.json({ instance: row });
  } catch (err) { next(err); }
});

// Complete an instance
router.post('/instances/:id/complete', requireRoles(CLINICAL), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const [row] = await db('checklist_instances')
      .where({ id: req.params.id, clinic_id: req.clinicId })
      .update({ status: 'completed', completed_by_staff_id: req.user!.id, completed_at: new Date(), updated_at: new Date() })
      .returning(CHECKLIST_INSTANCE_COLUMNS);
    res.json({ instance: row });
  } catch (err) { next(err); }
});

// Check if a checklist is complete for a trigger point (used by discharge/review flows)
router.get('/check/:triggerPoint/:patientId', requireRoles(CLINICAL), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const template = await db('checklist_templates')
      .where({ clinic_id: req.clinicId, trigger_point: req.params.triggerPoint, is_active: true })
      .first();
    if (!template) { res.json({ required: false, complete: true, enforcement: 'advisory' }); return; }

    const instance = await db('checklist_instances')
      .where({ clinic_id: req.clinicId, template_id: template.id, patient_id: req.params.patientId })
      .orderBy('created_at', 'desc')
      .first();

    const rawItems = typeof template.items === 'string' ? JSON.parse(template.items) : (template.items ?? []);
    const items = Array.isArray(rawItems) ? rawItems as ChecklistTemplateItem[] : [];
    const requiredItems = items.filter((i) => i.required);
    const rawCheckedItems = instance?.checked_items
      ? (typeof instance.checked_items === 'string' ? JSON.parse(instance.checked_items) : instance.checked_items)
      : {};
    const checkedItems = (rawCheckedItems ?? {}) as Record<string, ChecklistCheckedItem>;
    const allRequiredComplete = requiredItems.every((i) => checkedItems[i.id]?.checked);

    res.json({
      required: true,
      templateId: template.id,
      templateName: template.name,
      enforcement: template.enforcement,
      complete: instance?.status === 'completed' || allRequiredComplete,
      instanceId: instance?.id ?? null,
      totalItems: items.length,
      completedItems: instance?.completed_items ?? 0,
      requiredItems: requiredItems.length,
      requiredComplete: requiredItems.filter((i) => checkedItems[i.id]?.checked).length,
    });
  } catch (err) { next(err); }
});

export default router;
