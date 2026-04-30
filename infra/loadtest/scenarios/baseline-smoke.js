// baseline-smoke.js — confirm the API is reachable + healthy.
//
// 1 VU, 30s, hits /api/health and /api/health/full only. Run before
// every other scenario to catch dead environments early.

import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';

export const options = {
  vus: 1,
  duration: '30s',
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
  },
};

export default function () {
  const ping = http.get(`${BASE_URL}/api/health`);
  check(ping, { 'health 200': (r) => r.status === 200 });

  const full = http.get(`${BASE_URL}/api/health/full`);
  check(full, {
    'health/full 200|503': (r) => r.status === 200 || r.status === 503,
    'health/full has overall': (r) => {
      try {
        return ['ok', 'degraded', 'down'].includes(r.json('overall'));
      } catch {
        return false;
      }
    },
  });

  sleep(1);
}
