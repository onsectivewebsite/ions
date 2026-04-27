'use client';

const TOKEN_KEY = 'onsec_at';
const LEGACY_TOKEN_KEY = 'onsec_at'; // previously stored in sessionStorage

export function setAccessToken(t: string | null): void {
  if (typeof window === 'undefined') return;
  if (!t) {
    window.localStorage.removeItem(TOKEN_KEY);
    window.sessionStorage.removeItem(LEGACY_TOKEN_KEY);
    return;
  }
  window.localStorage.setItem(TOKEN_KEY, t);
}

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  const fromLocal = window.localStorage.getItem(TOKEN_KEY);
  if (fromLocal) return fromLocal;
  // Migrate any stragglers from the old sessionStorage location.
  const legacy = window.sessionStorage.getItem(LEGACY_TOKEN_KEY);
  if (legacy) {
    window.localStorage.setItem(TOKEN_KEY, legacy);
    window.sessionStorage.removeItem(LEGACY_TOKEN_KEY);
    return legacy;
  }
  return null;
}
