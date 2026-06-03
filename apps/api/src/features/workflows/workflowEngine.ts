/**
 * Workflow Engine — executes configured workflow steps when trigger events fire.
 *
 * Subscribes to workflowEvents, loads matching active workflows for the clinic,
 * and executes each step sequentially. Results are logged to workflow_executions.
 */
import { v4 as uuidv4 } from 'uuid';
import { db } from '../../db/db';
import { logger } from '../../utils/logger';
import { workflowEvents, TRIGGER_EVENTS, type WorkflowTriggerData } from './workflowEvents';

interface WorkflowStep {
  order: number;
  type: string;
  params: Record<string, unknown>;
}

interface WorkflowStepResult {
  step: number;
  type: string;
  ok: boolean;
  result?: string;
  error?: string;
}

type WorkflowTriggerHandler = (data: WorkflowTriggerData) => void | Promise<void>;

// ── Step Executors ───────────────────────────────────────────────────────────

async function executeStep(step: WorkflowStep, data: WorkflowTriggerData): Promise<{ ok: boolean; result?: string; error?: string }> {
  try {
    switch (step.type) {
      case 'create_task': {
        const p = step.params;
        // Tasks DB schema: assigned_by_id (not created_by_id).
        await db('tasks').insert({
          id: uuidv4(),
          clinic_id: data.clinicId,
          patient_id: data.patientId ?? null,
          episode_id: data.episodeId ?? null,
          title: (p.title as string) ?? 'Auto-generated task',
          description: (p.description as string) ?? `Triggered by workflow: ${step.type}`,
          priority: (p.priority as string) ?? 'medium',
          status: 'pending',
          task_type: (p.taskType as string) ?? 'follow-up',
          assigned_to_id: (p.assigneeId as string) ?? null,
          assigned_by_id: data.staffId ?? null,
          created_at: new Date(),
          updated_at: new Date(),
        });
        return { ok: true, result: `Task created: ${p.title}` };
      }

      case 'create_episode': {
        const p = step.params;
        await db('episodes').insert({
          id: uuidv4(),
          clinic_id: data.clinicId,
          patient_id: data.patientId!,
          episode_type: (p.episodeType as string) ?? 'community',
          team_id: (p.teamId as string) ?? null,
          status: 'open',
          start_date: new Date().toISOString().split('T')[0],
          created_at: new Date(),
          updated_at: new Date(),
        });
        return { ok: true, result: `Episode created: ${p.episodeType}` };
      }

      case 'assign_team': {
        const p = step.params;
        if (data.patientId && p.orgUnitId) {
          // @code-columns-exempt: pre-R2 drift on patient_team_assignments: clinic_id. Baseline 20260701000000 is the fix.
          await db('patient_team_assignments')
            .insert({
              id: uuidv4(),
              clinic_id: data.clinicId,
              patient_id: data.patientId,
              org_unit_id: p.orgUnitId as string,
              is_active: true,
              created_at: new Date(),
              updated_at: new Date(),
            })
            .onConflict(['patient_id', 'org_unit_id'])
            .merge({ is_active: true, updated_at: new Date() });
        }
        return { ok: true, result: `Team assigned: ${p.orgUnitId}` };
      }

      case 'create_alert': {
        const p = step.params;
        // @code-columns-exempt: pre-R2 drift on patient_flags: message, is_active, show_in_summary, acknowledged. Baseline 20260701000000 is the fix.
        await db('patient_flags').insert({
          id: uuidv4(),
          clinic_id: data.clinicId,
          patient_id: data.patientId!,
          category: (p.category as string) ?? 'workflow_alert',
          severity: (p.severity as string) ?? 'medium',
          message: (p.message as string) ?? 'Workflow-generated alert',
          is_active: true,
          show_in_summary: true,
          acknowledged: false,
          raised_by_staff_id: data.staffId ?? null,
          created_at: new Date(),
          updated_at: new Date(),
        }).onConflict().ignore();
        return { ok: true, result: `Alert created: ${p.category}` };
      }

      case 'send_notification': {
        const p = step.params;
        // Create in-app notification via messages table
        await db('notifications').insert({
          id: uuidv4(),
          clinic_id: data.clinicId,
          recipient_staff_id: (p.recipientId as string) ?? null,
          title: (p.title as string) ?? 'Workflow notification',
          body: (p.message as string) ?? '',
          type: 'workflow',
          is_read: false,
          created_at: new Date(),
        }).catch(() => { /* notifications table may not exist */ });
        return { ok: true, result: `Notification sent: ${p.title}` };
      }

      case 'update_status': {
        const p = step.params;
        const table = p.table as string;
        const field = p.field as string;
        const value = p.value as string;
        const recordId = (p.recordId as string) ?? data.episodeId ?? data.referralId;
        if (table && field && value && recordId) {
          await db(table).where({ id: recordId, clinic_id: data.clinicId }).update({ [field]: value, updated_at: new Date() });
        }
        return { ok: true, result: `Updated ${table}.${field} = ${value}` };
      }

      case 'present_checklist': {
        const p = step.params;
        const triggerPoint = (p.triggerPoint as string) ?? 'custom';
        // Find checklist template for this trigger point
        const template = await db('checklist_templates')
          .where({ clinic_id: data.clinicId, trigger_point: triggerPoint, is_active: true })
          .first()
          .catch((err) => { logger.warn({ err }, 'workflowEngine: op failed — returning null'); return null; });
        if (!template) return { ok: true, result: `No checklist template for ${triggerPoint} — skipped` };
        // Create a checklist instance for the patient
        const items = typeof template.items === 'string' ? JSON.parse(template.items) : (template.items ?? []);
        await db('checklist_instances').insert({
          id: uuidv4(),
          clinic_id: data.clinicId,
          template_id: template.id,
          patient_id: data.patientId!,
          episode_id: data.episodeId ?? null,
          status: 'in_progress',
          checked_items: JSON.stringify({}),
          total_items: items.length,
          completed_items: 0,
          created_at: new Date(),
          updated_at: new Date(),
        }).catch(() => { /* table may not exist */ });
        // Also create a task for the clinician to complete the checklist.
        // Tasks DB schema: assigned_by_id (not created_by_id) — this
        // workflow creates the task on behalf of the staff member so
        // assigned_by_id records the workflow trigger actor.
        await db('tasks').insert({
          id: uuidv4(),
          clinic_id: data.clinicId,
          patient_id: data.patientId ?? null,
          episode_id: data.episodeId ?? null,
          title: `Complete Checklist: ${template.name}`,
          description: `A ${template.name} checklist has been created and requires completion.`,
          priority: template.enforcement === 'mandatory' ? 'high' : 'medium',
          status: 'pending',
          task_type: 'checklist',
          assigned_to_id: data.staffId ?? null,
          assigned_by_id: data.staffId ?? null,
          created_at: new Date(),
          updated_at: new Date(),
        });
        return { ok: true, result: `Checklist created: ${template.name} (${items.length} items)` };
      }

      default:
        return { ok: false, error: `Unknown step type: ${step.type}` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message || 'Step execution failed' };
  }
}

// ── Engine ────────────────────────────────────────────────────────────────────

async function runWorkflow(workflowId: string, clinicId: string, steps: WorkflowStep[], data: WorkflowTriggerData): Promise<void> {
  const executionId = uuidv4();
  const sortedSteps = [...steps].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  try {
    await db('workflow_executions').insert({
      id: executionId,
      clinic_id: clinicId,
      workflow_id: workflowId,
      trigger_data: JSON.stringify(data),
      status: 'running',
      steps_completed: 0,
      total_steps: sortedSteps.length,
      started_at: new Date(),
    });
  } catch (err) {
    // BUG-517 — workflow_executions INSERT failed. Most likely cause
    // is the table not existing yet (first-deploy migration ordering)
    // but that's a load-bearing operator signal — silent skip means
    // workflow runs are invisible until ops manually inspect logs.
    // Workflow execution still skipped (must-not-block per existing
    // semantic) but the unavailability is now observable.
    logger.warn(
      { err, kind: 'workflow_executions_table_unavailable', workflowId, clinicId, executionId },
      'BUG-517: workflow_executions INSERT failed; table may not exist yet — check migrations. Workflow execution skipped.',
    );
    return;
  }

  const results: WorkflowStepResult[] = [];
  let completed = 0;

  for (const step of sortedSteps) {
    const result = await executeStep(step, data);
    results.push({ step: step.order, type: step.type, ...result });
    if (result.ok) completed++;
    else {
      // Stop on failure
      await db('workflow_executions').where({ id: executionId, clinic_id: clinicId }).update({
        status: 'failed',
        steps_completed: completed,
        error_message: result.error,
        step_results: JSON.stringify(results),
        completed_at: new Date(),
      }).catch(err => { logger.warn({ err }, 'Workflow action failed'); });
      logger.warn({ workflowId, step: step.order, error: result.error }, '[Workflow] Step failed');
      return;
    }
  }

  await db('workflow_executions').where({ id: executionId, clinic_id: clinicId }).update({
    status: 'completed',
    steps_completed: completed,
    step_results: JSON.stringify(results),
    completed_at: new Date(),
  }).catch(err => { logger.warn({ err }, 'Workflow action failed'); });

  logger.info({ workflowId, steps: completed }, '[Workflow] Completed successfully');
}

// ── Subscribe to all trigger events ──────────────────────────────────────────

// Phase 0.7.2: Handler registry so listeners can be removed on
// graceful shutdown. Without this, every restart adds 18 new
// listeners (one per TRIGGER_EVENT) that are never removed —
// memory leak under rolling deploys.
const handlerRegistry = new Map<string, WorkflowTriggerHandler>();

export function startWorkflowEngine(): void {
  // Clean up any prior handlers (hot-reload, restart)
  stopWorkflowEngine();

  for (const event of TRIGGER_EVENTS) {
    const handler = async (data: WorkflowTriggerData) => {
      try {
        const workflows = await db('workflows')
          .where({ clinic_id: data.clinicId, trigger_event: event, is_active: true })
          .whereNull('deleted_at');

        for (const wf of workflows) {
          const steps: WorkflowStep[] = typeof wf.steps === 'string' ? JSON.parse(wf.steps) : (wf.steps ?? []);
          if (steps.length > 0) {
            runWorkflow(wf.id, data.clinicId, steps, data).catch(runErr => {
              const message = runErr instanceof Error ? runErr.message : String(runErr);
              logger.error({ err: runErr, message, workflowId: wf.id }, '[Workflow] Execution error');
            });
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ err, message, event }, '[Workflow] Failed to load workflows');
      }
    };

    handlerRegistry.set(event, handler);
    workflowEvents.on(event, handler);
  }
  logger.info(`[Workflow] Engine started — listening for ${TRIGGER_EVENTS.length} events`);
}

export function stopWorkflowEngine(): void {
  for (const [event, handler] of handlerRegistry) {
    workflowEvents.removeListener(event, handler);
  }
  handlerRegistry.clear();
}
