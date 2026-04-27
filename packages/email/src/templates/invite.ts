import { sendEmail, type SendEmailResult } from '../send';
import { htmlShell, buttonHtml, escapeHtml, type EmailBrand } from './base';

export type SendInviteInput = {
  to: string;
  inviteeName: string;
  firmName: string;
  roleName: string;
  inviteUrl: string;
  invitedByName?: string;
  brand?: EmailBrand;
};

export async function sendInviteEmail(input: SendInviteInput): Promise<SendEmailResult> {
  const inviter = input.invitedByName ? escapeHtml(input.invitedByName) : 'Your firm admin';

  const body = `
    <h1 style="margin:0 0 12px 0;font-size:20px;font-weight:600;">
      You're invited to ${escapeHtml(input.firmName)}
    </h1>
    <p style="margin:0 0 16px 0;font-size:14px;">
      ${inviter} added you as a <strong>${escapeHtml(input.roleName)}</strong> on OnsecBoad.
      Click the button below to set a password, enroll two-factor authentication,
      and start using the platform.
    </p>
    <p style="margin:24px 0;">
      ${buttonHtml('Accept invite', input.inviteUrl, input.brand?.primaryHex)}
    </p>
    <p style="margin:0 0 8px 0;font-size:12px;color:#6B7280;">
      Or copy this link into your browser: ${escapeHtml(input.inviteUrl)}
    </p>
    <p style="margin:0;font-size:12px;color:#6B7280;">
      This invite expires in 7 days.
    </p>
  `;

  const text =
    `${inviter} invited you to ${input.firmName} on OnsecBoad as ${input.roleName}.\n` +
    `Accept here (expires in 7 days): ${input.inviteUrl}\n`;

  return sendEmail({
    to: input.to,
    subject: `You're invited to ${input.firmName} on OnsecBoad`,
    html: htmlShell(body, input.brand),
    text,
    headers: { 'X-Entity-Ref-ID': 'invite' },
  });
}
