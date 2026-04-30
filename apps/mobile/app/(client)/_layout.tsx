/**
 * Client portal app — auth gate.
 *
 * Same shape as the staff layout: SecureStore lookup decides whether the
 * user goes to /sign-in or straight into the (tabs) group. No 2FA in the
 * portal flow (matches the web portal — Phase 5.5 chose email + password
 * only for the client surface).
 */
import { useEffect, useState } from 'react';
import { Redirect, Stack, useSegments } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { getClientToken } from '../../src/shared/session';

type AuthState = 'loading' | 'signed-in' | 'signed-out';

export default function ClientLayout() {
  const [authState, setAuthState] = useState<AuthState>('loading');
  const segments = useSegments();

  useEffect(() => {
    void (async () => {
      const t = await getClientToken();
      setAuthState(t ? 'signed-in' : 'signed-out');
    })();
  }, []);

  if (authState === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  const onAuthRoute = segments.includes('sign-in' as never);
  if (authState === 'signed-out' && !onAuthRoute) {
    return <Redirect href="/(client)/sign-in" />;
  }
  if (authState === 'signed-in' && onAuthRoute) {
    return <Redirect href="/(client)/(tabs)" />;
  }
  return <Stack screenOptions={{ headerShown: false }} />;
}
