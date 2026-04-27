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
import { callRouter } from './routers/call.js';
import { smsRouter } from './routers/sms.js';
import { twilioConfigRouter } from './routers/twilio-config.js';
import { metaConfigRouter } from './routers/meta-config.js';
import { tiktokConfigRouter } from './routers/tiktok-config.js';
import { leadRuleRouter } from './routers/lead-rule.js';
import { campaignRouter } from './routers/campaign.js';
import { kpiRouter } from './routers/kpi.js';
import { clientRouter } from './routers/client.js';
import { intakeTemplateRouter } from './routers/intake-template.js';
import { intakeRouter } from './routers/intake.js';
import { appointmentRouter } from './routers/appointment.js';
import { caseRouter } from './routers/case.js';
import { retainerTemplateRouter } from './routers/retainer-template.js';
import { retainerRouter } from './routers/retainer.js';
import { documentChecklistTemplateRouter } from './routers/document-checklist-template.js';
import { documentCollectionRouter } from './routers/document-collection.js';
import { portalRouter, clientPortalAdminRouter } from './routers/portal.js';
import { caseAiRouter } from './routers/case-ai.js';

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
  calls: callRouter,
  sms: smsRouter,
  twilioConfig: twilioConfigRouter,
  metaConfig: metaConfigRouter,
  tiktokConfig: tiktokConfigRouter,
  leadRule: leadRuleRouter,
  campaign: campaignRouter,
  kpi: kpiRouter,
  client: clientRouter,
  intakeTemplate: intakeTemplateRouter,
  intake: intakeRouter,
  appointment: appointmentRouter,
  cases: caseRouter,
  retainerTemplate: retainerTemplateRouter,
  retainer: retainerRouter,
  documentChecklistTemplate: documentChecklistTemplateRouter,
  documentCollection: documentCollectionRouter,
  portal: portalRouter,
  clientPortal: clientPortalAdminRouter,
  caseAi: caseAiRouter,
});

export type AppRouter = typeof appRouter;
