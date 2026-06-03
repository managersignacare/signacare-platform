import { describe, expect, it } from 'vitest';
import {
  ALL_DOMAIN_COMMANDS,
  DOMAIN_COMMANDS,
  DOMAIN_COMMAND_WAVES,
} from './domainCommands';

describe('domainCommands', () => {
  it('DC-1: exposes the 19 canonical command identifiers from the v4 plan', () => {
    expect(ALL_DOMAIN_COMMANDS).toHaveLength(19);
    expect(ALL_DOMAIN_COMMANDS).toContain('episode.create');
    expect(ALL_DOMAIN_COMMANDS).toContain('staffSettings.update');
  });

  it('DC-2: keeps every command identifier unique', () => {
    expect(new Set(ALL_DOMAIN_COMMANDS).size).toBe(ALL_DOMAIN_COMMANDS.length);
  });

  it('DC-3: partitions commands into the five E waves without losing any identifier', () => {
    const waveCommands = Object.values(DOMAIN_COMMAND_WAVES).flat();

    expect(waveCommands).toHaveLength(ALL_DOMAIN_COMMANDS.length);
    expect(new Set(waveCommands)).toEqual(new Set(ALL_DOMAIN_COMMANDS));
  });

  it('DC-4: preserves the E1 transitions exactly as named in the plan', () => {
    expect(DOMAIN_COMMAND_WAVES.E1).toEqual([
      DOMAIN_COMMANDS.EPISODE_CREATE,
      DOMAIN_COMMANDS.EPISODE_DEACTIVATE,
      DOMAIN_COMMANDS.EPISODE_ASSIGN_MDT,
      DOMAIN_COMMANDS.REFERRAL_CREATE,
      DOMAIN_COMMANDS.REFERRAL_INTAKE_CLOSE,
    ]);
  });
});
