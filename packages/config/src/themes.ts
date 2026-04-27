/**
 * Theme tokens for OnsecBoad. Six presets + custom.
 * Tenants pick one in Phase 1 setup; can change later in Settings → Branding.
 */

export type ThemeTokens = {
  color: {
    bg: string;
    surface: string;
    surfaceMuted: string;
    border: string;
    borderMuted: string;
    text: string;
    textMuted: string;
    textOnPrimary: string;
    primary: string;
    primaryHover: string;
    primaryActive: string;
    accent: string;
    success: string;
    warning: string;
    danger: string;
    info: string;
    focus: string;
  };
  radius: { sm: string; md: string; lg: string; xl: string; pill: string };
  shadow: { sm: string; md: string; lg: string };
  font: { sans: string; mono: string };
};

export type ThemePreset = {
  code: ThemeCode;
  name: string;
  isDark: boolean;
  tokens: ThemeTokens;
};

export type ThemeCode = 'maple' | 'glacier' | 'forest' | 'slate' | 'aurora' | 'midnight' | 'custom';

const sharedSizing = {
  radius: { sm: '4px', md: '8px', lg: '12px', xl: '16px', pill: '9999px' },
  shadow: {
    sm: '0 1px 2px rgba(0,0,0,0.05)',
    md: '0 4px 12px rgba(0,0,0,0.08)',
    lg: '0 12px 32px rgba(0,0,0,0.12)',
  },
  font: {
    sans: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    mono: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
  },
};

export const THEME_PRESETS: Record<Exclude<ThemeCode, 'custom'>, ThemePreset> = {
  maple: {
    code: 'maple',
    name: 'Maple',
    isDark: false,
    tokens: {
      color: {
        bg: '#FAFAF7',
        surface: '#FFFFFF',
        surfaceMuted: '#F4F4F0',
        border: '#E5E5DF',
        borderMuted: '#EFEFEA',
        text: '#111827',
        textMuted: '#6B7280',
        textOnPrimary: '#FFFFFF',
        primary: '#B5132B',
        primaryHover: '#9C0F25',
        primaryActive: '#7E0C1E',
        accent: '#1F2937',
        success: '#15803D',
        warning: '#B45309',
        danger: '#B91C1C',
        info: '#1E40AF',
        focus: '#B5132B',
      },
      ...sharedSizing,
    },
  },
  glacier: {
    code: 'glacier',
    name: 'Glacier',
    isDark: false,
    tokens: {
      color: {
        bg: '#F8FAFC',
        surface: '#FFFFFF',
        surfaceMuted: '#F1F5F9',
        border: '#E2E8F0',
        borderMuted: '#EDF2F7',
        text: '#0F172A',
        textMuted: '#64748B',
        textOnPrimary: '#FFFFFF',
        primary: '#1E40AF',
        primaryHover: '#1B3A9C',
        primaryActive: '#172F7F',
        accent: '#0EA5E9',
        success: '#15803D',
        warning: '#B45309',
        danger: '#B91C1C',
        info: '#0369A1',
        focus: '#1E40AF',
      },
      ...sharedSizing,
    },
  },
  forest: {
    code: 'forest',
    name: 'Forest',
    isDark: false,
    tokens: {
      color: {
        bg: '#F7FAF7',
        surface: '#FFFFFF',
        surfaceMuted: '#EEF4EF',
        border: '#DDE8DD',
        borderMuted: '#E8EFE8',
        text: '#0F1F12',
        textMuted: '#5C7361',
        textOnPrimary: '#FFFFFF',
        primary: '#15803D',
        primaryHover: '#126E34',
        primaryActive: '#0F5A2B',
        accent: '#65A30D',
        success: '#15803D',
        warning: '#B45309',
        danger: '#B91C1C',
        info: '#1E40AF',
        focus: '#15803D',
      },
      ...sharedSizing,
    },
  },
  slate: {
    code: 'slate',
    name: 'Slate',
    isDark: false,
    tokens: {
      color: {
        bg: '#F1F5F9',
        surface: '#FFFFFF',
        surfaceMuted: '#E2E8F0',
        border: '#CBD5E1',
        borderMuted: '#DDE4EC',
        text: '#0F172A',
        textMuted: '#64748B',
        textOnPrimary: '#FFFFFF',
        primary: '#0F172A',
        primaryHover: '#1E293B',
        primaryActive: '#334155',
        accent: '#64748B',
        success: '#15803D',
        warning: '#B45309',
        danger: '#B91C1C',
        info: '#1E40AF',
        focus: '#0F172A',
      },
      ...sharedSizing,
    },
  },
  aurora: {
    code: 'aurora',
    name: 'Aurora',
    isDark: false,
    tokens: {
      color: {
        bg: '#FAFAFC',
        surface: '#FFFFFF',
        surfaceMuted: '#F1F0FA',
        border: '#E5E2F0',
        borderMuted: '#EDEAF6',
        text: '#1E1B4B',
        textMuted: '#6B6790',
        textOnPrimary: '#FFFFFF',
        primary: '#7C3AED',
        primaryHover: '#6D2FCC',
        primaryActive: '#5B25A8',
        accent: '#22D3EE',
        success: '#15803D',
        warning: '#B45309',
        danger: '#B91C1C',
        info: '#1E40AF',
        focus: '#7C3AED',
      },
      ...sharedSizing,
    },
  },
  midnight: {
    code: 'midnight',
    name: 'Midnight',
    isDark: true,
    tokens: {
      color: {
        bg: '#0B1220',
        surface: '#111827',
        surfaceMuted: '#1F2937',
        border: '#374151',
        borderMuted: '#1F2937',
        text: '#E5E7EB',
        textMuted: '#9CA3AF',
        textOnPrimary: '#0B1220',
        primary: '#60A5FA',
        primaryHover: '#3B82F6',
        primaryActive: '#2563EB',
        accent: '#A78BFA',
        success: '#22C55E',
        warning: '#F59E0B',
        danger: '#EF4444',
        info: '#38BDF8',
        focus: '#60A5FA',
      },
      ...sharedSizing,
    },
  },
};

