/**
 * SecureStore-backed sessions for the mobile apps.
 *
 * Two namespaces, kept separate so a single device that's signed in to
 * both the staff and client apps doesn't have its tokens trampled:
 *   onsec_staff_at  — firm-scope access token (staff app)
 *   onsec_client_at — client-portal access token (client app)
 *
 * SecureStore is the right primitive on mobile: hardware-backed on iOS
 * (Keychain) and Android (EncryptedSharedPreferences). The web side uses
 * localStorage — same idea, different platform.
 */
import * as SecureStore from 'expo-secure-store';

const STAFF_TOKEN_KEY = 'onsec_staff_at';
const CLIENT_TOKEN_KEY = 'onsec_client_at';
const TV_TOKEN_KEY = 'onsec_tv_at';
const TV_BRANCH_KEY = 'onsec_tv_branch';
const TV_BRANCH_NAME_KEY = 'onsec_tv_branch_name';

async function getToken(key: string): Promise<string | null> {
  try {
    return (await SecureStore.getItemAsync(key)) ?? null;
  } catch {
    return null;
  }
}

async function setToken(key: string, token: string | null): Promise<void> {
  if (token == null) {
    await SecureStore.deleteItemAsync(key);
    return;
  }
  await SecureStore.setItemAsync(key, token, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED,
  });
}

export const getStaffToken = (): Promise<string | null> => getToken(STAFF_TOKEN_KEY);
export const setStaffToken = (token: string | null): Promise<void> => setToken(STAFF_TOKEN_KEY, token);
export const getClientToken = (): Promise<string | null> => getToken(CLIENT_TOKEN_KEY);
export const setClientToken = (token: string | null): Promise<void> => setToken(CLIENT_TOKEN_KEY, token);
export const getTvToken = (): Promise<string | null> => getToken(TV_TOKEN_KEY);
export const setTvToken = (token: string | null): Promise<void> => setToken(TV_TOKEN_KEY, token);
export const getTvBranchId = (): Promise<string | null> => getToken(TV_BRANCH_KEY);
export const setTvBranchId = (id: string | null): Promise<void> => setToken(TV_BRANCH_KEY, id);
export const getTvBranchName = (): Promise<string | null> => getToken(TV_BRANCH_NAME_KEY);
export const setTvBranchName = (name: string | null): Promise<void> => setToken(TV_BRANCH_NAME_KEY, name);
