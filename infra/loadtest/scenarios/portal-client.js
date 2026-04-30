// portal-client.js — client-portal flow under realistic load.
//
// Each VU signs in with a portal account, lists cases + invoices, opens
// the messages thread. No writes — write paths in the portal are
// minimal and need staged data per VU to be realistic.

import { sleep, group } from 'k6';
import { signInPortal, rpcQuery } from '../lib/auth.js';

export const options = {
  stages: [
    { duration: '2m', target: 200 },
    { duration: '10m', target: 200 },
    { duration: '2m', target: 0 },
  ],
  thresholds: {
    'http_req_duration{type:read}': ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

function pickPortalCredentials() {
  const raw = __ENV.PORTAL_USERS;
  if (!raw) {
    return {
      email: __ENV.PORTAL_EMAIL || 'portal-test@example.com',
      password: __ENV.PORTAL_PASSWORD || 'changeme',
    };
  }
  const list = raw.split(',').map((s) => {
    const [email, password] = s.split(':');
    return { email, password };
  });
  return list[(__VU - 1) % list.length];
}

export default function () {
  const creds = pickPortalCredentials();
  let token;
  group('sign-in', () => {
    token = signInPortal(creds).accessToken;
  });

  for (let i = 0; i < 5; i++) {
    group('reads', () => {
      rpcQuery('portal.me', undefined, { token });
      const cases = rpcQuery('portal.cases', undefined, { token });
      const inv = rpcQuery('portal.invoicesList', undefined, { token });
      rpcQuery('portal.messagesList', undefined, { token });
      rpcQuery('portal.messagesUnreadCount', undefined, { token });
      // Drill into one case + one invoice if present.
      if (cases && cases[0]) {
        rpcQuery('portal.caseDetail', { id: cases[0].id }, { token });
      }
      if (inv && inv[0]) {
        rpcQuery('portal.invoiceGet', { id: inv[0].id }, { token });
      }
    });
    sleep(1.5);
  }
}
