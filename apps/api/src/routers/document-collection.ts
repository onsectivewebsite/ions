/**
 * Document collection lifecycle. One per case. Auto-instantiated on read
 * if missing. Send → generates a public token + (optionally) fires SMS/email.
 * Auto-locks when client clicks Submit on the public page; FIRM_ADMIN /
 * BRANCH_MANAGER can unlock with a reason.
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { Prisma } from '@onsecboad/db';
import { router } from '../trpc.js';
import { requirePermission } from '../lib/permissions.js';
import { publishEvent } from '../lib/realtime.js';
import { logger } from '../logger.js';
import { signedUrl } from '@onsecboad/r2';
import { sendSms } from '@onsecboad/twilio';
import { sendEmail } from '@onsecboad/email';
import { loadEnv } from '@onsecboad/config';
import { getTwilioCreds } from '../lib/twilio-config.js';
import {
  ensureDocumentCollection,
  pickChecklistTemplate,
  makeCollectionToken,
  type ChecklistItem,
} from '../lib/document-collection.js';

const env = loadEnv();

export const documentCollectionRouter = router({
  // Returns the case's collection, creating a DRAFT one if none exists yet.
  getForCase: requirePermission('cases', 'read')
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const c = await ctx.prisma.case.findFirst({
        where: { id: input.caseId, tenantId: ctx.tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!c) throw new TRPCError({ code: 'NOT_FOUND' });
      await ensureDocumentCollection(ctx.prisma, {
        tenantId: ctx.tenantId,
        caseId: c.id,
        actorId: ctx.session.sub,
      });
      const collection = await ctx.prisma.documentCollection.findUnique({
        where: { caseId: c.id },
        include: {
          uploads: {
            where: { supersededAt: null },
            orderBy: { createdAt: 'desc' },
          },
        },
      });
      if (!collection) return null;
      // Build a per-item view that the UI can render directly.
      const items = (collection.itemsJson as unknown as ChecklistItem[]) ?? [];
      const byKey = new Map<string, typeof collection.uploads>();
      for (const u of collection.uploads) {
        const list = byKey.get(u.itemKey) ?? [];
        list.push(u);
        byKey.set(u.itemKey, list);
      }
      const itemsWithStatus = items.map((it) => ({
        ...it,
        uploads: byKey.get(it.key) ?? [],
        complete: (byKey.get(it.key)?.length ?? 0) > 0,
      }));
      const requiredCount = items.filter((i) => i.required).length;
      const requiredDone = items.filter((i) => i.required && (byKey.get(i.key)?.length ?? 0) > 0).length;
      return {
        ...collection,
        items: itemsWithStatus,
        requiredCount,
        requiredDone,
        publicTokenHash: undefined, // never leak the hash to the client
      };
    }),

  regenerate: requirePermission('cases', 'write')
    .input(z.object({ caseId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const collection = await ctx.prisma.documentCollection.findUnique({
        where: { caseId: input.caseId },
      });
      if (!collection || collection.tenantId !== ctx.tenantId)
        throw new TRPCError({ code: 'NOT_FOUND' });
      if (collection.status !== 'DRAFT') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Collection already sent — regenerating items would invalidate the public link.',
        });
      }
      const c = await ctx.prisma.case.findFirst({
        where: { id: input.caseId, tenantId: ctx.tenantId },
        select: { caseType: true },
      });
      if (!c) throw new TRPCError({ code: 'NOT_FOUND' });
      const tpl = await pickChecklistTemplate(ctx.prisma, ctx.tenantId, c.caseType);
      const updated = await ctx.prisma.documentCollection.update({
        where: { id: collection.id },
        data: {
          itemsJson: tpl.itemsJson as unknown as Prisma.InputJsonValue,
          templateId: tpl.id,
        },
      });
      return updated;
    }),

  editItems: requirePermission('cases', 'write')
    .input(
      z.object({
        caseId: z.string().uuid(),
        itemsJson: z
          .array(
            z.object({
              key: z.string().regex(/^[a-z][a-z0-9_]*$/),
              label: z.string().min(1).max(200),
              description: z.string().max(1000).optional(),
              required: z.boolean().default(false),
              accept: z.array(z.string()).max(20).optional(),
              maxSizeMb: z.number().int().min(1).max(200).optional(),
            }),
          )
          .min(1)
          .max(80),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const collection = await ctx.prisma.documentCollection.findUnique({
        where: { caseId: input.caseId },
      });
      if (!collection || collection.tenantId !== ctx.tenantId)
        throw new TRPCError({ code: 'NOT_FOUND' });
      if (collection.status !== 'DRAFT') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot edit items after the collection has been sent.',
        });
      }
      const updated = await ctx.prisma.documentCollection.update({
        where: { id: collection.id },
        data: { itemsJson: input.itemsJson as unknown as Prisma.InputJsonValue },
      });
      return updated;
    }),

  // Generate a fresh public token + (optionally) push it via SMS/email.
  // Re-sending replaces the prior token (one valid token per collection).
  send: requirePermission('cases', 'write')
    .input(
      z.object({
        caseId: z.string().uuid(),
        via: z.enum(['sms', 'email', 'none']).default('none'),
        ttlDays: z.number().int().min(1).max(60).default(14),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const collection = await ctx.prisma.documentCollection.findUnique({
        where: { caseId: input.caseId },
      });
      if (!collection || collection.tenantId !== ctx.tenantId)
        throw new TRPCError({ code: 'NOT_FOUND' });
      if (collection.status === 'LOCKED') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Collection is locked — unlock before re-sending.',
        });
      }

      const c = await ctx.prisma.case.findFirst({
        where: { id: input.caseId, tenantId: ctx.tenantId },
        include: {
          client: { select: { firstName: true, lastName: true, phone: true, email: true } },
          tenant: { select: { displayName: true } },
        },
      });
      if (!c) throw new TRPCError({ code: 'NOT_FOUND' });

      const { plaintext, hash } = makeCollectionToken();
      const expires = new Date();
      expires.setDate(expires.getDate() + input.ttlDays);
      const updated = await ctx.prisma.documentCollection.update({
        where: { id: collection.id },
        data: {
          status: 'SENT',
          publicTokenHash: hash,
          publicTokenExpiresAt: expires,
          sentAt: new Date(),
          sentVia: input.via === 'none' ? null : input.via,
        },
      });

      const url = `${env.APP_URL}/dc/${plaintext}`;
      let pushed: { mode?: string; ok: boolean; error?: string } = { ok: true };

      if (input.via === 'sms' && c.client.phone) {
        try {
          const creds = await getTwilioCreds(ctx.prisma, ctx.tenantId);
          const r = await sendSms({
            creds,
            to: c.client.phone,
            body: `${c.tenant.displayName}: please upload your documents at ${url} (expires in ${input.ttlDays} days).`,
          });
          pushed = { mode: r.mode, ok: true };
        } catch (e) {
          pushed = { ok: false, error: e instanceof Error ? e.message : 'sms failed' };
          logger.warn({ err: e, caseId: c.id }, 'document collection SMS failed');
        }
      }
      if (input.via === 'email' && c.client.email) {
        try {
          const text = `Hello ${c.client.firstName ?? ''},\n\nPlease upload your documents at:\n${url}\n\nThis link expires in ${input.ttlDays} days.\n\n— ${c.tenant.displayName}`;
          await sendEmail({
            to: c.client.email,
            subject: `${c.tenant.displayName} — please upload your documents`,
            text,
            html: `<p>Hello ${c.client.firstName ?? ''},</p><p>Please upload your documents at:</p><p><a href="${url}">${url}</a></p><p>This link expires in ${input.ttlDays} days.</p><p>— ${c.tenant.displayName}</p>`,
          });
          pushed = { ok: true };
        } catch (e) {
          pushed = { ok: false, error: e instanceof Error ? e.message : 'email failed' };
          logger.warn({ err: e, caseId: c.id }, 'document collection email failed');
        }
      }

      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'documentCollection.send',
          targetType: 'DocumentCollection',
          targetId: collection.id,
          payload: {
            via: input.via,
            ttlDays: input.ttlDays,
            pushed: pushed.ok ? pushed.mode ?? 'sent' : `error: ${pushed.error}`,
          },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });

      void publishEvent(
        { kind: 'tenant', tenantId: ctx.tenantId },
        { type: 'case.status', caseId: c.id, status: 'PENDING_DOCUMENTS' },
      );

      // Plaintext token only goes back to the client this once — use it to
      // copy/show the URL. We never persist it unhashed.
      return { ...updated, plaintextToken: plaintext, publicUrl: url, pushed };
    }),

  unlock: requirePermission('cases', 'write')
    .input(
      z.object({
        caseId: z.string().uuid(),
        reason: z.string().min(2).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Only branch+ scope (FIRM_ADMIN gets it via _all, BRANCH_MANAGER via
      // explicit grant). 'assigned' lawyers/filers can't unlock — matches
      // the docs invariant.
      if (ctx.scope !== 'tenant' && ctx.scope !== 'branch') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only Firm Admin or Branch Manager can unlock a submitted collection.',
        });
      }
      const collection = await ctx.prisma.documentCollection.findUnique({
        where: { caseId: input.caseId },
      });
      if (!collection || collection.tenantId !== ctx.tenantId)
        throw new TRPCError({ code: 'NOT_FOUND' });
      if (collection.status !== 'LOCKED') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Only LOCKED collections can be unlocked.',
        });
      }
      const updated = await ctx.prisma.documentCollection.update({
        where: { id: collection.id },
        data: {
          status: 'UNLOCKED',
          unlockedAt: new Date(),
          unlockedById: ctx.session.sub,
          unlockReason: input.reason,
        },
      });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'documentCollection.unlock',
          targetType: 'DocumentCollection',
          targetId: collection.id,
          payload: { reason: input.reason },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return updated;
    }),

  // Returns a 1-hour signed download URL for a single upload.
  signedDownloadUrl: requirePermission('documents', 'read')
    .input(z.object({ uploadId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const u = await ctx.prisma.documentUpload.findFirst({
        where: { id: input.uploadId, tenantId: ctx.tenantId },
      });
      if (!u) throw new TRPCError({ code: 'NOT_FOUND' });
      const url = await signedUrl(u.r2Key, 3600);
      return { url, fileName: u.fileName, contentType: u.contentType };
    }),
});
