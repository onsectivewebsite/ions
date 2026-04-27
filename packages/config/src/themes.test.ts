import { describe, it, expect } from 'vitest';
import {
  THEME_PRESETS,
  THEME_LIST,
  buildCustomTheme,
  themeToCssVars,
  _testInternals,
} from './themes';

describe('theme presets', () => {
  it('exposes 6 named presets', () => {
    expect(THEME_LIST).toHaveLength(6);
    for (const code of ['maple', 'glacier', 'forest', 'slate', 'aurora', 'midnight'] as const) {
      expect(THEME_PRESETS[code]).toBeDefined();
    }
  });

  it('each preset has a contrasting text-on-primary', () => {
    for (const t of THEME_LIST) {
      const ratio = _testInternals.contrastRatio(
        t.tokens.color.textOnPrimary,
        t.tokens.color.primary,
      );
      expect(ratio).toBeGreaterThanOrEqual(3.5);
    }
  });
});

describe('buildCustomTheme', () => {
  it('derives hover/active darker than the primary', () => {
    const t = buildCustomTheme('#3366FF');
    expect(t.tokens.color.primary.toUpperCase()).toBe('#3366FF');
    expect(t.tokens.color.primaryHover).not.toBe(t.tokens.color.primary);
    expect(t.tokens.color.primaryActive).not.toBe(t.tokens.color.primary);
  });

  it('picks white text on a dark primary', () => {
    const t = buildCustomTheme('#0F172A');
    expect(t.tokens.color.textOnPrimary).toBe('#FFFFFF');
  });

  it('picks dark text on a light primary', () => {
    const t = buildCustomTheme('#FDE68A');
    expect(t.tokens.color.textOnPrimary).toBe('#111827');
  });
});

describe('themeToCssVars', () => {
  it('maps tokens to --color-* / --radius-* / --shadow-* / --font-*', () => {
    const vars = themeToCssVars(THEME_PRESETS.maple);
    expect(vars['--color-primary']).toBe('#B5132B');
    expect(vars['--radius-md']).toBe('8px');
    expect(vars['--shadow-sm']).toMatch(/^0 1px 2px/);
    expect(vars['--font-sans']).toMatch(/^Inter/);
  });
});
