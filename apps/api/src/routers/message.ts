/**
 * Secure messaging — Phase 7.4.
 *
 * One thread per (tenant, client). Cross-case by default — clients
 * see all their messages with the firm in one stream. Staff can
 * optionally tag a message to a specific case (caseId) for filing,
 * and the case detail page filters to that subset.
 *
 * Scope (RBAC `messages.*`):
 *   tenant   → firm admin: every client thread
 *   branch   → branch manager: clients on their branch's cases
 *   assigned → lawyer/consultant: clients on cases they own
 *   case     → filer/case manager: same idea — case-scoped
 *
 * The Client model itself doesn't carry an `assignedToId`; case ownership
 * is the proxy. We resolve it by joining through Case.lawyerId/filerId
 * for the assigned/case scopes. A client with NO case yet is invisible
 * to assigned/case roles — they have nothing to message about.
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { type Prisma } from '@onsecboad/db';
import { router } from '../trpc.js';
import { requirePermission } from '../lib/permissions.js';
import { publishEvent } from '../lib/realtime.js';

function scopedClientWhere(ctx: {
  tenantId: string;
  scope: false | 'own' | 'assigned' | 'case' | 'branch' | 'tenant';
  perms: { userId: string; branchId: string | null };
  clientId: string;
}): Prisma.ClientWhereInput {
  const base: Prisma.ClientWhereInput = {
    id: ctx.clientId,
    tenantId: ctx.tenantId,
    deletedAt: null,
  };
  if (ctx.scope === 'tenant') return base;
  if (ctx.scope === 'branch') {
    // Branch manager: client must have a case on this branch (or be
    // directly tagged to the branch via Client.branchId).
    return {
      ...base,
      OR: [
        { branchId: ctx.perms.branchId ?? '__none__' },
        { cases: { some: { branchId: ctx.perms.branchId ?? '__none__', deletedAt: null } } },
      ],
    };
  }
  // assigned / case / own — must have at least one case where this user
  // is lawyer or filer.
  return {
    ...base,
    cases: {
      some: {
        deletedAt: null,
        OR: [{ lawyerId: ctx.perms.userId }, { filerId: ctx.perms.userId }],
      },
    },
  };
}

const PREVIEW_LEN = 80;
function preview(body: string): string {
  return body.length > PREVIEW_LEN ? `${body.slice(0, PREVIEW_LEN - 1)}…` : body;
}

export const messageRouter = router({
  thread: requirePermission('messages', 'read')
    .input(
      z.object({
        clientId: z.string().uuid(),
        caseId: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(500).default(200),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Scope-check the client first — getting NOT_FOUND here means the
      // user can't even see this client.
      const client = await ctx.prisma.client.findFirst({
        where: scopedClientWhere({ ...ctx, clientId: input.clientId }),
        select: { id: true },
      });
      if (!client) throw new TRPCError({ code: 'NOT_FOUND' });

      const items = await ctx.prisma.message.findMany({
        where: {
          tenantId: ctx.tenantId,
          clientId: input.clientId,
          ...(input.caseId ? { caseId: input.caseId } : {}),
        },
        orderBy: { createdAt: 'asc' },
        take: input.limit,
        select: {
          id: true,
          sender: true,
          senderUserId: true,
          body: true,
          attachments: true,
          readByClient: true,
          readByStaff: true,
          createdAt: true,
          caseId: true,
        },
      });
      return items;
    }),

  send: requirePermission('messages', 'write')
    .input(
      z.object({
        clientId: z.string().uuid(),
        caseId: z.string().uuid().optional(),
        body: z.string().min(1).max(5000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const client = await ctx.prisma.client.findFirst({
        where: scopedClientWhere({ ...ctx, clientId: input.clientId }),
        select: { id: true },
      });
      if (!client) throw new TRPCError({ code: 'NOT_FOUND' });

      const msg = await ctx.prisma.message.create({
        data: {
          tenantId: ctx.tenantId,
          clientId: input.clientId,
          caseId: input.caseId ?? null,
          sender: 'STAFF',
          senderUserId: ctx.session.sub,
          body: input.body,
          // Mark staff-side as "read by sender" — staff sees their own
          // sent message immediately.
          readByStaff: new Date(),
        },
      });
      await publishEvent(
        { kind: 'tenant', tenantId: ctx.tenantId },
        {
          type: 'message.new',
          messageId: msg.id,
          clientId: input.clientId,
          caseId: input.caseId ?? null,
          sender: 'STAFF',
          bodyPreview: preview(input.body),
        },
      );

      // Phase 9.5 — push the staff reply to the client's mobile devices.
      void (async () => {
        const { clientAccountsForClient, pushToClientAccounts } = await import('../lib/push.js');
        const tenant = await ctx.prisma.tenant.findUnique({
          where: { id: ctx.tenantId },
          select: { displayName: true },
        });
        const accountIds = await clientAccountsForClient(ctx.prisma, input.clientId);
        if (accountIds.length === 0) return;
        await pushToClientAccounts(accountIds, {
          title: tenant?.displayName ?? 'Your firm',
          body: preview(input.body),
          data: { kind: 'message', clientId: input.clientId, caseId: input.caseId ?? null },
        });
      })();

      return msg;
    }),

  // Mark every unread CLIENT-sent message in this thread as read by staff.
  markRead: requirePermission('messages', 'write')
    .input(
      z.object({
        clientId: z.string().uuid(),
        caseId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const client = await ctx.prisma.client.findFirst({
        where: scopedClientWhere({ ...ctx, clientId: input.clientId }),
        select: { id: true },
      });
      if (!client) throw new TRPCError({ code: 'NOT_FOUND' });

      const r = await ctx.prisma.message.updateMany({
        where: {
          tenantId: ctx.tenantId,
          clientId: input.clientId,
          ...(input.caseId ? { caseId: input.caseId } : {}),
          sender: 'CLIENT',
          readByStaff: null,
        },
        data: { readByStaff: new Date() },
      });
      return { marked: r.count };
    }),

  // Per-client unread count (staff perspective). Used on case lists +
  // dashboard inbox tile. Scope honoured via clientFilterForScope.
  unreadByClient: requirePermission('messages', 'read').query(async ({ ctx }) => {
    const grouped = await ctx.prisma.message.groupBy({
      by: ['clientId'],
      where: {
        tenantId: ctx.tenantId,
        sender: 'CLIENT',
        readByStaff: null,
        client: clientFilterForScope(ctx),
      },
      _count: { _all: true },
    });
    return grouped.map((g) => ({ clientId: g.clientId, count: g._count._all }));
  }),
});

// Same logic as scopedClientWhere but without an id constraint — used in
// aggregate queries.
function clientFilterForScope(ctx: {
  tenantId: string;
  scope: false | 'own' | 'assigned' | 'case' | 'branch' | 'tenant';
  perms: { userId: string; branchId: string | null };
}): Prisma.ClientWhereInput {
  const base: Prisma.ClientWhereInput = { tenantId: ctx.tenantId, deletedAt: null };
  if (ctx.scope === 'tenant') return base;
  if (ctx.scope === 'branch') {
    return {
      ...base,
      OR: [
        { branchId: ctx.perms.branchId ?? '__none__' },
        { cases: { some: { branchId: ctx.perms.branchId ?? '__none__', deletedAt: null } } },
      ],
    };
  }
  return {
    ...base,
    cases: {
      some: {
        deletedAt: null,
        OR: [{ lawyerId: ctx.perms.userId }, { filerId: ctx.perms.userId }],
      },
    },
  };
}
