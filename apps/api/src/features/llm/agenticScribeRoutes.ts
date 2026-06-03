import { Router, type NextFunction, type Request, type Response } from 'express';
import { randomUUID } from 'crypto';
import {
  AgenticScribeCreateTasksRequestSchema,
  AgenticScribeCreateTasksResponseSchema,
  AgenticScribeGenerateDraftsRequestSchema,
  AgenticScribeGenerateDraftsResponseSchema,
} from '@signacare/shared';
import { authMiddleware } from '../../middleware/authMiddleware';
import { requireClinicModuleEnabled } from '../../middleware/clinicModuleMiddleware';
import { requireModuleRead, requireModuleWrite } from '../../middleware/moduleAccessMiddleware';
import { requireRoles } from '../../middleware/rbacMiddleware';
import { MODULE_KEYS } from '../../shared/moduleKeys';
import { extractScribeActions } from '../../mcp/scribeEnhancements';
import { CLINICAL_AI_DISCLAIMER } from '../../shared/llmDisclaimer';
import { buildAuthContext } from '../../shared/buildAuthContext';
import { requirePatientRelationship } from '../../shared/authGuards';
import * as taskService from '../tasks/taskService';
import { writeAuditLog } from '../../utils/audit';

const router = Router();

router.use(authMiddleware);
router.use(
  requireClinicModuleEnabled(MODULE_KEYS.AGENTIC_AI_SCRIBE, {
    missingRowPolicy: 'disabled',
  }),
);
router.use(requireModuleRead(MODULE_KEYS.AGENTIC_AI_SCRIBE));

type DraftUrgency = 'routine' | 'soon' | 'urgent';

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function urgencyForText(text: string): DraftUrgency {
  const s = text.toLowerCase();
  if (/(urgent|asap|immediately|immediate|today|critical|stat)\b/.test(s)) {
    return 'urgent';
  }
  if (/(soon|this week|next week|within\s+\d+\s+day|\bfortnight\b)/.test(s)) {
    return 'soon';
  }
  return 'routine';
}

