import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('AmbientAiRecorder default template contract', () => {
  const source = readFileSync(resolve(__dirname, './AmbientAiRecorder.tsx'), 'utf8');

  it('defaults the Medical Scribe format to progress notes', () => {
    expect(source).toContain("const [format, setFormat] = useState<AmbientFormat>('progress');");
  });
});
