import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('scribe runtime labels contract', () => {
  const runtimePanelSource = readFileSync(
    resolve(__dirname, '..', 'components', 'PowerAiRuntimePanel.tsx'),
    'utf8',
  );
  const recorderControlsSource = readFileSync(
    resolve(__dirname, '..', '..', 'patients', 'components', 'notes', 'AmbientRecorderControls.tsx'),
    'utf8',
  );

  it('labels the clinic runtime mode selector around Medical Scribe', () => {
    expect(runtimePanelSource).toContain('label="Preferred Scribe Mode"');
    expect(runtimePanelSource).toContain('Medical Scribe');
    expect(runtimePanelSource).toContain('Medical Scribe + Drafting');
    expect(runtimePanelSource).not.toContain('Regular Scribe');
    expect(runtimePanelSource).not.toContain('Agentic Scribe');
  });

  it('labels the recorder hand-off button as a drafting action instead of agentic jargon', () => {
    expect(recorderControlsSource).toContain('Draft Actions');
    expect(recorderControlsSource).toContain('Open Medical Scribe Drafting');
    expect(recorderControlsSource).not.toContain('Open Agentic AI');
  });
});
