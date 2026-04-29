/**
 * Mobile theme tokens.
 *
 * Source of truth is `@onsecboad/config/themes` — same six presets the web
 * side uses (Maple, Glacier, Forest, Slate, Aurora, Midnight). On mobile
 * we resolve once at app boot via the firm's branding fetched from
 * /trpc/user.me, then expose the tokens via React context for screens.
 */
import { createContext, useContext, type ReactNode } from 'react';
import {
  THEME_PRESETS,
  buildCustomTheme,
  type ThemeCode,
  type ThemePreset,
} from '@onsecboad/config/themes';
import React from 'react';

export type Branding = {
  themeCode: ThemeCode;
  customPrimary?: string | null;
  logoUrl?: string | null;
};

const DEFAULT_BRANDING: Branding = { themeCode: 'maple' };

export function resolveTheme(branding: Branding): ThemePreset {
  if (branding.themeCode === 'custom' && branding.customPrimary) {
    return buildCustomTheme(branding.customPrimary);
  }
  if (branding.themeCode === 'custom') return THEME_PRESETS.maple;
  return THEME_PRESETS[branding.themeCode] ?? THEME_PRESETS.maple;
}

const ThemeContext = createContext<{ branding: Branding; theme: ThemePreset }>({
  branding: DEFAULT_BRANDING,
  theme: THEME_PRESETS.maple,
});

export function ThemeProvider({
  branding,
  children,
}: {
  branding: Branding;
  children: ReactNode;
}) {
  const theme = resolveTheme(branding);
  return React.createElement(ThemeContext.Provider, { value: { branding, theme } }, children);
}

export function useTheme(): ThemePreset {
  return useContext(ThemeContext).theme;
}

/** Direct access to the colour map — convenient inside screens. */
export function useColors(): ThemePreset['tokens']['color'] {
  return useTheme().tokens.color;
}
