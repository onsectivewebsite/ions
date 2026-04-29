/**
 * Three apps from one codebase.
 *
 * APP_VARIANT picks which app this build is — staff, client, or tv. Each
 * variant gets its own bundle id, slug, name, and entry. Pick at build
 * time:
 *
 *   pnpm --filter @onsecboad/mobile start:staff
 *   APP_VARIANT=client eas build --profile preview --platform all
 *
 * Bundle ids are placeholders; swap to Onsective's real Apple/Google
 * accounts before submitting to TestFlight / Play.
 */
import type { ExpoConfig } from 'expo/config';

type Variant = 'staff' | 'client' | 'tv';
const variant: Variant = (process.env.APP_VARIANT as Variant) ?? 'staff';

const VARIANTS: Record<Variant, { name: string; slug: string; bundle: string; description: string }> = {
  staff: {
    name: 'OnsecBoad Staff',
    slug: 'onsecboad-staff',
    bundle: 'cloud.onsective.onsecboad.staff',
    description: 'Manage leads, calls, and cases on the go.',
  },
  client: {
    name: 'OnsecBoad Client',
    slug: 'onsecboad-client',
    bundle: 'cloud.onsective.onsecboad.client',
    description: 'Track your immigration file with your firm.',
  },
  tv: {
    name: 'OnsecBoad Lobby',
    slug: 'onsecboad-tv',
    bundle: 'cloud.onsective.onsecboad.tv',
    description: 'Branch lobby display — today\'s schedule + walk-ins.',
  },
};

const v = VARIANTS[variant];

const config: ExpoConfig = {
  name: v.name,
  slug: v.slug,
  scheme: v.slug,
  description: v.description,
  version: '0.0.1',
  orientation: variant === 'tv' ? 'landscape' : 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  splash: {
    image: './assets/splash.png',
    resizeMode: 'contain',
    backgroundColor: '#FAFAF7',
  },
  assetBundlePatterns: ['**/*'],
  ios: {
    supportsTablet: true,
    bundleIdentifier: v.bundle,
  },
  android: {
    package: v.bundle,
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#FAFAF7',
    },
  },
  web: {
    bundler: 'metro',
    output: 'static',
    favicon: './assets/favicon.png',
  },
  plugins: ['expo-router', 'expo-secure-store'],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    appVariant: variant,
    apiBaseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000',
    portalUrl: process.env.PORTAL_URL ?? 'http://localhost:3001',
  },
};

export default config;
