import { Prisma } from '@onsecboad/db';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { router, firmProcedure } from '../trpc.js';
import { requirePermission } from '../lib/permissions.js';

const brandingSchema = z.object({
  themeCode: z.enum(['maple', 'glacier', 'forest', 'slate', 'aurora', 'midnight', 'custom']),
  customPrimary: z.string().regex(/^#[0-9a-f]{6}$/i).nullable().optional(),
  logoUrl: z.string().nullable().optional(),
});

const addressSchema = z.object({
  line1: z.string().max(200).nullable().optional(),
  line2: z.string().max(200).nullable().optional(),
  city: z.string().max(120).nullable().optional(),
  province: z.string().max(60).nullable().optional(),
  postalCode: z.string().max(20).nullable().optional(),
  country: z.string().max(60).nullable().optional(),
});

const firmDetailsSchema = z.object({
  displayName: z.string().min(2).max(200).optional(),
  legalName: z.string().min(2).max(200).optional(),
  contactName: z.string().max(200).nullable().optional(),
  contactEmail: z.string().email().nullable().optional(),
  contactPhone: z.string().max(40).nullable().optional(),
  emailFrom: z.string().email().nullable().optional(),
  locale: z.string().max(10).optional(),
  timezone: z.string().max(60).optional(),
  address: addressSchema.nullable().optional(),
  // Min 90 days satisfies PIPEDA s.10.3 (24-month minimum for breach
  // records). 1825 = 5 years upper bound to keep storage in check.
  auditRetentionDays: z.number().int().min(90).max(1825).optional(),
});

export const tenantRouter = router({
  brandingGet: firmProcedure.query(async ({ ctx }) => {
    const t = await ctx.prisma.tenant.findUnique({ where: { id: ctx.tenantId } });
    return t?.branding ?? null;
  }),

  brandingUpdate: firmProcedure
    .input(brandingSchema)
    .mutation(async ({ ctx, input }) => {
      // Preserve internal fields the client doesn't manage (logoR2Key set by
      // the upload route). Merge instead of overwrite so saving the form
      // doesn't lose the R2 key.
      const existing = await ctx.prisma.tenant.findUnique({
        where: { id: ctx.tenantId },
        select: { branding: true },
      });
      const prev = (existing?.branding ?? {}) as Record<string, unknown>;
      const merged = { ...prev, ...input };
      await ctx.prisma.tenant.update({
        where: { id: ctx.tenantId },
        data: { branding: merged },
      });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'tenant.branding.update',
          targetType: 'Tenant',
          targetId: ctx.tenantId,
          payload: input,
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return { ok: true };
    }),

  firmDetailsGet: firmProcedure.query(async ({ ctx }) => {
    const t = await ctx.prisma.tenant.findUnique({
      where: { id: ctx.tenantId },
      select: {
        id: true,
        slug: true,
        displayName: true,
        legalName: true,
        contactName: true,
        contactEmail: true,
        contactPhone: true,
        emailFrom: true,
        locale: true,
        timezone: true,
        address: true,
        packageTier: true,
        seatCount: true,
        auditRetentionDays: true,
      },
    });
    return t;
  }),

  firmDetailsUpdate: requirePermission('settings', 'write')
    .input(firmDetailsSchema)
    .mutation(async ({ ctx, input }) => {
      const data: Prisma.TenantUpdateInput = {};
      if (input.displayName !== undefined) data.displayName = input.displayName;
      if (input.legalName !== undefined) data.legalName = input.legalName;
      if (input.contactName !== undefined) data.contactName = input.contactName;
      if (input.contactEmail !== undefined) data.contactEmail = input.contactEmail;
      if (input.contactPhone !== undefined) data.contactPhone = input.contactPhone;
      if (input.emailFrom !== undefined) data.emailFrom = input.emailFrom;
      if (input.locale !== undefined) data.locale = input.locale;
      if (input.timezone !== undefined) data.timezone = input.timezone;
      if (input.auditRetentionDays !== undefined) {
        data.auditRetentionDays = input.auditRetentionDays;
      }
      if (input.address !== undefined) {
        data.address = (input.address as Prisma.InputJsonValue) ?? Prisma.JsonNull;
      }
      await ctx.prisma.tenant.update({ where: { id: ctx.tenantId }, data });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'tenant.firm_details.update',
          targetType: 'Tenant',
          targetId: ctx.tenantId,
          payload: { changes: Object.keys(input) },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return { ok: true };
    }),

  reminderConfigGet: firmProcedure.query(async ({ ctx }) => {
    const t = await ctx.prisma.tenant.findUnique({
      where: { id: ctx.tenantId },
      select: { reminderConfig: true },
    });
    return (
      (t?.reminderConfig as unknown as {
        sendLong: boolean;
        sendShort: boolean;
        longHours: number;
        shortMinutes: number;
      } | null) ?? null
    );
  }),

  reminderConfigUpdate: requirePermission('settings', 'write')
    .input(
      z.object({
        sendLong: z.boolean(),
        sendShort: z.boolean(),
        longHours: z.number().int().min(1).max(168), // 1 hour – 1 week
        shortMinutes: z.number().int().min(5).max(720), // 5 min – 12 hours
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.tenant.update({
        where: { id: ctx.tenantId },
        data: { reminderConfig: input },
      });
      return { ok: true };
    }),

  /**
   * Seed sample leads, clients, cases, appointments tagged with [demo] in
   * notes so they can be wiped later. Useful so a fresh tenant doesn't
   * stare at zeroed dashboards during a sales demo. Idempotent: re-running
   * does nothing if the tag is already present.
   */
  loadDemoData: requirePermission('settings', 'write').mutation(async ({ ctx }) => {
    // Idempotency check.
    const already = await ctx.prisma.lead.findFirst({
      where: { tenantId: ctx.tenantId, notes: { contains: '[demo]' } },
      select: { id: true },
    });
    if (already) {
      return { ok: true, alreadyLoaded: true };
    }

    // Pick a branch + a lawyer to attribute things to.
    const [branch, lawyer] = await Promise.all([
      ctx.prisma.branch.findFirst({
        where: { tenantId: ctx.tenantId, isActive: true },
        orderBy: { createdAt: 'asc' },
      }),
      ctx.prisma.user.findFirst({
        where: { tenantId: ctx.tenantId, deletedAt: null, status: 'ACTIVE' },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    if (!branch || !lawyer) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Need at least one branch + one active user before loading demo data.',
      });
    }

    const now = Date.now();
    const sample = [
      {
        firstName: 'Aanya',
        lastName: 'Sharma',
        phone: '+14165551001',
        email: 'aanya@example.com',
        source: 'walkin',
        status: 'INTERESTED' as const,
        caseInterest: 'work_permit',
      },
      {
        firstName: 'Marcus',
        lastName: 'Bell',
        phone: '+16475552002',
        email: 'marcus@example.com',
        source: 'meta',
        status: 'CONTACTED' as const,
        caseInterest: 'study_permit',
      },
      {
        firstName: 'Priya',
        lastName: 'Iyer',
        phone: '+12365553003',
        email: 'priya@example.com',
        source: 'referral',
        status: 'NEW' as const,
        caseInterest: 'pr_economic',
      },
    ];

    const leads: { id: string; phone: string }[] = [];
    for (const s of sample) {
      const l = await ctx.prisma.lead.create({
        data: {
          tenantId: ctx.tenantId,
          branchId: branch.id,
          firstName: s.firstName,
          lastName: s.lastName,
          phone: s.phone,
          email: s.email,
          source: s.source,
          status: s.status,
          caseInterest: s.caseInterest,
          assignedToId: lawyer.id,
          notes: '[demo] sample lead — safe to delete.',
        },
      });
      leads.push({ id: l.id, phone: s.phone });
    }

    // Promote the first two to clients + open cases.
    for (let i = 0; i < 2; i++) {
      const s = sample[i];
      const lead = leads[i];
      if (!s || !lead) continue;
      const client = await ctx.prisma.client.create({
        data: {
          tenantId: ctx.tenantId,
          branchId: branch.id,
          firstName: s.firstName,
          lastName: s.lastName,
          phone: s.phone,
          email: s.email,
          primaryLeadId: lead.id,
          notes: '[demo]',
        },
      });
      await ctx.prisma.case.create({
        data: {
          tenantId: ctx.tenantId,
          branchId: branch.id,
          clientId: client.id,
          leadId: lead.id,
          caseType: s.caseInterest,
          lawyerId: lawyer.id,
          status: 'PENDING_DOCUMENTS',
          retainerFeeCents: 250000,
          notes: '[demo] sample case — safe to delete.',
        },
      });
    }

    // One booked appointment for the third lead, tomorrow at 10am.
    const tomorrow = new Date(now + 24 * 60 * 60 * 1000);
    tomorrow.setHours(10, 0, 0, 0);
    const thirdLead = leads[2];
    if (thirdLead) {
      await ctx.prisma.appointment.create({
        data: {
          tenantId: ctx.tenantId,
          providerId: lawyer.id,
          branchId: branch.id,
          leadId: thirdLead.id,
          scheduledAt: tomorrow,
          durationMin: 30,
          kind: 'consultation',
          status: 'SCHEDULED',
          createdBy: ctx.session.sub,
          notes: '[demo] sample appointment — safe to delete.',
        },
      });
    }

    await ctx.prisma.auditLog.create({
      data: {
        tenantId: ctx.tenantId,
        actorId: ctx.session.sub,
        actorType: 'USER',
        action: 'tenant.loadDemoData',
        targetType: 'Tenant',
        targetId: ctx.tenantId,
        ip: ctx.ip,
        userAgent: ctx.userAgent ?? null,
      },
    });

    return { ok: true, leads: leads.length, clients: 2, cases: 2, appointments: 1 };
  }),

  /**
   * Wipe demo data. Matches by [demo] tag in notes. Skips real data.
   */
  wipeDemoData: requirePermission('settings', 'write').mutation(async ({ ctx }) => {
    const r = await ctx.prisma.$transaction(async (tx) => {
      const apps = await tx.appointment.deleteMany({
        where: { tenantId: ctx.tenantId, notes: { contains: '[demo]' } },
      });
      const cases = await tx.case.deleteMany({
        where: { tenantId: ctx.tenantId, notes: { contains: '[demo]' } },
      });
      const clients = await tx.client.deleteMany({
        where: { tenantId: ctx.tenantId, notes: { contains: '[demo]' } },
      });
      const leads = await tx.lead.deleteMany({
        where: { tenantId: ctx.tenantId, notes: { contains: '[demo]' } },
      });
      return {
        appointments: apps.count,
        cases: cases.count,
        clients: clients.count,
        leads: leads.count,
      };
    });
    await ctx.prisma.auditLog.create({
      data: {
        tenantId: ctx.tenantId,
        actorId: ctx.session.sub,
        actorType: 'USER',
        action: 'tenant.wipeDemoData',
        targetType: 'Tenant',
        targetId: ctx.tenantId,
        payload: r,
        ip: ctx.ip,
        userAgent: ctx.userAgent ?? null,
      },
    });
    return { ok: true, ...r };
  }),
});
