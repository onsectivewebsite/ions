/**
 * Retainer agreement router. One agreement per case (DRAFT → LAWYER_APPROVED
 * → SIGNED). Lawyer approval transitions case to PENDING_RETAINER_SIGNATURE;
 * client signature transitions case to PENDING_DOCUMENTS.
 *
 * Captures audit-grade signature trail: signer's typed name, timestamp,
 * IP, user-agent. Optional canvas signature (base64 SVG/PNG) drops in
 * later via `signatureSvg` without a schema change.
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { Prisma } from '@onsecboad/db';
import type { PrismaClient } from '@onsecboad/db';
import { router } from '../trpc.js';
import { requirePermission } from '../lib/permissions.js';
import { logger } from '../logger.js';
import { publishEvent } from '../lib/realtime.js';
import { buildRetainerVars, renderTemplate, DEFAULT_RETAINER_MD } from '../lib/retainer-render.js';

/**
 * Resolve the best template for (tenant, caseType):
 *   1. case-type-specific isDefault
 *   2. case-type-specific (any active)
 *   3. tenant-wide default (caseType=null)
 *   4. baked-in DEFAULT_RETAINER_MD
 */
async function pickTemplate(
  prisma: PrismaClient,
  tenantId: string,
  caseType: string,
): Promise<{ id: string | null; contentMd: string }> {
  const t = await prisma.retainerTemplate.findFirst({
    where: { tenantId, caseType, isActive: true, isDefault: true },
  });
  if (t) return { id: t.id, contentMd: t.contentMd };
  const tAny = await prisma.retainerTemplate.findFirst({
    where: { tenantId, caseType, isActive: true },
    orderBy: { createdAt: 'desc' },
  });
  if (tAny) return { id: tAny.id, contentMd: tAny.contentMd };
  const tDefault = await prisma.retainerTemplate.findFirst({
    where: { tenantId, caseType: null, isActive: true, isDefault: true },
  });
  if (tDefault) return { id: tDefault.id, contentMd: tDefault.contentMd };
  const tFallback = await prisma.retainerTemplate.findFirst({
    where: { tenantId, caseType: null, isActive: true },
    orderBy: { createdAt: 'desc' },
  });
  if (tFallback) return { id: tFallback.id, contentMd: tFallback.contentMd };
  return { id: null, contentMd: DEFAULT_RETAINER_MD };
}

/**
 * Auto-instantiate a DRAFT agreement for a case. Idempotent — if one
 * already exists for this case, returns it untouched. Called from
 * autoCreateCaseFromRetainer after a RETAINER outcome, AND from
 * cases.create after a manual case creation.
 */
export async function ensureRetainerAgreement(
  prisma: PrismaClient,
  args: { tenantId: string; caseId: string; actorId: string },
): Promise<{ agreementId: string; created: boolean }> {
  const existing = await prisma.retainerAgreement.findUnique({
    where: { caseId: args.caseId },
  });
  if (existing) return { agreementId: existing.id, created: false };

  const c = await prisma.case.findFirst({
    where: { id: args.caseId, tenantId: args.tenantId, deletedAt: null },
    include: {
      client: true,
      lawyer: true,
      tenant: true,
    },
  });
  if (!c) throw new Error('Case not found for agreement instantiation');

  const tpl = await pickTemplate(prisma, args.tenantId, c.caseType);
  const todayIso = new Date().toISOString().slice(0, 10);
  const vars = buildRetainerVars({
    tenant: c.tenant,
    client: c.client,
    lawyer: c.lawyer,
    case_: c,
    todayIso,
  });
  const rendered = renderTemplate(tpl.contentMd, vars);

  const created = await prisma.retainerAgreement.create({
    data: {
      tenantId: args.tenantId,
      caseId: c.id,
      templateId: tpl.id,
      status: 'DRAFT',
      contentMd: rendered,
      createdBy: args.actorId,
    },
  });
  logger.info(
    { caseId: c.id, agreementId: created.id, templateId: tpl.id },
    'retainer agreement instantiated',
  );
  return { agreementId: created.id, created: true };
}

