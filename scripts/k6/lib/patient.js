import http from 'k6/http';
import { check, fail } from 'k6';
import { API_URL } from './config.js';

function extractPatientId(res) {
  const rows = res.json('data') || res.json();
  if (Array.isArray(rows)) {
    return rows[0]?.id;
  }
  return rows?.[0]?.id;
}

export function discoverPatientIdOrFail(opts, stage = 'k6') {
  const res = http.get(`${API_URL}/patients?limit=1`, {
    ...opts,
    tags: { name: 'patient_search' },
  });

  const ok = check(res, {
    [`${stage}: patient probe status 200`]: (r) => r.status === 200,
  });

  if (!ok) {
    fail(`${stage}: patient probe failed with status ${res.status}`);
  }

  let patientId;
  try {
    patientId = extractPatientId(res);
  } catch (err) {
    fail(
      `${stage}: patient probe response parse failed: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!patientId) {
    fail(`${stage}: patient probe returned no patient id`);
  }

  return patientId;
}
