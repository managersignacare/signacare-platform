import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('router calendar canonical contract', () => {
  const source = readFileSync(resolve(__dirname, './router.tsx'), 'utf8');

  it('redirects legacy /appointments traffic to the canonical /calendar route', () => {
    expect(source).toContain(`{ path: '/appointments',   element: <Navigate to="/calendar" replace /> }`);
    expect(source).toContain(`{ path: '/calendar',       element: <CalendarPage /> }`);
  });
});
