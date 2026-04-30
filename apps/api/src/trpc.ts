import { initTRPC, TRPCError } from '@trpc/server';
import { Prisma } from '@onsecboad/db';
import type { Ctx } from './context.js';

const t = initTRPC.context<Ctx>().create();

/**
 * Translate raw Prisma errors into TRPCErrors with human messages so the
 * frontend doesn't display things like "Unique constraint failed on
 * (tenantId, email)" verbatim. Pass through anything that's already a
 * TRPCError. Unknown errors become INTERNAL_SERVER_ERROR with a generic
 * message — the original is logged via the onError hook in main.ts.
 */
const prismaErrorMiddleware = t.middleware(async ({ next }) => {
  try {
    return await next();
  } catch (err) {
    if (err instanceof TRPCError) throw err;
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      switch (err.code) {
        case 'P2002': {
          const target = (err.meta?.target as string[] | undefined)?.join(', ');
          throw new TRPCError({
            code: 'CONFLICT',
            message: target
              ? `That ${target} already exists.`
              : 'Already exists.',
          });
        }
        case 'P2025':
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Record not found.' });
        case 'P2003':
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: "Can't link to that record — it doesn't exist or has been deleted.",
          });
        case 'P2014':
        case 'P2017':
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Related records prevent this change.',
          });
        default:
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Database error — please try again or contact support.',
          });
      }
    }
    if (err instanceof Prisma.PrismaClientValidationError) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Invalid data — check the form and try again.',
      });
    }
    throw err;
  }
});

const baseProcedure = t.procedure.use(prismaErrorMiddleware);

export const router = t.router;
export const publicProcedure = baseProcedure;

export const protectedProcedure = baseProcedure.use(({ ctx, next }) => {
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

/**
 * Client-portal-scoped procedure. Gates on scope='client' and resolves
 * the linked Client + tenantId so handlers can `where: { clientId,
 * tenantId }` filter without re-querying.
 */
export const clientProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (ctx.session.scope !== 'client' || !ctx.session.tenantId) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Client portal only' });
  }
  const account = await ctx.prisma.clientPortalAccount.findUnique({
    where: { id: ctx.session.sub },
    select: { id: true, clientId: true, tenantId: true, status: true },
  });
  if (!account || account.status !== 'ACTIVE') {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Account not active' });
  }
  return next({
    ctx: {
      ...ctx,
      tenantId: account.tenantId,
      clientId: account.clientId,
      accountId: account.id,
    },
  });
});