export const THEME_LIST: ThemePreset[] = Object.values(THEME_PRESETS);

/** Compute a custom theme from a primary hex color, deriving accent + hover/active. */
export function buildCustomTheme(primaryHex: string): ThemePreset {
  const base = THEME_PRESETS.maple.tokens;
  return {
    code: 'custom',
    name: 'Custom',
    isDark: false,
    tokens: {
      ...base,
      color: {
        ...base.color,
        primary: primaryHex,
        primaryHover: shade(primaryHex, -8),
        primaryActive: shade(primaryHex, -14),
        accent: hueShift(primaryHex, 30),
        textOnPrimary: bestContrastOn(primaryHex),
        focus: primaryHex,
      },
    },
  };
}

/** Convert a theme to CSS variables consumed by the global stylesheet. */
export function themeToCssVars(theme: ThemePreset): Record<string, string> {
  const vars: Record<string, string> = {};
  const { color, radius, shadow, font } = theme.tokens;
  for (const [k, v] of Object.entries(color)) vars[`--color-${kebab(k)}`] = v;
  for (const [k, v] of Object.entries(radius)) vars[`--radius-${k}`] = v;
  for (const [k, v] of Object.entries(shadow)) vars[`--shadow-${k}`] = v;
  for (const [k, v] of Object.entries(font)) vars[`--font-${k}`] = v;
  return vars;
}

// ─── color helpers ────────────────────────────────────────────────────────────

function kebab(s: string): string {
  return s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return [0, 0, 0];
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

function shade(hex: string, percent: number): string {
  const [r, g, b] = hexToRgb(hex);
  const f = (1 + percent / 100);
  return rgbToHex(r * f, g * f, b * f);
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function bestContrastOn(bg: string): string {
  return contrastRatio('#FFFFFF', bg) >= 4.5 ? '#FFFFFF' : '#111827';
}

function hueShift(hex: string, deg: number): string {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  h = (h + deg + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r2 = 0, g2 = 0, b2 = 0;
  if (h < 60) [r2, g2, b2] = [c, x, 0];
  else if (h < 120) [r2, g2, b2] = [x, c, 0];
  else if (h < 180) [r2, g2, b2] = [0, c, x];
  else if (h < 240) [r2, g2, b2] = [0, x, c];
  else if (h < 300) [r2, g2, b2] = [x, 0, c];
  else [r2, g2, b2] = [c, 0, x];
  return rgbToHex((r2 + m) * 255, (g2 + m) * 255, (b2 + m) * 255);
}

export const _testInternals = { hexToRgb, contrastRatio, bestContrastOn };
