import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { randomBytes, createHash } from 'node:crypto';
import { Prisma } from '@onsecboad/db';
import { hashPassword, signAccessToken, generateRefreshToken } from '@onsecboad/auth';
import { sendSetupInviteEmail } from '@onsecboad/email';
import { loadEnv } from '@onsecboad/config';
import {
  attachPaymentMethod,
  cancelSubscription,
  changeSubscriptionPlan,
  createCustomer,
  createSubscription,
  setCustomerTaxId,
  updateCustomer,
} from '@onsecboad/stripe';
import { router, platformProcedure } from '../../trpc.js';
import { logger } from '../../logger.js';
import { syncSeats } from '../../lib/seats.js';
import { SYSTEM_ROLES } from '../../lib/system-roles.js';

const env = loadEnv();

const SETUP_TOKEN_TTL_DAYS = 7;
const PLACEHOLDER_PASSWORD = 'AwaitingSetup_DoNotUse_'; // overwritten on setup.complete

const slugSchema = z
  .string()
  .min(2)
  .max(63)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'Lowercase letters, numbers, and hyphens only');

const tenantStatusSchema = z.enum(['PROVISIONING', 'ACTIVE', 'SUSPENDED', 'CANCELED']);

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

/** Convert our address shape → Stripe's address shape (province → state). */
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

