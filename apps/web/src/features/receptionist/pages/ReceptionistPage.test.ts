// BUG-445 — ReceptionistPage bulk-SMS fabricated success
//
// Pre-fix `sendBulkReminders` (apps/web/src/features/receptionist/pages/
// ReceptionistPage.tsx:521-534) had `} catch { setResult({sent:0,
// failed:0, message:'Bulk reminders will be sent via in-app
// notifications…'}) }`. Because `failed===0`, the Alert at lines
// 563-569 rendered `severity='success'` (green) with literal "Campaign
// created" — clinician believed messages queued when they had failed.
// P0 patient-safety: missed appointment reminders → missed clinical
// care.
//
// Pre-fix RED gate: BS-2 fails (pre-fix returns `failed:0` not
// `failed:withPhoneCount`).
//
// Post-fix: 5/5 GREEN.

import { describe, it, expect } from 'vitest';
import {
  computeBulkResult,
  computeBulkResultOnError,
  bulkResultSeverity,
} from './ReceptionistPage';

describe('BUG-445 — ReceptionistPage bulk-SMS result honesty', () => {
  it('BS-1 — happy path: server returns sentCount/failedCount → severity success', () => {
    const r = computeBulkResult({ sentCount: 5, failedCount: 0 }, 5);
    expect(r.sent).toBe(5);
    expect(r.failed).toBe(0);
    expect(bulkResultSeverity(r)).toBe('success');
  });

  it('BS-2 — server failure: catch sets failed=withPhone.length + error severity (PRE-FIX RED)', () => {
    const r = computeBulkResultOnError(new Error('Network Error'), 5);
    expect(r.sent).toBe(0);
    expect(r.failed).toBe(5);
    expect(r.message).toBe('Failed to send reminders: Network Error');
    expect(bulkResultSeverity(r)).toBe('error');
  });

  it('BS-3 — partial failure: any failed count renders error severity (not warning)', () => {
    const r = computeBulkResult({ sentCount: 3, failedCount: 2 }, 5);
    expect(r.sent).toBe(3);
    expect(r.failed).toBe(2);
    expect(bulkResultSeverity(r)).toBe('error');
  });

  it('BS-4 — legacy server shape sent/failed (without Count suffix) is honoured', () => {
    const r = computeBulkResult({ sent: 4, failed: 1 }, 5);
    expect(r.sent).toBe(4);
    expect(r.failed).toBe(1);
    expect(bulkResultSeverity(r)).toBe('error');
  });

  it('BS-5 — non-Error throw flows through String(err)', () => {
    const r = computeBulkResultOnError('boom', 3);
    expect(r.sent).toBe(0);
    expect(r.failed).toBe(3);
    expect(r.message).toBe('Failed to send reminders: boom');
    expect(bulkResultSeverity(r)).toBe('error');
  });
});
