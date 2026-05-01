import { sendEmail, type SendEmailInput, type SendEmailResult } from '../send';
import { htmlShell, buttonHtml, escapeHtml, type EmailBrand } from './base';

export type SendUserInviteInput = {
  to: string;
  recipientName: string;
  firmName: string;
  roleName: string;
  inviterName: string;
  inviteUrl: string;
  ttlDays?: number;
  brand?: EmailBrand;
};

export function buildUserInviteEmail(input: SendUserInviteInput): SendEmailInput {
  const ttl = input.ttlDays ?? 7;
  const productName = input.brand?.productName ?? 'OnsecBoad';
  const body = `
    <h1 style="margin:0 0 12px 0;font-size:20px;font-weight:600;">You're invited to ${escapeHtml(input.firmName)}</h1>
    <p style="margin:0 0 12px 0;font-size:14px;">Hi ${escapeHtml(input.recipientName)},</p>
    <p style="margin:0 0 16px 0;font-size:14px;">
      ${escapeHtml(input.inviterName)} has invited you to join <strong>${escapeHtml(input.firmName)}</strong> on ${escapeHtml(productName)} as a <strong>${escapeHtml(input.roleName)}</strong>.
    </p>
    <p style="margin:0 0 16px 0;font-size:14px;">
      Click the button below to set a password and complete your account.
    </p>
    <p style="margin:24px 0;">
      ${buttonHtml('Accept invite', input.inviteUrl, input.brand?.primaryHex)}
    </p>
    <p style="margin:0 0 8px 0;font-size:12px;color:#6B7280;">
      Or paste this link: <span style="word-break:break-all;">${escapeHtml(input.inviteUrl)}</span>
    </p>
    <p style="margin:0;font-size:12px;color:#6B7280;">
      This invite expires in ${ttl} day${ttl === 1 ? '' : 's'}. If you weren't expecting this, ignore the email.
    </p>
  `;
  const text =
    `${input.inviterName} invited you to ${input.firmName} on ${productName} as ${input.roleName}.\n\n` +
    `Accept here: ${input.inviteUrl}\n\n` +
    `Expires in ${ttl} day${ttl === 1 ? '' : 's'}.\n`;
  return {
    to: input.to,
    subject: `${input.inviterName} invited you to ${input.firmName} on ${productName}`,
    html: htmlShell(body, input.brand),
    text,
    headers: { 'X-Entity-Ref-ID': 'user-invite' },
  };
}

export async function sendUserInviteEmail(
  input: SendUserInviteInput,
): Promise<SendEmailResult> {
  return sendEmail(buildUserInviteEmail(input));
}
