/**
 * Twilio integration — stub-aware. Mirrors the Stripe + R2 pattern.
 *
 * Per-tenant creds (account SID, auth token, TwiML app SID, phone number)
 * are stored encrypted in `Tenant.twilio` JSON via @onsecboad/auth's
 * encryptString/decryptString. Each call/SMS resolves the firm's creds
 * dynamically — there's no global Twilio config.
 *
 * Dry-run mode triggers when the tenant has no creds OR when SID is
 * `AC_dummy*`. In dry-run, every operation logs and returns plausible
 * mock IDs; the rest of the system can be exercised without a Twilio
 * account.
 *
 * Real Twilio takes over the moment a firm enters real creds in
 * /settings/integrations/twilio.
 */
import twilio, { type Twilio } from 'twilio';
import { encryptString, decryptString } from '@onsecboad/auth';

export type TwilioCreds = {
  accountSid: string;
  authToken: string;
  twimlAppSid?: string;
  phoneNumber: string; // E.164 — the firm's outbound caller ID
  recordOutbound?: boolean;
};

/** Shape stored in Tenant.twilio (each sensitive value encrypted). */
export type EncryptedTwilioConfig = {
  accountSidEnc: string;
  authTokenEnc: string;
  twimlAppSidEnc?: string;
  phoneNumber: string; // not secret — kept plaintext for display
  recordOutbound?: boolean;
};

export type TwilioMode = 'real' | 'dry-run';

export function isDryRun(creds: TwilioCreds | null): boolean {
  if (!creds) return true;
  if (!creds.accountSid || !creds.authToken) return true;
  if (creds.accountSid.startsWith('AC_dummy') || creds.accountSid === 'ACxxxxxxxx') return true;
  return false;
}

export function modeFor(creds: TwilioCreds | null): TwilioMode {
  return isDryRun(creds) ? 'dry-run' : 'real';
}

export function encryptTwilioCreds(creds: TwilioCreds): EncryptedTwilioConfig {
  const out: EncryptedTwilioConfig = {
    accountSidEnc: encryptString(creds.accountSid),
    authTokenEnc: encryptString(creds.authToken),
    phoneNumber: creds.phoneNumber,
    recordOutbound: creds.recordOutbound ?? true,
  };
  if (creds.twimlAppSid) out.twimlAppSidEnc = encryptString(creds.twimlAppSid);
  return out;
}

export function decryptTwilioCreds(enc: EncryptedTwilioConfig | null): TwilioCreds | null {
  if (!enc?.accountSidEnc || !enc?.authTokenEnc) return null;
  return {
    accountSid: decryptString(enc.accountSidEnc),
    authToken: decryptString(enc.authTokenEnc),
    twimlAppSid: enc.twimlAppSidEnc ? decryptString(enc.twimlAppSidEnc) : undefined,
    phoneNumber: enc.phoneNumber,
    recordOutbound: enc.recordOutbound ?? true,
  };
}

function dryId(prefix: string): string {
  return `${prefix}${Math.random().toString(36).slice(2, 12).padEnd(10, '0').toUpperCase()}`;
}

function log(op: string, args: Record<string, unknown> = {}): void {
  // eslint-disable-next-line no-console
  console.log(`[twilio:dry-run] ${op}`, args);
}

function getClient(creds: TwilioCreds): Twilio {
  return twilio(creds.accountSid, creds.authToken);
}

// ─── Voice ────────────────────────────────────────────────────────────────

export type PlaceCallInput = {
  creds: TwilioCreds | null;
  to: string; // E.164
  agentNumber?: string; // bridge-call: Twilio dials this first, then dials `to`
  recording?: boolean;
  webhookBaseUrl?: string; // for status callback
};

export type PlaceCallResult = {
  callSid: string;
  status: string;
  mode: TwilioMode;
};

