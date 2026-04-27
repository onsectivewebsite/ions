import { router } from './trpc.js';
import { authRouter } from './routers/auth.js';
import { userRouter } from './routers/user.js';
import { tenantRouter } from './routers/tenant.js';
import { platformRouter } from './routers/platform/index.js';
import { setupRouter } from './routers/setup.js';
import { billingRouter } from './routers/billing.js';
import { branchRouter } from './routers/branch.js';
import { inviteRouter } from './routers/invite.js';
import { roleRouter } from './routers/role.js';
import { auditRouter } from './routers/audit.js';
import { leadRouter } from './routers/lead.js';
import { apiKeyRouter } from './routers/api-key.js';

export const appRouter = router({
  auth: authRouter,
  user: userRouter,
  tenant: tenantRouter,
  platform: platformRouter,
  setup: setupRouter,
  billing: billingRouter,
  branch: branchRouter,
  invite: inviteRouter,
  role: roleRouter,
  audit: auditRouter,
  lead: leadRouter,
  apiKey: apiKeyRouter,
});

export type AppRouter = typeof appRouter;
