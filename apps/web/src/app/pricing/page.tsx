'use client';
import Link from 'next/link';
import { ArrowRight, Check, X } from 'lucide-react';
import { Button } from '@onsecboad/ui';
import { Logo } from '../../components/Logo';
import { LocaleSwitcher, useT } from '../../i18n';

type Tier = {
  code: string;
  name: string;
  pricePerSeat: number;
  tagline: string;
  features: { label: string; included: boolean }[];
  highlighted?: boolean;
};

const TIERS: Tier[] = [
  {
    code: 'STARTER',
    name: 'Starter',
    pricePerSeat: 39,
    tagline: 'Solo lawyers and small practices.',
    features: [
      { label: '1 branch', included: true },
      { label: 'Up to 5 users', included: true },
      { label: '200 leads / month', included: true },
      { label: '100 cases / year', included: true },
      { label: 'Walk-in lookup + custom intake forms', included: true },
      { label: 'Retainers + invoices + Stripe payments', included: true },
      { label: 'Client portal', included: true },
      { label: 'Audit log + 2-year retention', included: true },
      { label: 'AI document classification + form fill', included: false },
      { label: 'Priority support + SLA', included: false },
    ],
  },
  {
    code: 'GROWTH',
    name: 'Growth',
    pricePerSeat: 79,
    tagline: 'Multi-branch firms with several lawyers.',
    highlighted: true,
    features: [
      { label: 'Up to 5 branches', included: true },
      { label: 'Up to 50 users', included: true },
      { label: '5,000 leads / month', included: true },
      { label: 'Unlimited cases', included: true },
      { label: 'Everything in Starter', included: true },
      { label: 'AI document classification', included: true },
      { label: 'AI IRCC form fill (basic)', included: true },
      { label: 'Marketing campaigns (SMS + email)', included: true },
      { label: 'Per-branch reporting', included: true },
      { label: 'Priority support + SLA', included: false },
    ],
  },
  {
    code: 'SCALE',
    name: 'Scale',
    pricePerSeat: 129,
    tagline: 'Enterprise immigration practices.',
    features: [
      { label: 'Unlimited branches + users', included: true },
      { label: 'Unlimited leads + cases', included: true },
      { label: 'Everything in Growth', included: true },
      { label: 'AI agent: missing-document follow-ups', included: true },
      { label: 'Custom roles + permissions', included: true },
      { label: 'SSO / SAML', included: true },
      { label: 'Priority support + 99.9% SLA', included: true },
      { label: 'Dedicated success manager', included: true },
      { label: 'Annual contract discount', included: true },
    ],
  },
];

