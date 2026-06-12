import path from 'path';

/**
 * Single source of truth for the API's local upload root.
 *
 * Containers often run from a read-only image layer, so production-like
 * deployments must set UPLOAD_BASE_DIR to a writable mounted path.
 */
export function resolveUploadBaseDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.UPLOAD_BASE_DIR?.trim();
  if (configured) {
    const resolved = path.resolve(configured);
    if (env.NODE_ENV === 'production' && resolved.startsWith(path.resolve('/tmp'))) {
      throw new Error('UPLOAD_BASE_DIR must not point at /tmp in production');
    }
    return resolved;
  }
  if (env.NODE_ENV === 'production') {
    throw new Error('UPLOAD_BASE_DIR is required in production');
  }
  return path.resolve(process.cwd(), 'uploads');
}

export function resolveUploadPath(...segments: string[]): string {
  return path.join(resolveUploadBaseDir(), ...segments);
}
