/**
 * Canonical definitions of every built-in role. Used by:
 *   - the Prisma seed (demo tenant)
 *   - platform.tenant.create (every new firm gets all 8 roles up front)
 *
 * Permissions follow the scope vocabulary in packages/auth/src/rbac.ts:
 *   false | own | assigned | case | branch | tenant
 *
 * "_all" is a wildcard that resolveScope falls back to when a resource has no
 * explicit grant — used by FIRM_ADMIN to mean "everything tenant-wide".
 */
import type { Prisma } from '@onsecboad/db';

export type SystemRoleDef = {
  name:
    | 'FIRM_ADMIN'
    | 'BRANCH_MANAGER'
    | 'LAWYER'
    | 'CONSULTANT'
    | 'FILER'
    | 'CASE_MANAGER'
    | 'TELECALLER'
    | 'RECEPTIONIST';
  permissions: Prisma.InputJsonValue;
};

export const SYSTEM_ROLES: SystemRoleDef[] = [
  {
    name: 'FIRM_ADMIN',
    permissions: { _all: { read: 'tenant', write: 'tenant', delete: 'tenant' } },
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
      intake: { read: 'branch', write: 'branch', delete: false },
      // Phase 2 administrative scopes — branch managers can run their branch.
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
      intake: { read: 'branch', write: false, delete: false },
      appointments: { read: 'own', write: 'own', delete: false },
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
      intake: { read: 'branch', write: 'branch', delete: false },
      appointments: { read: 'own', write: 'own', delete: false },
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
    },
  },
  {
    name: 'RECEPTIONIST',
    permissions: {
      leads: { read: 'branch', write: 'own', delete: false },
      clients: { read: 'branch', write: 'branch', delete: false },
      appointments: { read: 'branch', write: 'branch', delete: false },
      // Receptionist runs the walk-in intake flow.
      intake: { read: 'branch', write: 'branch', delete: false },
    },
  },
];