export default function PricingPage() {
  const { t } = useT();
  return (
    <main className="min-h-screen bg-mesh">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Link href="/">
          <Logo />
        </Link>
        <div className="flex items-center gap-2">
          <LocaleSwitcher className="hidden sm:inline-flex" />
          <Link href="/sign-in" className="hidden sm:block">
            <Button size="sm" variant="ghost">
              {t('nav.signIn')}
            </Button>
          </Link>
          <Link href="/sign-up">
            <Button size="sm">
              {t('nav.startTrial')}
              <ArrowRight size={14} />
            </Button>
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-3xl px-6 pb-12 pt-12 text-center sm:pt-16">
        <h1 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
          {t('pricing.title')}
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-sm text-[var(--color-text-muted)] sm:text-base">
          {t('pricing.subhead')}
        </p>
      </section>

      <section className="mx-auto grid max-w-6xl grid-cols-1 gap-4 px-6 pb-16 lg:grid-cols-3">
        {TIERS.map((t) => (
          <PriceCard key={t.code} tier={t} />
        ))}
      </section>

      <section className="mx-auto max-w-3xl px-6 pb-24 text-center">
        <h2 className="text-xl font-semibold tracking-tight">{t('pricing.faq.title')}</h2>
        <div className="mt-6 grid gap-4 text-left sm:grid-cols-2">
          <Faq
            q="What's a 'seat'?"
            a="One active user account. Receptionists, paralegals, lawyers, even firm admins — anyone signing in to OnsecBoad. Disabled or deleted users don't count."
          />
          <Faq
            q="Can I switch tiers mid-month?"
            a="Yes. We pro-rate the difference automatically. Downgrades take effect at the next billing period."
          />
          <Faq
            q="Do clients count as seats?"
            a="No. Clients use the client portal — that's free and unlimited. Only your firm staff count."
          />
          <Faq
            q="Is there a setup fee?"
            a="No. The setup wizard is free. Self-onboard or schedule a 30-minute kickoff call with us — also free."
          />
          <Faq
            q="Where's my data hosted?"
            a="Toronto, Canada. Encrypted at rest. PIPEDA-aligned retention controls per firm."
          />
          <Faq
            q="Can I export my data?"
            a="Yes — JSON export of every record, anytime, at no extra cost. Right-to-deletion is also self-serve."
          />
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-6 pb-24 text-center">
        <h2 className="text-2xl font-semibold tracking-tight">{t('pricing.cta.title')}</h2>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">{t('pricing.cta.body')}</p>
        <div className="mt-6 flex justify-center gap-3">
          <Link href="/sign-up">
            <Button size="lg">
              {t('pricing.cta.btn')}
              <ArrowRight size={16} />
            </Button>
          </Link>
          <a href="mailto:sales@onsective.com">
            <Button size="lg" variant="secondary">
              {t('pricing.cta.contact')}
            </Button>
          </a>
        </div>
      </section>

      <footer className="border-t border-[var(--color-border)] py-6 text-center text-xs text-[var(--color-text-muted)]">
        © Onsective Inc. · Hosted in Canada ·{' '}
        <a href="mailto:sales@onsective.com" className="hover:underline">
          sales@onsective.com
        </a>
      </footer>
    </main>
  );
}

function PriceCard({ tier }: { tier: Tier }) {
  return (
    <div
      className={
        'relative flex flex-col rounded-[var(--radius-xl)] border bg-[var(--color-surface)] p-6 ' +
        (tier.highlighted
          ? 'border-[var(--color-primary)] shadow-lg ring-1 ring-[var(--color-primary)]'
          : 'border-[var(--color-border)]')
      }
    >
      {tier.highlighted ? (
        <div className="absolute -top-3 left-6 rounded-full bg-[var(--color-primary)] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
          Most popular
        </div>
      ) : null}

      <div className="text-sm font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
        {tier.name}
      </div>
      <div className="mt-3 flex items-baseline gap-1">
        <span className="text-3xl font-semibold tracking-tight">${tier.pricePerSeat}</span>
        <span className="text-sm text-[var(--color-text-muted)]">/ seat / month</span>
      </div>
      <p className="mt-1 text-xs text-[var(--color-text-muted)]">CAD, billed monthly</p>
      <p className="mt-3 text-sm text-[var(--color-text-muted)]">{tier.tagline}</p>

      <ul className="mt-6 space-y-2 text-sm">
        {tier.features.map((f) => (
          <li key={f.label} className="flex items-start gap-2">
            {f.included ? (
              <Check size={14} className="mt-0.5 shrink-0 text-[var(--color-success)]" />
            ) : (
              <X size={14} className="mt-0.5 shrink-0 text-[var(--color-text-muted)]" />
            )}
            <span
              className={
                f.included
                  ? 'text-[var(--color-text)]'
                  : 'text-[var(--color-text-muted)] line-through opacity-60'
              }
            >
              {f.label}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-6 pt-4 border-t border-[var(--color-border-muted)]">
        <Link href="/sign-up" className="block">
          <Button className="w-full" variant={tier.highlighted ? 'primary' : 'secondary'}>
            Start 14-day trial
            <ArrowRight size={14} />
          </Button>
        </Link>
      </div>
    </div>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="text-sm font-semibold">{q}</div>
      <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-muted)]">{a}</p>
    </div>
  );
}
