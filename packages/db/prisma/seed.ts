/**
 * Seed: superadmin PlatformUser + demo tenant + system roles + demo Firm Admin.
 * Idempotent — safe to run multiple times.
 *
 * Usage: pnpm db:seed
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { hashPassword } from '@onsecboad/auth';

const prisma = new PrismaClient();

// Onsective platform superadmin (manages the SaaS — sees every law firm).
const SUPERADMIN_EMAIL = process.env.SEED_SUPERADMIN_EMAIL ?? 'admin@onsective.com';
const SUPERADMIN_PW = process.env.SEED_SUPERADMIN_PASSWORD ?? 'OnsecBoad!ChangeMe123';

// Demo law firm + its first admin (the actual customer-facing user).
// Default true for dev convenience. Production .env.production should set
// SEED_DEMO_TENANT=false so re-running seed never re-creates demo data.
const SEED_DEMO_TENANT =
  (process.env.SEED_DEMO_TENANT ?? 'true').toLowerCase() !== 'false';
const DEMO_TENANT_SLUG = process.env.SEED_DEMO_TENANT_SLUG ?? 'demo-law-firm';
const DEMO_TENANT_NAME = process.env.SEED_DEMO_TENANT_NAME ?? 'Demo Law Firm';
const DEMO_ADMIN_EMAIL = process.env.SEED_DEMO_ADMIN_EMAIL ?? 'rk9814289618@gmail.com';
const DEMO_ADMIN_PW = process.env.SEED_DEMO_ADMIN_PASSWORD ?? 'Admin!ChangeMe123';

// Stale identities from earlier seed iterations — removed to avoid confusion.
const STALE_PLATFORM_EMAILS = ['onsectivesoftware@outlook.com'];
const STALE_FIRM_EMAILS = ['admin@acme.test', 'admin@onsective.com'];
const STALE_TENANT_SLUGS = ['acme-immigration'];

const SYSTEM_ROLES: Array<{ name: string; permissions: Prisma.InputJsonValue }> = [
  {
    name: 'FIRM_ADMIN',
    permissions: {
      _all: { read: 'tenant', write: 'tenant', delete: 'tenant' },
    },
  },
  {
    name: 'BRANCH_MANAGER',
    permissions: {
      leads: { read: 'branch', write: 'branch', delete: 'branch' },
      clients: { read: 'branch', write: 'branch', delete: false },
      cases: { read: 'branch', write: 'branch', delete: false },
      documents: { read: 'branch', write: 'branch', delete: 'branch' },
      calls: { read: 'branch', write: 'branch', delete: false },
      campaigns: { read: 'branch', write: 'branch', delete: false },
      leadRules: { read: 'branch', write: false, delete: false },
      reports: { read: 'branch', write: false, delete: false },
      users: { read: 'branch', write: 'branch', delete: 'branch' },
      branches: { read: 'branch', write: false, delete: false },
      audit: { read: 'branch', write: false, delete: false },
      roles: { read: false, write: false, delete: false },
      billing: { read: false, write: false, delete: false },
      settings: { read: false, write: false, delete: false },
    },
  },
  {
    name: 'LAWYER',
    permissions: {
      leads: { read: 'branch', write: false, delete: false },
      clients: { read: 'branch', write: 'assigned', delete: false },
      cases: { read: 'assigned', write: 'assigned', delete: false },
      documents: { read: 'case', write: 'case', delete: false },
      calls: { read: 'own', write: 'own', delete: false },
    },
  },
  {
    name: 'CONSULTANT',
    permissions: {
      leads: { read: 'branch', write: 'own', delete: false },
      clients: { read: 'branch', write: 'assigned', delete: false },
      cases: { read: 'assigned', write: 'assigned', delete: false },
      documents: { read: 'case', write: 'case', delete: false },
      calls: { read: 'own', write: 'own', delete: false },
    },
  },
  {
    name: 'FILER',
    permissions: {
      clients: { read: 'case', write: 'case', delete: false },
      cases: { read: 'assigned', write: 'assigned', delete: false },
      documents: { read: 'case', write: 'case', delete: false },
    },
  },
  {
    name: 'CASE_MANAGER',
    permissions: {
      clients: { read: 'case', write: 'case', delete: false },
      cases: { read: 'assigned', write: 'assigned', delete: false },
      documents: { read: 'case', write: 'case', delete: false },
    },
  },
  {
    name: 'TELECALLER',
    permissions: {
      leads: { read: 'own', write: 'own', delete: false },
      clients: { read: 'own', write: false, delete: false },
      calls: { read: 'own', write: 'own', delete: false },
      campaigns: { read: 'branch', write: false, delete: false },
      reports: { read: 'own', write: false, delete: false },
    },
  },
  {
    name: 'RECEPTIONIST',
    permissions: {
      leads: { read: 'branch', write: 'own', delete: false },
      clients: { read: 'branch', write: 'branch', delete: false },
      appointments: { read: 'branch', write: 'branch', delete: false },
    },
  },
];

const MAPLE_BRANDING: Prisma.InputJsonValue = {
  themeCode: 'maple',
  primary: '#B5132B',
  customPrimary: null,
  logoUrl: null,
};

// Plans sold by Onsective. stripePriceId values are dummy until real Stripe
// keys are wired (set STRIPE_DRY_RUN=false in .env once real prices exist).
const PLANS: Array<{
  code: 'STARTER' | 'GROWTH' | 'SCALE';
  name: string;
  pricePerSeatCents: bigint;
  stripePriceId: string;
  limits: Prisma.InputJsonValue;
}> = [
  {
    code: 'STARTER',
    name: 'Starter',
    pricePerSeatCents: 3900n,
    stripePriceId: 'price_dummy_starter',
    limits: { branches: 1, users: 5, leadsPerMonth: 200, casesPerYear: 100, ai: false },
  },
  {
    code: 'GROWTH',
    name: 'Growth',
    pricePerSeatCents: 7900n,
    stripePriceId: 'price_dummy_growth',
    limits: { branches: 5, users: 50, leadsPerMonth: 5000, casesPerYear: -1, ai: 'basic' },
  },
  {
    code: 'SCALE',
    name: 'Scale',
    pricePerSeatCents: 12900n,
    stripePriceId: 'price_dummy_scale',
    limits: { branches: -1, users: -1, leadsPerMonth: -1, casesPerYear: -1, ai: 'agent', sla: true },
  },
];

async function main(): Promise<void> {
  const createdCreds: Array<{ role: string; email: string; password: string }> = [];

  // 1. Superadmin platform user. PasswordHash is set ONLY on create — re-runs
  // never overwrite a password the user has changed.
  const existingSuper = await prisma.platformUser.findUnique({
    where: { email: SUPERADMIN_EMAIL },
  });
  if (existingSuper) {
    await prisma.platformUser.update({
      where: { email: SUPERADMIN_EMAIL },
      data: { isSuperadmin: true, name: 'Onsective Superadmin' },
    });
    console.log(`✓ superadmin: ${SUPERADMIN_EMAIL} (existing — password preserved)`);
  } else {
    const superHash = await hashPassword(SUPERADMIN_PW);
    await prisma.platformUser.create({
      data: {
        email: SUPERADMIN_EMAIL,
        name: 'Onsective Superadmin',
        passwordHash: superHash,
        isSuperadmin: true,
      },
    });
    createdCreds.push({ role: 'platform superadmin', email: SUPERADMIN_EMAIL, password: SUPERADMIN_PW });
    console.log(`✓ superadmin: ${SUPERADMIN_EMAIL} (created with default password)`);
  }

  // 1b. Plans (idempotent — codes are unique)
  const planByCode = new Map<string, string>();
  for (const p of PLANS) {
    const row = await prisma.plan.upsert({
      where: { code: p.code },
      update: {
        name: p.name,
        pricePerSeatCents: p.pricePerSeatCents,
        stripePriceId: p.stripePriceId,
        limits: p.limits,
        isActive: true,
      },
      create: {
        code: p.code,
        name: p.name,
        pricePerSeatCents: p.pricePerSeatCents,
        stripePriceId: p.stripePriceId,
        limits: p.limits,
      },
    });
    planByCode.set(p.code, row.id);
  }
  console.log(`✓ plans: ${PLANS.length}`);

  // 2-5. Demo tenant + branch + admin user. Skipped entirely when
  // SEED_DEMO_TENANT=false — production should set that to keep the seed
  // idempotent for plans + superadmin only.
  if (!SEED_DEMO_TENANT) {
    console.log('  SEED_DEMO_TENANT=false — skipping demo tenant + demo admin user');
    return;
  }
  const growthPlanId = planByCode.get('GROWTH')!;
  const demoBillingDetails = {
    contactName: 'Onsective Admin',
    contactEmail: DEMO_ADMIN_EMAIL,
    contactPhone: '+14165550100',
    address: {
      line1: '100 King St W',
      city: 'Toronto',
      province: 'ON',
      postalCode: 'M5X 1A9',
      country: 'CA',
    } as Prisma.InputJsonValue,
    taxId: '123456789RT0001',
    taxIdType: 'ca_gst_hst',
  };
  const existingTenant = await prisma.tenant.findUnique({ where: { slug: DEMO_TENANT_SLUG } });
  if (existingTenant && (existingTenant.deletedAt || existingTenant.status === 'CANCELED')) {
    console.log(
      `✓ tenant: ${DEMO_TENANT_SLUG} (deleted/canceled; left alone — set SEED_DEMO_TENANT=false to silence)`,
    );
    return;
  }
  const tenant = await prisma.tenant.upsert({
    where: { slug: DEMO_TENANT_SLUG },
    update: { displayName: DEMO_TENANT_NAME, planId: growthPlanId, ...demoBillingDetails },
    create: {
      legalName: `${DEMO_TENANT_NAME} Inc.`,
      displayName: DEMO_TENANT_NAME,
      slug: DEMO_TENANT_SLUG,
      status: 'ACTIVE',
      packageTier: 'GROWTH',
      planId: growthPlanId,
      branding: MAPLE_BRANDING,
      seatCount: 1,
      setupCompletedAt: new Date(),
      ...demoBillingDetails,
    },
  });
  console.log(`✓ tenant: ${tenant.slug}`);

  // 3. System roles. Permissions are refreshed ONLY when the role is still
  // marked isSystem=true. Once a firm admin edits a system role through the
  // UI, role.update flips isSystem to false (custom override) — and the seed
  // then leaves it alone. Same preservation pattern as user passwords.
  const roleByName = new Map<string, string>();
  let preserved = 0;
  let refreshed = 0;
  for (const def of SYSTEM_ROLES) {
    const existing = await prisma.role.findUnique({
      where: { tenantId_name: { tenantId: tenant.id, name: def.name } },
    });
    if (existing && !existing.isSystem) {
      // Custom override — leave the firm admin's edits intact.
      roleByName.set(def.name, existing.id);
      preserved++;
      continue;
    }
    const role = await prisma.role.upsert({
      where: { tenantId_name: { tenantId: tenant.id, name: def.name } },
      update: { permissions: def.permissions, isSystem: true },
      create: {
        tenantId: tenant.id,
        name: def.name,
        isSystem: true,
        permissions: def.permissions,
      },
    });
    roleByName.set(def.name, role.id);
    refreshed++;
  }
  const summary =
    preserved > 0
      ? `${refreshed} refreshed, ${preserved} preserved (custom override)`
      : `${refreshed}`;
  console.log(`✓ roles: ${summary}`);

  // 4. Demo branch
  const branch = await prisma.branch.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: 'Toronto Main' } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: 'Toronto Main',
      address: {
        line1: '100 King St W',
        city: 'Toronto',
        province: 'ON',
        postalCode: 'M5X 1A9',
        country: 'CA',
      },
      phone: '+14165550100',
      email: 'toronto@onsective.com',
    },
  });

  // 5. Demo Firm Admin — passwordHash set ONLY on create. Existing user's
  // password is left alone on re-seed.
  const adminRoleId = roleByName.get('FIRM_ADMIN');
  if (!adminRoleId) throw new Error('FIRM_ADMIN role missing');
  const existingFirmAdmin = await prisma.user.findUnique({
    where: { tenantId_email: { tenantId: tenant.id, email: DEMO_ADMIN_EMAIL } },
  });
  if (existingFirmAdmin && existingFirmAdmin.deletedAt) {
    // Demo admin was deleted via the UI. Respect that — don't resurrect.
    console.log(
      `✓ firm admin: ${DEMO_ADMIN_EMAIL} (soft-deleted; left alone — set SEED_DEMO_TENANT=false to silence)`,
    );
  } else if (existingFirmAdmin) {
    await prisma.user.update({
      where: { id: existingFirmAdmin.id },
      data: { status: 'ACTIVE', roleId: adminRoleId, branchId: branch.id },
    });
    console.log(`✓ firm admin: ${DEMO_ADMIN_EMAIL} (existing — password preserved)`);
  } else {
    const adminHash = await hashPassword(DEMO_ADMIN_PW);
    await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: DEMO_ADMIN_EMAIL,
        name: 'Onsective Admin',
        passwordHash: adminHash,
        roleId: adminRoleId,
        branchId: branch.id,
        status: 'ACTIVE',
        joinedAt: new Date(),
      },
    });
    createdCreds.push({ role: 'demo firm admin', email: DEMO_ADMIN_EMAIL, password: DEMO_ADMIN_PW });
    console.log(`✓ firm admin: ${DEMO_ADMIN_EMAIL} (created with default password)`);
  }

  // 6. Clean up stale identities from earlier seed runs so the dev DB has
  // exactly the accounts documented in the README.
  for (const email of STALE_PLATFORM_EMAILS) {
    if (email === SUPERADMIN_EMAIL) continue;
    const deleted = await prisma.platformUser.deleteMany({ where: { email } });
    if (deleted.count) console.log(`  removed stale platform user: ${email}`);
  }
  for (const email of STALE_FIRM_EMAILS) {
    if (email === DEMO_ADMIN_EMAIL) continue;
    const deleted = await prisma.user.deleteMany({ where: { email } });
    if (deleted.count) console.log(`  removed stale firm user: ${email}`);
  }
  for (const slug of STALE_TENANT_SLUGS) {
    if (slug === DEMO_TENANT_SLUG) continue;
    const stale = await prisma.tenant.findUnique({ where: { slug } });
    if (!stale) continue;
    // Drop dependents first (no Cascade declared on the schema).
    await prisma.user.deleteMany({ where: { tenantId: stale.id } });
    await prisma.role.deleteMany({ where: { tenantId: stale.id } });
    await prisma.branch.deleteMany({ where: { tenantId: stale.id } });
    await prisma.invite.deleteMany({ where: { tenantId: stale.id } });
    await prisma.auditLog.deleteMany({ where: { tenantId: stale.id } });
    await prisma.tenant.delete({ where: { id: stale.id } });
    console.log(`  removed stale tenant: ${slug}`);
  }

  console.log('\nSeed complete.');
  if (createdCreds.length === 0) {
    console.log('  All seeded users already existed — passwords preserved.');
  } else {
    console.log('  Newly created users (default passwords below — change before any non-local use):');
    for (const c of createdCreds) {
      console.log(`    - ${c.role}: ${c.email} / ${c.password}`);
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
