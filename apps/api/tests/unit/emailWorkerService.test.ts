import { describe, expect, it, vi } from 'vitest';
import {
  processEmailJobData,
  PermanentEmailJobError,
  type EmailWorkerDeps,
  type EmailJobData,
} from '../../src/jobs/workers/emailWorkerService';

function makeDeps(overrides: Partial<EmailWorkerDeps> = {}): EmailWorkerDeps {
  return {
    findStaffRecipient: vi.fn(),
    findPatientRecipient: vi.fn(),
    canSendAppointmentReminder: vi.fn(async () => true),
    canUseSmtp: vi.fn(() => true),
    sendSmtp: vi.fn(async () => {}),
    sendOutlook: vi.fn(async () => {}),
    logInfo: vi.fn(),
    logWarn: vi.fn(),
    ...overrides,
  };
}

describe('emailWorkerService', () => {
  it('sends staff notifications via SMTP when configured', async () => {
    const deps = makeDeps({
      findStaffRecipient: vi.fn(async () => ({
        email: 'staff.one@demo.local',
        displayName: 'Staff One',
        staffId: 'staff-1',
      })),
      canUseSmtp: vi.fn(() => true),
    });
    const job: EmailJobData = {
      type: 'staff_notification',
      clinicId: 'clinic-1',
      staffId: 'staff-1',
      title: 'New referral',
      body: 'Please review referral R-100',
      severity: 'warning',
      category: 'referral',
    };

    const out = await processEmailJobData(job, deps);

    expect(out.delivered).toBe(true);
    expect(out.provider).toBe('smtp');
    expect(deps.sendSmtp).toHaveBeenCalledTimes(1);
    expect(deps.sendOutlook).not.toHaveBeenCalled();
  });

  it('falls back to Outlook for staff notifications when SMTP is unavailable', async () => {
    const deps = makeDeps({
      findStaffRecipient: vi.fn(async () => ({
        email: 'staff.two@demo.local',
        displayName: 'Staff Two',
        staffId: 'staff-2',
      })),
      canUseSmtp: vi.fn(() => false),
    });
    const job: EmailJobData = {
      type: 'staff_notification',
      clinicId: 'clinic-1',
      staffId: 'staff-2',
      title: 'Critical alert',
      body: 'Action required now',
      severity: 'critical',
      category: 'pathology',
    };

    const out = await processEmailJobData(job, deps);

    expect(out.delivered).toBe(true);
    expect(out.provider).toBe('outlook');
    expect(deps.sendOutlook).toHaveBeenCalledTimes(1);
    expect(deps.sendSmtp).not.toHaveBeenCalled();
  });

  it('requires SMTP for patient reminders', async () => {
    const deps = makeDeps({
      findPatientRecipient: vi.fn(async () => ({
        email: 'patient.one@demo.local',
        displayName: 'Patient One',
      })),
      canUseSmtp: vi.fn(() => false),
    });
    const job: EmailJobData = {
      type: 'appointment_reminder',
      clinicId: 'clinic-1',
      patientId: 'patient-1',
      appointmentId: 'appt-1',
      body: 'Your review is due',
    };

    await expect(processEmailJobData(job, deps)).rejects.toBeInstanceOf(PermanentEmailJobError);
    expect(deps.sendSmtp).not.toHaveBeenCalled();
    expect(deps.sendOutlook).not.toHaveBeenCalled();
  });

  it('suppresses reminder when appointment is no longer eligible', async () => {
    const deps = makeDeps({
      canSendAppointmentReminder: vi.fn(async () => false),
    });
    const job: EmailJobData = {
      type: 'appointment_reminder',
      clinicId: 'clinic-1',
      patientId: 'patient-1',
      appointmentId: 'appt-cancelled',
      body: 'Reminder',
    };

    await expect(processEmailJobData(job, deps)).rejects.toBeInstanceOf(PermanentEmailJobError);
    expect(deps.sendSmtp).not.toHaveBeenCalled();
  });

  it('sends billing notices to patient recipients via SMTP', async () => {
    const deps = makeDeps({
      findPatientRecipient: vi.fn(async () => ({
        email: 'patient.billing@demo.local',
        displayName: 'Patient Billing',
      })),
      canUseSmtp: vi.fn(() => true),
    });
    const job: EmailJobData = {
      type: 'billing_notice',
      clinicId: 'clinic-1',
      patientId: 'patient-1',
      invoiceId: 'inv-1',
      paymentId: 'pay-1',
      amountCents: 12500,
      currency: 'aud',
      title: 'Payment receipt — INV-1',
      body: 'We have received your payment.',
    };

    const out = await processEmailJobData(job, deps);
    expect(out.delivered).toBe(true);
    expect(out.provider).toBe('smtp');
    expect(deps.sendSmtp).toHaveBeenCalledTimes(1);
  });

  it('billing_notice requires patientId', async () => {
    const deps = makeDeps({
      canUseSmtp: vi.fn(() => true),
    });
    const job: EmailJobData = {
      type: 'billing_notice',
      clinicId: 'clinic-1',
      body: 'Billing message',
    };

    await expect(processEmailJobData(job, deps)).rejects.toBeInstanceOf(PermanentEmailJobError);
    expect(deps.sendSmtp).not.toHaveBeenCalled();
  });

  it('throws permanent error when recipient is missing', async () => {
    const deps = makeDeps({
      findStaffRecipient: vi.fn(async () => null),
      canUseSmtp: vi.fn(() => true),
    });
    const job: EmailJobData = {
      type: 'staff_notification',
      clinicId: 'clinic-1',
      staffId: 'staff-404',
      body: 'hello',
    };

    await expect(processEmailJobData(job, deps)).rejects.toBeInstanceOf(PermanentEmailJobError);
    expect(deps.sendSmtp).not.toHaveBeenCalled();
  });
});