export async function placeCall(input: PlaceCallInput): Promise<PlaceCallResult> {
  if (isDryRun(input.creds)) {
    log('calls.create', { to: input.to, agent: input.agentNumber });
    return { callSid: dryId('CA_dryrun_'), status: 'queued', mode: 'dry-run' };
  }
  const client = getClient(input.creds!);
  // Bridge model: Twilio dials our agent first (if provided), then connects to lead.
  // Without agentNumber, this is a one-leg programmatic call.
  const fromNumber = input.creds!.phoneNumber;
  const twiml = input.agentNumber
    ? `<Response><Dial${input.recording ? ' record="record-from-answer"' : ''}><Number>${input.to}</Number></Dial></Response>`
    : `<Response><Say>Connecting your call.</Say><Dial><Number>${input.to}</Number></Dial></Response>`;
  const call = await client.calls.create({
    to: input.agentNumber ?? input.to,
    from: fromNumber,
    twiml,
    record: input.recording ?? true,
    statusCallback: input.webhookBaseUrl
      ? `${input.webhookBaseUrl}/api/v1/webhooks/twilio-voice/status`
      : undefined,
    statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
  });
  return { callSid: call.sid, status: call.status, mode: 'real' };
}

export type EndCallInput = { creds: TwilioCreds | null; callSid: string };
export async function endCall(input: EndCallInput): Promise<{ ok: boolean; mode: TwilioMode }> {
  if (isDryRun(input.creds)) {
    log('calls.update.completed', { callSid: input.callSid });
    return { ok: true, mode: 'dry-run' };
  }
  await getClient(input.creds!).calls(input.callSid).update({ status: 'completed' });
  return { ok: true, mode: 'real' };
}

// ─── SMS ──────────────────────────────────────────────────────────────────

export type SendSmsInput = {
  creds: TwilioCreds | null;
  to: string;
  body: string;
};

export type SendSmsResult = {
  smsSid: string;
  status: string;
  mode: TwilioMode;
};

export async function sendSms(input: SendSmsInput): Promise<SendSmsResult> {
  if (isDryRun(input.creds)) {
    log('messages.create', { to: input.to, bodyLen: input.body.length });
    return { smsSid: dryId('SM_dryrun_'), status: 'queued', mode: 'dry-run' };
  }
  const msg = await getClient(input.creds!).messages.create({
    from: input.creds!.phoneNumber,
    to: input.to,
    body: input.body,
  });
  return { smsSid: msg.sid, status: msg.status, mode: 'real' };
}

// ─── Webhook signature verification ───────────────────────────────────────

export function verifyTwilioSignature(
  creds: TwilioCreds | null,
  signature: string | undefined,
  url: string,
  params: Record<string, string>,
): boolean {
  if (isDryRun(creds)) return true; // dry-run: trust local replay
  if (!signature) return false;
  return twilio.validateRequest(creds!.authToken, signature, url, params);
}

// ─── Voice JWT for browser softphone (Slice 3.3.2) ────────────────────────

/**
 * Generates a short-lived Twilio Voice access token. The browser softphone
 * uses it to register with Twilio and place calls. Slice 3.3.1 doesn't
 * use this yet — included so the wiring is in place.
 */
export type VoiceTokenInput = {
  creds: TwilioCreds | null;
  identity: string; // typically the user's id or email — must be unique per agent
  apiKeySid?: string; // separate from accountSid; required for real mode
  apiKeySecret?: string;
  ttlSeconds?: number;
};

export function voiceToken(input: VoiceTokenInput): { token: string; mode: TwilioMode } {
  if (isDryRun(input.creds)) {
    log('voiceToken', { identity: input.identity });
    return { token: `dryrun.${input.identity}.${Date.now()}`, mode: 'dry-run' };
  }
  if (!input.apiKeySid || !input.apiKeySecret || !input.creds!.twimlAppSid) {
    throw new Error('voiceToken in real mode needs apiKeySid + apiKeySecret + twimlAppSid');
  }
  const AccessToken = twilio.jwt.AccessToken;
  const VoiceGrant = AccessToken.VoiceGrant;
  const grant = new VoiceGrant({
    outgoingApplicationSid: input.creds!.twimlAppSid,
    incomingAllow: true,
  });
  const token = new AccessToken(
    input.creds!.accountSid,
    input.apiKeySid,
    input.apiKeySecret,
    {
      identity: input.identity,
      ttl: input.ttlSeconds ?? 3600,
    },
  );
  token.addGrant(grant);
  return { token: token.toJwt(), mode: 'real' };
}
