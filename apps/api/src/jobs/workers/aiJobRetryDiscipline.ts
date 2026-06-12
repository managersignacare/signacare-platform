export function resolveFailedAttemptNumber(attemptsMade: number | null | undefined): number {
  if (typeof attemptsMade === 'number' && Number.isFinite(attemptsMade) && attemptsMade > 0) {
    return Math.floor(attemptsMade);
  }
  return 1;
}

export function haveAiJobRetriesExhausted(input: {
  attemptsMade: number | null | undefined;
  maxAttempts: number | null | undefined;
}): boolean {
  const maxAttempts = typeof input.maxAttempts === 'number' && Number.isFinite(input.maxAttempts) && input.maxAttempts > 0
    ? Math.floor(input.maxAttempts)
    : 1;
  return resolveFailedAttemptNumber(input.attemptsMade) >= maxAttempts;
}

export function getAiJobQueuePriority(action: string): number {
  switch (action) {
    case 'ambient-audio':
      return 1;
    case 'letter':
    case 'discharge':
    case 'certificate':
    case 'med-summary':
      return 2;
    case 'handover-summary':
    case 'register-summary':
    case 'risk-summary':
    case 'report-insight':
    case 'admin-report':
      return 3;
    case '91day':
    case 'maudsley':
    case 'formulation':
    case '5p-formulation':
    case 'lifechart-schema':
      return 5;
    default:
      return 4;
  }
}
