import { describe, expect, it } from 'vitest';
import { pathwayKeys } from './queryKeys';

describe('pathwayKeys behavioral namespace', () => {
  it('scopes patient-dependent keys to patient id', () => {
    expect(pathwayKeys.behaviorContracts('p-1')).toEqual(['pathways', 'behavioral', 'contracts', 'p-1']);
    expect(pathwayKeys.routines('p-1')).toEqual(['pathways', 'behavioral', 'routines', 'p-1']);
    expect(pathwayKeys.microLearningAssignments('p-2')).toEqual([
      'pathways',
      'behavioral',
      'micro-learning',
      'assignments',
      'p-2',
    ]);
  });

  it('keeps shared dashboards/settings under explicit behavioral roots', () => {
    expect(pathwayKeys.slaBoard()).toEqual(['pathways', 'behavioral', 'sla-board']);
    expect(pathwayKeys.choiceArchitectureDefaults()).toEqual([
      'pathways',
      'behavioral',
      'choice-architecture',
      'defaults',
    ]);
    expect(pathwayKeys.microLearningCards()).toEqual([
      'pathways',
      'behavioral',
      'micro-learning',
      'cards',
    ]);
  });
});

