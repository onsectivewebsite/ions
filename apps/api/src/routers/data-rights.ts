/**
 * PIPEDA data-rights surface — Phase 10.1.
 *
 * Three operations on a Client:
 *   - exportClient    → bundle every row touching them as JSON, stash
 *                       the zip in R2, return a 1-hour signed URL.
 *   - requestDeletion → soft-delete + schedule hard-purge in 30 days
 *                       (configurable per-call, default 30 days). Daily
 *                       cron picks it up if `legalHoldUntil` is null.
 *   - cancelDeletion  → clears purgeAt before the cron runs.
 *   - setLegalHold    → blocks the cron until the timestamp passes.
 *
 * RBAC: `dataRights` resource (FIRM_ADMIN-only by default; firm-admin
 * via `_all`). Audit-log every action.
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { router } from '../trpc.js';
import { requirePermission } from '../lib/permissions.js';
import { uploadBuffer, signedUrl } from '@onsecboad/r2';
import { logger } from '../logger.js';

const DEFAULT_GRACE_DAYS = 30;

export const dataRightsRouter = router({
  // ─── Export ─────────────────────────────────────────────────────────
  exportClient: requirePermission('dataRights', 'write')
    .input(z.object({ clientId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const client = await ctx.prisma.client.findFirst({
        where: { id: input.clientId, tenantId: ctx.tenantId },
      });
      if (!client) throw new TRPCError({ code: 'NOT_FOUND' });

      const [
        leads,
        cases,
        appointments,
        intake,
        messages,
        uploads,
        invoices,
        payments,
        irccLog,
        portal,
      ] = await Promise.all([
        ctx.prisma.lead.findMany({ where: { tenantId: ctx.tenantId, phone: client.phone } }),
        ctx.prisma.case.findMany({
          where: { tenantId: ctx.tenantId, clientId: client.id },
          include: { lawyer: { select: { name: true } }, filer: { select: { name: true } } },
        }),
        ctx.prisma.appointment.findMany({
          where: { tenantId: ctx.tenantId, clientId: client.id },
        }),
        ctx.prisma.intakeSubmission.findMany({
          where: { tenantId: ctx.tenantId, clientId: client.id },
        }),
        ctx.prisma.message.findMany({
          where: { tenantId: ctx.tenantId, clientId: client.id },
        }),
        ctx.prisma.documentUpload.findMany({
          where: { tenantId: ctx.tenantId, case: { clientId: client.id } } as never,
        }),
        ctx.prisma.caseInvoice.findMany({
          where: { tenantId: ctx.tenantId, case: { clientId: client.id } },
          include: { items: true, payments: true },
        }),
        ctx.prisma.casePayment.findMany({
          where: { tenantId: ctx.tenantId, case: { clientId: client.id } },
        }),
        ctx.prisma.irccCorrespondence.findMany({
          where: { tenantId: ctx.tenantId, case: { clientId: client.id } } as never,
        }),
        ctx.prisma.clientPortalAccount.findUnique({
          where: { clientId: client.id },
          select: { id: true, email: true, status: true, invitedAt: true, joinedAt: true, lastLoginAt: true },
        }),
      ]);

      // Walk uploads + sign each one's R2 key so the export bundle has
      // pointers to the actual files (PIPEDA right-of-access requires
      // file copies, not just metadata). 1-hour signed URLs match the
      // rest of the system.
      const uploadsWithUrls = await Promise.all(
        uploads.map(async (u: { id: string; r2Key: string; fileName: string; sizeBytes: number; contentType: string; createdAt: Date }) => ({
          id: u.id,
          fileName: u.fileName,
          sizeBytes: u.sizeBytes,
          contentType: u.contentType,
          createdAt: u.createdAt,
          downloadUrl: await signedUrl(u.r2Key),
        })),
      );

      const bundle = {
        exportedAt: new Date().toISOString(),
        tenantId: ctx.tenantId,
        client,
        leads,
        cases,
        appointments,
        intakeSubmissions: intake,
        messages,
        uploads: uploadsWithUrls,
        invoices,
        payments,
        irccLog,
        portalAccount: portal,
      };

      // Single-file zip would need a zip lib (jszip / yazl). Skip the
      // archive layer for now — JSON + signed URLs is a complete export
      // per PIPEDA Right-to-Access (the requirement is "their data in a
      // commonly-used machine-readable format"). Ship as JSON.
      const json = JSON.stringify(bundle, null, 2);
      const buf = Buffer.from(json, 'utf8');
      const key = `tenants/${ctx.tenantId}/data-rights/exports/${client.id}-${Date.now()}.json`;
      try {
        await uploadBuffer(key, buf, 'application/json');
      } catch (e) {
        logger.error({ err: e, clientId: client.id }, 'data export R2 upload failed');
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Export upload failed' });
      }
      const url = await signedUrl(key);

      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'dataRights.export',
          targetType: 'Client',
          targetId: client.id,
          payload: {
            sizeBytes: buf.length,
            counts: {
              leads: leads.length,
              cases: cases.length,
              appointments: appointments.length,
              intake: intake.length,
              messages: messages.length,
              uploads: uploads.length,
              invoices: invoices.length,
              payments: payments.length,
              ircc: irccLog.length,
            },
          },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });

      return { url, sizeBytes: buf.length };
    }),

  // ─── Deletion lifecycle ─────────────────────────────────────────────
  requestDeletion: requirePermission('dataRights', 'write')
    .input(
      z.object({
        clientId: z.string().uuid(),
        reason: z.string().min(2).max(500),
        graceDays: z.number().int().min(0).max(365).default(DEFAULT_GRACE_DAYS),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const client = await ctx.prisma.client.findFirst({
        where: { id: input.clientId, tenantId: ctx.tenantId },
      });
      if (!client) throw new TRPCError({ code: 'NOT_FOUND' });
      if (client.legalHoldUntil && client.legalHoldUntil > new Date()) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Client is on legal hold until ${client.legalHoldUntil.toISOString()}.`,
        });
      }

      const purgeAt = new Date(Date.now() + input.graceDays * 24 * 60 * 60 * 1000);
      await ctx.prisma.$transaction(async (tx) => {
        await tx.client.update({
          where: { id: client.id },
          data: {
            purgeAt,
            deletionReason: input.reason,
            deletedAt: new Date(),
          },
        });
        // Revoke the portal account immediately so the client can't sign
        // back in during the grace window.
        await tx.clientPortalAccount.updateMany({
          where: { clientId: client.id },
          data: { status: 'DISABLED' },
        });
        // Drop active portal sessions.
        await tx.clientPortalSession.deleteMany({
          where: { account: { clientId: client.id } },
        });
        await tx.auditLog.create({
          data: {
            tenantId: ctx.tenantId,
            actorId: ctx.session.sub,
            actorType: 'USER',
            action: 'dataRights.requestDeletion',
            targetType: 'Client',
            targetId: client.id,
            payload: { reason: input.reason, graceDays: input.graceDays, purgeAt },
            ip: ctx.ip,
            userAgent: ctx.userAgent ?? null,
          },
        });
      });
      return { purgeAt };
    }),

  cancelDeletion: requirePermission('dataRights', 'write')
    .input(z.object({ clientId: z.string().uuid(), reason: z.string().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      const client = await ctx.prisma.client.findFirst({
        where: { id: input.clientId, tenantId: ctx.tenantId },
      });
      if (!client) throw new TRPCError({ code: 'NOT_FOUND' });
      if (!client.purgeAt) {
        return { ok: true, alreadyClear: true };
      }
      await ctx.prisma.client.update({
        where: { id: client.id },
        data: { purgeAt: null, deletedAt: null, deletionReason: null },
      });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'dataRights.cancelDeletion',
          targetType: 'Client',
          targetId: client.id,
          payload: { reason: input.reason ?? null },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return { ok: true };
    }),

  setLegalHold: requirePermission('dataRights', 'write')
    .input(
      z.object({
        clientId: z.string().uuid(),
        until: z.string().datetime().nullable(),
        reason: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const client = await ctx.prisma.client.findFirst({
        where: { id: input.clientId, tenantId: ctx.tenantId },
      });
      if (!client) throw new TRPCError({ code: 'NOT_FOUND' });
      const until = input.until ? new Date(input.until) : null;
      await ctx.prisma.client.update({
        where: { id: client.id },
        data: { legalHoldUntil: until },
      });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'dataRights.setLegalHold',
          targetType: 'Client',
          targetId: client.id,
          payload: { until: until?.toISOString() ?? null, reason: input.reason ?? null },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return { ok: true, until };
    }),

  // List clients with deletion / hold flags. UI: "compliance queue".
  listPending: requirePermission('dataRights', 'read').query(async ({ ctx }) => {
    return ctx.prisma.client.findMany({
      where: {
        tenantId: ctx.tenantId,
        OR: [{ purgeAt: { not: null } }, { legalHoldUntil: { not: null } }],
      },
      orderBy: [{ purgeAt: 'asc' }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        email: true,
        purgeAt: true,
        legalHoldUntil: true,
        deletionReason: true,
        deletedAt: true,
      },
    });
  }),
});
