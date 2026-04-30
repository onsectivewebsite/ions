// Sign-in helper for k6. Returns { accessToken } or throws.
//
// Two-step flow: auth.signIn → auth.verify2FA. For load tests we
// assume the staging env exposes a fixed OTP via OTP_FIXTURE, OR the
// test users are configured with a known TOTP that the runner can
// pre-compute. Real email OTP flows aren't testable from k6 since
// k6 can't read mailboxes.

import http from 'k6/http';
import { check, fail } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';

function rpcMutation(procedure, input, opts = {}) {
  const headers = { 'content-type': 'application/json' };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const res = http.post(`${BASE_URL}/trpc/${procedure}`, JSON.stringify({ json: input }), {
    headers,
    tags: { type: 'write', procedure },
  });
  check(res, { [`${procedure} 2xx`]: (r) => r.status >= 200 && r.status < 300 });
  if (res.status >= 300) {
    return null;
  }
  const body = res.json();
  return body && body.result && body.result.data ? body.result.data.json ?? body.result.data : null;
}

export function rpcQuery(procedure, input, opts = {}) {
  const headers = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const url =
    input === undefined
      ? `${BASE_URL}/trpc/${procedure}`
      : `${BASE_URL}/trpc/${procedure}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
  const res = http.get(url, { headers, tags: { type: 'read', procedure } });
  check(res, { [`${procedure} 2xx`]: (r) => r.status >= 200 && r.status < 300 });
  if (res.status >= 300) return null;
  const body = res.json();
  return body && body.result && body.result.data ? body.result.data.json ?? body.result.data : null;
}

export { rpcMutation };

export function signInStaff({ email, password, otp }) {
  const stage1 = rpcMutation('auth.signIn', { email, password });
  if (!stage1 || !stage1.ticket) {
    fail(`auth.signIn returned no ticket for ${email}`);
  }
  // Trigger email OTP if the user has it (TOTP users skip this).
  if (stage1.methods && stage1.methods.includes('email_otp') && !stage1.methods.includes('totp')) {
    rpcMutation('auth.requestEmailOtp', { ticket: stage1.ticket });
  }
  const code = otp || __ENV.OTP_FIXTURE;
  if (!code) {
    fail('OTP_FIXTURE env var required for load-test sign-in');
  }
  const verify = rpcMutation('auth.verify2FA', { ticket: stage1.ticket, code });
  if (!verify || !verify.accessToken) {
    fail('auth.verify2FA returned no accessToken');
  }
  return { accessToken: verify.accessToken };
}

export function signInPortal({ email, password }) {
  const r = rpcMutation('portal.signIn', { email, password });
  if (!r || !r.accessToken) fail(`portal.signIn returned no accessToken for ${email}`);
  return { accessToken: r.accessToken };
}
