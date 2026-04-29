/**
 * Variant router. Reads APP_VARIANT from the Expo manifest and redirects
 * to the right entry for this build.
 */
import { Redirect } from 'expo-router';
import Constants from 'expo-constants';

type Variant = 'staff' | 'client' | 'tv';

export default function Index() {
  const variant = (Constants.expoConfig?.extra?.appVariant as Variant) ?? 'staff';
  if (variant === 'staff') return <Redirect href="/(staff)" />;
  if (variant === 'client') return <Redirect href="/(client)" />;
  return <Redirect href="/(tv)" />;
}
