import { describe, expect, it } from 'vitest';

import { asDartColor, parseRemToPx, renderDartDesignTokens } from './generate-dart-design-tokens';

describe('generate-dart-design-tokens', () => {
  it('parses rem units to px', () => {
    expect(parseRemToPx('1rem')).toBe(16);
    expect(parseRemToPx('1.125rem')).toBe(18);
  });

  it('converts hex colors to dart Color syntax', () => {
    expect(asDartColor('#b0413e')).toBe('Color(0xFFB0413E)');
    expect(asDartColor('2E5C8A')).toBe('Color(0xFF2E5C8A)');
  });

  it('renders patient tokens with patient body size', () => {
    const output = renderDartDesignTokens('patient');
    expect(output).toContain('static const Color severityCritical = Color(0xFFB0413E);');
    expect(output).toContain('static const double touchTargetSafetyActionPx = 56;');
    expect(output).toContain('static const double appBodySizePx = 18;');
    expect(output).toContain("themePalettes = {");
    expect(output).toContain("'signacare': SignacareThemePaletteToken(");
  });

  it('renders mobile tokens with clinician body size', () => {
    const output = renderDartDesignTokens('mobile');
    expect(output).toContain('static const double appBodySizePx = 16;');
  });
});
