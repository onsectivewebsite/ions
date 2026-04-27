import { sendEmail, type SendEmailResult } from '../send';
import { htmlShell, buttonHtml, escapeHtml, type EmailBrand } from './base';

export type SendPasswordResetInput = {
  to: string;
  resetUrl: string;
  ttlMinutes?: number;
  brand?: EmailBrand;
};

export async function sendPasswordResetEmail(
  input: SendPasswordResetInput,
): Promise<SendEmailResult> {
  const ttl = input.ttlMinutes ?? 30;
  const body = `
    <h1 style="margin:0 0 12px 0;font-size:20px;font-weight:600;">Reset your password</h1>
    <p style="margin:0 0 16px 0;font-size:14px;">
      We received a request to reset your OnsecBoad password.
      Click the button below to choose a new one — the link expires in ${ttl} minutes.
    </p>
    <p style="margin:24px 0;">
      ${buttonHtml('Reset password', input.resetUrl, input.brand?.primaryHex)}
    </p>
    <p style="margin:0 0 8px 0;font-size:12px;color:#6B7280;">
      Link: ${escapeHtml(input.resetUrl)}
    </p>
    <p style="margin:0;font-size:12px;color:#6B7280;">
      If you did not request this, ignore this email — your password has not changed.
    </p>
  `;

  const text =
    `Reset your OnsecBoad password (link expires in ${ttl} minutes):\n${input.resetUrl}\n` +
    `If you did not request this, ignore this email.\n`;

  return sendEmail({
    to: input.to,
    subject: 'Reset your OnsecBoad password',
    html: htmlShell(body, input.brand),
    text,
    headers: { 'X-Entity-Ref-ID': 'password-reset' },
  });
}
