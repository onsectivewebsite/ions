// sse-stream.js — connection-density test for the SSE realtime stream.
//
// k6 doesn't have native SSE; we use http.get with stream:false (the
// default) and just hold long-running connections via the HTTP/2
// keepalive. Realistically we want to confirm the API can hold N
// simultaneous /api/v1/stream connections without exhausting file
// descriptors or Redis subscribers.
//
// 100 connections held for 60s. Pair with the realistic-firm scenario
// to see if event delivery degrades under combined load.

import http from 'k6/http';
import { sleep } from 'k6';
import { signInStaff } from '../lib/auth.js';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';

export const options = {
  scenarios: {
    holdConnections: {
      executor: 'per-vu-iterations',
      vus: 100,
      iterations: 1,
      maxDuration: '90s',
    },
  },
};

export default function () {
  const session = signInStaff({
    email: __ENV.EMAIL || 'rk9814289618@gmail.com',
    password: __ENV.PASSWORD || 'changeme',
  });
  // SSE handshake; with timeout=60 we sit on the stream for a minute.
  // k6 will not parse events — we measure connection density only.
  http.get(`${BASE_URL}/api/v1/stream?token=${encodeURIComponent(session.accessToken)}`, {
    timeout: '60s',
    tags: { type: 'sse' },
  });
  sleep(1);
}
