import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = fileURLToPath(new URL('.', import.meta.url));

describe('BUG-341 npdsClient db import mode', () => {
  it('uses lazy dynamic import for db and no static top-level db import', () => {
    const sourcePath = resolve(currentDir, '../../src/integrations/escript/npdsClient.ts');
    const source = readFileSync(sourcePath, 'utf8');

    expect(source).toMatch(/await import\(['"]\.\.\/\.\.\/db\/db['"]\)/);
    expect(source).not.toMatch(
      /^import\s+.+from\s+['"]\.\.\/\.\.\/db\/db['"]\s*;?$/m,
    );
  });
});
