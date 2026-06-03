import type { AuthContext } from '@signacare/shared';

export function isAiBreakGlassActive(auth: AuthContext): boolean {
  return typeof auth.breakGlassSessionId === 'string' && auth.breakGlassSessionId.length > 0;
}
