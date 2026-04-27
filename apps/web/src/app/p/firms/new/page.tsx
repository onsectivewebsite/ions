'use client';
import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Check, CreditCard, Sparkles } from 'lucide-react';
import { Badge, Button, Card, Input, Label, Skeleton, Spinner, ThemeProvider } from '@onsecboad/ui';
import { rpcMutation, rpcQuery } from '../../../../lib/api';
import { getAccessToken } from '../../../../lib/session';
import { AppShell, type ShellUser } from '../../../../components/AppShell';
import { CardCapture } from '../../../../components/CardCapture';

type Plan = {
  id: string;
  code: 'STARTER' | 'GROWTH' | 'SCALE';
  name: string;
  pricePerSeatCents: number;
  currency: string;
  limits: Record<string, unknown>;
};

type Me = { kind: 'platform'; name: string; email: string };

type CreateResp = {
  tenantId: string;
  setupUrl: string;
  emailSent: boolean;
  emailError?: string;
};

const PLAN_BLURBS: Record<Plan['code'], string[]> = {
  STARTER: ['1 branch', '5 users', '200 leads/mo', '100 cases/yr'],
  GROWTH: ['5 branches', '50 users', '5,000 leads/mo', 'Unlimited cases', 'AI form-fill'],
  SCALE: ['Unlimited branches', 'Unlimited users', 'AI agent', 'White-label', 'SLA'],
};

