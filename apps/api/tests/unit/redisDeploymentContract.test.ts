import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const API_SRC = join(__dirname, '..', '..', 'src');

describe('Redis deployment contract', () => {
  it('does not hardcode BullMQ worker connections to localhost/6379', () => {
    const files = [
      join(API_SRC, 'jobs', 'workers', 'hl7Worker.ts'),
      join(API_SRC, 'features', 'pathology', 'pathologyService.ts'),
      join(API_SRC, 'routes', 'health.ts'),
    ];

    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      expect(src).not.toMatch(/REDIS_HOST['"\]]\s*\?\?\s*['"]localhost['"][\s\S]{0,80}port:\s*6379/);
      expect(src).not.toMatch(/connection:\s*\{\s*host:\s*process\.env/);
    }
  });
});
