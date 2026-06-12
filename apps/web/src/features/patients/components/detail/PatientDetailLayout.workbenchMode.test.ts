import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('PatientDetailLayout workbench controls', () => {
  const source = readFileSync(resolve(__dirname, './PatientDetailLayout.tsx'), 'utf8');

  it('keeps balanced as the internal default mode', () => {
    expect(source).toContain("useState<WorkbenchMode>('balanced')");
  });

  it('does not render a visible Balanced chip', () => {
    expect(source).not.toContain('label="Balanced"');
  });

  it('toggles focus and review chips back to balanced mode', () => {
    expect(source).toContain("const toggleWorkbenchMode = (nextMode: Exclude<WorkbenchMode, 'balanced'>) => {");
    expect(source).toContain("currentMode === nextMode ? 'balanced' : nextMode");
    expect(source).toContain("onClick={() => toggleWorkbenchMode('focus')}");
    expect(source).toContain("onClick={() => toggleWorkbenchMode('review')}");
  });
});