function suggestedDateFromTimeframe(timeframeText: string): string | null {
  const normalized = timeframeText.trim().toLowerCase();
  const m = normalized.match(/(\d+)\s*(day|days|week|weeks|fortnight|fortnights|month|months)/i);
  if (!m) return null;
  const amount = Number(m[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const unit = m[2];
  const dt = new Date();
  if (unit.startsWith('day')) {
    dt.setDate(dt.getDate() + amount);
    return toIsoDate(dt);
  }
  if (unit.startsWith('week')) {
    dt.setDate(dt.getDate() + amount * 7);
    return toIsoDate(dt);
  }
  if (unit.startsWith('fortnight')) {
    dt.setDate(dt.getDate() + amount * 14);
    return toIsoDate(dt);
  }
  if (unit.startsWith('month')) {
    dt.setMonth(dt.getMonth() + amount);
    return toIsoDate(dt);
  }
  return null;
}

function followUpModeFromText(text: string): 'unspecified' | 'in_person' | 'telehealth' | 'phone' {
  const s = text.toLowerCase();
  if (/(telehealth|video|virtual)/.test(s)) return 'telehealth';
  if (/(phone|telephone|call)/.test(s)) return 'phone';
  if (/(in person|clinic|face[\s-]?to[\s-]?face)/.test(s)) return 'in_person';
  return 'unspecified';
}

router.post(
  '/drafts',
  requireRoles(['clinician', 'admin', 'superadmin']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = AgenticScribeGenerateDraftsRequestSchema.parse(req.body);
      if (dto.patientId) {
        const auth = buildAuthContext(req, dto.patientId);
        await requirePatientRelationship(auth, dto.patientId);
      }

      const combinedText = dto.contextNote
        ? `${dto.transcript}\n\n${dto.contextNote}`
        : dto.transcript;
      const actions = extractScribeActions([], [], combinedText);

      const labOrders = actions
        .filter((a) => a.type === 'pathology')
        .map((a) => {
          const testName = (a.details.test ?? a.description.replace(/^Pathology:\s*/i, '')).trim();
          const sourceSnippet = a.description.trim();
          return {
            draftId: randomUUID(),
            testName: testName || 'Pathology test',
            urgency: urgencyForText(sourceSnippet),
            rationale: sourceSnippet,
            sourceSnippet,
          };
        });

      const referrals = actions
        .filter((a) => a.type === 'referral')
        .map((a) => {
          const specialtyOrService = (a.details.recipient ?? a.description.replace(/^Referral to\s*/i, '')).trim();
          const sourceSnippet = a.description.trim();
          return {
            draftId: randomUUID(),
            specialtyOrService: specialtyOrService || 'Specialist / Service',
            reason: sourceSnippet,
            urgency: urgencyForText(sourceSnippet),
            sourceSnippet,
          };
        });

      const followUps = actions
        .filter((a) => a.type === 'appointment')
        .map((a) => {
          const timeframeText = (a.details.timeframe ?? 'TBA').trim();
          const sourceSnippet = a.description.trim();
          return {
            draftId: randomUUID(),
            timeframeText,
            suggestedDate: suggestedDateFromTimeframe(timeframeText),
            appointmentType: /mha/i.test(sourceSnippet) ? 'MHA review' : 'Clinical follow-up',
            mode: followUpModeFromText(sourceSnippet),
            rationale: sourceSnippet,
            sourceSnippet,
          };
        });

      const payload = AgenticScribeGenerateDraftsResponseSchema.parse({
        generatedAt: new Date().toISOString(),
        drafts: {
          labOrders,
          referrals,
          followUps,
        },
        disclaimer: CLINICAL_AI_DISCLAIMER,
      });

      await writeAuditLog({
        clinicId: req.clinicId!,
        actorId: req.user!.id,
        action: 'CREATE',
        tableName: 'llm_interactions',
        recordId: dto.patientId ?? req.user!.id,
        newData: {
          patientId: dto.patientId ?? null,
          labOrderCount: payload.drafts.labOrders.length,
          referralCount: payload.drafts.referrals.length,
          followUpCount: payload.drafts.followUps.length,
        },
      });

      res.json(AgenticScribeGenerateDraftsResponseSchema.parse(payload));
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/tasks/from-drafts',
  requireRoles(['clinician', 'admin', 'superadmin']),
  requireModuleWrite(MODULE_KEYS.AGENTIC_AI_SCRIBE),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = AgenticScribeCreateTasksRequestSchema.parse(req.body);
      const auth = buildAuthContext(req, dto.patientId ?? undefined);

      if (dto.patientId) {
        await requirePatientRelationship(auth, dto.patientId);
      }

      const createdTasks: Array<{ id: string; draftType: 'lab_order' | 'referral' | 'follow_up'; draftId: string; title: string }> = [];

      for (const item of dto.items) {
        const created = await taskService.createTask(auth, {
          patientId: dto.patientId,
          episodeId: dto.episodeId,
          assignedToId: dto.assignedToId,
          title: item.title,
          description: item.description,
          dueDate: item.dueDate,
          priority: item.priority,
        });
        createdTasks.push({
          id: created.id,
          draftType: item.draftType,
          draftId: item.draftId,
          title: created.title,
        });
      }

      await writeAuditLog({
        clinicId: req.clinicId!,
        actorId: req.user!.id,
        action: 'CREATE',
        tableName: 'tasks',
        recordId: createdTasks[0]?.id ?? req.user!.id,
        newData: {
          patientId: dto.patientId ?? null,
          count: createdTasks.length,
          draftTypes: createdTasks.map((t) => t.draftType),
        },
      });

      res.status(201).json(AgenticScribeCreateTasksResponseSchema.parse({ createdTasks }));
    } catch (err) {
      next(err);
    }
  },
);

export default router;
