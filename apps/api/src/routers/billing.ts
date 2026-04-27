import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { Prisma } from '@onsecboad/db';
import {
  attachPaymentMethod,
  changeSubscriptionPlan,
  createSetupIntent,
  isDryRun,
  publishableKey,
  setCustomerTaxId,
  updateCustomer,
} from '@onsecboad/stripe';
import { signedUrl } from '@onsecboad/r2';
import { router, firmProcedure, publicProcedure } from '../trpc.js';
import { logger } from '../logger.js';

const addressSchema = z
  .object({
    line1: z.string().max(200).optional(),
    line2: z.string().max(200).optional(),
    city: z.string().max(100).optional(),
    province: z.string().max(100).optional(),
    postalCode: z.string().max(20).optional(),
    country: z.string().length(2).default('CA'),
  })
  .partial()
  .nullable()
  .optional();

const taxIdTypeSchema = z
  .enum([
    'ca_gst_hst',
    'ca_pst_bc',
    'ca_pst_mb',
    'ca_pst_sk',
    'ca_qst',
    'us_ein',
    'eu_vat',
    'gb_vat',
    'in_gst',
  ])
  .optional();

function toStripeAddress(addr: unknown): Record<string, string> | undefined {
  if (!addr || typeof addr !== 'object') return undefined;
  const a = addr as Record<string, string | undefined>;
  const out: Record<string, string> = {};
  if (a.line1) out.line1 = a.line1;
  if (a.line2) out.line2 = a.line2;
  if (a.city) out.city = a.city;
  if (a.province) out.state = a.province;
  if (a.postalCode) out.postal_code = a.postalCode;
  if (a.country) out.country = a.country;
  return Object.keys(out).length ? out : undefined;
}

