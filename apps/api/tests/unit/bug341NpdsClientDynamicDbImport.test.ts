import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('BUG-341 npdsClient db import mode', () => {
  it('uses lazy dynamic import for db and no static top-level db import', () => {
    const sourcePath = resolve(
      process.cwd(),
      'src/integrations/escript/npdsClient.ts',
    );
    const source = readFileSync(sourcePath, 'utf8');

    expect(source).toMatch(/await import\(['"]\.\.\/\.\.\/db\/db['"]\)/);
    expect(source).not.toMatch(
      /^import\s+.+from\s+['"]\.\.\/\.\.\/db\/db['"]\s*;?$/m,
    );
  });
});

