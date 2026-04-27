import { describe, it, expect } from 'vitest';
import { resolveScope, hasAtLeast, whereForRead, type Permissions } from './rbac';

const FIRM_ADMIN: Permissions = {
  _all: { read: 'tenant', write: 'tenant', delete: 'tenant' },
};

const FILER: Permissions = {
  cases: { read: 'assigned', write: 'assigned', delete: false },
  documents: { read: 'case', write: 'case', delete: false },
};

const TELECALLER: Permissions = {
  leads: { read: 'own', write: 'own', delete: false },
};

describe('rbac.resolveScope', () => {
  it('uses _all fallback when no explicit perm', () => {
    expect(resolveScope(FIRM_ADMIN, 'leads', 'read')).toBe('tenant');
  });

  it('explicit perm wins over _all', () => {
    expect(resolveScope(FILER, 'cases', 'read')).toBe('assigned');
  });

  it('returns false when neither is set', () => {
    expect(resolveScope(FILER, 'billing', 'read')).toBe(false);
  });
});

describe('rbac.hasAtLeast', () => {
  it('grants when scope meets minimum', () => {
    expect(hasAtLeast(FIRM_ADMIN, 'cases', 'read', 'branch')).toBe(true);
  });

  it('denies when scope is below minimum', () => {
    expect(hasAtLeast(TELECALLER, 'leads', 'read', 'branch')).toBe(false);
  });

  it('denies when permission is false', () => {
    expect(hasAtLeast(FILER, 'cases', 'delete', 'own')).toBe(false);
  });
});

describe('rbac.whereForRead', () => {
  const ctx = { userId: 'u1', branchId: 'b1', permissions: TELECALLER };

  it('returns null when no read access', () => {
    expect(whereForRead(ctx, 'billing')).toBeNull();
  });

  it('scopes "own" via ownerField', () => {
    expect(whereForRead(ctx, 'leads', { ownerField: 'assignedTo' })).toEqual({ assignedTo: 'u1' });
  });

  it('scopes "branch" via branchField', () => {
    const branchCtx = {
      ...ctx,
      permissions: { leads: { read: 'branch' as const, write: false } } satisfies Permissions,
    };
    expect(whereForRead(branchCtx, 'leads', { branchField: 'branchId' })).toEqual({
      branchId: 'b1',
    });
  });

  it('scopes "tenant" to no narrowing (RLS handles it)', () => {
    expect(whereForRead({ ...ctx, permissions: FIRM_ADMIN }, 'leads')).toEqual({});
  });
});
