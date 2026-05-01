/**
 * Calendar connection management. List/disconnect external calendar
 * OAuth connections for the current user. The OAuth dance itself is
 * REST (apps/api/src/routes/calendar-google.ts) — these procedures
 * are for inspection and revocation.
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { router, protectedProcedure } from '../trpc.js';
import { loadEnv } from '@onsecboad/config';

const env = loadEnv();

export const calendarRouter = router({
  /**
   * Surfaces whether OAuth is configured + the list of the current
   * user's connections (sans tokens).
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.session.scope !== 'firm') {
      return {
        configured: false,
        googleConfigured: false,
        outlookConfigured: false,
        items: [],
      };
    }
    const items = await ctx.prisma.calendarConnection.findMany({
      where: { userId: ctx.session.sub },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        provider: true,
        externalAccount: true,
        status: true,
        lastSyncedAt: true,
        lastError: true,
        createdAt: true,
      },
    });
    const googleConfigured =
      !!env.GOOGLE_OAUTH_CLIENT_ID && !!env.GOOGLE_OAUTH_CLIENT_SECRET;
    const outlookConfigured =
      !!env.MS_OAUTH_CLIENT_ID && !!env.MS_OAUTH_CLIENT_SECRET;
    return {
      // `configured` is kept for backward-compat with existing UI; truthy if
      // either provider is set up.
      configured: googleConfigured || outlookConfigured,
      googleConfigured,
      outlookConfigured,
      items,
    };
  }),

  /** Disconnect a calendar — sets status='revoked' and forgets tokens. */
  disconnect: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const conn = await ctx.prisma.calendarConnection.findUnique({
        where: { id: input.id },
      });
      if (!conn || conn.userId !== ctx.session.sub) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      await ctx.prisma.calendarConnection.update({
        where: { id: conn.id },
        data: {
          status: 'revoked',
          accessTokenEnc: '',
          refreshTokenEnc: null,
        },
      });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.session.scope === 'firm' ? (ctx.session.tenantId ?? null) : null,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'calendar.disconnect',
          targetType: 'CalendarConnection',
          targetId: conn.id,
          payload: { provider: conn.provider, externalAccount: conn.externalAccount },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return { ok: true };
    }),
});
