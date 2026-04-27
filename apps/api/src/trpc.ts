import { initTRPC, TRPCError } from '@trpc/server';
import type { Ctx } from './context.js';

const t = initTRPC.context<Ctx>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session) throw new TRPCError({ code: 'UNAUTHORIZED' });
  return next({ ctx: { ...ctx, session: ctx.session } });
});

export const platformProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.session.scope !== 'platform') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Platform-only' });
  }
  return next();
});

export const firmProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (ctx.session.scope !== 'firm' || !ctx.session.tenantId) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Firm-only' });
  }
  // Reject requests for tenants that have been deleted, canceled, or
  // suspended — even when the JWT is otherwise valid. Catches existing
  // access tokens immediately, not just on next expiry.
  const tenant = await ctx.prisma.tenant.findUnique({
    where: { id: ctx.session.tenantId },
    select: { status: true, deletedAt: true },
  });
  if (!tenant || tenant.deletedAt || tenant.status === 'CANCELED') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'This firm is no longer active. Contact your platform administrator.',
    });
  }
  if (tenant.status === 'SUSPENDED') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'This firm is suspended. Contact your platform administrator.',
    });
  }
  return next({ ctx: { ...ctx, tenantId: ctx.session.tenantId } });
});
