import { describe, expect, it } from 'vitest';
import { shouldAllowLocalhostCspConnectSource } from '../../src/shared/cspPolicy';

describe('shouldAllowLocalhostCspConnectSource', () => {
  it('allows localhost in unhosted local development by default', () => {
    expect(
      shouldAllowLocalhostCspConnectSource({
        nodeEnv: 'development',
        websiteSiteName: '',
        cspAllowLocalhostConnect: undefined,
      }),
    ).toBe(true);
  });

  it('removes localhost in hosted development environments such as App Service staging', () => {
    expect(
      shouldAllowLocalhostCspConnectSource({
        nodeEnv: 'development',
        websiteSiteName: 'signacare-api-staging',
        cspAllowLocalhostConnect: undefined,
      }),
    ).toBe(false);
  });

  it('honours an explicit opt-in override', () => {
    expect(
      shouldAllowLocalhostCspConnectSource({
        nodeEnv: 'development',
        websiteSiteName: 'signacare-api-staging',
        cspAllowLocalhostConnect: 'true',
      }),
    ).toBe(true);
  });

  it('honours an explicit opt-out override', () => {
    expect(
      shouldAllowLocalhostCspConnectSource({
        nodeEnv: 'development',
        websiteSiteName: '',
        cspAllowLocalhostConnect: 'false',
      }),
    ).toBe(false);
  });
});
