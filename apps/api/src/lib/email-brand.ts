/**
 * Per-tenant email branding selector. Pulls displayName + branding JSON
 * (logoUrl proxy URL, customPrimary hex) and shapes them into the
 * EmailBrand the @onsecboad/email templates expect. Used by every send-
 * email call site so transactional emails never go out as generic
 * "OnsecBoad" red — they look like the firm sent them.
 */
import type { EmailBrand } from '@onsecboad/email';

type TenantBrandRow = {
  displayName: string;
  branding?: unknown;
};

export function tenantEmailBrand(t: TenantBrandRow | null | undefined): EmailBrand {
  if (!t) return { productName: 'OnsecBoad' };
  const b = (t.branding as Record<string, unknown> | null | undefined) ?? {};
  const primaryHex =
    typeof b.customPrimary === 'string' && /^#[0-9a-fA-F]{6}$/.test(b.customPrimary)
      ? b.customPrimary
      : undefined;
  const logoUrl =
    typeof b.logoUrl === 'string' && b.logoUrl.length > 0 ? b.logoUrl : null;
  return {
    productName: t.displayName,
    primaryHex,
    logoUrl,
    footerText: `${t.displayName} · powered by Onsective. Transactional email — please do not reply.`,
  };
}