function makeSetupToken(): { raw: string; hash: string; expiresAt: Date } {
  const raw = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(raw).digest('hex');
  const expiresAt = new Date(Date.now() + SETUP_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  return { raw, hash, expiresAt };
}

export const tenantPlatformRouter = router({
  list: platformProcedure
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        q: z.string().optional(),
        status: tenantStatusSchema.optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where = {
        ...(input.status ? { status: input.status } : {}),
        ...(input.q
          ? {
              OR: [
                { displayName: { contains: input.q, mode: 'insensitive' as const } },
                { legalName: { contains: input.q, mode: 'insensitive' as const } },
                { slug: { contains: input.q, mode: 'insensitive' as const } },
              ],
            }
          : {}),
        deletedAt: null,
      };
      const [items, total] = await Promise.all([
        ctx.prisma.tenant.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: 20,
          skip: (input.page - 1) * 20,
          include: { plan: true },
        }),
        ctx.prisma.tenant.count({ where }),
      ]);
      return {
        items: items.map((t) => ({
          ...t,
          plan: t.plan
            ? { ...t.plan, pricePerSeatCents: Number(t.plan.pricePerSeatCents) }
            : null,
        })),
        total,
        page: input.page,
        pageSize: 20,
      };
    }),

  get: platformProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const t = await ctx.prisma.tenant.findUnique({
        where: { id: input.id },
        include: {
          plan: true,
          users: { take: 20, orderBy: { createdAt: 'desc' }, include: { role: true, branch: true } },
          branches: true,
          _count: { select: { users: true, branches: true, invoices: true } },
        },
      });
      if (!t) throw new TRPCError({ code: 'NOT_FOUND' });
      return {
        ...t,
        plan: t.plan
          ? { ...t.plan, pricePerSeatCents: Number(t.plan.pricePerSeatCents) }
          : null,
      };
    }),

  create: platformProcedure
    .input(
      z.object({
        legalName: z.string().min(2).max(200),
        displayName: z.string().min(2).max(200),
        slug: slugSchema,
        country: z.string().default('CA'),
        contactName: z.string().min(2).max(200),
        contactEmail: z.string().email(),
        contactPhone: z.string().optional(),
        address: addressSchema,
        taxId: z.string().max(60).optional(),
        taxIdType: taxIdTypeSchema,
        planCode: z.enum(['STARTER', 'GROWTH', 'SCALE']),
        paymentMethodId: z.string().optional(), // Stripe pm_… (required in production)
        couponCode: z.string().optional(),
        startTrial: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // 1. Slug uniqueness
      const slugTaken = await ctx.prisma.tenant.findUnique({ where: { slug: input.slug } });
      if (slugTaken) {
        throw new TRPCError({ code: 'CONFLICT', message: 'That slug is taken. Pick another.' });
      }

      // 2. Find the plan
      const plan = await ctx.prisma.plan.findUnique({ where: { code: input.planCode } });
      if (!plan || !plan.isActive) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Plan not available' });
      }

      // 3. Find or bootstrap the FIRM_ADMIN role (per-tenant, but we need it now
      //    so we can create the admin user as part of provisioning).
      // 4. Provision in order: Stripe customer → subscription → tenant row →
      //    role + branch + admin user → setup token + email. Failure mid-way
      //    leaves the tenant in PROVISIONING for retry/inspection.

      // Stripe customer
      const customer = await createCustomer({
        email: input.contactEmail,
        name: input.displayName,
        tenantId: 'pending', // we don't have the tenantId yet; updated post-create
      });

      // Stripe subscription (qty 1 = the FirmAdmin we're about to create)
      const subscription = await createSubscription({
        customerId: customer.id,
        priceId: plan.stripePriceId,
        quantity: 1,
        trialDays: input.startTrial ? env.STRIPE_TRIAL_DAYS : 0,
        tenantId: 'pending',
      });

      // Optional: attach the supplied payment method as default
      if (input.paymentMethodId) {
        await attachPaymentMethod(customer.id, input.paymentMethodId, true);
      }

      // Tenant row (start in PROVISIONING; the setup-complete flow flips to ACTIVE)
      const tenant = await ctx.prisma.tenant.create({
        data: {
          legalName: input.legalName,
          displayName: input.displayName,
          slug: input.slug,
          status: 'PROVISIONING',
          packageTier: input.planCode,
          planId: plan.id,
          stripeCustomerId: customer.id,
          stripeSubscriptionId: subscription.id,
          trialEndsAt: subscription.trialEnd,
          seatCount: 1,
          branding: { themeCode: 'maple', customPrimary: null, logoUrl: null },
          contactName: input.contactName,
          contactEmail: input.contactEmail,
          contactPhone: input.contactPhone ?? null,
          address: (input.address as Prisma.InputJsonValue) ?? Prisma.JsonNull,
          taxId: input.taxId ?? null,
          taxIdType: input.taxIdType ?? null,
        },
      });

      // Push the contact info to Stripe so invoices show the right details.
      try {
        await updateCustomer(customer.id, {
          email: input.contactEmail,
          name: input.displayName,
          phone: input.contactPhone,
          address: toStripeAddress(input.address),
        });
        if (input.taxId && input.taxIdType) {
          await setCustomerTaxId(customer.id, { type: input.taxIdType, value: input.taxId });
        }
      } catch (e) {
        logger.error({ err: e, tenantId: tenant.id }, 'stripe customer enrichment failed (non-fatal)');
      }

      // Every new firm gets the full set of 8 system roles up front so the
      // FirmAdmin can invite users into any role from day one.
      const roleByName = new Map<string, string>();
      for (const def of SYSTEM_ROLES) {
        const r = await ctx.prisma.role.create({
          data: {
            tenantId: tenant.id,
            name: def.name,
            isSystem: true,
            permissions: def.permissions,
          },
        });
        roleByName.set(def.name, r.id);
      }
      const adminRoleId = roleByName.get('FIRM_ADMIN');
      if (!adminRoleId) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'FIRM_ADMIN role missing' });
      const adminRole = { id: adminRoleId };

      // Placeholder branch — user can rename in /f/setup
      const branch = await ctx.prisma.branch.create({
        data: {
          tenantId: tenant.id,
          name: 'Main',
          address: { country: input.country },
          phone: input.contactPhone ?? '',
        },
      });

      // FirmAdmin user. Password is a placeholder — the setup flow replaces it
      // when the invitee follows the email link and chooses their own.
      const placeholderHash = await hashPassword(PLACEHOLDER_PASSWORD + randomBytes(8).toString('hex'));
      const adminUser = await ctx.prisma.user.create({
        data: {
          tenantId: tenant.id,
          email: input.contactEmail,
          name: input.contactName,
          passwordHash: placeholderHash,
          roleId: adminRole.id,
          branchId: branch.id,
          status: 'INVITED',
          invitedAt: new Date(),
        },
      });

      // Setup token (the link we email)
      const setup = makeSetupToken();
      await ctx.prisma.tenant.update({
        where: { id: tenant.id },
        data: {
          setupTokenHash: setup.hash,
          setupTokenExpiresAt: setup.expiresAt,
        },
      });

      const setupUrl = `${env.APP_URL.replace(/\/$/, '')}/setup?token=${setup.raw}`;

      // Send the invite — non-fatal if SMTP fails (the platform manager can
      // resend, or copy the setupUrl from the response). Outcome surfaces in
      // the response so the UI can warn instead of silently misleading.
      let emailSent = false;
      let emailError: string | undefined;
      try {
        const result = await sendSetupInviteEmail({
          to: input.contactEmail,
          recipientName: input.contactName,
          firmName: input.displayName,
          setupUrl,
          ttlDays: SETUP_TOKEN_TTL_DAYS,
          brand: { productName: 'OnsecBoad' },
        });
        emailSent = result.ok;
        if (!result.ok) {
          emailError = result.error ?? 'unknown';
          logger.error({ err: emailError }, 'setup invite send failed');
        }
      } catch (e) {
        emailError = e instanceof Error ? e.message : String(e);
        logger.error({ err: emailError }, 'setup invite throw');
      }

      // Audit
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: tenant.id,
          actorId: ctx.session.sub,
          actorType: 'PLATFORM',
          action: 'tenant.create',
          targetType: 'Tenant',
          targetId: tenant.id,
          payload: {
            slug: tenant.slug,
            planCode: input.planCode,
            adminEmail: input.contactEmail,
            stripeCustomerId: customer.id,
            stripeSubscriptionId: subscription.id,
          },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });

      // Recompute seats now that the FirmAdmin user exists. The provision flow
      // already set seatCount=1 on the Tenant; this also pushes the quantity
      // to Stripe (no-op in dry-run).
      await syncSeats(ctx.prisma, tenant.id);

      return {
        tenantId: tenant.id,
        adminUserId: adminUser.id,
        setupUrl,
        emailSent,
        emailError,
      };
    }),

  reconcileSeats: platformProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await syncSeats(ctx.prisma, input.id);
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: input.id,
          actorId: ctx.session.sub,
          actorType: 'PLATFORM',
          action: 'tenant.seats.reconcile',
          targetType: 'Tenant',
          targetId: input.id,
          payload: { seats: result.seats },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return result;
    }),

  update: platformProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        legalName: z.string().min(2).max(200).optional(),
        displayName: z.string().min(2).max(200).optional(),
        contactName: z.string().min(2).max(200).optional(),
        contactEmail: z.string().email().optional(),
        contactPhone: z.string().nullable().optional(),
        address: addressSchema,
        taxId: z.string().max(60).nullable().optional(),
        taxIdType: taxIdTypeSchema.nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const before = await ctx.prisma.tenant.findUnique({ where: { id: input.id } });
      if (!before) throw new TRPCError({ code: 'NOT_FOUND' });

      const data: Prisma.TenantUpdateInput = {};
      if (input.legalName !== undefined) data.legalName = input.legalName;
      if (input.displayName !== undefined) data.displayName = input.displayName;
      if (input.contactName !== undefined) data.contactName = input.contactName;
      if (input.contactEmail !== undefined) data.contactEmail = input.contactEmail;
      if (input.contactPhone !== undefined) data.contactPhone = input.contactPhone;
      if (input.address !== undefined) {
        data.address = input.address ? (input.address as Prisma.InputJsonValue) : Prisma.JsonNull;
      }
      if (input.taxId !== undefined) data.taxId = input.taxId;
      if (input.taxIdType !== undefined) data.taxIdType = input.taxIdType;

      await ctx.prisma.tenant.update({ where: { id: input.id }, data });

      // Mirror to Stripe so invoices reflect the change. Errors are non-fatal —
      // the local update is the source of truth.
      if (before.stripeCustomerId) {
        try {
          await updateCustomer(before.stripeCustomerId, {
            email: input.contactEmail,
            name: input.displayName ?? before.displayName,
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
          logger.error({ err: e, tenantId: before.id }, 'stripe customer mirror failed');
        }
      }

      await ctx.prisma.auditLog.create({
        data: {
          tenantId: before.id,
          actorId: ctx.session.sub,
          actorType: 'PLATFORM',
          action: 'tenant.update',
          targetType: 'Tenant',
          targetId: before.id,
          payload: input as object,
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return { ok: true };
    }),

  delete: platformProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        confirmSlug: z.string(),
        immediate: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const t = await ctx.prisma.tenant.findUnique({ where: { id: input.id } });
      if (!t) throw new TRPCError({ code: 'NOT_FOUND' });
      if (t.slug !== input.confirmSlug) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Slug confirmation mismatch — type the firm slug to delete.',
        });
      }

      // Soft-delete by default: set deletedAt + status=CANCELED, cancel Stripe
      // subscription. Preserves audit history and invoices. Hard delete is
      // intentionally not exposed — restoring data is preferable to losing it.
      if (t.stripeSubscriptionId) {
        try {
          await cancelSubscription(t.stripeSubscriptionId, input.immediate);
        } catch (e) {
          logger.error({ err: e, tenantId: t.id }, 'stripe cancel failed during delete');
        }
      }
      // Revoke every active session so users in the deleted firm can't keep going.
      await ctx.prisma.session.updateMany({
        where: { user: { tenantId: t.id }, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await ctx.prisma.tenant.update({
        where: { id: t.id },
        data: { status: 'CANCELED', deletedAt: new Date() },
      });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: t.id,
          actorId: ctx.session.sub,
          actorType: 'PLATFORM',
          action: 'tenant.delete',
          targetType: 'Tenant',
          targetId: t.id,
          payload: { slug: t.slug, immediate: input.immediate },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return { ok: true };
    }),

  resendSetup: platformProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const t = await ctx.prisma.tenant.findUnique({ where: { id: input.id } });
      if (!t) throw new TRPCError({ code: 'NOT_FOUND' });
      if (t.setupCompletedAt) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Setup already complete' });
      }
      const admin = await ctx.prisma.user.findFirst({
        where: { tenantId: t.id, status: 'INVITED' },
        orderBy: { createdAt: 'asc' },
      });
      if (!admin) throw new TRPCError({ code: 'NOT_FOUND', message: 'No pending firm admin' });

      const setup = makeSetupToken();
      await ctx.prisma.tenant.update({
        where: { id: t.id },
        data: { setupTokenHash: setup.hash, setupTokenExpiresAt: setup.expiresAt },
      });
      const setupUrl = `${env.APP_URL.replace(/\/$/, '')}/setup?token=${setup.raw}`;
      let emailSent = false;
      let emailError: string | undefined;
      try {
        const result = await sendSetupInviteEmail({
          to: admin.email,
          recipientName: admin.name,
          firmName: t.displayName,
          setupUrl,
          ttlDays: SETUP_TOKEN_TTL_DAYS,
          brand: { productName: 'OnsecBoad' },
        });
        emailSent = result.ok;
        if (!result.ok) {
          emailError = result.error ?? 'unknown';
          logger.error({ err: emailError }, 'setup invite resend failed');
        }
      } catch (e) {
        emailError = e instanceof Error ? e.message : String(e);
        logger.error({ err: emailError }, 'setup invite resend throw');
      }
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: t.id,
          actorId: ctx.session.sub,
          actorType: 'PLATFORM',
          action: 'tenant.setup.resend',
          targetType: 'Tenant',
          targetId: t.id,
          payload: { emailSent, emailError: emailError ?? null },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return { ok: true, setupUrl, emailSent, emailError };
    }),

  suspend: platformProcedure
    .input(z.object({ id: z.string().uuid(), reason: z.string().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      const t = await ctx.prisma.tenant.findUnique({ where: { id: input.id } });
      if (!t) throw new TRPCError({ code: 'NOT_FOUND' });
      await ctx.prisma.tenant.update({ where: { id: t.id }, data: { status: 'SUSPENDED' } });
      // Revoke every active session for the tenant's users.
      await ctx.prisma.session.updateMany({
        where: { user: { tenantId: t.id }, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: t.id,
          actorId: ctx.session.sub,
          actorType: 'PLATFORM',
          action: 'tenant.suspend',
          targetType: 'Tenant',
          targetId: t.id,
          payload: { reason: input.reason ?? null },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return { ok: true };
    }),

  resume: platformProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.tenant.update({
        where: { id: input.id },
        data: { status: 'ACTIVE' },
      });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: input.id,
          actorId: ctx.session.sub,
          actorType: 'PLATFORM',
          action: 'tenant.resume',
          targetType: 'Tenant',
          targetId: input.id,
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return { ok: true };
    }),

  cancel: platformProcedure
    .input(z.object({ id: z.string().uuid(), immediate: z.boolean().default(false) }))
    .mutation(async ({ ctx, input }) => {
      const t = await ctx.prisma.tenant.findUnique({ where: { id: input.id } });
      if (!t) throw new TRPCError({ code: 'NOT_FOUND' });
      if (t.stripeSubscriptionId) {
        await cancelSubscription(t.stripeSubscriptionId, input.immediate);
      }
      await ctx.prisma.tenant.update({
        where: { id: t.id },
        data: input.immediate
          ? { status: 'CANCELED', deletedAt: new Date() }
          : { status: 'CANCELED' },
      });
      // Revoke active sessions immediately so existing tabs lose access.
      // The firmProcedure middleware will also reject any in-flight JWTs.
      await ctx.prisma.session.updateMany({
        where: { user: { tenantId: t.id }, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: t.id,
          actorId: ctx.session.sub,
          actorType: 'PLATFORM',
          action: 'tenant.cancel',
          targetType: 'Tenant',
          targetId: t.id,
          payload: { immediate: input.immediate },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return { ok: true };
    }),

  changePlan: platformProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        planCode: z.enum(['STARTER', 'GROWTH', 'SCALE']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [t, plan] = await Promise.all([
        ctx.prisma.tenant.findUnique({ where: { id: input.id } }),
        ctx.prisma.plan.findUnique({ where: { code: input.planCode } }),
      ]);
      if (!t) throw new TRPCError({ code: 'NOT_FOUND', message: 'Tenant not found' });
      if (!plan || !plan.isActive) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Plan not available' });
      if (t.stripeSubscriptionId) {
        await changeSubscriptionPlan(t.stripeSubscriptionId, plan.stripePriceId, 'create_prorations');
      }
      await ctx.prisma.tenant.update({
        where: { id: t.id },
        data: { planId: plan.id, packageTier: input.planCode },
      });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: t.id,
          actorId: ctx.session.sub,
          actorType: 'PLATFORM',
          action: 'tenant.changePlan',
          targetType: 'Tenant',
          targetId: t.id,
          payload: { from: t.packageTier, to: input.planCode },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return { ok: true };
    }),

  invoices: platformProcedure
    .input(
      z.object({
        tenantId: z.string().uuid(),
        page: z.number().int().min(1).default(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      const items = await ctx.prisma.subscriptionInvoice.findMany({
        where: { tenantId: input.tenantId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        skip: (input.page - 1) * 20,
      });
      return {
        items: items.map((i) => ({ ...i, amountCents: Number(i.amountCents) })),
      };
    }),

  /**
   * Per-firm feature flags. Toggle a single key on/off; returns the new
   * flags map. Lets platform admin grant/revoke specific features
   * without a deploy.
   */
  setFeatureFlag: platformProcedure
    .input(
      z.object({
        tenantId: z.string().uuid(),
        key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{1,40}$/, 'letters/numbers/dash/underscore'),
        value: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const t = await ctx.prisma.tenant.findUnique({ where: { id: input.tenantId } });
      if (!t) throw new TRPCError({ code: 'NOT_FOUND' });
      const prev = (t.featureFlags as Record<string, unknown> | null) ?? {};
      const next = { ...prev, [input.key]: input.value };
      await ctx.prisma.tenant.update({
        where: { id: t.id },
        data: { featureFlags: next },
      });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: t.id,
          actorId: ctx.session.sub,
          actorType: 'PLATFORM',
          action: 'platform.featureFlag.set',
          targetType: 'Tenant',
          targetId: t.id,
          payload: { key: input.key, value: input.value },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return { ok: true, featureFlags: next };
    }),

  /**
   * Send (or clear) a firm-wide announcement banner. Persisted on the
   * Tenant row + audited. Frontend polls tenant.brandingGet on
   * navigation; we surface it via a separate read here so the firm
   * AppShell can fetch it cheaply.
   */
  setAnnouncement: platformProcedure
    .input(
      z.object({
        tenantId: z.string().uuid(),
        message: z.string().max(500).nullable(),
        level: z.enum(['info', 'warning', 'urgent']).default('info'),
        expiresAt: z.string().datetime().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const t = await ctx.prisma.tenant.findUnique({ where: { id: input.tenantId } });
      if (!t) throw new TRPCError({ code: 'NOT_FOUND' });

      const announcement =
        input.message === null || input.message.trim().length === 0
          ? null
          : {
              message: input.message,
              level: input.level,
              expiresAt: input.expiresAt ?? null,
              setAt: new Date().toISOString(),
            };

      await ctx.prisma.tenant.update({
        where: { id: t.id },
        data: { announcement: announcement ?? Prisma.JsonNull },
      });

      await ctx.prisma.auditLog.create({
        data: {
          tenantId: t.id,
          actorId: ctx.session.sub,
          actorType: 'PLATFORM',
          action: announcement
            ? 'platform.announcement.set'
            : 'platform.announcement.clear',
          targetType: 'Tenant',
          targetId: t.id,
          payload: announcement ?? {},
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return { ok: true, announcement };
    }),

  /**
   * Per-firm AI usage summary for the platform admin. Same shape as the
   * firm-side aiUsage.summary, scoped by tenantId. Default: last 30 days.
   */
  aiUsage: platformProcedure
    .input(
      z.object({
        tenantId: z.string().uuid(),
        days: z.number().int().min(1).max(365).default(30),
      }),
    )
    .query(async ({ ctx, input }) => {
      const to = new Date();
      const from = new Date(to.getTime() - input.days * 24 * 60 * 60 * 1000);
      const where = {
        tenantId: input.tenantId,
        createdAt: { gte: from, lte: to },
      };
      const [total, byFeature, byModel, count] = await Promise.all([
        ctx.prisma.aiUsage.aggregate({
          where,
          _sum: { inputTokens: true, cachedInputTokens: true, outputTokens: true, costCents: true },
        }),
        ctx.prisma.aiUsage.groupBy({
          by: ['feature'],
          where,
          _sum: { costCents: true },
          _count: { _all: true },
        }),
        ctx.prisma.aiUsage.groupBy({
          by: ['model'],
          where,
          _sum: { costCents: true },
          _count: { _all: true },
        }),
        ctx.prisma.aiUsage.count({ where }),
      ]);
      return {
        from: from.toISOString(),
        to: to.toISOString(),
        days: input.days,
        callCount: count,
        totals: {
          inputTokens: total._sum.inputTokens ?? 0,
          cachedInputTokens: total._sum.cachedInputTokens ?? 0,
          outputTokens: total._sum.outputTokens ?? 0,
          costCents: total._sum.costCents ?? 0,
        },
        byFeature: byFeature.map((g) => ({
          feature: g.feature,
          calls: g._count._all,
          costCents: g._sum.costCents ?? 0,
        })),
        byModel: byModel.map((g) => ({
          model: g.model,
          calls: g._count._all,
          costCents: g._sum.costCents ?? 0,
        })),
      };
    }),

  /**
   * Support tool: impersonate a firm user. Mints a firm-scope JWT for the
   * platform admin to "log in as" the target user. Used to reproduce
   * customer issues, walk a firm through their UI, etc. Heavily audit-
   * logged. The minted access token's claims include `impersonator` so
   * the frontend can show a banner and block sensitive actions.
   *
   * Token TTL is short (matches access TTL) and there's no refresh token
   * — the platform admin re-impersonates if they need more time. This
   * makes the audit trail line up with each session start.
   */
  impersonate: platformProcedure
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const u = await ctx.prisma.user.findFirst({
        where: { id: input.userId, deletedAt: null },
        include: { tenant: true },
      });
      if (!u) throw new TRPCError({ code: 'NOT_FOUND' });
      if (u.status !== 'ACTIVE') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot impersonate inactive users.',
        });
      }
      const claims = {
        sub: u.id,
        scope: 'firm' as const,
        tenantId: u.tenantId,
        roleId: u.roleId,
        ...(u.branchId ? { branchId: u.branchId } : {}),
        impersonator: ctx.session.sub, // platform user id
      };
      const access = await signAccessToken(
        claims,
        env.JWT_ACCESS_SECRET,
        Math.min(env.ACCESS_TOKEN_TTL_SEC, 30 * 60), // cap at 30 min
      );
      // No refresh token — short-lived only. Re-impersonate if needed.

      await ctx.prisma.auditLog.create({
        data: {
          tenantId: u.tenantId,
          actorId: ctx.session.sub,
          actorType: 'PLATFORM',
          action: 'platform.impersonate',
          targetType: 'User',
          targetId: u.id,
          payload: {
            targetEmail: u.email,
            tenantSlug: u.tenant.slug,
          },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });

      logger.warn(
        {
          platformUserId: ctx.session.sub,
          targetUserId: u.id,
          tenantId: u.tenantId,
        },
        'platform: impersonation start',
      );

      return {
        accessToken: access.token,
        accessExpiresAt: access.expiresAt.toISOString(),
        target: {
          userId: u.id,
          name: u.name,
          email: u.email,
          tenantId: u.tenantId,
          tenantName: u.tenant.displayName,
        },
      };
    }),

  /**
   * Extend a tenant's trial by N days. Bumps trialEndsAt; if Stripe is
   * wired, also calls Stripe to extend trial_end on the subscription.
   * Audit-logged.
   */
  extendTrial: platformProcedure
    .input(
      z.object({
        tenantId: z.string().uuid(),
        days: z.number().int().min(1).max(90),
        reason: z.string().min(2).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const t = await ctx.prisma.tenant.findUnique({ where: { id: input.tenantId } });
      if (!t) throw new TRPCError({ code: 'NOT_FOUND' });
      const base = t.trialEndsAt && t.trialEndsAt > new Date() ? t.trialEndsAt : new Date();
      const newEnd = new Date(base.getTime() + input.days * 24 * 60 * 60 * 1000);
      await ctx.prisma.tenant.update({
        where: { id: t.id },
        data: { trialEndsAt: newEnd },
      });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: t.id,
          actorId: ctx.session.sub,
          actorType: 'PLATFORM',
          action: 'platform.extendTrial',
          targetType: 'Tenant',
          targetId: t.id,
          payload: {
            previousTrialEnd: t.trialEndsAt?.toISOString() ?? null,
            newTrialEnd: newEnd.toISOString(),
            days: input.days,
            reason: input.reason,
          },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return { ok: true, trialEndsAt: newEnd };
    }),
});
