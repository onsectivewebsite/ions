/**
 * Intake submissions router. The "submit a filled form" path.
 *
 * Behaviour:
 *   - Validates each value against its template field's type.
 *   - Idempotently upserts a Client (by phone) when the template includes a
 *     phone field — receptionist intake automatically creates the Client.
 *   - Backfills the lead with first/last/email/language/caseInterest if those
 *     came in via the form.
 *   - Bumps the lead status to BOOKED (we'll wire appointment outcomes in
 *     the next slice; for now intake-completed = "moving toward consultation").
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { createHash, randomBytes } from 'node:crypto';
import { Prisma } from '@onsecboad/db';
import { sendIntakeRequestEmail } from '@onsecboad/email';
import { loadEnv } from '@onsecboad/config';
import { router } from '../trpc.js';
import { requirePermission } from '../lib/permissions.js';
import { logger } from '../logger.js';

const env = loadEnv();

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function pickBrand(t: {
  displayName: string;
  branding: unknown;
}): { productName: string; primaryHex?: string; logoUrl?: string | null } {
  const b = (t.branding as Record<string, unknown> | null | undefined) ?? {};
  return {
    productName: t.displayName,
    primaryHex: typeof b.customPrimary === 'string' ? b.customPrimary : undefined,
    logoUrl: typeof b.logoUrl === 'string' ? b.logoUrl : null,
  };
}

type FieldDef = {
  key: string;
  label: string;
  type:
    | 'text'
    | 'email'
    | 'phone'
    | 'date'
    | 'number'
    | 'textarea'
    | 'select'
    | 'multiselect'
    | 'checkbox'
    | 'file';
  required?: boolean;
  options?: string[];
  maxLength?: number;
};

function validateValue(field: FieldDef, raw: unknown): string {
  const present = raw !== undefined && raw !== null && raw !== '';
  if (!present) {
    if (field.required) throw new Error(`${field.label} is required`);
    return '';
  }
  switch (field.type) {
    case 'email':
      if (typeof raw !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw))
        throw new Error(`${field.label} is not a valid email`);
      return raw;
    case 'phone':
      if (typeof raw !== 'string' || raw.replace(/\D/g, '').length < 6)
        throw new Error(`${field.label} is not a valid phone`);
      return raw;
    case 'number':
      if (Number.isNaN(Number(raw))) throw new Error(`${field.label} must be a number`);
      return String(raw);
    case 'date':
      if (typeof raw !== 'string' || Number.isNaN(Date.parse(raw)))
        throw new Error(`${field.label} is not a valid date`);
      return raw;
    case 'select':
      if (typeof raw !== 'string' || !field.options?.includes(raw))
        throw new Error(`${field.label} value not in allowed options`);
      return raw;
    case 'multiselect': {
      if (!Array.isArray(raw)) throw new Error(`${field.label} must be an array`);
      const opts = field.options ?? [];
      for (const v of raw) if (typeof v !== 'string' || !opts.includes(v))
        throw new Error(`${field.label} contains invalid option`);
      return JSON.stringify(raw);
    }
    case 'checkbox':
      return raw ? 'true' : 'false';
    case 'text':
    case 'textarea':
    case 'file':
    default: {
      const s = String(raw);
      if (field.maxLength && s.length > field.maxLength)
        throw new Error(`${field.label} exceeds max length`);
      return s;
    }
  }
}

export const intakeRouter = router({
  submit: requirePermission('intake', 'write')
    .input(
      z.object({
        templateId: z.string().uuid(),
        leadId: z.string().uuid().optional(),
        clientId: z.string().uuid().optional(),
        // Free-form key/value map; the template drives validation server-side.
        values: z.record(z.string(), z.unknown()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tpl = await ctx.prisma.intakeFormTemplate.findFirst({
        where: { id: input.templateId, tenantId: ctx.tenantId, isActive: true },
      });
      if (!tpl)
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Template not found or inactive',
        });
      const fields = (tpl.fieldsJson as unknown as FieldDef[]) ?? [];

      // Validate every field against its definition.
      const cleaned: Record<string, unknown> = {};
      try {
        for (const f of fields) {
          cleaned[f.key] = input.values[f.key] ?? null;
          validateValue(f, input.values[f.key]);
        }
      } catch (e) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: e instanceof Error ? e.message : 'Validation failed',
        });
      }

      // Lead lookup (if supplied) — must belong to this tenant.
      let leadRow:
        | Awaited<ReturnType<typeof ctx.prisma.lead.findFirst>>
        | null = null;
      if (input.leadId) {
        leadRow = await ctx.prisma.lead.findFirst({
          where: { id: input.leadId, tenantId: ctx.tenantId, deletedAt: null },
        });
        if (!leadRow) throw new TRPCError({ code: 'NOT_FOUND', message: 'Lead not found' });
      }

      // Pull canonical fields out of the form (best-effort by key name).
      const v = input.values;
      const formPhone = pickString(v, ['phone', 'phone_number', 'mobile']);
      const formEmail = pickString(v, ['email', 'email_address']);
      const formFirst = pickString(v, ['first_name', 'firstName', 'given_name']);
      const formLast = pickString(v, ['last_name', 'lastName', 'family_name']);
      const formLang = pickString(v, ['language', 'preferred_language']);

      // Client upsert by phone (canonical key per docs/01-domain).
      let clientId: string | null = input.clientId ?? null;
      const phoneForClient = formPhone ?? leadRow?.phone ?? null;
      if (!clientId && phoneForClient) {
        const existing = await ctx.prisma.client.findFirst({
          where: { tenantId: ctx.tenantId, phone: phoneForClient, deletedAt: null },
        });
        if (existing) {
          clientId = existing.id;
        } else {
          const created = await ctx.prisma.client.create({
            data: {
              tenantId: ctx.tenantId,
              branchId: leadRow?.branchId ?? null,
              firstName: formFirst ?? leadRow?.firstName ?? null,
              lastName: formLast ?? leadRow?.lastName ?? null,
              email: formEmail ?? leadRow?.email ?? null,
              phone: phoneForClient,
              language: formLang ?? leadRow?.language ?? null,
              primaryLeadId: leadRow?.id ?? null,
            },
          });
          clientId = created.id;
        }
      }

      const submission = await ctx.prisma.intakeSubmission.create({
        data: {
          tenantId: ctx.tenantId,
          templateId: tpl.id,
          caseType: tpl.caseType,
          leadId: leadRow?.id ?? null,
          clientId,
          fieldsJson: cleaned as unknown as Prisma.InputJsonValue,
          submittedBy: ctx.session.sub,
        },
      });

      // Backfill the lead with anything new we learned, and bump status.
      if (leadRow) {
        const leadUpdates: Prisma.LeadUpdateInput = {};
        if (formFirst && !leadRow.firstName) leadUpdates.firstName = formFirst;
        if (formLast && !leadRow.lastName) leadUpdates.lastName = formLast;
        if (formEmail && !leadRow.email) leadUpdates.email = formEmail;
        if (formLang && !leadRow.language) leadUpdates.language = formLang;
        if (!leadRow.caseInterest) leadUpdates.caseInterest = tpl.caseType;
        if (leadRow.status === 'NEW' || leadRow.status === 'CONTACTED') {
          leadUpdates.status = 'BOOKED';
        }
        if (Object.keys(leadUpdates).length > 0) {
          await ctx.prisma.lead.update({ where: { id: leadRow.id }, data: leadUpdates });
        }
      }

      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'intake.submit',
          targetType: 'IntakeSubmission',
          targetId: submission.id,
          payload: {
            templateId: tpl.id,
            leadId: leadRow?.id ?? null,
            clientId,
            fieldCount: fields.length,
          },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });

      logger.info(
        { tenantId: ctx.tenantId, submissionId: submission.id, leadId: leadRow?.id, clientId },
        'intake submitted',
      );

      return { id: submission.id, clientId, leadId: leadRow?.id ?? null };
    }),

  get: requirePermission('intake', 'read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const sub = await ctx.prisma.intakeSubmission.findFirst({
        where: { id: input.id, tenantId: ctx.tenantId },
        include: { template: true },
      });
      if (!sub) throw new TRPCError({ code: 'NOT_FOUND' });
      return sub;
    }),

  /**
   * Issue a public intake-form invite. Creates an IntakeRequest with a
   * fresh public token and (when sentVia=email) emails the recipient a
   * branded link. Returns the publicUrl so the caller can also display
   * a QR code or copy-button.
   */
  createRequest: requirePermission('intake', 'write')
    .input(
      z.object({
        templateId: z.string().uuid(),
        leadId: z.string().uuid().optional(),
        clientId: z.string().uuid().optional(),
        recipientName: z.string().max(200).optional(),
        recipientEmail: z.string().email().optional(),
        recipientPhone: z.string().max(40).optional(),
        sentVia: z.enum(['email', 'sms', 'qr', 'staff']),
        ttlDays: z.number().int().min(1).max(60).default(14),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!input.leadId && !input.clientId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Provide a leadId or clientId.',
        });
      }
      const tpl = await ctx.prisma.intakeFormTemplate.findFirst({
        where: { id: input.templateId, tenantId: ctx.tenantId, isActive: true },
      });
      if (!tpl) throw new TRPCError({ code: 'NOT_FOUND', message: 'Template not active' });

      // Mint a fresh token (32 bytes ≈ 256 bits, base64url).
      const tokenPlain = randomBytes(32).toString('base64url');
      const tokenHash = hashToken(tokenPlain);
      const expiresAt = new Date(Date.now() + input.ttlDays * 24 * 60 * 60 * 1000);

      const req = await ctx.prisma.intakeRequest.create({
        data: {
          tenantId: ctx.tenantId,
          templateId: tpl.id,
          leadId: input.leadId ?? null,
          clientId: input.clientId ?? null,
          recipientName: input.recipientName ?? null,
          recipientEmail: input.recipientEmail ?? null,
          recipientPhone: input.recipientPhone ?? null,
          sentVia: input.sentVia,
          publicTokenHash: tokenHash,
          publicTokenExpiresAt: expiresAt,
          createdBy: ctx.session.sub,
        },
      });

      const url = `${env.APP_URL.replace(/\/$/, '')}/intake/${tokenPlain}`;

      // Best-effort email delivery when sentVia=email and we have an address.
      let emailSent = false;
      let emailError: string | null = null;
      if (input.sentVia === 'email' && input.recipientEmail) {
        try {
          const tenant = await ctx.prisma.tenant.findUnique({
            where: { id: ctx.tenantId },
            select: { displayName: true, branding: true },
          });
          const brand = tenant
            ? pickBrand(tenant)
            : { productName: 'OnsecBoad' };
          const result = await sendIntakeRequestEmail({
            to: input.recipientEmail,
            recipientName: input.recipientName ?? 'there',
            firmName: tenant?.displayName ?? 'Your firm',
            templateName: tpl.name,
            url,
            ttlDays: input.ttlDays,
            brand,
          });
          if (result.ok) {
            emailSent = true;
          } else {
            emailError = result.error ?? 'unknown';
          }
        } catch (e) {
          emailError = e instanceof Error ? e.message : 'send failed';
        }
      }

      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'intake.createRequest',
          targetType: 'IntakeRequest',
          targetId: req.id,
          payload: {
            templateId: tpl.id,
            leadId: input.leadId ?? null,
            clientId: input.clientId ?? null,
            sentVia: input.sentVia,
            emailSent,
          },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });

      logger.info(
        { tenantId: ctx.tenantId, requestId: req.id, sentVia: input.sentVia, emailSent },
        'intake request issued',
      );

      return {
        id: req.id,
        publicUrl: url,
        publicToken: tokenPlain,
        expiresAt,
        emailSent,
        emailError,
      };
    }),

  /** List all intake requests for a lead or client. Most recent first. */
  listRequestsForLead: requirePermission('intake', 'read')
    .input(
      z.object({
        leadId: z.string().uuid().optional(),
        clientId: z.string().uuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (!input.leadId && !input.clientId) return [];
      return ctx.prisma.intakeRequest.findMany({
        where: {
          tenantId: ctx.tenantId,
          ...(input.leadId ? { leadId: input.leadId } : {}),
          ...(input.clientId ? { clientId: input.clientId } : {}),
        },
        orderBy: { createdAt: 'desc' },
        include: {
          template: { select: { id: true, name: true, caseType: true } },
          submission: { select: { id: true, submittedAt: true, lockedAt: true } },
        },
      });
    }),

  /** Cancel an unfilled request. Filled requests can't be cancelled. */
  cancelRequest: requirePermission('intake', 'write')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const r = await ctx.prisma.intakeRequest.findFirst({
        where: { id: input.id, tenantId: ctx.tenantId },
      });
      if (!r) throw new TRPCError({ code: 'NOT_FOUND' });
      if (r.filledAt) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Already filled — cancel is no-op.',
        });
      }
      await ctx.prisma.intakeRequest.update({
        where: { id: r.id },
        data: { cancelledAt: new Date() },
      });
      return { ok: true };
    }),

  /**
   * Unlock a filled IntakeSubmission so the client can edit again. Only
   * firm admin or branch manager. Audit-logged. Re-locks on next submit.
   */
  unlock: requirePermission('intake', 'write')
    .input(z.object({ submissionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Tighten gate beyond the 'intake.write' check — only roles that
      // are firm-admin or branch-manager can unlock.
      const role = await ctx.prisma.user.findUnique({
        where: { id: ctx.session.sub },
        include: { role: true },
      });
      const roleName = role?.role.name ?? '';
      const allowed =
        /firm.?admin/i.test(roleName) || /branch.?manager/i.test(roleName) || ctx.scope === 'tenant';
      if (!allowed) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only firm admin or branch manager can unlock filled forms.',
        });
      }
      const sub = await ctx.prisma.intakeSubmission.findFirst({
        where: { id: input.submissionId, tenantId: ctx.tenantId },
      });
      if (!sub) throw new TRPCError({ code: 'NOT_FOUND' });
      if (!sub.lockedAt) return { ok: true, alreadyOpen: true };
      await ctx.prisma.intakeSubmission.update({
        where: { id: sub.id },
        data: {
          lockedAt: null,
          unlockedBy: ctx.session.sub,
          unlockedAt: new Date(),
        },
      });
      // Re-extend the request token so the client can re-open the link.
      await ctx.prisma.intakeRequest.updateMany({
        where: { submissionId: sub.id },
        data: {
          publicTokenExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'intake.unlock',
          targetType: 'IntakeSubmission',
          targetId: sub.id,
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return { ok: true };
    }),
});

function pickString(values: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = values[k];
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return null;
}
