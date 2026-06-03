import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthContext } from '@signacare/shared';

vi.mock('../../src/features/tasks/taskRepository', () => ({
  findById: vi.fn(),
}));

vi.mock('../../src/shared/authGuards', () => ({
  requirePatientRelationship: vi.fn(async () => {}),
}));

vi.mock('../../src/features/tasks/taskMutationCommand', () => ({
  executeTaskCreateMutation: vi.fn(),
  executeTaskUpdateMutation: vi.fn(),
  executeTaskDeleteMutation: vi.fn(),
}));

import * as taskRepo from '../../src/features/tasks/taskRepository';
import { requirePatientRelationship } from '../../src/shared/authGuards';
import { executeTaskUpdateMutation } from '../../src/features/tasks/taskMutationCommand';
import { updateTask } from '../../src/features/tasks/taskService';
import { AppError } from '../../src/shared/errors';

const auth: AuthContext = {
  clinicId: '11111111-1111-1111-1111-111111111111',
  staffId: '22222222-2222-2222-2222-222222222222',
  role: 'clinician',
};

describe('taskService optimistic lock bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes current lock_version into executeTaskUpdateMutation', async () => {
    vi.mocked(taskRepo.findById).mockResolvedValue({
      id: 'task-1',
      clinic_id: auth.clinicId,
      patient_id: '33333333-3333-3333-3333-333333333333',
      lock_version: 7,
      title: 'T',
      priority: 'medium',
      status: 'pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      assigned_by_id: auth.staffId,
    } as never);
    vi.mocked(executeTaskUpdateMutation).mockResolvedValue({
      id: 'task-1',
      clinic_id: auth.clinicId,
      assigned_by_id: auth.staffId,
      title: 'Updated',
      description: null,
      priority: 'high',
      status: 'pending',
      patient_id: null,
      episode_id: null,
      assigned_to_id: null,
      due_date: null,
      completed_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      created_by_staff_name: 'Staff A',
      assigned_to_staff_name: null,
      patient_name: null,
    } as never);

    await updateTask(auth, 'task-1', { priority: 'high' });

    expect(vi.mocked(requirePatientRelationship)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(executeTaskUpdateMutation)).toHaveBeenCalledWith(
      expect.objectContaining({
        clinicId: auth.clinicId,
        actorStaffId: auth.staffId,
        taskId: 'task-1',
        expectedLockVersion: 7,
      }),
    );
  });

  it('throws TASK_LOCK_VERSION_MISSING when lock_version is absent', async () => {
    vi.mocked(taskRepo.findById).mockResolvedValue({
      id: 'task-1',
      clinic_id: auth.clinicId,
      patient_id: null,
      title: 'T',
      priority: 'medium',
      status: 'pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      assigned_by_id: auth.staffId,
    } as never);

    await expect(updateTask(auth, 'task-1', { status: 'completed' })).rejects.toMatchObject({
      code: 'TASK_LOCK_VERSION_MISSING',
      status: 500,
    } satisfies Partial<AppError>);
    expect(vi.mocked(executeTaskUpdateMutation)).not.toHaveBeenCalled();
  });
});
