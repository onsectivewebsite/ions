import Link from 'next/link';
import { ArrowRight, ShieldCheck, Sparkles, Users } from 'lucide-react';
import { Button } from '@onsecboad/ui';
import { Logo } from '../components/Logo';

export default function HomePage() {
  return (
    <main className="min-h-screen bg-mesh">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Logo />
        <Link href="/sign-in">
          <Button size="sm">
            Sign in
            <ArrowRight size={14} />
          </Button>
        </Link>
      </header>

      <section className="mx-auto max-w-3xl px-6 pb-24 pt-20 text-center">
        <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1 text-xs font-medium text-[var(--color-text-muted)]">
          <Sparkles size={12} />
          Phase 0 · Foundation is live
        </div>
        <h1 className="mt-6 text-5xl font-semibold leading-[1.05] tracking-tight text-[var(--color-text)]">
          The operating system for{' '}
          <span className="bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-accent)] bg-clip-text text-transparent">
            Canadian immigration practices.
          </span>
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-[var(--color-text-muted)]">
          OnsecBoad runs the lead pipeline, intake, consultations, retainers,
          document collection, and IRCC submissions in one workspace — with
          built-in CRM, e-sign, billing, and client portal.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link href="/sign-in">
            <Button size="lg">
              Sign in to your workspace
              <ArrowRight size={16} />
            </Button>
          </Link>
          <Link href="/sign-in">
            <Button size="lg" variant="secondary">
              Try the demo account
            </Button>
          </Link>
        </div>
        <p className="mt-4 text-xs text-[var(--color-text-muted)]">
          By invitation only. Contact your firm admin or sales@onsective.com.
        </p>
      </section>

      <section className="mx-auto grid max-w-5xl grid-cols-1 gap-4 px-6 pb-24 md:grid-cols-3">
        {[
          {
            icon: Users,
            title: 'Built for the whole firm',
            body: 'Lawyers, consultants, filers, telecallers, receptionists, and clients all work in one system with role-based dashboards.',
          },
          {
            icon: ShieldCheck,
            title: 'PIPEDA-ready security',
            body: 'Argon2id passwords, passkeys, two-factor auth, row-level tenant isolation, encrypted columns for sensitive credentials.',
          },
          {
            icon: Sparkles,
            title: 'AI when you want it',
            body: 'Claude-powered document classification, IRCC form drafting, and missing-document follow-ups with cost guardrails per firm.',
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

      <footer className="border-t border-[var(--color-border)] py-6 text-center text-xs text-[var(--color-text-muted)]">
        © Onsective Inc. · Hosted in Canada · Privacy · Terms
      </footer>
    </main>
  );
}
