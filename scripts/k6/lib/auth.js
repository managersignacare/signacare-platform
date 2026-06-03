/**
 * Category 6 — Shared k6 auth helper.
 *
 * Logs in once per VU iteration via POST /auth/login (mobile mode →
 * token in body, no cookies — simpler for k6 which doesn't have a
 * built-in cookie jar that survives across requests cleanly). Returns
 * { token, clinicId, userId } or fails the iteration.
 *
 * Most scenarios call login() exactly once in setup() and pass the
 * token down to every VU via the data object — that gives realistic
 * per-VU stable sessions without spending the test budget on N login
 * round trips per second.
 */

import http from 'k6/http';
import { check, fail } from 'k6';
import { API_URL, TEST_USER, TEST_PASS } from './config.js';

export function login() {
  const res = http.post(
    `${API_URL}/auth/login`,
    JSON.stringify({ email: TEST_USER, password: TEST_PASS }),
    {
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': 'k6-load-test',
        'X-Client': 'mobile',
      },
      tags: { name: 'login' },
    },
  );

  const ok = check(res, {
    'login: status 200': (r) => r.status === 200,
    'login: returned accessToken': (r) => {
      try { return !!r.json('accessToken'); } catch { return false; }
    },
  });

  if (!ok) {
    fail(`Login failed: ${res.status} ${res.body}`);
  }

  return {
    token: res.json('accessToken'),
    clinicId: res.json('user.clinicId'),
    userId: res.json('user.id'),
  };
}
