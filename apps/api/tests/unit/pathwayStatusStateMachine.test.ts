import { describe, expect, it } from 'vitest';
import { assertPathwayStatusTransition } from '../../src/features/treatment-pathways/pathwayStatusStateMachine';

describe('pathwayStatusStateMachine', () => {
  it('allows active -> paused and paused -> active transitions', () => {
    expect(() => assertPathwayStatusTransition('active', 'paused')).not.toThrow();
    expect(() => assertPathwayStatusTransition('paused', 'active')).not.toThrow();
  });

  it('allows active/paused -> terminal transitions', () => {
    expect(() => assertPathwayStatusTransition('active', 'completed')).not.toThrow();
    expect(() => assertPathwayStatusTransition('active', 'discontinued')).not.toThrow();
    expect(() => assertPathwayStatusTransition('paused', 'completed')).not.toThrow();
    expect(() => assertPathwayStatusTransition('paused', 'discontinued')).not.toThrow();
  });

  it('blocks terminal re-open transitions', () => {
    expect(() => assertPathwayStatusTransition('completed', 'active')).toThrow(/INVALID_STATE_TRANSITION|cannot transition/i);
    expect(() => assertPathwayStatusTransition('discontinued', 'active')).toThrow(/INVALID_STATE_TRANSITION|cannot transition/i);
  });

  it('allows no-op transitions', () => {
    expect(() => assertPathwayStatusTransition('active', 'active')).not.toThrow();
    expect(() => assertPathwayStatusTransition('completed', 'completed')).not.toThrow();
  });
});

