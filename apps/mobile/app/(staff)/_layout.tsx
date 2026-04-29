/**
 * Staff app entry. Auth gate: pulls the access token from SecureStore;
 * sends signed-out users to /sign-in, otherwise lets them through to
 * the dashboard.
 */
import { useEffect, useState } from 'react';
import { Redirect, Stack, useSegments } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { getStaffToken } from '../../src/shared/session';

type AuthState = 'loading' | 'signed-in' | 'signed-out';

export default function StaffLayout() {
  const [authState, setAuthState] = useState<AuthState>('loading');
  const segments = useSegments();

  useEffect(() => {
    void (async () => {
      const t = await getStaffToken();
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

  // Already on /(staff)/sign-in or /(staff)/2fa? let it render.
  const onAuthRoute =
    segments.includes('sign-in' as never) || segments.includes('2fa' as never);

  if (authState === 'signed-out' && !onAuthRoute) {
    return <Redirect href="/(staff)/sign-in" />;
  }
  if (authState === 'signed-in' && onAuthRoute) {
    return <Redirect href="/(staff)/dashboard" />;
  }
  return <Stack screenOptions={{ headerShown: false }} />;
}
