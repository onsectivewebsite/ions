/**
 * Meta (Facebook + Instagram) Lead Ads integration — stub-aware.
 *
 * Mirrors the Twilio pattern: per-tenant creds (app secret, page id, page
 * access token, verify token) live encrypted in Tenant.meta JSON. Each
 * webhook call resolves the firm's creds dynamically — there is no global
 * Meta config.
 *
 * Dry-run triggers when creds are missing OR pageId starts with `META_dummy`.
 * In dry-run, signature verification is skipped (trust local replay) and the
 * Graph-API lead fetch returns synthetic data so the rest of the system can
 * be exercised without a Facebook business account.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { encryptString, decryptString } from '@onsecboad/auth';

export type MetaCreds = {
  appSecret: string; // signs webhook payloads
  pageId: string; // the FB Page receiving leads
  pageAccessToken: string; // long-lived token to fetch lead details
  verifyToken: string; // user-chosen string Meta echoes during subscription
  graphApiVersion?: string; // e.g. 'v19.0'
};

export type EncryptedMetaConfig = {
  appSecretEnc: string;
  pageId: string;
  pageAccessTokenEnc: string;
  verifyTokenEnc: string;
  graphApiVersion?: string;
};

export type MetaMode = 'real' | 'dry-run';

const DUMMY_PAGE_PREFIXES = ['META_dummy', 'PAGE_dummy', 'dummy_'];

export function isDryRun(creds: MetaCreds | null): boolean {
  if (!creds) return true;
  if (!creds.appSecret || !creds.pageAccessToken || !creds.pageId) return true;
  if (DUMMY_PAGE_PREFIXES.some((p) => creds.pageId.startsWith(p))) return true;
  return false;
}

export function modeFor(creds: MetaCreds | null): MetaMode {
  return isDryRun(creds) ? 'dry-run' : 'real';
}

export function encryptMetaCreds(creds: MetaCreds): EncryptedMetaConfig {
  return {
    appSecretEnc: encryptString(creds.appSecret),
    pageId: creds.pageId,
    pageAccessTokenEnc: encryptString(creds.pageAccessToken),
    verifyTokenEnc: encryptString(creds.verifyToken),
    graphApiVersion: creds.graphApiVersion ?? 'v19.0',
  };
}

export function decryptMetaCreds(enc: EncryptedMetaConfig | null): MetaCreds | null {
  if (!enc?.appSecretEnc || !enc?.pageAccessTokenEnc) return null;
  return {
    appSecret: decryptString(enc.appSecretEnc),
    pageId: enc.pageId,
    pageAccessToken: decryptString(enc.pageAccessTokenEnc),
    verifyToken: decryptString(enc.verifyTokenEnc),
    graphApiVersion: enc.graphApiVersion ?? 'v19.0',
  };
}

// ─── Webhook signature verification ────────────────────────────────────────

/**
 * Verifies Meta's `X-Hub-Signature-256` header against the raw request body.
 * Header format is `sha256=<hex digest>`.
 *
 * Pass the *raw* body bytes — once express has JSON-parsed and re-serialized,
 * whitespace differences will break the HMAC.
 */
export function verifyMetaSignature(
  creds: MetaCreds | null,
  signatureHeader: string | undefined,
  rawBody: Buffer | string,
): boolean {
  if (isDryRun(creds)) return true;
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;
  const provided = signatureHeader.slice('sha256='.length);
  const expected = createHmac('sha256', creds!.appSecret)
    .update(typeof rawBody === 'string' ? Buffer.from(rawBody) : rawBody)
    .digest('hex');
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'));
}

// ─── Lead fetch ────────────────────────────────────────────────────────────

/**
 * Meta's webhook only carries the leadgen_id; actual field values must be
 * fetched from the Graph API. This function returns a uniform shape across
 * real + dry-run so the webhook handler doesn't branch on mode.
 */
export type MetaLead = {
  id: string;
  createdAt: string;
  formId?: string;
  fields: Record<string, string>; // {full_name, email, phone_number, ...}
};

export async function fetchMetaLead(
  creds: MetaCreds | null,
  leadgenId: string,
): Promise<{ lead: MetaLead; mode: MetaMode }> {
  if (isDryRun(creds)) {
    return {
      mode: 'dry-run',
      lead: {
        id: leadgenId,
        createdAt: new Date().toISOString(),
        formId: 'dryrun_form',
        fields: {
          full_name: 'Test Lead',
          email: 'test+meta@example.com',
          phone_number: '+15555550100',
        },
      },
    };
  }
  const v = creds!.graphApiVersion ?? 'v19.0';
  const url = `https://graph.facebook.com/${v}/${encodeURIComponent(leadgenId)}?fields=created_time,form_id,field_data&access_token=${encodeURIComponent(creds!.pageAccessToken)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Meta Graph API error: ${res.status} ${await res.text()}`);
  }
  type GraphResp = {
    id: string;
    created_time: string;
    form_id?: string;
    field_data: Array<{ name: string; values: string[] }>;
  };
  const data = (await res.json()) as GraphResp;
  const fields: Record<string, string> = {};
  for (const fd of data.field_data ?? []) {
    fields[fd.name] = fd.values?.[0] ?? '';
  }
  return {
    mode: 'real',
    lead: {
      id: data.id,
      createdAt: data.created_time,
      formId: data.form_id,
      fields,
    },
  };
}

// ─── Field mapping ─────────────────────────────────────────────────────────

/**
 * Common Meta lead form field names → our Lead model fields. Meta's field
 * names depend on what the advertiser configured; we cover the standard set
 * and fall back to a regex sniff for the rest.
 */
export type MappedLead = {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  language?: string;
  caseInterest?: string;
};

export function mapMetaFieldsToLead(fields: Record<string, string>): MappedLead {
  const out: MappedLead = {};
  const fullName = fields.full_name ?? fields.name ?? '';
  if (fullName) {
    const [first, ...rest] = fullName.split(/\s+/);
    out.firstName = first;
    if (rest.length > 0) out.lastName = rest.join(' ');
  }
  if (fields.first_name) out.firstName = fields.first_name;
  if (fields.last_name) out.lastName = fields.last_name;
  if (fields.email) out.email = fields.email;
  if (fields.phone_number) out.phone = fields.phone_number;
  else if (fields.phone) out.phone = fields.phone;
  if (fields.language) out.language = fields.language;
  if (fields.case_interest) out.caseInterest = fields.case_interest;
  else if (fields.service_interest) out.caseInterest = fields.service_interest;
  return out;
}
