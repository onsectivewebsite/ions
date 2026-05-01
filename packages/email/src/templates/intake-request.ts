import { sendEmail, type SendEmailInput, type SendEmailResult } from '../send';
import { htmlShell, buttonHtml, escapeHtml, type EmailBrand } from './base';

export type SendIntakeRequestInput = {
  to: string;
  recipientName: string;
  firmName: string;
  templateName: string;
  url: string;
  ttlDays: number;
  brand?: EmailBrand;
};

/**
 * Builder — returns the SendEmailInput so callers can decide whether
 * to call sendEmail directly or wrap with the tracking pipeline.
 */
export function buildIntakeRequestEmail(input: SendIntakeRequestInput): SendEmailInput {
  const body = `
    <h1 style="margin:0 0 12px 0;font-size:20px;font-weight:600;">${escapeHtml(input.firmName)} has sent you a form</h1>
    <p style="margin:0 0 12px 0;font-size:14px;">Hi ${escapeHtml(input.recipientName)},</p>
    <p style="margin:0 0 16px 0;font-size:14px;">
      Before your consultation, please complete this short intake form: <strong>${escapeHtml(input.templateName)}</strong>.
      It takes a few minutes — your answers help your immigration consultant prepare and saves you time on the call.
    </p>
    <p style="margin:24px 0;">
      ${buttonHtml('Open the form', input.url, input.brand?.primaryHex)}
    </p>
    <p style="margin:0 0 8px 0;font-size:12px;color:#6B7280;">
      Or paste this link: <span style="word-break:break-all;">${escapeHtml(input.url)}</span>
    </p>
    <p style="margin:0;font-size:12px;color:#6B7280;">
      The link expires in ${input.ttlDays} day${input.ttlDays === 1 ? '' : 's'}. Once you submit, the
      form locks — contact ${escapeHtml(input.firmName)} if you need changes.
    </p>
  `;
  const text =
    `${input.firmName} has sent you an intake form: ${input.templateName}.\n\n` +
    `Open here: ${input.url}\n\n` +
    `The link expires in ${input.ttlDays} day${input.ttlDays === 1 ? '' : 's'}.\n`;
  return {
    to: input.to,
    subject: `${input.firmName} — please fill in your intake form`,
    html: htmlShell(body, input.brand),
    text,
    headers: { 'X-Entity-Ref-ID': 'intake-request' },
  };
}

export async function sendIntakeRequestEmail(
  input: SendIntakeRequestInput,
): Promise<SendEmailResult> {
  return sendEmail(buildIntakeRequestEmail(input));
}
