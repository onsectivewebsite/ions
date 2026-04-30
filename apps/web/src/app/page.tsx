import Link from 'next/link';
import {
  ArrowRight,
  Briefcase,
  ClipboardList,
  CreditCard,
  FileText,
  PhoneCall,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import { Button } from '@onsecboad/ui';
import { Logo } from '../components/Logo';

export default function HomePage() {
  return (
    <main className="min-h-screen bg-mesh">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Logo />
        <div className="flex items-center gap-2">
          <Link
            href="/pricing"
            className="hidden text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] sm:block"
          >
            Pricing
          </Link>
          <Link href="/sign-in" className="hidden sm:block">
            <Button size="sm" variant="ghost">
              Sign in
            </Button>
          </Link>
          <Link href="/sign-up">
            <Button size="sm">
              Start free trial
              <ArrowRight size={14} />
            </Button>
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-3xl px-6 pb-16 pt-16 text-center sm:pt-24">
        <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1 text-xs font-medium text-[var(--color-text-muted)]">
          <Sparkles size={12} />
          Built for Canadian immigration law firms
        </div>
        <h1 className="mt-6 text-4xl font-semibold leading-[1.05] tracking-tight text-[var(--color-text)] sm:text-5xl">
          The operating system for{' '}
          <span className="bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-accent)] bg-clip-text text-transparent">
            Canadian immigration practices.
          </span>
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-[var(--color-text-muted)] sm:text-lg">
          Walk-ins, leads, intake forms, consultations, retainers, IRCC submissions, and
          billing — one workspace your whole firm uses, from the receptionist to the
          principal lawyer.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link href="/sign-up">
            <Button size="lg">
              Start free trial
              <ArrowRight size={16} />
            </Button>
          </Link>
          <Link href="/demo">
            <Button size="lg" variant="secondary">
              See it in action
            </Button>
          </Link>
        </div>
        <p className="mt-4 text-xs text-[var(--color-text-muted)]">
          14-day trial · No credit card · Cancel anytime
        </p>
      </section>

      <section className="mx-auto max-w-5xl px-6 pb-16">
        <div className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-8 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
            One workflow, end to end
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
            <FlowStep
              n="1"
              icon={<Users size={16} />}
              title="Walk-in or lead arrives"
              detail="Phone-first lookup. Existing clients show up with their full history; new ones become a lead in one click."
            />
            <FlowStep
              n="2"
              icon={<ClipboardList size={16} />}
              title="Send intake form"
              detail="Branded form via email, SMS, or QR. Client fills on their own phone. You see the answers the moment they submit."
            />
            <FlowStep
              n="3"
              icon={<Briefcase size={16} />}
              title="Book consult, run case"
              detail="Booking gates on intake completion. Cases track retainers, documents, AI-extracted IRCC data, and payments."
            />
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-5xl grid-cols-1 gap-4 px-6 pb-16 md:grid-cols-3">
        {[
          {
            icon: PhoneCall,
            title: 'Walk-in & multi-channel CRM',
            body: 'Receptionist dashboard with phone-first lookup. Lead capture from Meta, TikTok, your website, and walk-ins, all routed by your rules.',
          },
          {
            icon: FileText,
            title: 'Custom intake + IRCC forms',
            body: "Build per-firm forms once, send by email or QR. AI extracts answers and pre-fills IRCC PDFs — your filer reviews and submits.",
          },
          {
            icon: CreditCard,
            title: 'Retainers, invoices, payments',
            body: 'E-sign retainers, generate invoices, accept Stripe payments via the client portal. Every dollar tied to a case.',
          },
          {
            icon: Users,
            title: 'Built for the whole firm',
            body: 'Role-based dashboards for lawyers, paralegals, telecallers, receptionists, and clients. Branch-scoped permissions if you have multiple offices.',
          },
          {
            icon: ShieldCheck,
            title: 'PIPEDA-ready security',
            body: 'Argon2id passwords, TOTP + passkeys, audit log retention, client data export & right-to-deletion. Hosted in Canada.',
          },
          {
            icon: Sparkles,
            title: 'AI when you want it',
            body: 'Claude-powered document classification, IRCC form drafting, and missing-document follow-ups — with per-firm cost caps.',
          },
        ].map((f) => {
          const Icon = f.icon;
          return (
            <div
              key={f.title}
              className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] bg-[color-mix(in_srgb,var(--color-primary)_14%,transparent)] text-[var(--color-primary)]">
                <Icon size={18} />
              </div>
              <h3 className="mt-4 text-base font-semibold text-[var(--color-text)]">{f.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-[var(--color-text-muted)]">{f.body}</p>
            </div>
          );
        })}
      </section>

      <section className="mx-auto max-w-3xl px-6 pb-24 text-center">
        <h2 className="text-2xl font-semibold tracking-tight">Ready to try it?</h2>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">
          Free for 14 days. We&rsquo;ll have your firm set up in under five minutes.
        </p>
        <div className="mt-6 flex justify-center">
          <Link href="/sign-up">
            <Button size="lg">
              Start free trial
              <ArrowRight size={16} />
            </Button>
          </Link>
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

function FlowStep({
  n,
  icon,
  title,
  detail,
}: {
  n: string;
  icon: React.ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <div className="relative rounded-[var(--radius-lg)] border border-[var(--color-border-muted)] bg-[var(--color-surface-muted)] p-4">
      <div className="flex items-center gap-2 text-xs font-medium text-[var(--color-text-muted)]">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--color-primary)] text-[10px] font-bold text-white">
          {n}
        </span>
        <span className="text-[var(--color-text-muted)]">{icon}</span>
      </div>
      <div className="mt-2 text-sm font-semibold text-[var(--color-text)]">{title}</div>
      <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-muted)]">{detail}</p>
    </div>
  );
}
