interface CspConnectPolicyInput {
  nodeEnv?: string | null;
  websiteSiteName?: string | null;
  cspAllowLocalhostConnect?: string | null;
}

function isTruthy(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().toLowerCase() === 'true';
}

function isFalsy(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().toLowerCase() === 'false';
}

export function shouldAllowLocalhostCspConnectSource(
  input: CspConnectPolicyInput,
): boolean {
  if (isTruthy(input.cspAllowLocalhostConnect)) return true;
  if (isFalsy(input.cspAllowLocalhostConnect)) return false;

  const isDevelopment = (input.nodeEnv ?? 'development') === 'development';
  const isHostedRuntime = typeof input.websiteSiteName === 'string'
    && input.websiteSiteName.trim().length > 0;

  return isDevelopment && !isHostedRuntime;
}
