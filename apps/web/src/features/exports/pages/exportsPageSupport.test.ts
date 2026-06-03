import { describe, expect, it } from 'vitest';
import {
  applyClinicalSafeMode,
  flattenRecordForCsv,
  toFlatCsv,
} from './exportsPageSupport';

describe('exportsPageSupport', () => {
  it('drops draft AI notes in clinical-safe mode by default', () => {
    const rows = [
      { id: '1', status: 'draft', noteType: 'ai_longitudinal_summary', isAiDraft: true, content: 'secret' },
      { id: '2', status: 'signed', noteType: 'progress', content: 'short note' },
    ];
    const out = applyClinicalSafeMode('notes', rows, {
      includeDraftAiNotes: false,
      includeLongFreeText: false,
      longTextThreshold: 100,
    });
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('2');
  });

  it('redacts long free text fields when includeLongFreeText is false', () => {
    const out = applyClinicalSafeMode('alerts', [{
      id: 'a1',
      notes: 'x'.repeat(250),
      title: 'Falls risk',
    }], {
      includeDraftAiNotes: false,
      includeLongFreeText: false,
      longTextThreshold: 120,
    });
    expect(out[0].notes).toBe('[REDACTED_LONG_TEXT_250_CHARS]');
    expect(out[0].title).toBe('Falls risk');
  });

  it('retains long text when explicit include is enabled', () => {
    const out = applyClinicalSafeMode('notes', [{
      id: 'n1',
      status: 'signed',
      noteType: 'progress',
      content: 'x'.repeat(220),
    }], {
      includeDraftAiNotes: false,
      includeLongFreeText: true,
      longTextThreshold: 120,
    });
    expect(out[0].content).toHaveLength(220);
  });

  it('flattens nested records for flat CSV rows', () => {
    const row = flattenRecordForCsv({
      id: 'p1',
      scores: { phq9: 18, gad7: 12 },
      flags: ['a', 'b'],
    });
    expect(row.id).toBe('p1');
    expect(row['scores.phq9']).toBe('18');
    expect(row['scores.gad7']).toBe('12');
    expect(row.flags).toBe('a | b');
  });

  it('generates deterministic flat CSV header ordering', () => {
    const csv = toFlatCsv([
      { patient: 'A', patientId: '1', module: 'notes', recordDate: '2026-01-01', 'note.title': 'T1' },
      { patient: 'B', patientId: '2', module: 'alerts', recordDate: '2026-01-02', 'alert.severity': 'high' },
    ]);
    const [header, first] = csv.split('\n');
    expect(header.startsWith('"patient","patientId","module","recordDate"')).toBe(true);
    expect(first.includes('"A"')).toBe(true);
  });
});
