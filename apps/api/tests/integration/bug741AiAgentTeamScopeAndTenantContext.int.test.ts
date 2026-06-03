import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dbAdmin } from '../../src/db/db';
import { runAgent } from '../../src/mcp/server/aiAgent';
import { handleToolCall } from '../../src/mcp/server/mcpServer';
import { issueAiDecisionToken } from '../../src/features/ai/policy/aiPolicy';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const READY = await isIntegrationReady();
const TEST_TAG = `BUG-741-${Date.now()}`;

let session: { token: string; clinicId: string; userId: string };
let teamId = '';
let patientId = '';
let episodeId = '';
let authCtx: {
  staffId: string;
  clinicId: string;
  role: string;
  permissions: string[];
};

beforeAll(async () => {
  if (!READY) return;

  session = await loginAsAdmin();
  const staff = await dbAdmin('staff')
    .where({ id: session.userId, clinic_id: session.clinicId })
    .select('role')
    .first();

  authCtx = {
    staffId: session.userId,
    clinicId: session.clinicId,
    role: String(staff?.role ?? 'superadmin'),
    permissions: [],
  };

  teamId = randomUUID();
  patientId = randomUUID();
  episodeId = randomUUID();

  await dbAdmin('org_units').insert({
    id: teamId,
    clinic_id: session.clinicId,
    name: `North Community Team ${TEST_TAG}`,
    level: 'team',
    parent_id: null,
    sort_order: 9999,
    is_active: true,
    created_at: new Date(),
    updated_at: new Date(),
  });

  await dbAdmin('patients').insert({
    id: patientId,
    clinic_id: session.clinicId,
    given_name: 'Agent',
    family_name: TEST_TAG,
    emr_number: `A${Date.now().toString().slice(-7)}`,
    date_of_birth: '1990-01-01',
    created_at: new Date(),
    updated_at: new Date(),
  });

  await dbAdmin('episodes').insert({
    id: episodeId,
    clinic_id: session.clinicId,
    patient_id: patientId,
    episode_type: 'community',
    presenting_problem: TEST_TAG,
    primary_diagnosis: 'Bipolar affective disorder',
    team_id: teamId,
    primary_clinician_id: session.userId,
    status: 'open',
    start_date: new Date(),
    created_at: new Date(),
    updated_at: new Date(),
  });
});

afterAll(async () => {
  if (!READY) return;
  await dbAdmin('episodes').where({ id: episodeId }).del().catch(() => undefined);
  await dbAdmin('patients').where({ id: patientId }).del().catch(() => undefined);
  await dbAdmin('org_units').where({ id: teamId }).del().catch(() => undefined);
});

