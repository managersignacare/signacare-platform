import { describe, expect, it } from 'vitest';
import { checkPatternLogger } from '../level-1-static';

describe('L1.14 pattern-logger', () => {
  it('passes when importing the canonical utils logger from API routes', () => {
    const violations = checkPatternLogger(
      'apps/api/src/routes/example.ts',
      [`import { logger } from '../utils/logger';`],
    );

    expect(violations).toHaveLength(0);
  });

  it('passes when importing ./logger inside the utils directory', () => {
    const violations = checkPatternLogger(
      'apps/api/src/utils/nameResolver.ts',
      [`import { logger } from './logger';`],
    );

    expect(violations).toHaveLength(0);
  });

  it('fails when importing the legacy shared logger path', () => {
    const violations = checkPatternLogger(
      'apps/api/src/middleware/errorHandler.ts',
      [`import { logger } from '../shared/logger';`],
    );

    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain('apps/api/src/utils/logger.ts');
  });
});
