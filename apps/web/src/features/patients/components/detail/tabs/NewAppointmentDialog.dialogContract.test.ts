import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Source-level guardrails for the in-patient-detail NewAppointmentDialog.
 *
 * Mirrors the existing AppointmentsPage.dialogContract.test.ts (which
 * guards the top-level /appointments page dialog) for the dialog used
 * inside the patient workbench — so neither dialog regresses on the
 * "title is not a user-input field" + "mode pinned to the four-option
 * enum" contract.
 *
 * The dialog body deliberately does not render a Title input; the
 * display title shown on calendar cells is derived from
 * APPT_TYPE_LABELS[type] (see AppointmentsTab.tsx:147), not user input.
 */
describe('NewAppointmentDialog (patient-detail tab) contract', () => {
  const source = readFileSync(resolve(__dirname, './NewAppointmentDialog.tsx'), 'utf8');

  it('does not render a standalone title field in the appointment dialog', () => {
    expect(source).not.toContain('label="Title"');
    expect(source).not.toContain("const [title, setTitle] = useState('')");
  });

  it('does not carry a user-editable title on the editing prop interface', () => {
    // Guards against the legacy EditableAppointment.title field sneaking
    // back into the interface and misleading callers into thinking
    // appointments have a user-editable title.
    expect(source).not.toMatch(/EditableAppointment[\s\S]*\btitle:\s*string/);
  });

  it('pins the appointment mode dropdown to the supported four-option set', () => {
    expect(source).toContain("{ value: 'direct', label: 'Direct' }");
    expect(source).toContain("{ value: 'telehealth', label: 'Telehealth' }");
    expect(source).toContain("{ value: 'videoconference', label: 'Videoconference' }");
    expect(source).toContain("{ value: 'other', label: 'Other' }");
  });
});
