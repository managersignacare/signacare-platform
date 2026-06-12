import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveUploadBaseDir, resolveUploadPath } from '../../src/shared/uploadPaths';

const originalUploadBaseDir = process.env.UPLOAD_BASE_DIR;
const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  if (originalUploadBaseDir === undefined) {
    delete process.env.UPLOAD_BASE_DIR;
  } else {
    process.env.UPLOAD_BASE_DIR = originalUploadBaseDir;
  }
  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = originalNodeEnv;
  }
});

describe('upload path contract', () => {
  it('uses an explicit writable UPLOAD_BASE_DIR when configured', () => {
    process.env.UPLOAD_BASE_DIR = ' /home/signacare/uploads ';

    expect(resolveUploadBaseDir()).toBe(path.resolve('/home/signacare/uploads'));
    expect(resolveUploadPath('audio', '2026', '06')).toBe(
      path.join(path.resolve('/home/signacare/uploads'), 'audio', '2026', '06'),
    );
  });

  it('falls back to the repo-local uploads directory for development', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.UPLOAD_BASE_DIR;

    expect(resolveUploadBaseDir()).toBe(path.resolve(process.cwd(), 'uploads'));
  });

  it('requires explicit non-/tmp upload storage in production', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.UPLOAD_BASE_DIR;

    expect(() => resolveUploadBaseDir()).toThrow(/UPLOAD_BASE_DIR is required/);

    process.env.UPLOAD_BASE_DIR = '/tmp/signacare';
    expect(() => resolveUploadBaseDir()).toThrow(/must not point at \/tmp/);
  });
});
