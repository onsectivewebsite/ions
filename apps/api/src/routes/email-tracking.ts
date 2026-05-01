/**
 * Email-tracking endpoints. No auth — possession of the EmailLog id
 * (a UUID embedded in the email body) is the auth.
 *
 *   GET /api/v1/email/open/:id.png  → 1x1 transparent PNG, stamps openedAt
 *   GET /api/v1/email/click/:id?to=<url> → 302 to <url>, stamps clickedAt
 *
 * Both endpoints respond even if the id doesn't match — tracking
 * shouldn't break the email rendering for the recipient.
 */
import type { Request, Response } from 'express';
import { prisma } from '@onsecboad/db';

const TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9ZptCRkAAAAASUVORK5CYII=',
  'base64',
);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function emailOpenHandler(req: Request, res: Response): Promise<void> {
  // Path is /:id.png — strip the .png suffix.
  const raw = String(req.params.id ?? '').replace(/\.png$/i, '');
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'no-store');
  // Send the pixel first so the recipient's mail client doesn't wait.
  res.end(TRANSPARENT_PNG);
  if (!UUID_RE.test(raw)) return;
  try {
    const row = await prisma.emailLog.findUnique({ where: { id: raw } });
    if (!row || row.openedAt) return;
    await prisma.emailLog.update({
      where: { id: raw },
      data: {
        openedAt: new Date(),
        status: row.status === 'sent' ? 'opened' : row.status,
      },
    });
  } catch {
    /* swallow — tracking is best-effort */
  }
}

export async function emailClickHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params.id ?? '');
  const to = String(req.query.to ?? '');
  // Validate destination — only http/https allowed; deny redirects to
  // javascript: or other schemes.
  let safeTo = '/';
  try {
    const u = new URL(to);
    if (u.protocol === 'http:' || u.protocol === 'https:') safeTo = u.toString();
  } catch {
    /* fall through — safeTo stays '/' */
  }
  // Best-effort stamp BEFORE redirect so the click row sticks even if
  // the redirect target is slow.
  if (UUID_RE.test(id)) {
    try {
      const row = await prisma.emailLog.findUnique({ where: { id } });
      if (row && !row.clickedAt) {
        await prisma.emailLog.update({
          where: { id },
          data: {
            clickedAt: new Date(),
            openedAt: row.openedAt ?? new Date(),
            status: 'clicked',
          },
        });
      }
    } catch {
      /* ignore */
    }
  }
  res.redirect(302, safeTo);
}
