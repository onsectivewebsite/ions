import { sendEmail, type SendEmailResult } from '../send';
import { htmlShell, type EmailBrand, escapeHtml } from './base';

export type SendOtpInput = {
  to: string;
  code: string;
  ttlMinutes?: number;
  recipientName?: string;
  brand?: EmailBrand;
};

export async function sendOtpEmail(input: SendOtpInput): Promise<SendEmailResult> {
  const ttl = input.ttlMinutes ?? 5;
  const greeting = input.recipientName ? `Hi ${escapeHtml(input.recipientName)},` : 'Hello,';

  const body = `
    <p style="margin:0 0 16px 0;font-size:14px;">${greeting}</p>
    <p style="margin:0 0 8px 0;font-size:14px;">Use this one-time code to finish signing in:</p>
    <div style="font-family:'JetBrains Mono',ui-monospace,Menlo,monospace;
                font-size:28px;letter-spacing:8px;font-weight:700;
                background:#f4f4f0;border:1px dashed #e5e5df;border-radius:8px;
                padding:16px;text-align:center;margin:16px 0;">
      ${escapeHtml(input.code)}
    </div>
    <p style="margin:0 0 8px 0;font-size:13px;color:#6B7280;">
      This code expires in ${ttl} minute${ttl === 1 ? '' : 's'}.
      If you did not request it, ignore this email and consider changing your password.
    </p>
  `;

  const text =
    `Your OnsecBoad sign-in code is ${input.code}\n` +
    `It expires in ${ttl} minute${ttl === 1 ? '' : 's'}.\n` +
    `If you did not request this, ignore this email.\n`;

  return sendEmail({
    to: input.to,
    subject: `Your OnsecBoad sign-in code: ${input.code}`,
    html: htmlShell(body, input.brand),
    text,
    headers: { 'X-Entity-Ref-ID': 'otp' },
  });
}
