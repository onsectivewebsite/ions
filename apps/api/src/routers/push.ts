/**
 * Push device registration — Phase 9.5.
 *
 * Three procedures:
 *   - registerStaff (firmProcedure) — upserts a PushDevice for the
 *     signed-in firm user (variant='staff').
 *   - registerClient (clientProcedure) — same for the portal account
 *     (variant='client').
 *   - unregister (publicProcedure) — idempotent delete by token. Public
 *     so a sign-out flow can still drop the token even if the access
 *     JWT has already expired.
 */
import { z } from 'zod';
import { router, publicProcedure, firmProcedure, clientProcedure } from '../trpc.js';

const REGISTER_INPUT = z.object({
  token: z.string().min(10).max(200),
  platform: z.enum(['ios', 'android', 'web']),
});

export const pushRouter = router({
  registerStaff: firmProcedure
    .input(REGISTER_INPUT)
    .mutation(async ({ ctx, input }) => {
      // Upsert by expoPushToken — Expo rotates these on reinstall, so a
      // single device might register a fresh token periodically. We move
      // the row to the new user / variant, since the same physical
      // device can be re-paired by a different staffer.
      const row = await ctx.prisma.pushDevice.upsert({
        where: { expoPushToken: input.token },
        create: {
          tenantId: ctx.tenantId,
          userId: ctx.session.sub,
          clientPortalAccountId: null,
          expoPushToken: input.token,
          platform: input.platform,
          variant: 'staff',
        },
        update: {
          tenantId: ctx.tenantId,
          userId: ctx.session.sub,
          clientPortalAccountId: null,
          platform: input.platform,
          variant: 'staff',
          lastUsedAt: new Date(),
        },
      });
      return { id: row.id };
    }),

  registerClient: clientProcedure
    .input(REGISTER_INPUT)
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.prisma.pushDevice.upsert({
        where: { expoPushToken: input.token },
        create: {
          tenantId: ctx.tenantId,
          userId: null,
          clientPortalAccountId: ctx.session.sub,
          expoPushToken: input.token,
          platform: input.platform,
          variant: 'client',
        },
        update: {
          tenantId: ctx.tenantId,
          userId: null,
          clientPortalAccountId: ctx.session.sub,
          platform: input.platform,
          variant: 'client',
          lastUsedAt: new Date(),
        },
      });
      return { id: row.id };
    }),

  unregister: publicProcedure
    .input(z.object({ token: z.string().min(10).max(200) }))
    .mutation(async ({ ctx, input }) => {
      // Idempotent — silently no-op if the token isn't registered.
      await ctx.prisma.pushDevice
        .delete({ where: { expoPushToken: input.token } })
        .catch(() => undefined);
      return { ok: true };
    }),
});
