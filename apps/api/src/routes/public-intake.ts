/**
 * Public intake form endpoints. No auth — auth is by possession of the
 * public token issued by intake.createRequest.
 *
 *   GET  /api/v1/intake/:token            preview (firm + template + recipient + lock state)
 *   POST /api/v1/intake/:token/submit     fill (creates IntakeSubmission, marks request)
 *
 * Token validation:
 *   - Hash the path token, look up IntakeRequest by hash.
 *   - Reject if cancelled, expired, or attached submission is locked.
 */
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { Prisma, prisma } from '@onsecboad/db';
import { publishEvent } from '../lib/realtime.js';

function hashToken(t: string): string {
  return createHash('sha256').update(t).digest('hex');
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
  placeholder?: string;
  helpText?: string;
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
        throw new Error(`${field.label} is not a valid choice`);
      return raw;
    case 'multiselect': {
      if (!Array.isArray(raw)) throw new Error(`${field.label} must be a list`);
      const opts = field.options ?? [];
      for (const v of raw) {
        if (typeof v !== 'string' || !opts.includes(v))
          throw new Error(`${field.label} contains an invalid choice`);
      }
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
        throw new Error(`${field.label} is too long`);
      return s;
    }
  }
}

async function loadRequestByToken(token: string) {
  if (!token) return null;
  const r = await prisma.intakeRequest.findUnique({
    where: { publicTokenHash: hashToken(token) },
    include: {
      template: true,
      submission: true,
      tenant: { select: { displayName: true, branding: true } },
    },
  });
  if (!r) return null;
  return r;
}

export async function publicIntakeGetHandler(req: Request, res: Response): Promise<void> {
  const r = await loadRequestByToken(String(req.params.token ?? ''));
  if (!r) {
    res.status(404).json({ ok: false, error: 'not-found' });
    return;
  }
  if (r.cancelledAt) {
    res.status(410).json({ ok: false, error: 'cancelled' });
    return;
  }
  if (r.publicTokenExpiresAt < new Date()) {
    res.status(410).json({ ok: false, error: 'expired' });
    return;
  }

  // Mark first-open if not already.
  if (!r.openedAt) {
    await prisma.intakeRequest.update({
      where: { id: r.id },
      data: { openedAt: new Date() },
    });
  }

  res.json({
    ok: true,
    firm: { displayName: r.tenant.displayName, branding: r.tenant.branding },
    template: {
      id: r.template.id,
      name: r.template.name,
      description: r.template.description,
      caseType: r.template.caseType,
      fields: r.template.fieldsJson,
    },
    recipient: {
      name: r.recipientName,
      email: r.recipientEmail,
      phone: r.recipientPhone,
    },
    locked: !!r.submission?.lockedAt,
    submitted: !!r.filledAt,
    submittedAt: r.filledAt,
    expiresAt: r.publicTokenExpiresAt,
    // Echo back already-saved values so an unlocked re-fill shows what was there.
    existingValues: r.submission ? r.submission.fieldsJson : null,
  });
}

export async function publicIntakeSubmitHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const r = await loadRequestByToken(String(req.params.token ?? ''));
  if (!r) {
    res.status(404).json({ ok: false, error: 'not-found' });
    return;
  }
  if (r.cancelledAt) {
    res.status(410).json({ ok: false, error: 'cancelled' });
    return;
  }
  if (r.publicTokenExpiresAt < new Date()) {
    res.status(410).json({ ok: false, error: 'expired' });
    return;
  }
  if (r.submission?.lockedAt) {
    res
      .status(423)
      .json({ ok: false, error: 'locked', message: 'This form is locked. Contact the firm to make changes.' });
    return;
  }

  const body = req.body as { values?: Record<string, unknown> };
  if (!body || typeof body !== 'object' || !body.values) {
    res.status(400).json({ ok: false, error: 'missing-values' });
    return;
  }
  const fields = (r.template.fieldsJson as unknown as FieldDef[]) ?? [];
  const cleaned: Record<string, unknown> = {};
  try {
    for (const f of fields) {
      cleaned[f.key] = body.values[f.key] ?? null;
      validateValue(f, body.values[f.key]);
    }
  } catch (e) {
    res
      .status(400)
      .json({ ok: false, error: 'validation', message: e instanceof Error ? e.message : 'Invalid' });
    return;
  }

  const submission = await prisma.$transaction(async (tx) => {
    let sub = r.submission;
    if (sub) {
      sub = await tx.intakeSubmission.update({
        where: { id: sub.id },
        data: {
          fieldsJson: cleaned as unknown as Prisma.InputJsonValue,
          publicSubmittedAt: new Date(),
          lockedAt: new Date(),
        },
      });
    } else {
      sub = await tx.intakeSubmission.create({
        data: {
          tenantId: r.tenantId,
          templateId: r.templateId,
          caseType: r.template.caseType,
          leadId: r.leadId,
          clientId: r.clientId,
          fieldsJson: cleaned as unknown as Prisma.InputJsonValue,
          submittedBy: null,
          publicSubmittedAt: new Date(),
          lockedAt: new Date(),
        },
      });
    }
    await tx.intakeRequest.update({
      where: { id: r.id },
      data: {
        filledAt: new Date(),
        submissionId: sub.id,
      },
    });
    // Bump lead status if attached.
    if (r.leadId) {
      const lead = await tx.lead.findUnique({ where: { id: r.leadId } });
      if (lead && (lead.status === 'NEW' || lead.status === 'CONTACTED' || lead.status === 'FOLLOWUP')) {
        await tx.lead.update({
          where: { id: r.leadId },
          data: { status: 'INTERESTED' },
        });
      }
    }
    await tx.auditLog.create({
      data: {
        tenantId: r.tenantId,
        actorId: r.clientId ?? r.leadId ?? r.id,
        actorType: 'CLIENT',
        action: 'intake.publicSubmit',
        targetType: 'IntakeSubmission',
        targetId: sub.id,
        payload: { requestId: r.id, leadId: r.leadId, clientId: r.clientId },
        ip: req.ip ?? null,
        userAgent: (req.headers['user-agent'] as string) ?? null,
      },
    });
    return sub;
  });

  // Best-effort realtime push so the receptionist's screen lights up.
  await publishEvent(
    { kind: 'tenant', tenantId: r.tenantId },
    {
      type: 'intake.filled',
      requestId: r.id,
      submissionId: submission.id,
      leadId: r.leadId,
      clientId: r.clientId,
      templateName: r.template.name,
    },
  );

  res.json({ ok: true, submissionId: submission.id });
}
