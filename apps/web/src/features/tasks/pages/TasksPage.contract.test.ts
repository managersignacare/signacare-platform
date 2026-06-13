import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('TasksPage monitoring snapshot contract', () => {
  const source = readFileSync(resolve(__dirname, './TasksPage.tsx'), 'utf8');

  it('persists scope-specific monitoring collapse preferences', () => {
    expect(source).toContain('TASK_MONITORING_COLLAPSE_KEY');
    expect(source).toContain('serializeTaskMonitoringCollapseState');
    expect(source).toContain("const [monitoringCollapsedByScope, setMonitoringCollapsedByScope] = useState<TaskMonitoringCollapseState>(loadTaskMonitoringCollapseState);");
  });

  it('defaults my monitoring snapshot to the collapsible panel path', () => {
    expect(source).toContain("collapsed={monitoringCollapsedByScope[scope]}");
    expect(source).toContain("title={scope === 'my' ? 'My monitoring snapshot' : 'Team monitoring snapshot'}");
    expect(source).toContain("{props.collapsed ? 'Expand' : 'Minimise'}");
    expect(source).toContain('<Collapse in={!props.collapsed}>');
  });
});
