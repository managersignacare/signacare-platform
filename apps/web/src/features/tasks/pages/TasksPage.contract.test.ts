import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('TasksPage workbench summary contract', () => {
  const source = readFileSync(resolve(__dirname, './TasksPage.tsx'), 'utf8');

  it('shows bucket chips and count chips on the primary workbench surface', () => {
    expect(source).toContain('Workbench buckets');
    expect(source).toContain('buildMonitoringCards(summary).map((card) => (');
    expect(source).toContain('label={`${card.label}: ${card.value}`}');
  });

  it('does not keep the old collapsible monitoring snapshot panel', () => {
    expect(source).not.toContain('My monitoring snapshot');
    expect(source).not.toContain('TASK_MONITORING_COLLAPSE_KEY');
    expect(source).not.toContain('<Collapse in={!props.collapsed}>');
  });
});
