'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, CreditCard, FileText, Pencil, Sparkles, X } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardTitle,
  Input,
  Label,
  Skeleton,
  Spinner,
  ThemeProvider,
  type Branding,
} from '@onsecboad/ui';
import { rpcMutation, rpcQuery } from '../../../lib/api';
import { getAccessToken } from '../../../lib/session';
import { AppShell, type ShellUser } from '../../../components/AppShell';
import { CardCapture } from '../../../components/CardCapture';

type SubResp = {
  tenant: {
    id: string;
    displayName: string;
    status: 'PROVISIONING' | 'ACTIVE' | 'SUSPENDED' | 'CANCELED';
    seatCount: number;
    trialEndsAt: string | null;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
  };
  plan: {
    code: 'STARTER' | 'GROWTH' | 'SCALE';
    name: string;
    pricePerSeatCents: number;
    currency: string;
  } | null;
};

type Address = {
  line1?: string;
  line2?: string;
  city?: string;
  province?: string;
  postalCode?: string;
  country?: string;
} | null;

type BillingDetails = {
  legalName: string;
  displayName: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  address: Address;
  taxId: string | null;
  taxIdType: string | null;
};

type Invoice = {
  id: string;
  stripeInvoiceId: string;
  amountCents: number;
  currency: string;
  status: string;
  periodStart: string;
  periodEnd: string;
  pdfUrl: string | null;
  hostedUrl: string | null;
};

type Me = {
  kind: 'firm';
  name: string;
  email: string;
  tenant: { displayName: string; branding: Branding };
};

