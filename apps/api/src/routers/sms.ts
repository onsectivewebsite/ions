/**
 * SMS procedures — outbound only in slice 3.3.1. Inbound is wired in the
 * Twilio webhook handler (apps/api/src/webhooks/twilio.ts).
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { sendSms } from '@onsecboad/twilio';
import { router } from '../trpc.js';
import { requirePermission } from '../lib/permissions.js';
import { getTwilioCreds } from '../lib/twilio-config.js';
import { logger } from '../logger.js';

export const smsRouter = router({
  send: requirePermission('calls', 'write')
    .input(
      z.object({
        leadId: z.string().uuid().optional(),
        toNumber: z.string().min(5).max(20),
        body: z.string().min(1).max(1600),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const creds = await getTwilioCreds(ctx.prisma, ctx.tenantId);
      // DNC guard
      if (input.leadId) {
        const lead = await ctx.prisma.lead.findFirst({
          where: { id: input.leadId, tenantId: ctx.tenantId, deletedAt: null },
        });
        if (!lead) throw new TRPCError({ code: 'NOT_FOUND' });
        if (lead.dncFlag) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'This lead is flagged Do Not Call.',
          });
        }
      }
      // Phase 10.1 — CASL suppression check. Tenant-wide; survives lead
      // churn since it keys off the raw phone number.
      const { isSuppressed } = await import('../lib/suppression.js');
      if (await isSuppressed(ctx.prisma, ctx.tenantId, 'sms', input.toNumber)) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'This number is on the firm-wide suppression list.',
        });
      }
      const result = await sendSms({ creds, to: input.toNumber, body: input.body });
      const log = await ctx.prisma.smsLog.create({
        data: {
          tenantId: ctx.tenantId,
          leadId: input.leadId,
          agentId: ctx.session.sub,
          twilioSid: result.smsSid,
          direction: 'outbound',
          fromNumber: creds?.phoneNumber ?? 'dryrun',
          toNumber: input.toNumber,
          body: input.body,
          status: result.status,
        },
      });
      if (input.leadId) {
        await ctx.prisma.lead.update({
          where: { id: input.leadId },
          data: { lastContactedAt: new Date() },
        });
      }
      logger.info({ smsLogId: log.id, mode: result.mode }, 'sms sent');
      return { smsLogId: log.id, smsSid: result.smsSid, mode: result.mode };
    }),
});
