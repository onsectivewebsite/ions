/**
 * Client router. Phase 4 foundation.
 *
 * Phone is the canonical client key (per docs/01-domain.md). The receptionist
 * walk-in flow keys off this — type a phone, get the existing client + their
 * full lead/intake history, OR start a new lead prefilled with the phone.
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { Prisma } from '@onsecboad/db';
import { router } from '../trpc.js';
import { requirePermission } from '../lib/permissions.js';

const phoneSchema = z.string().min(4).max(40);

export const clientRouter = router({
  // Receptionist's primary tool: phone lookup.
  // Returns the matching Client (if any) plus every lead with that phone
  // and every past intake submission attached to either.
  findByPhone: requirePermission('clients', 'read')
    .input(z.object({ phone: phoneSchema }))
    .query(async ({ ctx, input }) => {
      const phone = input.phone.trim();
      const client = await ctx.prisma.client.findFirst({
        where: { tenantId: ctx.tenantId, phone, deletedAt: null },
      });
      const leads = await ctx.prisma.lead.findMany({
        where: { tenantId: ctx.tenantId, phone, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          source: true,
          status: true,
          caseInterest: true,
          createdAt: true,
          assignedTo: { select: { id: true, name: true } },
        },
      });
      const intake = await ctx.prisma.intakeSubmission.findMany({
        where: {
          tenantId: ctx.tenantId,
          OR: [
            ...(client ? [{ clientId: client.id }] : []),
            ...(leads.length ? [{ leadId: { in: leads.map((l) => l.id) } }] : []),
          ],
        },
        orderBy: { submittedAt: 'desc' },
        take: 20,
        include: {
          template: { select: { id: true, name: true, caseType: true } },
        },
      });
      return { client, leads, intake };
    }),

  list: requirePermission('clients', 'read')
    .input(
      z
        .object({
          page: z.number().int().min(1).default(1),
          q: z.string().optional(),
          branchId: z.string().uuid().optional(),
        })
        .default({ page: 1 }),
    )
    .query(async ({ ctx, input }) => {
      // Branch-scoped readers see only their branch's clients.
      const branchScopeFilter =
        ctx.scope === 'branch' && ctx.perms.branchId
          ? { branchId: ctx.perms.branchId }
          : {};
      const where: Prisma.ClientWhereInput = {
        tenantId: ctx.tenantId,
        deletedAt: null,
        ...branchScopeFilter,
        ...(input.branchId ? { branchId: input.branchId } : {}),
        ...(input.q
          ? {
              OR: [
                { firstName: { contains: input.q, mode: 'insensitive' as const } },
                { lastName: { contains: input.q, mode: 'insensitive' as const } },
                { phone: { contains: input.q } },
                { email: { contains: input.q, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      };
      const [items, total] = await Promise.all([
        ctx.prisma.client.findMany({
          where,
          orderBy: { updatedAt: 'desc' },
          take: 20,
          skip: (input.page - 1) * 20,
        }),
        ctx.prisma.client.count({ where }),
      ]);
      return { items, total };
    }),

  get: requirePermission('clients', 'read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const client = await ctx.prisma.client.findFirst({
        where: { id: input.id, tenantId: ctx.tenantId, deletedAt: null },
      });
      if (!client) throw new TRPCError({ code: 'NOT_FOUND' });
      // Branch scope guard
      if (
        ctx.scope === 'branch' &&
        ctx.perms.branchId &&
        client.branchId !== ctx.perms.branchId
      ) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      const intake = await ctx.prisma.intakeSubmission.findMany({
        where: { tenantId: ctx.tenantId, clientId: client.id },
        orderBy: { submittedAt: 'desc' },
        include: { template: { select: { id: true, name: true, caseType: true } } },
      });
      return { client, intake };
    }),

  // Promote a lead to a client. Idempotent on (tenant, phone) — if a client
  // already exists for that phone we attach the lead to it instead of creating
  // a duplicate. Returns the resulting clientId either way.
  upsertFromLead: requirePermission('clients', 'write')
    .input(z.object({ leadId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const lead = await ctx.prisma.lead.findFirst({
        where: { id: input.leadId, tenantId: ctx.tenantId, deletedAt: null },
      });
      if (!lead) throw new TRPCError({ code: 'NOT_FOUND' });
      if (!lead.phone) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Lead has no phone number — cannot create a Client.',
        });
      }
      const existing = await ctx.prisma.client.findFirst({
        where: { tenantId: ctx.tenantId, phone: lead.phone, deletedAt: null },
      });
      if (existing) {
        return { id: existing.id, created: false };
      }
      const client = await ctx.prisma.client.create({
        data: {
          tenantId: ctx.tenantId,
          branchId: lead.branchId,
          firstName: lead.firstName,
          lastName: lead.lastName,
          email: lead.email,
          phone: lead.phone,
          language: lead.language,
          primaryLeadId: lead.id,
        },
      });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'client.create',
          targetType: 'Client',
          targetId: client.id,
          payload: { fromLeadId: lead.id, phone: lead.phone },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return { id: client.id, created: true };
    }),

  update: requirePermission('clients', 'write')
    .input(
      z.object({
        id: z.string().uuid(),
        firstName: z.string().max(120).optional(),
        lastName: z.string().max(120).optional(),
        email: z.string().email().nullable().optional(),
        phone: phoneSchema.optional(),
        language: z.string().max(10).nullable().optional(),
        notes: z.string().max(4000).nullable().optional(),
        branchId: z.string().uuid().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.client.findFirst({
        where: { id: input.id, tenantId: ctx.tenantId, deletedAt: null },
      });
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });

      const data: Prisma.ClientUpdateInput = {};
      if (input.firstName !== undefined) data.firstName = input.firstName;
      if (input.lastName !== undefined) data.lastName = input.lastName;
      if (input.email !== undefined) data.email = input.email;
      if (input.phone !== undefined) data.phone = input.phone;
      if (input.language !== undefined) data.language = input.language;
      if (input.notes !== undefined) data.notes = input.notes;
      if (input.branchId !== undefined) {
        data.branch =
          input.branchId === null
            ? { disconnect: true }
            : { connect: { id: input.branchId } };
      }

      const client = await ctx.prisma.client.update({ where: { id: input.id }, data });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'client.update',
          targetType: 'Client',
          targetId: client.id,
          payload: { changes: Object.keys(input).filter((k) => k !== 'id') },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return client;
    }),
});
