/**
 * Phase 3 async-routing hardening — unit coverage for the durable-job
 * guard that fires on the synchronous /llm/clinical-ai endpoint.
 *
 * Why this test exists (in addition to the integration test that
 * exercises the full HTTP path):
 *
 *  - The integration test requires a live Postgres / Redis / login
 *    and therefore only runs in the integration job. The unit test
 *    runs in every contributor's pre-push.
 *  - The 14 operator-mandated long-action set must be deterministically
 *    blocked from sync execution. We assert each one fires AppError 409
 *    `AI_ACTION_REQUIRES_ASYNC_JOB` with the canonical recommendedEndpoint.
 *  - We also assert that non-durable lightweight actions (`chat`,
 *    arbitrary free-form classifiers) DO NOT fire the guard — Phase 3
 *    must not break bounded synchronous utilities.
 */
import { describe, expect, it } from 'vitest';
import {
  ASYNC_REQUIRED_CLINICAL_AI_ERROR_CODE,
  DURABLE_CLINICAL_AI_JOB_ACTIONS,
  PATIENT_SCOPED_ASYNC_REQUIRED_CLINICAL_AI_ACTIONS,
  UNCONDITIONAL_ASYNC_REQUIRED_CLINICAL_AI_ACTIONS,
  type DurableClinicalAiJobAction,
} from '@signacare/shared';
import { AppError } from '../../shared/errors';
import { assertSyncClinicalAiRouteAllowed } from './asyncClinicalAiGuard';

// Operator-mandated long-action set (Phase 3 hard constraint #1).
// Any change to this list is an operator decision, not a contributor
// shortcut — keep it pinned literally so a future contributor cannot
// silently drop an action without operator sign-off.
const OPERATOR_LONG_ACTIONS = [
  'maudsley',
  'isbar',
  'report-insight',
  'handover-summary',
  'medication-adherence',
  'ect-summary',
  'mhrt-report',
  'lifechart-schema',
  'linkages',
  'med-summary',
  'register-summary',
  'risk-summary',
  'certificate',
  'admin-report',
  'discharge',
  'formulation',
] as const satisfies readonly DurableClinicalAiJobAction[];

const SAMPLE_PATIENT_ID = '11111111-1111-1111-1111-111111111111';

function assertThrowsAsyncGuard(action: string, patientId?: string): AppError {
  try {
    assertSyncClinicalAiRouteAllowed(action, patientId);
  } catch (err) {
    if (err instanceof AppError) return err;
    throw err;
  }
  throw new Error(`Expected assertSyncClinicalAiRouteAllowed('${action}', '${patientId ?? ''}') to throw AppError, but it did not`);
}

describe('asyncClinicalAiGuard — operator-mandated long actions', () => {
  it.each(OPERATOR_LONG_ACTIONS)(
    "blocks '%s' from the sync clinical-ai endpoint",
    (action) => {
      // Most operator-mandated actions are patient-scoped; pass a patient
      // id so the patient-scoped subset fires. Unconditional-async actions
      // (admin-report, handover-summary) fire regardless.
      const err = assertThrowsAsyncGuard(action, SAMPLE_PATIENT_ID);
      expect(err.status).toBe(409);
      expect(err.code).toBe(ASYNC_REQUIRED_CLINICAL_AI_ERROR_CODE);
      expect(err.details).toMatchObject({
        action,
        recommendedEndpoint: '/api/v1/ai/jobs',
      });
      expect(err.message).toContain('/llm/clinical-ai');
    },
  );

  it('blocks every UNCONDITIONAL_ASYNC_REQUIRED action even without a patientId', () => {
    for (const action of UNCONDITIONAL_ASYNC_REQUIRED_CLINICAL_AI_ACTIONS) {
      const err = assertThrowsAsyncGuard(action);
      expect(err.status).toBe(409);
      expect(err.code).toBe(ASYNC_REQUIRED_CLINICAL_AI_ERROR_CODE);
      expect(err.details).toMatchObject({ action, recommendedEndpoint: '/api/v1/ai/jobs' });
    }
  });

  it('blocks every PATIENT_SCOPED_ASYNC_REQUIRED action when a patientId is supplied', () => {
    for (const action of PATIENT_SCOPED_ASYNC_REQUIRED_CLINICAL_AI_ACTIONS) {
      const err = assertThrowsAsyncGuard(action, SAMPLE_PATIENT_ID);
      expect(err.status).toBe(409);
      expect(err.code).toBe(ASYNC_REQUIRED_CLINICAL_AI_ERROR_CODE);
    }
  });

  it('allows PATIENT_SCOPED_ASYNC_REQUIRED actions when no patientId is present (bounded utility branch)', () => {
    // Some patient-scoped durable actions can run synchronously as a
    // utility when the caller has no patient context — e.g. the AI Agent
    // free-form chat surface (apps/web/src/features/ai-agent/) which
    // selects a long action label but has not bound a patient. The guard
    // must NOT throw in that branch; the runtime branching on the client
    // and the AiAgentPage tests cover the higher-level invariant.
    for (const action of PATIENT_SCOPED_ASYNC_REQUIRED_CLINICAL_AI_ACTIONS) {
      // Skip actions that are also in UNCONDITIONAL_ASYNC (those should still fail).
      if (UNCONDITIONAL_ASYNC_REQUIRED_CLINICAL_AI_ACTIONS.includes(action as never)) continue;
      expect(() => assertSyncClinicalAiRouteAllowed(action, undefined)).not.toThrow();
    }
  });
});

describe('asyncClinicalAiGuard — bounded lightweight utilities', () => {
  it('does NOT block free-form / non-durable actions', () => {
    // These are non-clinical short prompts that legitimately run via the
    // sync /llm/clinical-ai endpoint. They are NOT in the durable closed
    // list and must continue to work without async-job ceremony.
    const bounded = ['chat', 'generic-helper', 'lightweight-classifier'] as const;
    for (const action of bounded) {
      expect(() => assertSyncClinicalAiRouteAllowed(action)).not.toThrow();
      expect(() => assertSyncClinicalAiRouteAllowed(action, SAMPLE_PATIENT_ID)).not.toThrow();
    }
  });
});

describe('asyncClinicalAiGuard — operator list ⊆ DURABLE closed list', () => {
  it('every operator-mandated long action is registered in the shared DURABLE_CLINICAL_AI_JOB_ACTIONS closed list', () => {
    const durable = new Set<string>(DURABLE_CLINICAL_AI_JOB_ACTIONS);
    const missing = OPERATOR_LONG_ACTIONS.filter((a) => !durable.has(a));
    expect(missing).toEqual([]);
  });
});
