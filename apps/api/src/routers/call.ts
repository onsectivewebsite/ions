/**
 * Call (Twilio Voice) procedures. Stub-aware via @onsecboad/twilio:
 *   - real Twilio when the firm has set valid creds
 *   - dry-run otherwise — every operation logs and writes a CallLog row
 *     so the UI can be exercised end-to-end without a Twilio account
 *
 * Slice 3.3.1 ships the procedures + lead-detail action; the browser
 * softphone (Voice SDK) lands alongside slice 3.3.2.
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { Prisma } from '@onsecboad/db';
import { placeCall, endCall, voiceToken, modeFor } from '@onsecboad/twilio';
import { loadEnv } from '@onsecboad/config';
import { router } from '../trpc.js';
import { requirePermission } from '../lib/permissions.js';
import { getTwilioCreds } from '../lib/twilio-config.js';
import { logger } from '../logger.js';

const env = loadEnv();

const dispositionSchema = z.enum([
  'interested',
  'not_interested',
  'voicemail',
  'callback',
  'wrong_number',
  'dnc',
  'booked',
]);

export const callRouter = router({
  // Browser softphone token. Returns dry-run token until real creds + Twilio
  // API key/secret are added (Slice 3.3.2 wires these to the env).
  token: requirePermission('calls', 'write').query(async ({ ctx }) => {
    const creds = await getTwilioCreds(ctx.prisma, ctx.tenantId);
    const t = voiceToken({
      creds,
      identity: ctx.session.sub,
      apiKeySid: process.env.TWILIO_API_KEY_SID,
      apiKeySecret: process.env.TWILIO_API_KEY_SECRET,
      ttlSeconds: 3600,
    });
    return { token: t.token, identity: ctx.session.sub, mode: t.mode };
  }),

  start: requirePermission('calls', 'write')
    .input(
      z.object({
        leadId: z.string().uuid().optional(),
        toNumber: z.string().min(5).max(20),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const creds = await getTwilioCreds(ctx.prisma, ctx.tenantId);
      // DNC guard — refuse to call any lead flagged DNC.
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
      const result = await placeCall({
        creds,
        to: input.toNumber,
        recording: creds?.recordOutbound ?? true,
        webhookBaseUrl: env.API_URL,
      });
      // Persist the CallLog row regardless of mode — the UI timeline reads it.
      const log = await ctx.prisma.callLog.create({
        data: {
          tenantId: ctx.tenantId,
          leadId: input.leadId,
          agentId: ctx.session.sub,
          twilioSid: result.callSid,
          direction: 'outbound',
          fromNumber: creds?.phoneNumber ?? 'dryrun',
          toNumber: input.toNumber,
          status: result.status,
        },
      });
      // Update lead.lastContactedAt for visibility on the lead list.
      if (input.leadId) {
        await ctx.prisma.lead.update({
          where: { id: input.leadId },
          data: { lastContactedAt: new Date() },
        });
      }
      logger.info(
        { callLogId: log.id, mode: result.mode, leadId: input.leadId },
        'call started',
      );
      return { callLogId: log.id, callSid: result.callSid, mode: result.mode };
    }),

  end: requirePermission('calls', 'write')
    .input(
      z.object({
        callLogId: z.string().uuid(),
        disposition: dispositionSchema.optional(),
        notes: z.string().max(2000).optional(),
        durationSec: z.number().int().min(0).max(86400).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const log = await ctx.prisma.callLog.findFirst({
        where: { id: input.callLogId, tenantId: ctx.tenantId },
      });
      if (!log) throw new TRPCError({ code: 'NOT_FOUND' });
      const creds = await getTwilioCreds(ctx.prisma, ctx.tenantId);
      // Try to hang up the active call leg. Errors are non-fatal — the call
      // may already be completed when the user clicks End & Save.
      if (log.twilioSid && log.status !== 'completed') {
        try {
          await endCall({ creds, callSid: log.twilioSid });
        } catch (e) {
          logger.warn({ err: e, callSid: log.twilioSid }, 'endCall failed (likely already ended)');
        }
      }
      const data: Prisma.CallLogUpdateInput = {
        status: 'completed',
        endedAt: new Date(),
      };
      if (input.disposition) data.disposition = input.disposition;
      if (input.notes !== undefined) data.notes = input.notes;
      if (input.durationSec !== undefined) data.durationSec = input.durationSec;
      // Dry-run: fake a duration if none provided so the UI shows something useful.
      if (modeFor(creds) === 'dry-run' && input.durationSec === undefined && !log.durationSec) {
        data.durationSec = Math.floor((Date.now() - log.startedAt.getTime()) / 1000);
      }
      const updated = await ctx.prisma.callLog.update({
        where: { id: log.id },
        data,
      });
      // If the agent marked DNC on the call, flag the lead too.
      if (input.disposition === 'dnc' && log.leadId) {
        await ctx.prisma.lead.update({
          where: { id: log.leadId },
          data: { dncFlag: true, status: 'DNC' },
        });
      }
      return updated;
    }),

  list: requirePermission('calls', 'read')
    .input(
      z
        .object({
          page: z.number().int().min(1).default(1),
          mine: z.boolean().optional(),
          leadId: z.string().uuid().optional(),
        })
        .default({ page: 1 }),
    )
    .query(async ({ ctx, input }) => {
      const where: Prisma.CallLogWhereInput = {
        tenantId: ctx.tenantId,
        ...(input.mine ? { agentId: ctx.session.sub } : {}),
        ...(input.leadId ? { leadId: input.leadId } : {}),
        ...(ctx.scope === 'own' ? { agentId: ctx.session.sub } : {}),
      };
      const [items, total] = await Promise.all([
        ctx.prisma.callLog.findMany({
          where,
          orderBy: { startedAt: 'desc' },
          take: 50,
          skip: (input.page - 1) * 50,
          include: {
            lead: { select: { id: true, firstName: true, lastName: true, phone: true } },
            agent: { select: { id: true, name: true, email: true } },
          },
        }),
        ctx.prisma.callLog.count({ where }),
      ]);
      return { items, total, page: input.page, pageSize: 50 };
    }),

  get: requirePermission('calls', 'read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const log = await ctx.prisma.callLog.findFirst({
        where: {
          id: input.id,
          tenantId: ctx.tenantId,
          ...(ctx.scope === 'own' ? { agentId: ctx.session.sub } : {}),
        },
        include: {
          lead: true,
          agent: { select: { id: true, name: true, email: true } },
        },
      });
      if (!log) throw new TRPCError({ code: 'NOT_FOUND' });
      return log;
    }),

  // Phase 8.4 — manual re-summarize. Synchronous so staff get feedback.
  summarize: requirePermission('ai', 'write')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const log = await ctx.prisma.callLog.findFirst({
        where: { id: input.id, tenantId: ctx.tenantId },
        select: { id: true },
      });
      if (!log) throw new TRPCError({ code: 'NOT_FOUND' });
      const { summarizeCallAsync } = await import('../lib/ai-summarize.js');
      await summarizeCallAsync(ctx.prisma, log.id);
      const refreshed = await ctx.prisma.callLog.findUnique({
        where: { id: log.id },
        select: {
          transcript: true,
          transcriptSource: true,
          aiSummary: true,
          aiSummarizedAt: true,
          aiSummaryMode: true,
        },
      });
      return refreshed;
    }),
});
