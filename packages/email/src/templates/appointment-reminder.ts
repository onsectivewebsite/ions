import { sendEmail, type SendEmailInput, type SendEmailResult } from '../send';
import { htmlShell, escapeHtml, type EmailBrand } from './base';

export type SendApptReminderInput = {
  to: string;
  recipientName: string;
  firmName: string;
  // 'long' = 24h before; 'short' = ~1h before
  kind: 'long' | 'short';
  scheduledAt: Date;
  durationMin: number;
  caseType?: string | null;
  providerName?: string | null;
  brand?: EmailBrand;
};

export function buildAppointmentReminderEmail(input: SendApptReminderInput): SendEmailInput {
  const when = input.scheduledAt.toLocaleString('en-CA', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
  const lead = input.kind === 'long' ? 'tomorrow' : 'in about an hour';
  const subject =
    input.kind === 'long'
      ? `Reminder: consultation tomorrow with ${input.firmName}`
      : `Starting soon: consultation with ${input.firmName}`;
  const body = `
    <h1 style="margin:0 0 12px 0;font-size:20px;font-weight:600;">Your consultation is ${escapeHtml(lead)}</h1>
    <p style="margin:0 0 12px 0;font-size:14px;">Hi ${escapeHtml(input.recipientName)},</p>
    <p style="margin:0 0 16px 0;font-size:14px;">
      Just a reminder that you have a consultation with <strong>${escapeHtml(input.firmName)}</strong> scheduled for:
    </p>
    <p style="margin:0 0 16px 0;padding:12px 16px;background:#f4f4f0;border-radius:8px;font-size:15px;font-weight:600;">
      ${escapeHtml(when)}<br/>
      <span style="font-weight:400;font-size:13px;color:#6B7280;">${input.durationMin} minutes${input.caseType ? ` · ${escapeHtml(input.caseType.replace(/_/g, ' '))}` : ''}${input.providerName ? ` · with ${escapeHtml(input.providerName)}` : ''}</span>
    </p>
    ${
      input.kind === 'long'
        ? `<p style="margin:0;font-size:13px;color:#6B7280;">Please reply to this email if you need to reschedule.</p>`
        : `<p style="margin:0;font-size:13px;color:#6B7280;">Bring any documents you've been asked to prepare.</p>`
    }
  `;
  const text =
    `Your consultation with ${input.firmName} is ${lead}.\n\n` +
    `When: ${when}\n` +
    `Duration: ${input.durationMin} min${input.caseType ? `\nType: ${input.caseType}` : ''}${input.providerName ? `\nWith: ${input.providerName}` : ''}\n`;
  return {
    to: input.to,
    subject,
    html: htmlShell(body, input.brand),
    text,
    headers: { 'X-Entity-Ref-ID': `appt-reminder-${input.kind}` },
  };
}

export async function sendAppointmentReminderEmail(
  input: SendApptReminderInput,
): Promise<SendEmailResult> {
  return sendEmail(buildAppointmentReminderEmail(input));
}
