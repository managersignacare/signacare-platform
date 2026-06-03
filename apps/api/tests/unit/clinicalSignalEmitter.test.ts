import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/features/notifications/notificationService', () => ({
  notificationService: {
    emit: vi.fn(async () => ({ ids: ['n-1'], published: true })),
  },
}));

import { notificationService } from '../../src/features/notifications/notificationService';
import { emitClinicalSignal } from '../../src/features/events/clinicalSignalEmitter';

describe('clinicalSignalEmitter', () => {
  it('adds source and signal metadata to notification payload', async () => {
    const out = await emitClinicalSignal({
      source: 'messaging',
      signalKey: 'new-message',
      clinicId: 'clinic-1',
      userId: 'staff-1',
      severity: 'info',
      category: 'message',
      title: 'New message',
      payload: { thread_id: 'thread-1' },
    });

    expect(out).toEqual({ ids: ['n-1'], published: true });
    expect(vi.mocked(notificationService.emit)).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          thread_id: 'thread-1',
          signal_source: 'messaging',
          signal_key: 'new-message',
        }),
      }),
    );
  });
});
