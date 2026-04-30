/**
 * Mobile push helpers — Phase 9.5.
 *
 * Wraps expo-notifications: permission, token retrieval, register +
 * unregister against the API, and a tap-handler that deep-links to the
 * relevant screen based on `data.kind`.
 *
 * Designed to fail soft — push is a nice-to-have on top of the polling
 * the apps already do. Permission denial / no-token / network error
 * never throws to the calling sign-in flow.
 */
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { rpcMutation } from './api';

// Set the foreground handler once. Defaults are reasonable: show alert,
// play sound, set badge.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export type PushVariant = 'staff' | 'client';

export type PushTokenInfo = {
  token: string;
  platform: 'ios' | 'android' | 'web';
};

async function ensurePermission(): Promise<boolean> {
  const settings = await Notifications.getPermissionsAsync();
  if (settings.granted || settings.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) {
    return true;
  }
  const req = await Notifications.requestPermissionsAsync();
  return req.granted || req.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
}

export async function getPushToken(): Promise<PushTokenInfo | null> {
  if (!Device.isDevice) {
    // Push tokens are device-only; simulators get nothing useful.
    return null;
  }
  const ok = await ensurePermission();
  if (!ok) return null;
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#B5132B',
      });
    }
    const projectId =
      (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId ??
      Constants.easConfig?.projectId;
    const tokenRes = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    const platform: 'ios' | 'android' | 'web' =
      Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';
    return { token: tokenRes.data, platform };
  } catch {
    return null;
  }
}

export async function registerPush(
  variant: PushVariant,
  apiToken: string,
): Promise<void> {
  try {
    const info = await getPushToken();
    if (!info) return;
    const procedure = variant === 'staff' ? 'push.registerStaff' : 'push.registerClient';
    await rpcMutation(procedure, { token: info.token, platform: info.platform }, { token: apiToken });
  } catch {
    /* swallow — best effort */
  }
}

export async function unregisterPush(): Promise<void> {
  try {
    const info = await getPushToken();
    if (!info) return;
    await rpcMutation('push.unregister', { token: info.token });
  } catch {
    /* swallow */
  }
}

/**
 * Wire the global tap handler. Call once from the root layout. Reads
 * `data.kind` and pushes the right deep-link onto the router stack.
 *
 *   { kind: 'lead', id }            → /(staff)/leads/[id]
 *   { kind: 'appointment', id }     → /(staff)/appointments/[id]
 *   { kind: 'message', clientId }   → /(client)/(tabs)/messages
 */
export function attachNotificationTapHandler(): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data as
      | { kind?: string; id?: string }
      | undefined;
    if (!data?.kind) return;
    switch (data.kind) {
      case 'lead':
        if (data.id) router.push(`/(staff)/leads/${data.id}`);
        break;
      case 'appointment':
        if (data.id) router.push(`/(staff)/appointments/${data.id}`);
        break;
      case 'case':
        if (data.id) router.push(`/(staff)/cases/${data.id}`);
        break;
      case 'message':
        // Client variant taps a notification → open the messages tab.
        router.push('/(client)/(tabs)/messages');
        break;
    }
  });
  return () => sub.remove();
}
