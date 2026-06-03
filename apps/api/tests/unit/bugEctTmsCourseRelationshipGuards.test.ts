import { describe, expect, test } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ectServiceSource = readFileSync(
  resolve(__dirname, '..', '..', 'src', 'features', 'ect', 'ectService.ts'),
  'utf8',
);
const tmsServiceSource = readFileSync(
  resolve(__dirname, '..', '..', 'src', 'features', 'tms', 'tmsService.ts'),
  'utf8',
);
const ectRoutesSource = readFileSync(
  resolve(__dirname, '..', '..', 'src', 'features', 'ect', 'ectRoutes.ts'),
  'utf8',
);
const tmsRoutesSource = readFileSync(
  resolve(__dirname, '..', '..', 'src', 'features', 'tms', 'tmsRoutes.ts'),
  'utf8',
);

describe('BUG-ECT/TMS family source guards', () => {
  test('ECT route enforces module-read/write rails', () => {
    expect(ectRoutesSource).toContain('router.use(requireModuleRead(MODULE_KEYS.ECT));');
    expect(ectRoutesSource).toContain("router.post('/courses', requireModuleWrite(MODULE_KEYS.ECT)");
    expect(ectRoutesSource).toContain("router.post('/courses/:courseId/sessions', requireModuleWrite(MODULE_KEYS.ECT)");
  });

  test('TMS route enforces module-read/write rails', () => {
    expect(tmsRoutesSource).toContain('router.use(requireModuleRead(MODULE_KEYS.TMS));');
    expect(tmsRoutesSource).toContain("router.post('/courses', requireModuleWrite(MODULE_KEYS.TMS)");
    expect(tmsRoutesSource).toContain("router.post('/courses/:courseId/sessions', requireModuleWrite(MODULE_KEYS.TMS)");
  });

  test('ECT route responses are schema-validated before res.json', () => {
    expect(ectRoutesSource).toContain('EctCourseResponseSchema.parse(course)');
    expect(ectRoutesSource).toContain('EctSessionResponseSchema.parse(session)');
    expect(ectRoutesSource).toContain('EctByPatientResponseSchema.parse(data)');
    expect(ectRoutesSource).toContain('EctCourseSessionsResponseSchema.parse({ sessions })');
  });

  test('TMS route responses are schema-validated before res.json', () => {
    expect(tmsRoutesSource).toContain('TmsCourseResponseSchema.parse(course)');
    expect(tmsRoutesSource).toContain('TmsSessionResponseSchema.parse(session)');
    expect(tmsRoutesSource).toContain('TmsByPatientResponseSchema.parse(data)');
    expect(tmsRoutesSource).toContain('TmsCourseSessionsResponseSchema.parse({ sessions })');
  });

  test('ECT session paths require specialty + patient relationship on course-linked surfaces', () => {
    expect(ectServiceSource).toContain("await requireSpecialty(auth, ['psychiatry', 'mental_health']);");
    expect(ectServiceSource).toContain("await requirePatientRelationship(auth, course.patient_id as string);");
  });

  test('ECT mutation paths emit writeAuditLog rows', () => {
    expect(ectServiceSource).toContain("tableName: 'ect_courses'");
    expect(ectServiceSource).toContain("tableName: 'ect_sessions'");
    expect(ectServiceSource).toContain('await writeAuditLog({');
    expect(ectServiceSource).not.toContain('auditLogService.logCreate');
  });

  test('TMS session paths require specialty + patient relationship on course-linked surfaces', () => {
    expect(tmsServiceSource).toContain("await requireSpecialty(auth, ['psychiatry', 'mental_health']);");
    expect(tmsServiceSource).toContain("await requirePatientRelationship(auth, course.patient_id as string);");
  });

  test('TMS mutation paths emit writeAuditLog rows', () => {
    expect(tmsServiceSource).toContain("tableName: 'tms_courses'");
    expect(tmsServiceSource).toContain("tableName: 'tms_sessions'");
    expect(tmsServiceSource).toContain('await writeAuditLog({');
    expect(tmsServiceSource).not.toContain('auditLogService.logCreate');
  });
});
