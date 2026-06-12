import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('AppointmentsPage dialog contract', () => {
  const source = readFileSync(resolve(__dirname, './AppointmentsPage.tsx'), 'utf8');

  it('does not render a standalone title field in the new appointment dialog', () => {
    expect(source).not.toContain('label="Title"');
    expect(source).not.toContain("const [title, setTitle] = useState('')");
  });

  it('pins the appointment mode dropdown to the supported four-option set', () => {
    expect(source).toContain("{ value: 'direct', label: 'Direct' }");
    expect(source).toContain("{ value: 'telehealth', label: 'Telehealth' }");
    expect(source).toContain("{ value: 'videoconference', label: 'Videoconference' }");
    expect(source).toContain("{ value: 'other', label: 'Other' }");
  });
});