export const billingRouter = router({
  // Public so the unauthenticated /p/firms/new wizard can mount Stripe.js too.
  // It only returns the publishable key + dry-run flag, neither of which is
  // sensitive (publishable keys are explicitly safe to expose).
  config: publicProcedure.query(() => ({
    publishableKey: publishableKey(),
    dryRun: isDryRun(),
  })),

  // Self-serve: firm admin sees their own subscription summary.
  subscriptionGet: firmProcedure.query(async ({ ctx }) => {
    const t = await ctx.prisma.tenant.findUnique({
      where: { id: ctx.tenantId },
      include: { plan: true },
    });
    if (!t) throw new TRPCError({ code: 'NOT_FOUND' });
    return {
      tenant: {
        id: t.id,
        displayName: t.displayName,
        status: t.status,
        seatCount: t.seatCount,
        trialEndsAt: t.trialEndsAt,
        stripeCustomerId: t.stripeCustomerId,
        stripeSubscriptionId: t.stripeSubscriptionId,
      },
      plan: t.plan
        ? { ...t.plan, pricePerSeatCents: Number(t.plan.pricePerSeatCents) }
        : null,
    };
  }),

  invoices: firmProcedure
    .input(z.object({ page: z.number().int().min(1).default(1) }).default({ page: 1 }))
    .query(async ({ ctx, input }) => {
      const items = await ctx.prisma.subscriptionInvoice.findMany({
        where: { tenantId: ctx.tenantId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        skip: (input.page - 1) * 20,
      });
      return {
        items: items.map((i) => ({
          ...i,
          amountCents: Number(i.amountCents),
        })),
      };
    }),

  // Returns a 1-hour signed URL for the cached invoice PDF. If the stored URL
  // isn't an r2:// pointer (R2 dry-run / Stripe-hosted fallback), it's
  // returned verbatim so the UI still works.
  invoiceUrl: firmProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const inv = await ctx.prisma.subscriptionInvoice.findFirst({
        where: { id: input.id, tenantId: ctx.tenantId },
      });
      if (!inv?.pdfUrl) throw new TRPCError({ code: 'NOT_FOUND' });
      if (inv.pdfUrl.startsWith('r2://')) {
        const key = inv.pdfUrl.replace(/^r2:\/\/[^/]+\//, '');
        return { url: await signedUrl(key, 3600) };
      }
      return { url: inv.pdfUrl };
    }),

  // Returns a SetupIntent client_secret. The client mounts Stripe Elements with
  // it to capture a card without ever sending the number to our server.
  updatePaymentMethod: firmProcedure.mutation(async ({ ctx }) => {
    const t = await ctx.prisma.tenant.findUnique({ where: { id: ctx.tenantId } });
    if (!t?.stripeCustomerId) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'No Stripe customer on file' });
    }
    const si = await createSetupIntent(t.stripeCustomerId);
    return { clientSecret: si.clientSecret };
  }),

  // Called after the SetupIntent confirms client-side and we have a pm_…
  attachPaymentMethod: firmProcedure
    .input(z.object({ paymentMethodId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const t = await ctx.prisma.tenant.findUnique({ where: { id: ctx.tenantId } });
      if (!t?.stripeCustomerId) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED' });
      }
      await attachPaymentMethod(t.stripeCustomerId, input.paymentMethodId, true);
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'tenant.payment_method.update',
          targetType: 'Tenant',
          targetId: ctx.tenantId,
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return { ok: true };
    }),

  // Billing details — what shows up on invoices. Editable by the firm admin.
  detailsGet: firmProcedure.query(async ({ ctx }) => {
    const t = await ctx.prisma.tenant.findUnique({
      where: { id: ctx.tenantId },
      select: {
        legalName: true,
        displayName: true,
        contactName: true,
        contactEmail: true,
        contactPhone: true,
        address: true,
        taxId: true,
        taxIdType: true,
      },
    });
    if (!t) throw new TRPCError({ code: 'NOT_FOUND' });
    return t;
  }),

  detailsUpdate: firmProcedure
    .input(
      z.object({
        legalName: z.string().min(2).max(200).optional(),
        contactName: z.string().min(2).max(200).optional(),
        contactEmail: z.string().email().optional(),
        contactPhone: z.string().nullable().optional(),
        address: addressSchema,
        taxId: z.string().max(60).nullable().optional(),
        taxIdType: taxIdTypeSchema.nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const before = await ctx.prisma.tenant.findUnique({ where: { id: ctx.tenantId } });
      if (!before) throw new TRPCError({ code: 'NOT_FOUND' });

      const data: Prisma.TenantUpdateInput = {};
      if (input.legalName !== undefined) data.legalName = input.legalName;
      if (input.contactName !== undefined) data.contactName = input.contactName;
      if (input.contactEmail !== undefined) data.contactEmail = input.contactEmail;
      if (input.contactPhone !== undefined) data.contactPhone = input.contactPhone;
      if (input.address !== undefined) {
        data.address = input.address ? (input.address as Prisma.InputJsonValue) : Prisma.JsonNull;
      }
      if (input.taxId !== undefined) data.taxId = input.taxId;
      if (input.taxIdType !== undefined) data.taxIdType = input.taxIdType;

      await ctx.prisma.tenant.update({ where: { id: ctx.tenantId }, data });

      if (before.stripeCustomerId) {
        try {
          await updateCustomer(before.stripeCustomerId, {
            email: input.contactEmail,
            name: before.displayName,
            phone: input.contactPhone === null ? '' : input.contactPhone,
            address: toStripeAddress(input.address),
          });
          if ('taxId' in input || 'taxIdType' in input) {
            const newTaxId = input.taxId === undefined ? before.taxId : input.taxId;
            const newType = input.taxIdType === undefined ? before.taxIdType : input.taxIdType;
            await setCustomerTaxId(
              before.stripeCustomerId,
              newTaxId && newType ? { type: newType, value: newTaxId } : null,
            );
          }
        } catch (e) {
          logger.error({ err: e, tenantId: ctx.tenantId }, 'stripe customer mirror failed');
        }
      }

      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'tenant.billing_details.update',
          targetType: 'Tenant',
          targetId: ctx.tenantId,
          payload: input as object,
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return { ok: true };
    }),

  // Self-serve plan change. Same proration semantics as the platform-side call.
  changePlan: firmProcedure
    .input(z.object({ planCode: z.enum(['STARTER', 'GROWTH', 'SCALE']) }))
    .mutation(async ({ ctx, input }) => {
      const [t, plan] = await Promise.all([
        ctx.prisma.tenant.findUnique({ where: { id: ctx.tenantId } }),
        ctx.prisma.plan.findUnique({ where: { code: input.planCode } }),
      ]);
      if (!t) throw new TRPCError({ code: 'NOT_FOUND' });
      if (!plan?.isActive) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Plan unavailable' });
      if (t.stripeSubscriptionId) {
        await changeSubscriptionPlan(t.stripeSubscriptionId, plan.stripePriceId, 'create_prorations');
      }
      await ctx.prisma.tenant.update({
        where: { id: t.id },
        data: { planId: plan.id, packageTier: input.planCode },
      });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'tenant.changePlan.self',
          targetType: 'Tenant',
          targetId: ctx.tenantId,
          payload: { from: t.packageTier, to: input.planCode },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return { ok: true };
    }),
});
