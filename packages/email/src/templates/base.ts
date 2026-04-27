/**
 * Minimal shared HTML wrapper. Email clients are unforgiving — keep it inline,
 * tables-free where possible, and 600px max width.
 */
export type EmailBrand = {
  productName?: string;
  primaryHex?: string;
  logoUrl?: string | null;
  footerText?: string;
};

const DEFAULT_BRAND: Required<EmailBrand> = {
  productName: 'OnsecBoad',
  primaryHex: '#B5132B',
  logoUrl: null,
  footerText: 'Onsective Inc. · This is a transactional email. Please do not reply.',
};

export function htmlShell(body: string, brand: EmailBrand = {}): string {
  const b = { ...DEFAULT_BRAND, ...brand };
  const logo = b.logoUrl
    ? `<img src="${escapeHtml(b.logoUrl)}" alt="${escapeHtml(b.productName)}" style="height:32px;width:auto" />`
    : `<span style="font-weight:600;font-size:18px;color:${b.primaryHex}">${escapeHtml(b.productName)}</span>`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(b.productName)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f4f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#111827;">
    <div style="max-width:560px;margin:0 auto;padding:32px 16px;">
      <div style="margin-bottom:24px;">${logo}</div>
      <div style="background:#ffffff;border:1px solid #e5e5df;border-radius:12px;padding:24px;">
        ${body}
      </div>
      <p style="margin-top:24px;font-size:12px;color:#6B7280;text-align:center;">
        ${escapeHtml(b.footerText)}
      </p>
    </div>
  </body>
</html>`;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Quick "primary action" button as inline-styled anchor. */
export function buttonHtml(label: string, href: string, primaryHex = '#B5132B'): string {
  return `<a href="${escapeHtml(href)}"
            style="display:inline-block;background:${primaryHex};color:#fff;text-decoration:none;
                   padding:12px 20px;border-radius:8px;font-weight:600;font-size:14px;">
            ${escapeHtml(label)}
          </a>`;
}
