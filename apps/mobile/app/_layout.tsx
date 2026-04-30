/**
 * Root layout — picks the variant entry based on APP_VARIANT and wires
 * the global push-notification tap handler.
 *
 * expo-router scans this directory tree and builds a navigation graph.
 * The variants live under `(staff)`, `(client)`, `(tv)` route groups.
 */
import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { attachNotificationTapHandler } from '../src/shared/push';

export default function RootLayout() {
  useEffect(() => {
    return attachNotificationTapHandler();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false }} />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
