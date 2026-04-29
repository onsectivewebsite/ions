/**
 * SecureStore-backed session for the mobile staff app.
 *
 * Uses two keys:
 *   onsec_staff_at — firm-scope access token (matches the web side's
 *                    `onsec_at` localStorage key, but namespaced for mobile)
 *
 * SecureStore is the right primitive on mobile: hardware-backed on iOS
 * (Keychain) and Android (EncryptedSharedPreferences). The web side uses
 * localStorage — same idea, different platform.
 */
import * as SecureStore from 'expo-secure-store';

const STAFF_TOKEN_KEY = 'onsec_staff_at';

export async function getStaffToken(): Promise<string | null> {
  try {
    return (await SecureStore.getItemAsync(STAFF_TOKEN_KEY)) ?? null;
  } catch {
    return null;
  }
}

export async function setStaffToken(token: string | null): Promise<void> {
  if (token == null) {
    await SecureStore.deleteItemAsync(STAFF_TOKEN_KEY);
    return;
  }
  await SecureStore.setItemAsync(STAFF_TOKEN_KEY, token, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED,
  });
}