describe.skipIf(!READY)('BUG-741 — AI agent team scope + tenant context hardening', () => {
  it('returns friendly error for placeholder/invalid team token instead of UUID syntax failure', async () => {
    const result = await handleToolCall(
      { name: 'team_caseload', arguments: { team: 'caseload' } },
      authCtx,
    );

    const body = result.content[0]?.text ?? '';
    expect(result.isError).toBe(true);
    expect(body.toLowerCase()).toContain('team not found');
    expect(body.toLowerCase()).not.toContain('invalid input syntax for type uuid');
  });

  it('rejects placeholder query text safely before any tool dispatch', async () => {
    const result = await runAgent('Team caseload for [team name]', authCtx);
    expect(result.model).toBe('direct-tool');
    expect(result.toolCalls).toHaveLength(0);
    expect(result.answer.toLowerCase()).toContain('remove placeholder');
  });

  it('resolves team by team name and returns caseload rows', async () => {
    const query = `Team caseload for North Community Team ${TEST_TAG}`;
    const result = await runAgent(query, authCtx);

    expect(result.answer).toContain('Team');
    expect(result.answer).toContain('Caseload');
    expect(result.answer).toContain(TEST_TAG);
    expect(result.answer.toLowerCase()).not.toContain('tool error');
  });

  it('returns non-zero organisation patient count in direct-tool path outside request RLS middleware', async () => {
    const result = await runAgent('Organisation statistics', authCtx);
    const answer = result.answer;

    const totalMatch = answer.match(/\*\*Total Patients:\*\*\s*(\d+)/i);
    expect(totalMatch).toBeTruthy();
    const totalPatients = Number(totalMatch?.[1] ?? 0);
    expect(totalPatients).toBeGreaterThan(0);
    expect(answer.toLowerCase()).not.toContain('tool error');
  });

  it('blocks clinic-wide tools when AI scope is patient-bound', async () => {
    const aiScope = { level: 'patient' as const, patientIds: [patientId] };
    const result = await handleToolCall(
      { name: 'team_caseload', arguments: { team: `North Community Team ${TEST_TAG}` } },
      {
        ...authCtx,
        aiPurposeOfUse: 'clinical',
        aiScope,
        aiDecisionToken: issueAiDecisionToken({
          clinicId: authCtx.clinicId,
          staffId: authCtx.staffId,
          role: authCtx.role,
          permissions: authCtx.permissions,
          purposeOfUse: 'clinical',
          scope: aiScope,
        }),
      },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text ?? '').toContain('not allowed in patient-scoped mode');
  });

  it('normalises placeholder team argument to scoped team in team scope mode', async () => {
    const aiScope = {
      level: 'team' as const,
      teamIds: [teamId],
      teamLabels: [`North Community Team ${TEST_TAG}`],
    };
    const result = await handleToolCall(
      { name: 'team_caseload', arguments: { team: 'team name' } },
      {
        ...authCtx,
        aiPurposeOfUse: 'clinical',
        aiScope,
        aiDecisionToken: issueAiDecisionToken({
          clinicId: authCtx.clinicId,
          staffId: authCtx.staffId,
          role: authCtx.role,
          permissions: authCtx.permissions,
          purposeOfUse: 'clinical',
          scope: aiScope,
        }),
      },
    );

    expect(result.isError).not.toBe(true);
    const body = result.content[0]?.text ?? '';
    expect(body).toContain('Team');
    expect(body).toContain('Caseload');
    expect(body).toContain(TEST_TAG);
  });

  it('fails closed when scoped tool call has no valid AI decision token', async () => {
    const result = await handleToolCall(
      { name: 'get_patient_context', arguments: { patientId } },
      {
        ...authCtx,
        aiPurposeOfUse: 'clinical',
        aiScope: { level: 'patient', patientIds: [patientId] },
      },
    );

    expect(result.isError).toBe(true);
    expect((result.content[0]?.text ?? '').toLowerCase()).toContain('policy verification failed');
  });

  it('fails closed when AI decision token permissions do not match caller permissions', async () => {
    const aiScope = { level: 'patient' as const, patientIds: [patientId] };
    const result = await handleToolCall(
      { name: 'get_patient_context', arguments: { patientId } },
      {
        ...authCtx,
        aiPurposeOfUse: 'clinical',
        aiScope,
        aiDecisionToken: issueAiDecisionToken({
          clinicId: authCtx.clinicId,
          staffId: authCtx.staffId,
          role: authCtx.role,
          permissions: ['patient:read'],
          purposeOfUse: 'clinical',
          scope: aiScope,
        }),
      },
    );

    expect(result.isError).toBe(true);
    expect((result.content[0]?.text ?? '').toLowerCase()).toContain('policy verification failed');
  });

  it('auto-injects patientId from single-patient scope for patient tools', async () => {
    const aiScope = { level: 'patient' as const, patientIds: [patientId] };
    const result = await handleToolCall(
      { name: 'get_patient_context', arguments: {} },
      {
        ...authCtx,
        aiPurposeOfUse: 'clinical',
        aiScope,
        aiDecisionToken: issueAiDecisionToken({
          clinicId: authCtx.clinicId,
          staffId: authCtx.staffId,
          role: authCtx.role,
          permissions: authCtx.permissions,
          purposeOfUse: 'clinical',
          scope: aiScope,
        }),
      },
    );

    expect(result.isError).not.toBe(true);
    const body = result.content[0]?.text ?? '';
    expect(body).toContain(`Agent ${TEST_TAG}`);
    expect(body).toContain('EPISODES');
  });
});
