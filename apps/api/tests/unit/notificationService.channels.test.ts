import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/features/events/ssePublisher', () => ({
  publishClinicEvent: vi.fn(),
  publishUserEvent: vi.fn(),
}));

vi.mock('../../src/integrations/fcm/fcmService', () => ({
  sendToStaff: vi.fn(),
}));

vi.mock('../../src/queues', () => ({
  addJob: vi.fn(),
}));

vi.mock('../../src/features/notifications/notificationRepository', () => ({
  notificationRepository: {
    insertOne: vi.fn(),
    insertMany: vi.fn(),
  },
}));

vi.mock('../../src/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import logger from '../../src/utils/logger';
import * as ssePublisher from '../../src/features/events/ssePublisher';
import * as fcmService from '../../src/integrations/fcm/fcmService';
import * as queueModule from '../../src/queues';
import { notificationRepository } from '../../src/features/notifications/notificationRepository';
import { notificationService } from '../../src/features/notifications/notificationService';

describe('BUG-575 — notificationService email channel fanout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(notificationRepository.insertOne).mockResolvedValue({
      id: 'notif-1',
    } as never);
    vi.mocked(notificationRepository.insertMany).mockResolvedValue([]);
  });

  it('enqueues one email job for a targeted recipient when channel includes email', async () => {
    const result = await notificationService.emit({
      clinicId: 'clinic-1',
      userId: 'staff-1',
      severity: 'critical',
      category: 'pathology',
      title: 'Critical pathology alert',
      body: 'Action required',
      channels: ['bell', 'email'],
      dedupeKey: 'k-1',
    });

    expect(result).toEqual({ ids: ['notif-1'], published: false });
    expect(vi.mocked(notificationRepository.insertOne)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(queueModule.addJob)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(queueModule.addJob)).toHaveBeenCalledWith('email', {
      type: 'staff_notification',
      clinicId: 'clinic-1',
      staffId: 'staff-1',
      notificationId: 'notif-1',
      severity: 'critical',
      category: 'pathology',
      title: 'Critical pathology alert',
      body: 'Action required',
      actionUrl: null,
      dedupeKey: 'k-1',
    });
    expect(vi.mocked(ssePublisher.publishUserEvent)).not.toHaveBeenCalled();
    expect(vi.mocked(ssePublisher.publishClinicEvent)).not.toHaveBeenCalled();
    expect(vi.mocked(fcmService.sendToStaff)).not.toHaveBeenCalled();
  });

  it('fans out email jobs to each explicit userId even when bell channel is off', async () => {
    const result = await notificationService.emit({
      clinicId: 'clinic-2',
      userIds: ['staff-a', 'staff-b'],
      severity: 'warning',
      category: 'mha',
      title: 'Review due',
      channels: ['email'],
    });

    expect(result).toEqual({ ids: [], published: false });
    expect(vi.mocked(notificationRepository.insertOne)).not.toHaveBeenCalled();
    expect(vi.mocked(notificationRepository.insertMany)).not.toHaveBeenCalled();
    expect(vi.mocked(queueModule.addJob)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(queueModule.addJob)).toHaveBeenNthCalledWith(1, 'email', expect.objectContaining({
      clinicId: 'clinic-2',
      staffId: 'staff-a',
      notificationId: null,
    }));
    expect(vi.mocked(queueModule.addJob)).toHaveBeenNthCalledWith(2, 'email', expect.objectContaining({
      clinicId: 'clinic-2',
      staffId: 'staff-b',
      notificationId: null,
    }));
  });

  it('skips clinic-wide email enqueue and logs a warning', async () => {
    const result = await notificationService.emit({
      clinicId: 'clinic-3',
      severity: 'info',
      category: 'system',
      title: 'Clinic broadcast',
      channels: ['email'],
    });

    expect(result).toEqual({ ids: [], published: false });
    expect(vi.mocked(queueModule.addJob)).not.toHaveBeenCalled();
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      { clinicId: 'clinic-3', category: 'system' },
      'notificationService.emit — email channel requested for clinic-wide broadcast; no staff target, skipping enqueue',
    );
  });

  it('does not fail emit when the email enqueue path throws', async () => {
    vi.mocked(queueModule.addJob).mockRejectedValueOnce(new Error('queue down'));

    const result = await notificationService.emit({
      clinicId: 'clinic-4',
      userId: 'staff-4',
      severity: 'critical',
      category: 'pathology',
      title: 'Critical pathology alert',
      channels: ['email'],
    });

    expect(result).toEqual({ ids: [], published: false });
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.objectContaining({ clinicId: 'clinic-4', staffId: 'staff-4', category: 'pathology' }),
      'notificationService.emit — email enqueue failed, continuing',
    );
  });
});
