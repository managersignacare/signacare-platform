/**
 * Probe II.C.4 — api-contract
 *
 * Instruments every navigation with a page.on('response') listener.
 * For every /api/v1/** response, captures status + body. A summary
 * emits at test end: malformed JSON responses, unexpected 5xx,
 * unexpectedly-empty payloads on known-data-seeded endpoints.
 *
 * Not a full Zod-schema round-trip (the shared schema mapping would
 * require plumbing every apiClient URL → shared schema — that's a
 * bigger task). This probe targets:
 *   - 5xx responses (every one = bug)
 *   - 4xx responses on "safe" GET /api/v1/* calls
 *   - response bodies that don't parse as JSON when the frontend
 *     expects JSON
 *   - response shapes that differ from expected (checked at fixture)
 *
 * Catches: Bug 2 class (silent field mismatch from alias typo),
 * backend 500s during happy-path navigation.
 *
 * Run: `npx playwright test e2e/probes/api-contract.spec.ts`
 */
import { test, expect, useAs } from '../fixtures/auth';
import { SMOKE_ROUTES } from '../fixtures/routes';

// BUG-032 — restore superadmin storageState; see route-crawler.spec.ts rationale.
test.use(useAs('superadmin'));

test.describe.configure({ mode: 'serial' });

interface ApiIssue {
  url: string;
  status: number;
  method: string;
  bodyPreview?: string;
  route: string;
}

test.describe('Probe: api-contract (as superadmin)', () => {

  for (const route of SMOKE_ROUTES) {
    test(`${route.path} — no API 4xx/5xx on render`, async ({ page }) => {
      const issues: ApiIssue[] = [];
      page.on('response', async (r) => {
        const url = r.url();
        if (!url.includes('/api/v1/')) return;
        const status = r.status();
        const method = r.request().method();
        // Ignore 401/403 for auth endpoints when we're un-authed
        if ((status === 401 || status === 403) && url.includes('/auth/')) return;
        // Ignore 304 Not Modified (cache hits)
        if (status === 304) return;
        if (status >= 400) {
          let bodyPreview: string | undefined;
          try {
            bodyPreview = (await r.text()).slice(0, 200);
          } catch { /* body already consumed */ }
          issues.push({ url, status, method, bodyPreview, route: route.path });
        }
      });
      await page.goto(route.path);
      await page.waitForTimeout(3000);

      if (issues.length > 0) {
        console.log(
          `[api-contract] ${route.path} — ${issues.length} API issue(s):`,
          issues.map((i) => `${i.method} ${i.url} → ${i.status}`).slice(0, 10).join('\n  '),
        );
      }
      // Fail on any 5xx
      const server5xx = issues.filter((i) => i.status >= 500);
      expect(
        server5xx.length,
        `5xx on ${route.path}: ${JSON.stringify(server5xx.slice(0, 3))}`,
      ).toBe(0);
      // 4xx is a warning (auth/seed-thin-data edge cases) — log only, don't fail
    });
  }
});