export const retainerRouter = router({
  // Returns the case's agreement (auto-instantiates if missing). Always
  // safe to call from the case detail page.
  getForCase: requirePermission('cases', 'read')
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const c = await ctx.prisma.case.findFirst({
        where: { id: input.caseId, tenantId: ctx.tenantId, deletedAt: null },
      });
      if (!c) throw new TRPCError({ code: 'NOT_FOUND' });
      const existing = await ctx.prisma.retainerAgreement.findUnique({
        where: { caseId: c.id },
        include: {
          approvedBy: { select: { id: true, name: true, email: true } },
        },
      });
      if (existing) return existing;
      // Lazy instantiate so the lawyer always sees something to review.
      await ensureRetainerAgreement(ctx.prisma, {
        tenantId: ctx.tenantId,
        caseId: c.id,
        actorId: ctx.session.sub,
      });
      return ctx.prisma.retainerAgreement.findUnique({
        where: { caseId: c.id },
        include: {
          approvedBy: { select: { id: true, name: true, email: true } },
        },
      });
    }),

  // Re-render from the current template. Allowed only when DRAFT — once
  // approved, content is frozen.
  regenerate: requirePermission('cases', 'write')
    .input(z.object({ caseId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const a = await ctx.prisma.retainerAgreement.findUnique({
        where: { caseId: input.caseId },
      });
      if (!a) throw new TRPCError({ code: 'NOT_FOUND' });
      if (a.tenantId !== ctx.tenantId) throw new TRPCError({ code: 'NOT_FOUND' });
      if (a.status !== 'DRAFT') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Already approved — content is frozen.',
        });
      }
      const c = await ctx.prisma.case.findFirst({
        where: { id: input.caseId, tenantId: ctx.tenantId },
        include: { client: true, lawyer: true, tenant: true },
      });
      if (!c) throw new TRPCError({ code: 'NOT_FOUND' });
      const tpl = await pickTemplate(ctx.prisma, ctx.tenantId, c.caseType);
      const rendered = renderTemplate(
        tpl.contentMd,
        buildRetainerVars({
          tenant: c.tenant,
          client: c.client,
          lawyer: c.lawyer,
          case_: c,
          todayIso: new Date().toISOString().slice(0, 10),
        }),
      );
      const updated = await ctx.prisma.retainerAgreement.update({
        where: { caseId: c.id },
        data: { contentMd: rendered, templateId: tpl.id },
      });
      return updated;
    }),

  // Inline edit while DRAFT — lawyer tweaks rendered text before approval.
  editDraft: requirePermission('cases', 'write')
    .input(z.object({ caseId: z.string().uuid(), contentMd: z.string().min(20).max(100_000) }))
    .mutation(async ({ ctx, input }) => {
      const a = await ctx.prisma.retainerAgreement.findUnique({
        where: { caseId: input.caseId },
      });
      if (!a || a.tenantId !== ctx.tenantId) throw new TRPCError({ code: 'NOT_FOUND' });
      if (a.status !== 'DRAFT') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot edit an approved agreement.',
        });
      }
      const updated = await ctx.prisma.retainerAgreement.update({
        where: { id: a.id },
        data: { contentMd: input.contentMd },
      });
      return updated;
    }),

  // Lawyer approves the rendered terms. Captures their typed name (must
  // match the authenticated lawyer's name to avoid spoofing) + IP + UA.
  // Side effect: case → PENDING_RETAINER_SIGNATURE.
  lawyerApprove: requirePermission('cases', 'write')
    .input(
      z.object({
        caseId: z.string().uuid(),
        typedName: z.string().min(2).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const c = await ctx.prisma.case.findFirst({
        where: { id: input.caseId, tenantId: ctx.tenantId, deletedAt: null },
        include: { lawyer: true },
      });
      if (!c) throw new TRPCError({ code: 'NOT_FOUND' });
      if (c.status !== 'PENDING_RETAINER') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Case must be PENDING_RETAINER to approve (currently ${c.status}).`,
        });
      }
      // Only the assigned lawyer may approve (or a firm admin via tenant scope).
      if (ctx.scope !== 'tenant' && c.lawyerId !== ctx.perms.userId) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the assigned lawyer can approve this retainer.',
        });
      }
      // Typed name sanity — must match the lawyer of record (case-insensitive,
      // trimmed). Stops "approving as someone else" mistakes.
      const expected = c.lawyer.name.trim().toLowerCase();
      if (input.typedName.trim().toLowerCase() !== expected) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Typed name must match the lawyer of record exactly: "${c.lawyer.name}".`,
        });
      }

      const a = await ctx.prisma.retainerAgreement.findUnique({
        where: { caseId: c.id },
      });
      if (!a) throw new TRPCError({ code: 'NOT_FOUND', message: 'Retainer not yet drafted' });
      if (a.status !== 'DRAFT') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Already approved.' });
      }

      const now = new Date();
      const [updated] = await ctx.prisma.$transaction([
        ctx.prisma.retainerAgreement.update({
          where: { id: a.id },
          data: {
            status: 'LAWYER_APPROVED',
            approvedById: ctx.session.sub,
            approvedAt: now,
            approvedIp: ctx.ip,
            approvedUserAgent: ctx.userAgent ?? null,
          },
        }),
        ctx.prisma.case.update({
          where: { id: c.id },
          data: {
            status: 'PENDING_RETAINER_SIGNATURE',
            retainerApprovedAt: now,
          },
        }),
        ctx.prisma.auditLog.create({
          data: {
            tenantId: ctx.tenantId,
            actorId: ctx.session.sub,
            actorType: 'USER',
            action: 'retainer.lawyerApprove',
            targetType: 'RetainerAgreement',
            targetId: a.id,
            payload: { caseId: c.id, typedName: input.typedName },
            ip: ctx.ip,
            userAgent: ctx.userAgent ?? null,
          },
        }),
      ]);
      void publishEvent(
        { kind: 'tenant', tenantId: ctx.tenantId },
        { type: 'case.status', caseId: c.id, status: 'PENDING_RETAINER_SIGNATURE' },
      );
      return updated;
    }),

  // Client signs in-house. Receptionist or whoever runs the meeting captures
  // the typed name on the client's behalf — they're sitting next to the
  // client at a tablet/laptop. The audit fields prove who recorded it
  // (ctx.session.sub) + when + from where (IP/UA).
  // Side effect: case → PENDING_DOCUMENTS.
  clientSign: requirePermission('cases', 'write')
    .input(
      z.object({
        caseId: z.string().uuid(),
        signedName: z.string().min(2).max(200),
        signatureSvg: z.string().max(200_000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const c = await ctx.prisma.case.findFirst({
        where: { id: input.caseId, tenantId: ctx.tenantId, deletedAt: null },
        include: { client: true },
      });
      if (!c) throw new TRPCError({ code: 'NOT_FOUND' });
      if (c.status !== 'PENDING_RETAINER_SIGNATURE') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Case must be PENDING_RETAINER_SIGNATURE to sign (currently ${c.status}).`,
        });
      }
      const a = await ctx.prisma.retainerAgreement.findUnique({
        where: { caseId: c.id },
      });
      if (!a || a.status !== 'LAWYER_APPROVED') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Retainer not lawyer-approved.' });
      }

      const now = new Date();
      const data: Prisma.RetainerAgreementUpdateInput = {
        status: 'SIGNED',
        signedName: input.signedName,
        signedAt: now,
        signedIp: ctx.ip,
        signedUserAgent: ctx.userAgent ?? null,
      };
      if (input.signatureSvg) data.signatureSvg = input.signatureSvg;

      const [updated] = await ctx.prisma.$transaction([
        ctx.prisma.retainerAgreement.update({ where: { id: a.id }, data }),
        ctx.prisma.case.update({
          where: { id: c.id },
          data: {
            status: 'PENDING_DOCUMENTS',
            retainerSignedAt: now,
          },
        }),
        ctx.prisma.auditLog.create({
          data: {
            tenantId: ctx.tenantId,
            actorId: ctx.session.sub,
            actorType: 'USER',
            action: 'retainer.clientSign',
            targetType: 'RetainerAgreement',
            targetId: a.id,
            payload: {
              caseId: c.id,
              signedName: input.signedName,
              hasCanvasSignature: !!input.signatureSvg,
            },
            ip: ctx.ip,
            userAgent: ctx.userAgent ?? null,
          },
        }),
      ]);
      void publishEvent(
        { kind: 'tenant', tenantId: ctx.tenantId },
        { type: 'case.status', caseId: c.id, status: 'PENDING_DOCUMENTS' },
      );
      return updated;
    }),
});
