import { loadEnv } from '@onsecboad/config';
import { getTransport } from './transport';

export type SendEmailInput = {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  from?: string;
  replyTo?: string;
  headers?: Record<string, string>;
};

export type SendEmailResult = {
  ok: boolean;
  messageId: string | null;
  dryRun: boolean;
  error?: string;
};

/**
 * Send a transactional email. Honors EMAIL_DRY_RUN — when true, the message is
 * logged and the function returns ok=true without contacting the SMTP host.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const env = loadEnv();
  const from = input.from ?? env.EMAIL_FROM_DEFAULT;
  const recipients = Array.isArray(input.to) ? input.to.join(', ') : input.to;

  if (env.EMAIL_DRY_RUN) {
    // eslint-disable-next-line no-console
    console.log(
      `[email:dry-run] from=${from} to=${recipients} subject=${JSON.stringify(input.subject)}\n` +
        `--- text ---\n${input.text}\n--- end ---`,
    );
    return { ok: true, messageId: null, dryRun: true };
  }

  try {
    const info = await getTransport().sendMail({
      from,
      to: recipients,
      subject: input.subject,
      text: input.text,
      html: input.html,
      replyTo: input.replyTo,
      headers: input.headers,
    });
    return { ok: true, messageId: info.messageId, dryRun: false };
  } catch (err) {
    return {
      ok: false,
      messageId: null,
      dryRun: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
