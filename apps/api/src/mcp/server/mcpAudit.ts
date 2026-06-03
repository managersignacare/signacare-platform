import type { AuthContext } from '@signacare/shared';
import { logger } from '../../utils/logger';
import { writeAiToolCallAudit } from '../../features/ai/audit/aiAudit';

export async function writeToolAuditNonBlocking(input: {
  auth: AuthContext;
  toolName: string;
  argumentsSummary: Record<string, unknown>;
  success: boolean;
  errorCode?: string;
}): Promise<void> {
  await writeAiToolCallAudit(input).catch((err: unknown) => {
    logger.warn(
      { err, clinicId: input.auth.clinicId, staffId: input.auth.staffId, toolName: input.toolName },
      'AI tool audit write failed (non-blocking)',
    );
  });
}
