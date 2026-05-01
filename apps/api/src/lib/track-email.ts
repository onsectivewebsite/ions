/**
 * Email send wrapper that injects open + click tracking. Built-in,
 * provider-agnostic — no third-party webhook needed.
 *
 * How it works:
 *  - Insert an EmailLog row in 'sent' state, get its id.
 *  - Inject a 1x1 tracking pixel pointing at /api/v1/email/open/<id>.png
 *    into the HTML. The pixel-fetch endpoint stamps openedAt.
 *  - Rewrite every <a href="..."> in the HTML to
 *    /api/v1/email/click/<id>?to=<encoded original>. The redirect
 *    endpoint stamps clickedAt + redirects to the real URL.
 *  - Hand the modified HTML to the underlying sendEmail.
 *  - Update EmailLog.providerId with the SMTP messageId on success.
 *
 * Caller passes tenantId so the EmailLog row is properly scoped (the
 * platform-side /admin/email page reads from this table).
 */
import { sendEmail, type SendEmailInput, type SendEmailResult } from '@onsecboad/email';
import { prisma } from '@onsecboad/db';
import { loadEnv } from '@onsecboad/config';
import { logger } from '../logger.js';

const env = loadEnv();

export type TrackedSendInput = SendEmailInput & {
  tenantId: string;
  templateKey: string;
  leadId?: string;
};

function injectPixel(html: string, pixelUrl: string): string {
  const tag = `<img src="${pixelUrl}" alt="" width="1" height="1" style="display:none;border:0;" />`;
  // Inject just before </body>; if no </body>, append.
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${tag}</body>`);
  }
  return html + tag;
}

function rewriteLinks(html: string, base: string): string {
  // Match href="..." or href='...'. Skip mailto:, tel:, anchors, and
  // already-tracked links. Naive regex is fine for our template HTML.
  return html.replace(/href=("|')(https?:\/\/[^"']+)\1/gi, (_match, q, url: string) => {
    if (url.startsWith(base)) return `href=${q}${url}${q}`;
    const wrapped = `${base}?to=${encodeURIComponent(url)}`;
    return `href=${q}${wrapped}${q}`;
  });
}

export async function sendTrackedEmail(input: TrackedSendInput): Promise<SendEmailResult> {
  const recipients = Array.isArray(input.to) ? input.to.join(', ') : input.to;
  const apiBase = env.API_URL.replace(/\/$/, '');

  // Insert the log row first so we have an id to embed in the tracking URLs.
  const log = await prisma.emailLog.create({
    data: {
      tenantId: input.tenantId,
      leadId: input.leadId ?? null,
      toEmail: recipients,
      fromEmail: input.from ?? env.EMAIL_FROM_DEFAULT,
      subject: input.subject,
      body: input.text,
      templateKey: input.templateKey,
      status: 'sent',
    },
  });

  const pixelUrl = `${apiBase}/api/v1/email/open/${log.id}.png`;
  const clickBase = `${apiBase}/api/v1/email/click/${log.id}`;

  let html = input.html;
  // Order matters: rewrite links FIRST so the pixel <img> isn't transformed.
  html = rewriteLinks(html, clickBase);
  html = injectPixel(html, pixelUrl);

  const result = await sendEmail({ ...input, html });

  if (result.ok) {
    if (result.messageId) {
      await prisma.emailLog.update({
        where: { id: log.id },
        data: { providerId: result.messageId },
      });
    }
  } else {
    await prisma.emailLog.update({
      where: { id: log.id },
      data: { status: 'failed', bounceReason: result.error ?? null },
    });
    logger.warn(
      { tenantId: input.tenantId, templateKey: input.templateKey, error: result.error },
      'tracked email send failed',
    );
  }

  return result;
}
