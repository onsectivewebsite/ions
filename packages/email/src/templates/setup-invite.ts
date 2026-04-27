import { sendEmail, type SendEmailResult } from '../send';
import { htmlShell, buttonHtml, escapeHtml, type EmailBrand } from './base';

export type SendSetupInviteInput = {
  to: string;
  recipientName: string;
  firmName: string;
  setupUrl: string;
  ttlDays?: number;
  brand?: EmailBrand;
};

export async function sendSetupInviteEmail(input: SendSetupInviteInput): Promise<SendEmailResult> {
  const ttl = input.ttlDays ?? 7;
  const productName = input.brand?.productName ?? 'OnsecBoad';
  const body = `
    <h1 style="margin:0 0 12px 0;font-size:20px;font-weight:600;">Welcome to ${escapeHtml(productName)}</h1>
    <p style="margin:0 0 12px 0;font-size:14px;">Hi ${escapeHtml(input.recipientName)},</p>
    <p style="margin:0 0 16px 0;font-size:14px;">
      Your firm <strong>${escapeHtml(input.firmName)}</strong> has been provisioned on ${escapeHtml(productName)}.
      Click the button below to choose a password, pick your theme, and create your first branch.
    </p>
    <p style="margin:24px 0;">
      ${buttonHtml('Finish setup', input.setupUrl, input.brand?.primaryHex)}
    </p>
    <p style="margin:0 0 8px 0;font-size:12px;color:#6B7280;">
      Or paste this link: <span style="word-break:break-all;">${escapeHtml(input.setupUrl)}</span>
    </p>
    <p style="margin:0;font-size:12px;color:#6B7280;">
      This link expires in ${ttl} day${ttl === 1 ? '' : 's'}. If it expires, ask your platform administrator to resend it.
    </p>
  `;
  const text =
    `Welcome to ${productName}!\n\n` +
    `Your firm ${input.firmName} is ready. Finish setup at:\n${input.setupUrl}\n\n` +
    `This link expires in ${ttl} day${ttl === 1 ? '' : 's'}.\n`;
  return sendEmail({
    to: input.to,
    subject: `Finish setting up ${input.firmName} on ${productName}`,
    html: htmlShell(body, input.brand),
    text,
    headers: { 'X-Entity-Ref-ID': 'setup-invite' },
  });
}
