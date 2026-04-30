// public-lead-ingest.js — hammer /api/v1/leads/ingest.
//
// Bearer-auth via API_KEY env (osk_*). Posts plausible lead payloads at
// a sustained rate. The shared ingest helper handles idempotency on
// (tenantId, source, externalId) — we generate a fresh externalId per
// VU iteration so every call inserts.

import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';
const API_KEY = __ENV.API_KEY;

if (!API_KEY) {
  throw new Error('API_KEY env required (osk_…). Generate via apiKey.create.');
}

export const options = {
  scenarios: {
    sustained: {
      executor: 'constant-arrival-rate',
      rate: 50, // 50 ingests/s
      timeUnit: '1s',
      duration: '5m',
      preAllocatedVUs: 50,
      maxVUs: 200,
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<800'],
    http_req_failed: ['rate<0.01'],
  },
};

const SOURCES = ['meta', 'tiktok', 'website', 'referral'];
const CASE_TYPES = ['work_permit', 'study_permit', 'pr', 'visitor_visa'];
const FIRST_NAMES = ['Alex', 'Sam', 'Jordan', 'Taylor', 'Casey', 'Jamie', 'Morgan'];
const LAST_NAMES = ['Singh', 'Patel', 'Khan', 'Rodriguez', 'Lee', 'Nguyen', 'Smith'];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export default function () {
  const externalId = `loadtest-${__VU}-${__ITER}-${Date.now()}`;
  const phone = `+1${Math.floor(2000000000 + Math.random() * 7999999999)}`;
  const body = {
    json: {
      source: pick(SOURCES),
      externalId,
      firstName: pick(FIRST_NAMES),
      lastName: pick(LAST_NAMES),
      email: `lt-${externalId}@example.com`,
      phone,
      caseInterest: pick(CASE_TYPES),
      language: 'en',
      consentMarketing: true,
    },
  };

  const res = http.post(`${BASE_URL}/api/v1/leads/ingest`, JSON.stringify(body.json), {
    headers: {
      authorization: `Bearer ${API_KEY}`,
      'content-type': 'application/json',
    },
    tags: { type: 'write' },
  });

  check(res, {
    'ingest 2xx': (r) => r.status >= 200 && r.status < 300,
    'ingest has leadId': (r) => {
      try {
        return typeof r.json('leadId') === 'string';
      } catch {
        return false;
      }
    },
  });
  sleep(0.05);
}