export default function NewFirmPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<CreateResp | null>(null);

  // Step 1
  const [legalName, setLegalName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [slug, setSlug] = useState('');
  const [country, setCountry] = useState('CA');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [addrLine1, setAddrLine1] = useState('');
  const [addrLine2, setAddrLine2] = useState('');
  const [addrCity, setAddrCity] = useState('');
  const [addrProvince, setAddrProvince] = useState('');
  const [addrPostal, setAddrPostal] = useState('');
  const [taxId, setTaxId] = useState('');
  // Default tax-id type by country.
  const taxIdType = country === 'CA' ? 'ca_gst_hst' : country === 'US' ? 'us_ein' : undefined;

  // Step 2
  const [planCode, setPlanCode] = useState<Plan['code']>('GROWTH');

  // Step 3
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [couponCode, setCouponCode] = useState('');
  const [startTrial, setStartTrial] = useState(true);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      router.replace('/sign-in');
      return;
    }
    Promise.all([
      rpcQuery<Me>('user.me', undefined, { token }),
      rpcQuery<Plan[]>('platform.plan.list', undefined, { token }),
    ])
      .then(([m, p]) => {
        if (m.kind !== 'platform') {
          router.replace('/dashboard');
          return;
        }
        setMe(m);
        setPlans(p);
      })
      .catch(() => router.replace('/sign-in'));
  }, [router]);

  function next(): void {
    setError(null);
    if (step === 1) {
      if (!legalName || !displayName || !slug || !contactName || !contactEmail) {
        setError('Fill the required fields.');
        return;
      }
      if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug)) {
        setError('Slug: lowercase letters, numbers, and hyphens only.');
        return;
      }
    }
    setStep((s) => (s < 4 ? ((s + 1) as 1 | 2 | 3 | 4) : s));
  }

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const token = getAccessToken();
      const address =
        addrLine1 || addrCity || addrProvince || addrPostal
          ? {
              line1: addrLine1 || undefined,
              line2: addrLine2 || undefined,
              city: addrCity || undefined,
              province: addrProvince || undefined,
              postalCode: addrPostal || undefined,
              country,
            }
          : undefined;
      const res = await rpcMutation<CreateResp>(
        'platform.tenant.create',
        {
          legalName,
          displayName,
          slug,
          country,
          contactName,
          contactEmail,
          contactPhone: contactPhone || undefined,
          address,
          taxId: taxId || undefined,
          taxIdType: taxId ? taxIdType : undefined,
          planCode,
          paymentMethodId: paymentMethodId || undefined,
          couponCode: couponCode || undefined,
          startTrial,
        },
        { token },
      );
      setDone(res);
      setStep(5);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Provisioning failed');
    } finally {
      setSubmitting(false);
    }
  }

  if (!me || !plans) {
    return (
      <main className="grid min-h-screen grid-cols-[240px_1fr]">
        <div className="border-r border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <Skeleton className="h-6 w-32" />
        </div>
        <div className="space-y-4 p-8">
          <Skeleton className="h-12" />
          <Skeleton className="h-64" />
        </div>
      </main>
    );
  }

  const shellUser: ShellUser = {
    name: me.name,
    email: me.email,
    scope: 'platform',
    contextLabel: 'Onsective Platform',
  };

  const selectedPlan = plans.find((p) => p.code === planCode);

  return (
    <ThemeProvider branding={{ themeCode: 'maple' }}>
      <AppShell user={shellUser}>
        <div className="mx-auto w-full max-w-3xl space-y-6">
          <div className="flex items-center justify-between">
            <Link
              href="/p/firms"
              className="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              <ArrowLeft size={12} />
              Back to firms
            </Link>
            <div className="text-xs text-[var(--color-text-muted)]">
              Step {Math.min(step, 4)} of 4
            </div>
          </div>

          {step !== 5 ? (
            <>
              <h1 className="text-2xl font-semibold tracking-tight">
                {step === 1
                  ? 'Firm information'
                  : step === 2
                    ? 'Choose plan'
                    : step === 3
                      ? 'Payment method'
                      : 'Review & provision'}
              </h1>

              <Card>
                {step === 1 ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div>
                        <Label htmlFor="legal">Legal name *</Label>
                        <Input
                          id="legal"
                          value={legalName}
                          onChange={(e) => setLegalName(e.target.value)}
                        />
                      </div>
                      <div>
                        <Label htmlFor="display">Display name *</Label>
                        <Input
                          id="display"
                          value={displayName}
                          onChange={(e) => {
                            setDisplayName(e.target.value);
                            if (!slug) {
                              setSlug(
                                e.target.value
                                  .toLowerCase()
                                  .replace(/[^a-z0-9]+/g, '-')
                                  .replace(/^-+|-+$/g, '')
                                  .slice(0, 40),
                              );
                            }
                          }}
                        />
                      </div>
                    </div>
                    <div>
                      <Label htmlFor="slug">Slug *</Label>
                      <div className="mt-1 flex items-center gap-2">
                        <Input
                          id="slug"
                          value={slug}
                          onChange={(e) =>
                            setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))
                          }
                          className="font-mono"
                        />
                        <span className="shrink-0 text-xs text-[var(--color-text-muted)]">
                          .onsecboad.com
                        </span>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div>
                        <Label htmlFor="country">Country *</Label>
                        <select
                          id="country"
                          value={country}
                          onChange={(e) => setCountry(e.target.value)}
                          className="mt-1 h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
                        >
                          <option value="CA">Canada</option>
                          <option value="US">United States</option>
                        </select>
                      </div>
                      <div>
                        <Label htmlFor="phone">Contact phone</Label>
                        <Input
                          id="phone"
                          value={contactPhone}
                          onChange={(e) => setContactPhone(e.target.value)}
                          placeholder="+1 ___ ___ ____"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div>
                        <Label htmlFor="cname">Primary contact name *</Label>
                        <Input
                          id="cname"
                          value={contactName}
                          onChange={(e) => setContactName(e.target.value)}
                        />
                      </div>
                      <div>
                        <Label htmlFor="cemail">Contact email *</Label>
                        <Input
                          id="cemail"
                          type="email"
                          value={contactEmail}
                          onChange={(e) => setContactEmail(e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="border-t border-[var(--color-border-muted)] pt-4">
                      <div className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                        Billing address (shows on invoices)
                      </div>
                      <div className="mt-3 space-y-3">
                        <div>
                          <Label htmlFor="addr1">Street address</Label>
                          <Input id="addr1" value={addrLine1} onChange={(e) => setAddrLine1(e.target.value)} />
                        </div>
                        <div>
                          <Label htmlFor="addr2">Suite / unit</Label>
                          <Input id="addr2" value={addrLine2} onChange={(e) => setAddrLine2(e.target.value)} />
                        </div>
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                          <div>
                            <Label htmlFor="acity">City</Label>
                            <Input id="acity" value={addrCity} onChange={(e) => setAddrCity(e.target.value)} />
                          </div>
                          <div>
                            <Label htmlFor="aprov">Province / State</Label>
                            <Input id="aprov" value={addrProvince} onChange={(e) => setAddrProvince(e.target.value)} />
                          </div>
                          <div>
                            <Label htmlFor="apost">Postal / ZIP</Label>
                            <Input id="apost" value={addrPostal} onChange={(e) => setAddrPostal(e.target.value)} />
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="border-t border-[var(--color-border-muted)] pt-4">
                      <div className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                        Tax identification (optional, shown on invoices)
                      </div>
                      <div className="mt-3">
                        <Label htmlFor="tid">
                          {country === 'CA' ? 'GST/HST number' : country === 'US' ? 'EIN' : 'Tax ID'}
                        </Label>
                        <Input
                          id="tid"
                          value={taxId}
                          onChange={(e) => setTaxId(e.target.value)}
                          placeholder={country === 'CA' ? '123456789RT0001' : ''}
                          className="font-mono"
                        />
                      </div>
                    </div>
                  </div>
                ) : null}

                {step === 2 ? (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    {plans.map((p) => {
                      const selected = planCode === p.code;
                      return (
                        <button
                          key={p.code}
                          type="button"
                          onClick={() => setPlanCode(p.code)}
                          className={
                            'group relative rounded-[var(--radius-md)] border p-4 text-left transition-colors ' +
                            (selected
                              ? 'border-[var(--color-primary)] bg-[color-mix(in_srgb,var(--color-primary)_8%,transparent)]'
                              : 'border-[var(--color-border)] hover:border-[var(--color-primary)]/50')
                          }
                        >
                          {selected ? (
                            <div className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-primary)] text-white">
                              <Check size={12} />
                            </div>
                          ) : null}
                          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                            {p.code}
                          </div>
                          <div className="mt-1 flex items-baseline gap-1">
                            <div className="text-2xl font-semibold">
                              ${(p.pricePerSeatCents / 100).toFixed(0)}
                            </div>
                            <div className="text-xs text-[var(--color-text-muted)]">
                              / seat / mo
                            </div>
                          </div>
                          <ul className="mt-3 space-y-1 text-xs text-[var(--color-text-muted)]">
                            {PLAN_BLURBS[p.code].map((b) => (
                              <li key={b} className="flex items-center gap-1.5">
                                <Check size={11} className="shrink-0 text-[var(--color-primary)]" />
                                {b}
                              </li>
                            ))}
                          </ul>
                        </button>
                      );
                    })}
                  </div>
                ) : null}

                {step === 3 ? (
                  <div className="space-y-4">
                    {paymentMethodId ? (
                      <div className="rounded-[var(--radius-md)] border border-[var(--color-success)]/30 bg-[color-mix(in_srgb,var(--color-success)_8%,transparent)] p-3 text-sm text-[var(--color-success)]">
                        Card captured — <span className="font-mono text-xs">{paymentMethodId}</span>
                        <button
                          type="button"
                          onClick={() => setPaymentMethodId('')}
                          className="ml-3 text-xs underline"
                        >
                          Replace
                        </button>
                      </div>
                    ) : (
                      <CardCapture
                        onSuccess={(pm) => setPaymentMethodId(pm)}
                        buttonLabel="Save card"
                      />
                    )}
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div>
                        <Label htmlFor="coupon">Coupon code</Label>
                        <Input
                          id="coupon"
                          value={couponCode}
                          onChange={(e) => setCouponCode(e.target.value)}
                        />
                      </div>
                      <label className="mt-6 inline-flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={startTrial}
                          onChange={(e) => setStartTrial(e.target.checked)}
                        />
                        Start with a 14-day trial (no charge until trial ends)
                      </label>
                    </div>
                    <p className="text-xs text-[var(--color-text-muted)]">
                      You can also skip card capture entirely and have the firm admin add their card from <span className="font-mono">/settings/billing</span> later.
                    </p>
                  </div>
                ) : null}

                {step === 4 && selectedPlan ? (
                  <div className="space-y-3 text-sm">
                    <Row label="Firm">{displayName}</Row>
                    <Row label="Slug">
                      <span className="font-mono">{slug}.onsecboad.com</span>
                    </Row>
                    <Row label="Plan">
                      <Badge tone="neutral">{selectedPlan.code}</Badge>
                      <span className="ml-2 text-[var(--color-text-muted)]">
                        ${(selectedPlan.pricePerSeatCents / 100).toFixed(0)} / seat
                      </span>
                    </Row>
                    <Row label="Initial seats">1 (Firm Admin)</Row>
                    <Row label="Trial">{startTrial ? '14 days' : 'No trial'}</Row>
                    <Row label="Setup email goes to">{contactEmail}</Row>
                  </div>
                ) : null}

                {error ? (
                  <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] p-3 text-sm text-[var(--color-danger)]">
                    {error}
                  </div>
                ) : null}

                <div className="mt-6 flex items-center justify-between">
                  <Button
                    variant="ghost"
                    disabled={step === 1 || submitting}
                    onClick={() => setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3 | 4) : s))}
                  >
                    <ArrowLeft size={14} /> Back
                  </Button>
                  {step < 4 ? (
                    <Button onClick={next} disabled={submitting}>
                      Next <ArrowRight size={14} />
                    </Button>
                  ) : (
                    <Button onClick={submit} disabled={submitting}>
                      {submitting ? <Spinner /> : <CreditCard size={14} />}
                      Provision firm
                    </Button>
                  )}
                </div>
              </Card>
            </>
          ) : (
            <Card>
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-pill)] bg-[color-mix(in_srgb,var(--color-success)_15%,transparent)] text-[var(--color-success)]">
                  <Sparkles size={20} />
                </div>
                <div className="flex-1">
                  <h2 className="text-lg font-semibold">Firm provisioned</h2>
                  {done?.emailSent ? (
                    <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                      A setup email is on the way to <span className="font-mono">{contactEmail}</span>. The link expires in 7 days.
                    </p>
                  ) : (
                    <div className="mt-2 rounded-[var(--radius-md)] border border-[var(--color-warning)]/40 bg-[color-mix(in_srgb,var(--color-warning)_8%,transparent)] p-3 text-sm text-[var(--color-warning)]">
                      <div className="font-medium">Email failed</div>
                      <p className="mt-1 text-xs">
                        The firm was created. Copy the setup link below and share it manually — it&apos;s valid for 7 days.
                      </p>
                    </div>
                  )}
                  {done ? (
                    <div className="mt-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3 text-xs">
                      <div className="font-medium">Direct setup link{done.emailSent ? ' (also in the email)' : ' (share this manually)'}:</div>
                      <code className="mt-1 block break-all">{done.setupUrl}</code>
                      <button
                        type="button"
                        onClick={() => navigator.clipboard.writeText(done.setupUrl)}
                        className="mt-2 text-[var(--color-primary)] hover:underline"
                      >
                        Copy link
                      </button>
                    </div>
                  ) : null}
                  <div className="mt-4 flex gap-2">
                    {done ? (
                      <Link href={`/p/firms/${done.tenantId}`}>
                        <Button>View firm</Button>
                      </Link>
                    ) : null}
                    <Link href="/p/firms">
                      <Button variant="ghost">Back to firms</Button>
                    </Link>
                  </div>
                </div>
              </div>
            </Card>
          )}
        </div>
      </AppShell>
    </ThemeProvider>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[var(--color-border-muted)] py-2 last:border-0">
      <div className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">{label}</div>
      <div>{children}</div>
    </div>
  );
}
