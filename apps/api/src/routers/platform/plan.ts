import { router, platformProcedure } from '../../trpc.js';

export const planPlatformRouter = router({
  list: platformProcedure.query(async ({ ctx }) => {
    const plans = await ctx.prisma.plan.findMany({
      where: { isActive: true },
      orderBy: { pricePerSeatCents: 'asc' },
    });
    // BigInt → number for JSON transport (CAD cents fits comfortably).
    return plans.map((p) => ({
      ...p,
      pricePerSeatCents: Number(p.pricePerSeatCents),
    }));
  }),
});
