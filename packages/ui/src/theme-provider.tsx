'use client';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import {
  THEME_PRESETS,
  buildCustomTheme,
  themeToCssVars,
  type ThemeCode,
  type ThemePreset,
} from '@onsecboad/config/themes';

export type Branding = {
  themeCode: ThemeCode;
  customPrimary?: string | null;
  logoUrl?: string | null;
};

const DEFAULT_BRANDING: Branding = { themeCode: 'maple' };
const ThemeContext = createContext<{ branding: Branding; theme: ThemePreset }>({
  branding: DEFAULT_BRANDING,
  theme: THEME_PRESETS.maple,
});

export function resolveTheme(branding: Branding): ThemePreset {
  if (branding.themeCode === 'custom' && branding.customPrimary) {
    return buildCustomTheme(branding.customPrimary);
  }
  if (branding.themeCode === 'custom') return THEME_PRESETS.maple;
  return THEME_PRESETS[branding.themeCode] ?? THEME_PRESETS.maple;
}

/** Server-friendly: emits inline <style> with CSS variables. */
export function ThemeProvider({
  branding,
  children,
}: {
  branding: Branding;
  children: ReactNode;
}) {
  const theme = useMemo(() => resolveTheme(branding), [branding]);
  const vars = useMemo(() => themeToCssVars(theme), [theme]);
  const cssText = `:root{${Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';')}}`;

  return (
    <ThemeContext.Provider value={{ branding, theme }}>
      <style data-onsecboad-theme={theme.code} dangerouslySetInnerHTML={{ __html: cssText }} />
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): { branding: Branding; theme: ThemePreset } {
  return useContext(ThemeContext);
}
