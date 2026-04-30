import { sendEmail, type SendEmailResult } from '../send';
import { htmlShell, type EmailBrand, escapeHtml } from './base';

export type SecurityEventKind =
  | 'login_success'
  | 'login_fail'
  | 'account_locked'
  | 'unauthorized_login'
  | 'password_reset_requested'
  | 'password_reset_completed'
  | 'password_reset_unknown_account'
  | 'password_changed';

type Context = {
  ip?: string | null;
  userAgent?: string | null;
  at?: Date;
  resetUrl?: string;
  email?: string;
  reasons?: string[];
};

type Copy = { subject: string; heading: string; body: string };

function copy(kind: SecurityEventKind, ctx: Context, productName: string): Copy {
  const at = (ctx.at ?? new Date()).toUTCString();
  const where =
    ctx.ip || ctx.userAgent
      ? `<p style="margin:8px 0 0 0;font-size:12px;color:#6B7280;">
           ${ctx.ip ? `IP: ${escapeHtml(ctx.ip)} · ` : ''}${ctx.userAgent ? `Device: ${escapeHtml(ctx.userAgent)} · ` : ''}${escapeHtml(at)}
         </p>`
      : `<p style="margin:8px 0 0 0;font-size:12px;color:#6B7280;">${escapeHtml(at)}</p>`;
  const tail =
    '<p style="margin:16px 0 0 0;font-size:13px;color:#6B7280;">If this was not you, change your password immediately and contact your firm admin.</p>';

  switch (kind) {
    case 'login_success':
      return {
        subject: `New sign-in to your ${productName} account`,
        heading: 'New sign-in',
        body: `<p style="margin:0;font-size:14px;">A successful sign-in just happened on your account.</p>${where}${tail}`,
      };
    case 'login_fail':
      return {
        subject: `Failed sign-in attempt on your ${productName} account`,
        heading: 'Failed sign-in attempt',
        body: `<p style="margin:0;font-size:14px;">Someone tried to sign in but the password was wrong.</p>${where}<p style="margin:16px 0 0 0;font-size:13px;color:#6B7280;">If this was you, no action is needed. After 5 failed attempts in a row your account is locked for 15 minutes.</p>`,
      };
    case 'account_locked':
      return {
        subject: `${productName} account locked for 15 minutes`,
        heading: 'Account locked',
        body: `<p style="margin:0;font-size:14px;">Your account has been temporarily locked after 5 failed sign-in attempts. The lock clears automatically in 15 minutes.</p>${where}<p style="margin:16px 0 0 0;font-size:13px;color:#6B7280;">If this was not you, your password may be at risk. Reset it once the lock clears.</p>`,
      };
    case 'unauthorized_login': {
      const reasons = (ctx.reasons ?? []).map((r) => `<li style="margin:4px 0;">${escapeHtml(r)}</li>`).join('');
      return {
        subject: `[Alert] Unusual sign-in to your ${productName} account`,
        heading: 'Unusual sign-in detected',
        body: `<p style="margin:0;font-size:14px;">A sign-in to your account just succeeded, but something looks unusual:</p>
               <ul style="margin:12px 0 0 18px;font-size:14px;padding:0;">${reasons || '<li style="margin:4px 0;">Unrecognized context</li>'}</ul>
               ${where}
               <p style="margin:16px 0 0 0;font-size:13px;color:#111827;">
                 <strong>If this was you,</strong> no further action is needed.
               </p>
               <p style="margin:8px 0 0 0;font-size:13px;color:#6B7280;">
                 If this was <em>not</em> you, change your password immediately and revoke all sessions from your account settings.
               </p>`,
      };
    }
    case 'password_reset_requested':
      return {
        subject: `Reset your ${productName} password`,
        heading: 'Reset your password',
        body: `<p style="margin:0 0 12px 0;font-size:14px;">Click the button below to choose a new password. The link expires in 30 minutes.</p>
               <p style="margin:0 0 0 0;"><a href="${escapeHtml(ctx.resetUrl ?? '#')}" style="display:inline-block;background:#B5132B;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;font-size:14px;">Reset password</a></p>
               <p style="margin:16px 0 0 0;font-size:12px;color:#6B7280;word-break:break-all;">Or paste this URL: ${escapeHtml(ctx.resetUrl ?? '')}</p>${where}<p style="margin:16px 0 0 0;font-size:13px;color:#6B7280;">If you did not request this, ignore this email — your password stays the same.</p>`,
      };
    case 'password_reset_completed':
      return {
        subject: `Your ${productName} password was changed`,
        heading: 'Password changed',
        body: `<p style="margin:0;font-size:14px;">Your password was just changed successfully. You will need to sign in again on every device.</p>${where}<p style="margin:16px 0 0 0;font-size:13px;color:#6B7280;">If you did not do this, contact your firm admin right away — your account may be compromised.</p>`,
      };
    case 'password_reset_unknown_account':
      return {
        subject: `Password reset attempt on ${productName}`,
        heading: 'Password reset attempt',
        body: `<p style="margin:0;font-size:14px;">Someone tried to reset the password for an account at <span style="font-family:monospace">${escapeHtml(ctx.email ?? '')}</span>, but no such account exists on ${escapeHtml(productName)}.</p>${where}<p style="margin:16px 0 0 0;font-size:13px;color:#6B7280;">You are receiving this because the address is on file with us in another context (e.g. previous tenancy). No action is needed.</p>`,
      };
    case 'password_changed':
      return {
        subject: `Your ${productName} password was changed`,
        heading: 'Password changed',
        body: `<p style="margin:0;font-size:14px;">Your password was just changed from inside the app.</p>${where}<p style="margin:16px 0 0 0;font-size:13px;color:#6B7280;">If you did not do this, change your password again immediately and contact your firm admin — your account may be compromised.</p>`,
      };
  }
}

export type SendSecurityEventInput = {
  to: string;
  kind: SecurityEventKind;
  recipientName?: string;
  brand?: EmailBrand;
  ip?: string | null;
  userAgent?: string | null;
  at?: Date;
  resetUrl?: string;
  email?: string;
  reasons?: string[];
};

export async function sendSecurityEventEmail(input: SendSecurityEventInput): Promise<SendEmailResult> {
  const productName = input.brand?.productName ?? 'OnsecBoad';
  const c = copy(input.kind, input, productName);
  const greeting = input.recipientName ? `Hi ${escapeHtml(input.recipientName)},` : 'Hello,';
  const body = `
    <h2 style="margin:0 0 12px 0;font-size:18px;">${escapeHtml(c.heading)}</h2>
    <p style="margin:0 0 12px 0;font-size:14px;">${greeting}</p>
    ${c.body}
  `;
  const text =
    `${c.heading}\n\n` +
    (input.kind === 'password_reset_requested' && input.resetUrl
      ? `Reset link: ${input.resetUrl}\n\n`
      : '') +
    (input.kind === 'unauthorized_login' && input.reasons?.length
      ? `Reasons:\n${input.reasons.map((r) => `  - ${r}`).join('\n')}\n\n`
      : '') +
    `When: ${(input.at ?? new Date()).toUTCString()}\n` +
    (input.ip ? `IP: ${input.ip}\n` : '') +
    (input.userAgent ? `Device: ${input.userAgent}\n` : '') +
    `\nIf this was not you, take action immediately.\n`;

  return sendEmail({
    to: input.to,
    subject: c.subject,
    html: htmlShell(body, input.brand),
    text,
    headers: { 'X-Entity-Ref-ID': `security:${input.kind}` },
  });
}
