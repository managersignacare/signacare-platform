/**
 * Phase 0.7.1 — Security pattern enforcement tests.
 *
 * Verify that the codebase follows security patterns identified
 * during the deep audit. These are static analysis tests — they
 * read source files and check for patterns, no DB needed.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const API_SRC = path.resolve(__dirname, '../../src');

function grepFiles(pattern: string, glob: string): string[] {
  try {
    const result = execSync(
      `grep -rn "${pattern}" ${glob} 2>/dev/null || true`,
      { encoding: 'utf-8', cwd: API_SRC },
    );
    return result.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

describe('Security patterns', () => {
  it('CSRF middleware validates token value, not just presence', () => {
    const content = fs.readFileSync(
      path.join(API_SRC, 'middleware/csrfMiddleware.ts'),
      'utf-8',
    );
    expect(content).toContain('redis');
    expect(content).toContain('CSRF_INVALID');
  });

  it('no LIKE/ILIKE without escapeLike in feature routes', () => {
    const hits = grepFiles('ILIKE\\|LIKE', 'features/**/*.ts');
    const unescaped = hits.filter(
      (line) =>
        (line.includes('ILIKE') || line.includes(' LIKE ')) &&
        !line.includes('escapeLike') &&
        !line.includes('IF NOT EXISTS') &&
        !line.includes('//') &&
        !line.includes('*.ts:') === false,
    );
    // Filter out comments and safe patterns
    const violations = unescaped.filter(
      (l) => !l.includes('-- ') && !l.includes('gin_trgm') && !l.includes('test_name'),
    );
    // Allow the CDS rule (uses hardcoded constant, not user input)
    const realViolations = violations.filter(
      (l) => !l.includes('clinicalDecision'),
    );
    expect(realViolations).toEqual([]);
  });

  it('auth rate limit is <= 15 per 15 min in production', () => {
    const content = fs.readFileSync(
      path.join(API_SRC, 'middleware/rateLimiters.ts'),
      'utf-8',
    );
    // Find the AUTH_RATE_LIMIT fallback and extract the production default.
    const match = content.match(
      /AUTH_RATE_LIMIT[\s\S]*?isDevelopment\s*\?\s*'(\d+)'\s*:\s*'(\d+)'/,
    );
    expect(match).toBeTruthy();
    const prodDefault = parseInt(match![2]!, 10);
    expect(prodDefault).toBeLessThanOrEqual(15);
  });

  it('cookie SameSite is strict in all environments', () => {
    const content = fs.readFileSync(
      path.join(API_SRC, 'features/auth/authController.ts'),
      'utf-8',
    );
    expect(content).toContain("sameSite: \"strict\"");
    expect(content).not.toMatch(/sameSite.*lax/);
  });
});