export default function BillingPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [sub, setSub] = useState<SubResp | null>(null);
  const [details, setDetails] = useState<BillingDetails | null>(null);
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cardOpen, setCardOpen] = useState(false);
  const [setupSecret, setSetupSecret] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    const token = getAccessToken();
    if (!token) return;
    const [s, i, d] = await Promise.all([
      rpcQuery<SubResp>('billing.subscriptionGet', undefined, { token }),
      rpcQuery<{ items: Invoice[] }>('billing.invoices', { page: 1 }, { token }),
      rpcQuery<BillingDetails>('billing.detailsGet', undefined, { token }),
    ]);
    setSub(s);
    setInvoices(i.items);
    setDetails(d);
  }

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      router.replace('/sign-in');
      return;
    }
    rpcQuery<Me>('user.me', undefined, { token })
      .then((m) => {
        if (m.kind !== 'firm') {
          router.replace('/dashboard');
          return;
        }
        setMe(m);
      })
      .catch(() => router.replace('/sign-in'));
    void refresh();
  }, [router]);

  async function changePlan(code: 'STARTER' | 'GROWTH' | 'SCALE'): Promise<void> {
    if (!sub) return;
    if (!confirm(`Switch to ${code}?`)) return;
    setBusy(true);
    setInfo(null);
    setError(null);
    try {
      const token = getAccessToken();
      await rpcMutation('billing.changePlan', { planCode: code }, { token });
      setInfo(`Plan changed to ${code}.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Plan change failed');
    } finally {
      setBusy(false);
    }
  }

  async function startCardUpdate(): Promise<void> {
    setBusy(true);
    setInfo(null);
    setError(null);
    try {
      const token = getAccessToken();
      const { clientSecret } = await rpcMutation<{ clientSecret: string }>(
        'billing.updatePaymentMethod',
        undefined,
        { token },
      );
      setSetupSecret(clientSecret);
      setCardOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start card update');
    } finally {
      setBusy(false);
    }
  }

  async function onCardCaptured(pm: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const token = getAccessToken();
      await rpcMutation('billing.attachPaymentMethod', { paymentMethodId: pm }, { token });
      setInfo('Card on file updated.');
      setCardOpen(false);
      setSetupSecret(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to attach card');
    } finally {
      setBusy(false);
    }
  }

  if (!me || !sub) {
    return (
      <main className="grid min-h-screen grid-cols-[240px_1fr]">
        <div className="border-r border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <Skeleton className="h-6 w-32" />
        </div>
        <div className="space-y-4 p-8">
          <Skeleton className="h-32" />
          <Skeleton className="h-64" />
        </div>
      </main>
    );
  }

  const branding = me.tenant.branding ?? { themeCode: 'maple' };
  const shellUser: ShellUser = {
    name: me.name,
    email: me.email,
    scope: 'firm',
    contextLabel: me.tenant.displayName,
  };
  const mrr = sub.plan
    ? `$${((sub.tenant.seatCount * sub.plan.pricePerSeatCents) / 100).toFixed(2)}`
    : '—';

  return (
    <ThemeProvider branding={branding}>
      <AppShell user={shellUser}>
        <div className="space-y-8">
          <div>
            <div className="text-xs text-[var(--color-text-muted)]">Settings</div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Billing</h1>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Your subscription, payment method, and invoices.
            </p>
          </div>

          {info ? (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-success)]/30 bg-[color-mix(in_srgb,var(--color-success)_10%,transparent)] p-3 text-sm text-[var(--color-success)]">
              {info}
            </div>
          ) : null}
          {error ? (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] p-3 text-sm text-[var(--color-danger)]">
              {error}
            </div>
          ) : null}

          <Card>
            <div className="flex items-center justify-between">
              <CardTitle>Current plan</CardTitle>
              <Badge tone={sub.tenant.status === 'ACTIVE' ? 'success' : 'neutral'}>
                {sub.tenant.status}
              </Badge>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
              <Stat label="Plan">{sub.plan?.name ?? '—'}</Stat>
              <Stat label="Seats">{sub.tenant.seatCount}</Stat>
              <Stat label="Per seat">
                {sub.plan ? `$${(sub.plan.pricePerSeatCents / 100).toFixed(0)}` : '—'}
              </Stat>
              <Stat label="MRR">{mrr}</Stat>
            </div>
            {sub.tenant.trialEndsAt ? (
              <div className="mt-4 flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-info)]/30 bg-[color-mix(in_srgb,var(--color-info)_8%,transparent)] p-3 text-xs text-[var(--color-info)]">
                <Sparkles size={12} />
                Trial ends {new Date(sub.tenant.trialEndsAt).toLocaleDateString()} — your card is charged on that date.
              </div>
            ) : null}
            <div className="mt-6">
              <CardTitle>Change plan</CardTitle>
              <div className="mt-3 flex flex-wrap gap-2">
                {(['STARTER', 'GROWTH', 'SCALE'] as const).map((code) => (
                  <Button
                    key={code}
                    size="sm"
                    variant={sub.plan?.code === code ? 'primary' : 'secondary'}
                    disabled={busy || sub.plan?.code === code}
                    onClick={() => changePlan(code)}
                  >
                    {code}
                  </Button>
                ))}
              </div>
            </div>
          </Card>

          <Card>
            <div className="flex items-center justify-between">
              <CardTitle>Billing details</CardTitle>
              <div className="flex items-center gap-3">
                <Building2 size={16} className="text-[var(--color-text-muted)]" />
                <Button size="sm" variant="ghost" onClick={() => setEditOpen(true)}>
                  <Pencil size={12} /> Edit
                </Button>
              </div>
            </div>
            <p className="mt-2 text-sm text-[var(--color-text-muted)]">
              These details appear on every invoice we send on your behalf.
            </p>
            {details ? (
              <dl className="mt-4 grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
                <DetailRow label="Legal name">{details.legalName}</DetailRow>
                <DetailRow label="Contact">
                  {details.contactName ?? '—'}
                </DetailRow>
                <DetailRow label="Email">{details.contactEmail ?? '—'}</DetailRow>
                <DetailRow label="Phone">{details.contactPhone ?? '—'}</DetailRow>
                <div className="md:col-span-2">
                  <DetailRow label="Address">{formatBillingAddress(details.address)}</DetailRow>
                </div>
                <DetailRow label="Tax ID">
                  {details.taxId ? (
                    <span className="font-mono">
                      {details.taxIdType ? TAX_LABEL[details.taxIdType] ?? details.taxIdType : ''}{' '}
                      {details.taxId}
                    </span>
                  ) : (
                    '—'
                  )}
                </DetailRow>
              </dl>
            ) : (
              <Skeleton className="mt-4 h-32" />
            )}
          </Card>

          <Card>
            <div className="flex items-center justify-between">
              <CardTitle>Payment method</CardTitle>
              <CreditCard size={16} className="text-[var(--color-text-muted)]" />
            </div>
            <p className="mt-2 text-sm text-[var(--color-text-muted)]">
              Card details never reach our server. Stripe Elements collects them directly.
            </p>
            {!cardOpen ? (
              <div className="mt-3">
                <Button variant="secondary" disabled={busy} onClick={startCardUpdate}>
                  Update card
                </Button>
              </div>
            ) : (
              <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-4">
                <CardCapture
                  clientSecret={setupSecret ?? undefined}
                  onSuccess={onCardCaptured}
                  buttonLabel="Save card"
                />
                <button
                  type="button"
                  onClick={() => {
                    setCardOpen(false);
                    setSetupSecret(null);
                  }}
                  className="mt-3 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                >
                  Cancel
                </button>
              </div>
            )}
          </Card>

          <Card>
            <CardTitle>Invoices</CardTitle>
            <div className="mt-4 divide-y divide-[var(--color-border-muted)]">
              {invoices === null ? (
                <Skeleton className="h-12" />
              ) : invoices.length === 0 ? (
                <div className="py-12 text-center text-sm text-[var(--color-text-muted)]">
                  <FileText size={20} className="mx-auto mb-2 opacity-60" />
                  No invoices yet. The first one arrives at the end of your trial.
                </div>
              ) : (
                invoices.map((inv) => (
                  <div key={inv.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                    <div>
                      <div className="font-medium">
                        {new Date(inv.periodStart).toLocaleDateString()} —{' '}
                        {new Date(inv.periodEnd).toLocaleDateString()}
                      </div>
                      <div className="text-xs text-[var(--color-text-muted)]">
                        ${(inv.amountCents / 100).toFixed(2)} {inv.currency} · {inv.status}
                      </div>
                    </div>
                    {inv.pdfUrl ? (
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            const token = getAccessToken();
                            const { url } = await rpcQuery<{ url: string }>(
                              'billing.invoiceUrl',
                              { id: inv.id },
                              { token },
                            );
                            window.open(url, '_blank', 'noopener');
                          } catch (err) {
                            setError(err instanceof Error ? err.message : 'Failed to load PDF');
                          }
                        }}
                        className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-primary)] hover:underline"
                      >
                        Download PDF
                      </button>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>

        {editOpen && details ? (
          <EditDetailsDialog
            details={details}
            onClose={() => setEditOpen(false)}
            onSaved={async () => {
              setEditOpen(false);
              setInfo('Billing details saved.');
              await refresh();
            }}
            onError={(msg) => setError(msg)}
          />
        ) : null}
      </AppShell>
    </ThemeProvider>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">{label}</div>
      <div className="mt-1 text-base font-semibold">{children}</div>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">{label}</dt>
      <dd className="mt-1">{children}</dd>
    </div>
  );
}

const TAX_LABEL: Record<string, string> = {
  ca_gst_hst: 'GST/HST',
  ca_pst_bc: 'BC PST',
  ca_pst_mb: 'MB PST',
  ca_pst_sk: 'SK PST',
  ca_qst: 'QC QST',
  us_ein: 'EIN',
  eu_vat: 'EU VAT',
  gb_vat: 'GB VAT',
  in_gst: 'India GST',
};

function formatBillingAddress(a: Address): string {
  if (!a) return '—';
  const lines = [
    a.line1,
    a.line2,
    [a.city, a.province, a.postalCode].filter(Boolean).join(', '),
    a.country,
  ].filter(Boolean);
  return lines.length ? lines.join(' · ') : '—';
}

function EditDetailsDialog({
  details,
  onClose,
  onSaved,
  onError,
}: {
  details: BillingDetails;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  onError: (msg: string) => void;
}) {
  const [legalName, setLegalName] = useState(details.legalName);
  const [contactName, setContactName] = useState(details.contactName ?? '');
  const [contactEmail, setContactEmail] = useState(details.contactEmail ?? '');
  const [contactPhone, setContactPhone] = useState(details.contactPhone ?? '');
  const [line1, setLine1] = useState(details.address?.line1 ?? '');
  const [line2, setLine2] = useState(details.address?.line2 ?? '');
  const [city, setCity] = useState(details.address?.city ?? '');
  const [province, setProvince] = useState(details.address?.province ?? '');
  const [postalCode, setPostalCode] = useState(details.address?.postalCode ?? '');
  const [country, setCountry] = useState(details.address?.country ?? 'CA');
  const [taxId, setTaxId] = useState(details.taxId ?? '');
  const [taxIdType, setTaxIdType] = useState(
    details.taxIdType ?? (country === 'CA' ? 'ca_gst_hst' : 'us_ein'),
  );
  const [busy, setBusy] = useState(false);

  async function save(): Promise<void> {
    setBusy(true);
    try {
      const token = getAccessToken();
      const address =
        line1 || line2 || city || province || postalCode
          ? {
              line1: line1 || undefined,
              line2: line2 || undefined,
              city: city || undefined,
              province: province || undefined,
              postalCode: postalCode || undefined,
              country,
            }
          : null;
      await rpcMutation(
        'billing.detailsUpdate',
        {
          legalName,
          contactName,
          contactEmail,
          contactPhone: contactPhone || null,
          address,
          taxId: taxId || null,
          taxIdType: taxId ? taxIdType : null,
        },
        { token },
      );
      await onSaved();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-12">
      <Card className="w-full max-w-xl">
        <div className="flex items-center justify-between border-b border-[var(--color-border-muted)] pb-3">
          <CardTitle>Edit billing details</CardTitle>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[var(--radius-md)] p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)]"
          >
            <X size={16} />
          </button>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <Label htmlFor="bd_legal">Legal name</Label>
            <Input id="bd_legal" value={legalName} onChange={(e) => setLegalName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="bd_cname">Contact name</Label>
            <Input id="bd_cname" value={contactName} onChange={(e) => setContactName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="bd_cemail">Contact email</Label>
            <Input id="bd_cemail" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="bd_cphone">Contact phone</Label>
            <Input id="bd_cphone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
          </div>
        </div>

        <div className="mt-4 border-t border-[var(--color-border-muted)] pt-4">
          <div className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">Billing address</div>
          <div className="mt-3 space-y-3">
            <Input value={line1} onChange={(e) => setLine1(e.target.value)} placeholder="Street" />
            <Input value={line2} onChange={(e) => setLine2(e.target.value)} placeholder="Suite / unit" />
            <div className="grid grid-cols-3 gap-3">
              <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" />
              <Input value={province} onChange={(e) => setProvince(e.target.value)} placeholder="Province" />
              <Input value={postalCode} onChange={(e) => setPostalCode(e.target.value)} placeholder="Postal" />
            </div>
            <select
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
            >
              <option value="CA">Canada</option>
              <option value="US">United States</option>
            </select>
          </div>
        </div>

        <div className="mt-4 border-t border-[var(--color-border-muted)] pt-4">
          <div className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">Tax ID</div>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <select
              value={taxIdType}
              onChange={(e) => setTaxIdType(e.target.value)}
              className="col-span-1 h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
            >
              <option value="ca_gst_hst">GST/HST (CA)</option>
              <option value="ca_qst">QST (QC)</option>
              <option value="ca_pst_bc">PST (BC)</option>
              <option value="us_ein">EIN (US)</option>
              <option value="eu_vat">EU VAT</option>
              <option value="gb_vat">GB VAT</option>
              <option value="in_gst">India GST</option>
            </select>
            <Input
              className="col-span-2 font-mono"
              value={taxId}
              onChange={(e) => setTaxId(e.target.value)}
              placeholder="123456789RT0001"
            />
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? <Spinner /> : null}
            Save changes
          </Button>
        </div>
      </Card>
    </div>
  );
}
