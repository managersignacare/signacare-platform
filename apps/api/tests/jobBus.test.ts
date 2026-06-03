/**
 * S2.3 — JobBus facade unit tests
 *
 * Verifies the InMemoryJobBus and the singleton wiring. The
 * BullMqJobBus class needs a real Redis instance to exercise and is
 * covered by the integration suite (or by the existing BullMQ workers
 * which already exercise the same `Queue.add` code path).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Stub the logger so test output stays clean
vi.mock('../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Stub the config import — jobBus.ts reads REDIS_URL through `config`
vi.mock('../src/config', () => ({
  config: { REDIS_URL: 'redis://localhost:6379' },
}));

import { InMemoryJobBus, jobBus } from '../src/shared/jobBus';

describe('InMemoryJobBus', () => {
  let bus: InMemoryJobBus;

  beforeEach(() => {
    bus = new InMemoryJobBus();
  });

  it('records enqueued jobs in order', async () => {
    await bus.enqueue('email', { to: 'a@example.com' });
    await bus.enqueue('email', { to: 'b@example.com' }, { delay: 5_000 });
    await bus.enqueue('test-queue', { to: '+61400000000' });

    const all = bus.dump();
    expect(all).toHaveLength(3);
    expect(all[0]).toMatchObject({ queueName: 'email', data: { to: 'a@example.com' } });
    expect(all[1]).toMatchObject({ queueName: 'email', data: { to: 'b@example.com' } });
    expect(all[1].opts?.delay).toBe(5_000);
    expect(all[2]).toMatchObject({ queueName: 'test-queue' });
  });

  it('dump(name) returns only the matching queue', async () => {
    await bus.enqueue('email', { id: 1 });
    await bus.enqueue('test-queue', { id: 2 });
    await bus.enqueue('email', { id: 3 });

    expect(bus.dump('email')).toHaveLength(2);
    expect(bus.dump('test-queue')).toHaveLength(1);
    expect(bus.dump('nonexistent')).toHaveLength(0);
  });

  it('reset() clears the job log', async () => {
    await bus.enqueue('email', { id: 1 });
    expect(bus.dump()).toHaveLength(1);
    bus.reset();
    expect(bus.dump()).toHaveLength(0);
  });

  it('removeByMatch() removes only matching jobs from the target queue', async () => {
    await bus.enqueue('email', {
      type: 'appointment_reminder',
      clinicId: 'clinic-1',
      appointmentId: 'appt-1',
    });
    await bus.enqueue('email', {
      type: 'appointment_reminder',
      clinicId: 'clinic-1',
      appointmentId: 'appt-2',
    });
    await bus.enqueue('patient-outreach', {
      kind: 'appointment_reminder',
      clinicId: 'clinic-1',
      appointmentId: 'appt-1',
    });

    const removed = await bus.removeByMatch('email', {
      type: 'appointment_reminder',
      clinicId: 'clinic-1',
      appointmentId: 'appt-1',
    });

    expect(removed).toBe(1);
    const emailJobs = bus.dump('email');
    expect(emailJobs).toHaveLength(1);
    expect(emailJobs[0]?.data['appointmentId']).toBe('appt-2');
    expect(bus.dump('patient-outreach')).toHaveLength(1);
  });

  it('dedupes enqueue when queue + jobId pair repeats', async () => {
    await bus.enqueue(
      'email',
      { type: 'appointment_reminder', appointmentId: 'appt-1' },
      { jobId: 'reminder:appt-1:offset-1d', delay: 1000 },
    );
    await bus.enqueue(
      'email',
      { type: 'appointment_reminder', appointmentId: 'appt-1' },
      { jobId: 'reminder:appt-1:offset-1d', delay: 1000 },
    );
    await bus.enqueue(
      'patient-outreach',
      { kind: 'appointment_reminder', appointmentId: 'appt-1' },
      { jobId: 'reminder:appt-1:offset-1d', delay: 1000 },
    );

    expect(bus.dump('email')).toHaveLength(1);
    expect(bus.dump('patient-outreach')).toHaveLength(1);
  });

  it('exposes backendName for diagnostics', () => {
    expect(bus.backendName).toBe('in-memory');
  });
});

describe('jobBus singleton', () => {
  it('uses the InMemoryJobBus when NODE_ENV=test', () => {
    expect(jobBus.backendName).toBe('in-memory');
  });
});
