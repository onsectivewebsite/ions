/**
 * Root layout — picks the variant entry based on APP_VARIANT.
 *
 * expo-router scans this directory tree and builds a navigation graph.
 * The variants live under `(staff)`, `(client)`, `(tv)` route groups.
 * The root layout decides which one's the entry by reading
 * Constants.expoConfig?.extra?.appVariant.
 *
 * In Phase 9.1 only the staff variant has actual screens; client and tv
 * are placeholder splashes.
 */
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false }} />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
