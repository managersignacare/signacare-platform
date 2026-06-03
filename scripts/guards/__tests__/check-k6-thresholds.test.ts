import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runGuard } from '../check-k6-thresholds';

const TMP_BASE = join(tmpdir(), 'check-k6-thresholds-fixtures');

beforeAll(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
  mkdirSync(TMP_BASE, { recursive: true });
});

afterAll(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
});

function writeScenario(name: string, content: string): void {
  writeFileSync(join(TMP_BASE, name), content, 'utf8');
}

function writeCommonFiles(): void {
  writeScenario('README.md', '# ignored');
  writeScenario('db-explain.sql', '-- ignored');
  mkdirSync(join(TMP_BASE, 'lib'), { recursive: true });
  writeFileSync(join(TMP_BASE, 'lib', 'config.js'), 'export const x = 1;', 'utf8');
}

describe('check-k6-thresholds guard', () => {
  it('passes when thresholds exist and patient scenarios fail closed', () => {
    writeCommonFiles();
    writeScenario(
      'baseline.js',
      `
import { discoverPatientIdOrFail } from './lib/patient.js';
export const options = { thresholds: { http_req_failed: ['rate<0.1'] } };
export function setup() { return { patientId: discoverPatientIdOrFail({}, 'baseline.setup') }; }
export default function (data) { return data.patientId; }
`,
    );
    writeScenario(
      'load.js',
      `
import { discoverPatientIdOrFail } from './lib/patient.js';
export const options = { thresholds: { http_req_failed: ['rate<0.1'] } };
export function setup() { return { patientId: discoverPatientIdOrFail({}, 'load.setup') }; }
export default function (data) { return data.patientId; }
`,
    );
    writeScenario(
      'stress.js',
      `
import { discoverPatientIdOrFail } from './lib/patient.js';
export const options = { thresholds: { http_req_failed: ['rate<0.1'] } };
export function setup() { return { patientId: discoverPatientIdOrFail({}, 'stress.setup') }; }
export default function (data) { return data.patientId; }
`,
    );
    writeScenario(
      'spike.js',
      `
import { discoverPatientIdOrFail } from './lib/patient.js';
export const options = { thresholds: { http_req_failed: ['rate<0.1'] } };
export function setup() { return { patientId: discoverPatientIdOrFail({}, 'spike.setup') }; }
export default function (data) { return data.patientId; }
`,
    );
    writeScenario(
      'soak.js',
      `
import { discoverPatientIdOrFail } from './lib/patient.js';
export const options = { thresholds: { http_req_failed: ['rate<0.1'] } };
export function setup() { return { patientId: discoverPatientIdOrFail({}, 'soak.setup') }; }
export default function (data) { return data.patientId; }
`,
    );
    writeScenario(
      'scribe-pipeline.js',
      `
export const options = { thresholds: { http_req_failed: ['rate<0.1'] } };
export default function () {}
`,
    );

    const result = runGuard({ k6Dir: TMP_BASE });
    expect(result.exitCode).toBe(0);
    expect(result.violations).toHaveLength(0);
  });

  it('fails when a scenario omits thresholds', () => {
    writeCommonFiles();
    writeScenario(
      'baseline.js',
      `
import { discoverPatientIdOrFail } from './lib/patient.js';
export const options = {};
export function setup() { return { patientId: discoverPatientIdOrFail({}, 'baseline.setup') }; }
export default function (data) { return data.patientId; }
`,
    );
    writeScenario('load.js', `export const options = { thresholds: { http_req_failed: ['rate<0.1'] } };`);
    writeScenario('stress.js', `export const options = { thresholds: { http_req_failed: ['rate<0.1'] } };`);
    writeScenario('spike.js', `export const options = { thresholds: { http_req_failed: ['rate<0.1'] } };`);
    writeScenario('soak.js', `export const options = { thresholds: { http_req_failed: ['rate<0.1'] } };`);

    const result = runGuard({ k6Dir: TMP_BASE });
    expect(result.exitCode).toBe(1);
    expect(result.violations.some((v) => v.reason.includes('missing thresholds block'))).toBe(true);
  });

  it('fails when patient scenario has fail-open patientId return', () => {
    writeCommonFiles();
    writeScenario(
      'baseline.js',
      `
import { discoverPatientIdOrFail } from './lib/patient.js';
export const options = { thresholds: { http_req_failed: ['rate<0.1'] } };
export function setup() { return { patientId: discoverPatientIdOrFail({}, 'baseline.setup') }; }
export default function (data) {
  if (!data.patientId) { return; }
}
`,
    );
    writeScenario('load.js', `export const options = { thresholds: { http_req_failed: ['rate<0.1'] } };`);
    writeScenario('stress.js', `export const options = { thresholds: { http_req_failed: ['rate<0.1'] } };`);
    writeScenario('spike.js', `export const options = { thresholds: { http_req_failed: ['rate<0.1'] } };`);
    writeScenario('soak.js', `export const options = { thresholds: { http_req_failed: ['rate<0.1'] } };`);

    const result = runGuard({ k6Dir: TMP_BASE });
    expect(result.exitCode).toBe(1);
    expect(
      result.violations.some((v) =>
        v.reason.includes('patient scenario contains fail-open early return'),
      ),
    ).toBe(true);
  });
});
