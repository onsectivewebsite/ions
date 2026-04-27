/**
 * Retainer template merge-tag renderer.
 *
 * Substitutes `{{path.field}}` tokens with values from a flat lookup map.
 * No conditionals, no loops — keep it simple, add complexity only when a
 * firm asks for it. Unknown tags pass through unchanged so authors can
 * see what they got wrong.
 *
 * Vocabulary (case is the data, not the model name):
 *   {{client.name}}      first + last
 *   {{client.first_name}} {{client.last_name}}
 *   {{client.email}}     {{client.phone}}     {{client.language}}
 *   {{lawyer.name}}      {{lawyer.email}}
 *   {{firm.name}}        {{firm.address}}
 *   {{case.case_type}}   {{case.retainer_fee}}  {{case.total_fee}}
 *   {{date.today}}       ISO yyyy-mm-dd in firm tz
 */
import type { Case, Client, Tenant, User } from '@onsecboad/db';

export type RetainerVars = Record<string, string>;

export function buildRetainerVars(args: {
  tenant: Pick<Tenant, 'displayName' | 'legalName' | 'address'>;
  client: Pick<Client, 'firstName' | 'lastName' | 'email' | 'phone' | 'language'>;
  lawyer: Pick<User, 'name' | 'email'>;
  case_: Pick<Case, 'caseType' | 'retainerFeeCents' | 'totalFeeCents'>;
  todayIso: string;
}): RetainerVars {
  const c = args.case_;
  const formatMoney = (cents: number | null | undefined): string =>
    cents == null ? '—' : `CAD $${(cents / 100).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fullName =
    [args.client.firstName, args.client.lastName].filter(Boolean).join(' ').trim() || 'Client';

  // Address comes through as JSON; render it line-by-line if possible.
  let firmAddress = '';
  const addr = args.tenant.address as
    | { line1?: string; line2?: string; city?: string; province?: string; postalCode?: string; country?: string }
    | null
    | undefined;
  if (addr && typeof addr === 'object') {
    firmAddress = [
      addr.line1,
      addr.line2,
      [addr.city, addr.province].filter(Boolean).join(', '),
      [addr.postalCode, addr.country].filter(Boolean).join(' '),
    ]
      .filter(Boolean)
      .join('\n');
  }

  return {
    'client.name': fullName,
    'client.first_name': args.client.firstName ?? '',
    'client.last_name': args.client.lastName ?? '',
    'client.email': args.client.email ?? '',
    'client.phone': args.client.phone ?? '',
    'client.language': args.client.language ?? '',
    'lawyer.name': args.lawyer.name,
    'lawyer.email': args.lawyer.email,
    'firm.name': args.tenant.displayName ?? args.tenant.legalName,
    'firm.legal_name': args.tenant.legalName,
    'firm.address': firmAddress,
    'case.case_type': c.caseType.replace(/_/g, ' '),
    'case.retainer_fee': formatMoney(c.retainerFeeCents),
    'case.total_fee': formatMoney(c.totalFeeCents),
    'date.today': args.todayIso,
  };
}

/**
 * Replaces `{{path.field}}` tokens. Unknown tags pass through verbatim
 * (with the braces) so the author sees them in the rendered output.
 */
export function renderTemplate(content: string, vars: RetainerVars): string {
  return content.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key: string) => {
    const value = vars[key];
    return value === undefined ? `{{${key}}}` : value;
  });
}

/**
 * Default retainer body shipped on every new firm — generic enough that
 * a Canadian immigration practice can use it as-is, specific enough that
 * the firm sees the merge-tag mechanism in action.
 */
export const DEFAULT_RETAINER_MD = `# Retainer Agreement

**Date:** {{date.today}}

**Client:** {{client.name}}
**Phone:** {{client.phone}}
**Email:** {{client.email}}

**Firm:** {{firm.name}}
{{firm.address}}

**File type:** {{case.case_type}}
**Retainer fee:** {{case.retainer_fee}}
**Estimated full fee:** {{case.total_fee}}

## 1. Scope of representation

{{firm.name}} (the "Firm") agrees to act as legal counsel for {{client.name}} (the "Client") in the matter described above. The scope of work is limited to the preparation, filing, and reasonable follow-up on the named application with Immigration, Refugees and Citizenship Canada (IRCC).

## 2. Fees and payment

The Client agrees to pay the retainer fee shown above on signing. Additional fees, disbursements (government processing fees, translations, courier) and applicable taxes will be invoiced separately. **The Firm will not submit any application to IRCC until all fees are cleared.**

## 3. Cooperation

The Client agrees to provide all requested documents promptly and to respond to communications within a reasonable timeframe. The Firm cannot be held responsible for delays caused by missing or late documentation.

## 4. Confidentiality

All communications between the Firm and the Client are confidential and protected by solicitor-client privilege.

## 5. Termination

Either party may terminate this retainer in writing. Fees for work completed up to the termination date are non-refundable.

## 6. Acceptance

The Client acknowledges they have read, understood, and accept the terms above.

---

**Lawyer of record:** {{lawyer.name}} ({{lawyer.email}})
`;
