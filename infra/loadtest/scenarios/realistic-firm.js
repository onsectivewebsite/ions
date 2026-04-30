// realistic-firm.js — the docs/phase-10 spec target.
//
// 100 firms × 10 users × 10 RPS for 30 minutes within latency SLOs:
//   - p95 read   < 500ms
//   - p95 write  < 1500ms
//   - failure rate < 1%
//
// Implementation: ramp 1000 VUs over 5 min, hold 30 min, ramp down 5 min.
// Each VU signs in once at the start, then loops a realistic mix of
// reads (cases.list, lead.myQueue, appointment.list, message.thread)
// and light writes (lead.changeStatus on a held lead).
//
// Heavy writes (call.start, document upload) are excluded — they'd
// corrupt the seed data. Run dedicated scenarios for those.

import { sleep, group } from 'k6';
import { signInStaff, rpcQuery, rpcMutation } from '../lib/auth.js';

export const options = {
  // Ramp 0 → 1000 over 5 min, hold 30, ramp down.
  stages: [
    { duration: '5m', target: 1000 },
    { duration: '30m', target: 1000 },
    { duration: '5m', target: 0 },
  ],
  thresholds: {
    'http_req_duration{type:read}': ['p(95)<500'],
    'http_req_duration{type:write}': ['p(95)<1500'],
    http_req_failed: ['rate<0.01'],
  },
};

// User accounts come from a CSV-style env: STAFF_USERS=email1:pw1,email2:pw2
// Each VU picks a row by VU number modulo the list. In a real run this
// table would be 1000 entries seeded into staging.
function pickCredentials() {
  const raw = __ENV.STAFF_USERS;
  if (!raw) {
    return {
      email: __ENV.EMAIL || 'rk9814289618@gmail.com',
      password: __ENV.PASSWORD || 'changeme',
    };
  }
  const list = raw.split(',').map((s) => {
    const [email, password] = s.split(':');
    return { email, password };
  });
  return list[(__VU - 1) % list.length];
}

export function setup() {
  // Sanity-ping: catch a dead env before we ramp.
  const r = rpcQuery('billing.config');
  if (!r) throw new Error('billing.config returned null — wrong BASE_URL or API down');
  return {};
}

export default function () {
  const creds = pickCredentials();
  let token;
  group('sign-in', () => {
    const session = signInStaff({ email: creds.email, password: creds.password });
    token = session.accessToken;
  });

  // Realistic per-user behaviour: 6 reads + 1 write per ~6s loop = ~10 RPS
  // averaged over the user.
  for (let i = 0; i < 8; i++) {
    group('reads', () => {
      rpcQuery('user.me', undefined, { token });
      rpcQuery('cases.list', { page: 1 }, { token });
      rpcQuery('lead.myQueue', undefined, { token });
      rpcQuery(
        'appointment.list',
        { from: new Date().toISOString(), to: new Date(Date.now() + 86400000).toISOString() },
        { token },
      );
      rpcQuery('aiUsage.summary', {}, { token });
      rpcQuery('billing.config');
    });
    sleep(0.5);

    // Light write — flip a status on a lead the user owns. Skipped if
    // myQueue returned nothing.
    group('write', () => {
      const queue = rpcQuery('lead.myQueue', undefined, { token });
      const item = queue && queue.items && queue.items[0];
      if (item) {
        const next = item.status === 'NEW' ? 'CONTACTED' : 'FOLLOWUP';
        rpcMutation('lead.changeStatus', { id: item.id, status: next }, { token });
      }
    });
    sleep(0.5);
  }
}
