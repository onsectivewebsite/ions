/**
 * TikTok Lead Generation integration — stub-aware. Same pattern as Meta.
 *
 * TikTok's Lead Gen API webhook posts a JSON body and signs it with
 * `X-TikTok-Signature` (HMAC-SHA256 over the raw body using the app secret).
 * Lead form field values are included inline — no separate fetch step.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { encryptString, decryptString } from '@onsecboad/auth';

export type TikTokCreds = {
  appSecret: string;
  advertiserId: string; // identifies the firm's TikTok ad account
  accessToken: string;
};

export type EncryptedTikTokConfig = {
  appSecretEnc: string;
  advertiserId: string;
  accessTokenEnc: string;
};

export type TikTokMode = 'real' | 'dry-run';

const DUMMY_PREFIXES = ['TIKTOK_dummy', 'ADV_dummy', 'dummy_'];

export function isDryRun(creds: TikTokCreds | null): boolean {
  if (!creds) return true;
  if (!creds.appSecret || !creds.advertiserId) return true;
  if (DUMMY_PREFIXES.some((p) => creds.advertiserId.startsWith(p))) return true;
  return false;
}

export function modeFor(creds: TikTokCreds | null): TikTokMode {
  return isDryRun(creds) ? 'dry-run' : 'real';
}

export function encryptTikTokCreds(creds: TikTokCreds): EncryptedTikTokConfig {
  return {
    appSecretEnc: encryptString(creds.appSecret),
    advertiserId: creds.advertiserId,
    accessTokenEnc: encryptString(creds.accessToken),
  };
}

export function decryptTikTokCreds(enc: EncryptedTikTokConfig | null): TikTokCreds | null {
  if (!enc?.appSecretEnc || !enc?.accessTokenEnc) return null;
  return {
    appSecret: decryptString(enc.appSecretEnc),
    advertiserId: enc.advertiserId,
    accessToken: decryptString(enc.accessTokenEnc),
  };
}

export function verifyTikTokSignature(
  creds: TikTokCreds | null,
  signatureHeader: string | undefined,
  rawBody: Buffer | string,
): boolean {
  if (isDryRun(creds)) return true;
  if (!signatureHeader) return false;
  const expected = createHmac('sha256', creds!.appSecret)
    .update(typeof rawBody === 'string' ? Buffer.from(rawBody) : rawBody)
    .digest('hex');
  if (signatureHeader.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(signatureHeader, 'hex'), Buffer.from(expected, 'hex'));
}

// ─── Lead extraction ───────────────────────────────────────────────────────
// TikTok lead webhook body shape (subset we care about):
//   {
//     event: 'lead.create',
//     advertiser_id: '...',
//     data: {
//       lead_id: '...',
//       form_id: '...',
//       created_at: 1700000000,
//       fields: [{ name: 'email', value: '...' }, ...]
//     }
//   }

export type TikTokLead = {
  id: string;
  createdAt: string;
  formId?: string;
  advertiserId: string;
  fields: Record<string, string>;
};

export type TikTokWebhookPayload = {
  event?: string;
  advertiser_id?: string;
  data?: {
    lead_id?: string;
    form_id?: string;
    created_at?: number | string;
    fields?: Array<{ name: string; value: string }>;
  };
};

export function extractTikTokLead(body: TikTokWebhookPayload): TikTokLead | null {
  const d = body?.data;
  if (!d?.lead_id) return null;
  const fields: Record<string, string> = {};
  for (const f of d.fields ?? []) {
    fields[f.name] = f.value;
  }
  let createdAt = new Date().toISOString();
  if (typeof d.created_at === 'number') {
    createdAt = new Date(d.created_at * 1000).toISOString();
  } else if (typeof d.created_at === 'string') {
    createdAt = d.created_at;
  }
  return {
    id: d.lead_id,
    createdAt,
    formId: d.form_id,
    advertiserId: body.advertiser_id ?? '',
    fields,
  };
}

export type MappedLead = {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  language?: string;
  caseInterest?: string;
};

export function mapTikTokFieldsToLead(fields: Record<string, string>): MappedLead {
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
  if (fields.phone) out.phone = fields.phone;
  else if (fields.phone_number) out.phone = fields.phone_number;
  if (fields.language) out.language = fields.language;
  if (fields.case_interest) out.caseInterest = fields.case_interest;
  else if (fields.service_interest) out.caseInterest = fields.service_interest;
  return out;
}
