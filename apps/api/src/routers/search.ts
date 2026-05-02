/**
 * Global search across the firm's leads, clients, cases, and appointments.
 *
 * Powers the Cmd+K palette in the firm AppShell. Returns small grouped
 * lists — capped per group — so the UI can render results immediately
 * without paginating. Search runs case-insensitive, matches name, email,
 * phone, IRCC file number, and case type.
 *
 * Scope: respects the caller's read scope on each resource (the same
 * scope-where helpers used by the dedicated routers). Branch users only
 * see their branch's leads/clients/cases; "own" scope users see only
 * leads they're assigned to.
 */
import { z } from 'zod';
import { Prisma } from '@onsecboad/db';
import { router } from '../trpc.js';
import { firmProcedureWithPerms } from '../lib/permissions.js';

export const searchRouter = router({
  global: firmProcedureWithPerms
    .input(z.object({ q: z.string().min(1).max(200) }))
    .query(async ({ ctx, input }) => {
      const q = input.q.trim();
      if (!q) {
        return { leads: [], clients: [], cases: [], appointments: [] };
      }
      const i = { contains: q, mode: 'insensitive' as const };
      const phoneDigits = q.replace(/\D/g, '');
      const phoneSearch = phoneDigits.length >= 3 ? phoneDigits : null;

      // Build per-resource where fragments. We do NOT centralize a
      // "scope-aware-where for any resource" — each router has slightly
      // different scope semantics and getting them wrong would leak data.
      // So duplicate the logic here, narrow + obvious.
      const tenantBase: Prisma.LeadWhereInput = {
        tenantId: ctx.tenantId,
        deletedAt: null,
      };
      // Lead scope
      const leadScope: Prisma.LeadWhereInput = { ...tenantBase };
      if (ctx.perms.permissions?.leads?.read === 'branch') {
        leadScope.branchId = ctx.perms.branchId ?? '__none__';
      } else if (
        ctx.perms.permissions?.leads?.read === 'own' ||
        ctx.perms.permissions?.leads?.read === 'assigned'
      ) {
        leadScope.assignedToId = ctx.perms.userId;
      } else if (!ctx.perms.permissions?.leads?.read) {
        // No read access — skip
        leadScope.id = '__skip__';
      }

      const clientScope: Prisma.ClientWhereInput = {
        tenantId: ctx.tenantId,
        deletedAt: null,
      };
      if (ctx.perms.permissions?.clients?.read === 'branch') {
        clientScope.branchId = ctx.perms.branchId ?? '__none__';
      } else if (!ctx.perms.permissions?.clients?.read) {
        clientScope.id = '__skip__';
      }

      const caseScope: Prisma.CaseWhereInput = {
        tenantId: ctx.tenantId,
        deletedAt: null,
      };
      if (ctx.perms.permissions?.cases?.read === 'branch') {
        caseScope.branchId = ctx.perms.branchId ?? '__none__';
      } else if (
        ctx.perms.permissions?.cases?.read === 'own' ||
        ctx.perms.permissions?.cases?.read === 'assigned'
      ) {
        caseScope.OR = [{ lawyerId: ctx.perms.userId }, { filerId: ctx.perms.userId }];
      } else if (!ctx.perms.permissions?.cases?.read) {
        caseScope.id = '__skip__';
      }

      const apptScope: Prisma.AppointmentWhereInput = { tenantId: ctx.tenantId };
      if (ctx.perms.permissions?.appointments?.read === 'branch') {
        apptScope.branchId = ctx.perms.branchId ?? '__none__';
      } else if (
        ctx.perms.permissions?.appointments?.read === 'own' ||
        ctx.perms.permissions?.appointments?.read === 'assigned'
      ) {
        apptScope.providerId = ctx.perms.userId;
      } else if (!ctx.perms.permissions?.appointments?.read) {
        apptScope.id = '__skip__';
      }

      const [leads, clients, cases, appointments] = await Promise.all([
        ctx.prisma.lead.findMany({
          where: {
            ...leadScope,
            OR: [
              { firstName: i },
              { lastName: i },
              { email: i },
              ...(phoneSearch ? [{ phone: { contains: phoneSearch } }] : []),
            ],
          },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            email: true,
            status: true,
            caseInterest: true,
          },
        }),
        ctx.prisma.client.findMany({
          where: {
            ...clientScope,
            OR: [
              { firstName: i },
              { lastName: i },
              { email: i },
              ...(phoneSearch ? [{ phone: { contains: phoneSearch } }] : []),
            ],
          },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            email: true,
          },
        }),
        ctx.prisma.case.findMany({
          where: {
            ...caseScope,
            OR: [
              { caseType: i },
              { irccFileNumber: i },
              {
                client: {
                  OR: [
                    { firstName: i },
                    { lastName: i },
                    ...(phoneSearch ? [{ phone: { contains: phoneSearch } }] : []),
                  ],
                },
              },
            ],
          },
          orderBy: { updatedAt: 'desc' },
          take: 5,
          select: {
            id: true,
            caseType: true,
            status: true,
            irccFileNumber: true,
            client: { select: { firstName: true, lastName: true } },
          },
        }),
        ctx.prisma.appointment.findMany({
          where: {
            ...apptScope,
            OR: [
              {
                client: {
                  OR: [
                    { firstName: i },
                    { lastName: i },
                    ...(phoneSearch ? [{ phone: { contains: phoneSearch } }] : []),
                  ],
                },
              },
              {
                lead: {
                  OR: [
                    { firstName: i },
                    { lastName: i },
                    ...(phoneSearch ? [{ phone: { contains: phoneSearch } }] : []),
                  ],
                },
              },
            ],
          },
          orderBy: { scheduledAt: 'desc' },
          take: 5,
          select: {
            id: true,
            scheduledAt: true,
            kind: true,
            status: true,
            client: { select: { firstName: true, lastName: true } },
            lead: { select: { firstName: true, lastName: true, id: true } },
          },
        }),
      ]);

      return { leads, clients, cases, appointments };
    }),
});
