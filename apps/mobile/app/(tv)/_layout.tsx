/**
 * TV lobby app — auth + branch-pairing gate.
 *
 * Three states:
 *   - signed-out                 → /sign-in
 *   - signed-in but no branch    → /pair
 *   - signed-in + paired         → /display
 *
 * The TV reuses firm-scope JWT (any user with `branches.read` can pair).
 * 2FA stays on for the initial pairing — the device is then trusted as
 * long as its token is valid. Token expiry kicks the TV back to sign-in,
 * which is the right failure mode for a public-facing display.
 */
import { useEffect, useState } from 'react';
import { Redirect, Stack, useSegments } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { getTvBranchId, getTvToken } from '../../src/shared/session';

type AuthState = 'loading' | 'signed-out' | 'unpaired' | 'paired';

export default function TvLayout() {
  const [authState, setAuthState] = useState<AuthState>('loading');
  const segments = useSegments();

  useEffect(() => {
    void (async () => {
      const t = await getTvToken();
      if (!t) {
        setAuthState('signed-out');
        return;
      }
      const b = await getTvBranchId();
      setAuthState(b ? 'paired' : 'unpaired');
    })();
  }, []);

  if (authState === 'loading') {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#0F172A',
        }}
      >
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  const onSignIn = segments.includes('sign-in' as never) || segments.includes('2fa' as never);
  const onPair = segments.includes('pair' as never);

  if (authState === 'signed-out' && !onSignIn) return <Redirect href="/(tv)/sign-in" />;
  if (authState === 'unpaired' && !onPair && !onSignIn) return <Redirect href="/(tv)/pair" />;
  if (authState === 'paired' && (onSignIn || onPair)) return <Redirect href="/(tv)/display" />;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#0F172A' },
      }}
    />
  );
}
