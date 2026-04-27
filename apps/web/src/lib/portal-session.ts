'use client';

// Separate localStorage key from staff `onsec_at` so the same browser can
// run a staff session and a client portal session side-by-side without
// trampling tokens.
const KEY = 'onsec_portal_at';

export function setPortalToken(t: string | null): void {
  if (typeof window === 'undefined') return;
  if (!t) {
    window.localStorage.removeItem(KEY);
    return;
  }
  window.localStorage.setItem(KEY, t);
}

export function getPortalToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(KEY);
}
