'use client';
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, CheckCircle2, Sparkles } from 'lucide-react';
import { Button, Card, Input, Spinner } from '@onsecboad/ui';
import { rpcMutation } from '../../lib/api';
import { Logo } from '../../components/Logo';
import { FieldLabel, FieldError } from '../../components/forms';

type SignupResp = {
  ok: true;
  tenantId: string;
  contactEmail: string;
  emailSent: boolean;
  emailError: string | null;
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

export default function SignUpPage() {
  const [legalName, setLegalName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [slug, setSlug] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SignupResp | null>(null);

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (legalName.trim().length < 2) next.legalName = 'Required';
    if (displayName.trim().length < 2) next.displayName = 'Required';
    if (!/^[a-z0-9-]{3,40}$/.test(slug))
      next.slug = '3–40 chars, lowercase letters, digits, dashes';
    if (contactName.trim().length < 2) next.contactName = 'Required';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) next.contactEmail = 'Valid email required';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setGlobalError(null);
    if (!validate()) return;
    setBusy(true);
    try {
      const r = await rpcMutation<SignupResp>('auth.selfSignup', {
        legalName: legalName.trim(),
        displayName: displayName.trim(),
        slug: slug.trim().toLowerCase(),
        contactName: contactName.trim(),
        contactEmail: contactEmail.trim().toLowerCase(),
      });
      setResult(r);
    } catch (e) {
      setGlobalError(e instanceof Error ? e.message : 'Signup failed');
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-mesh px-4 py-12">
        <div className="w-full max-w-md space-y-4">
          <Logo />
          <Card>
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-pill)] bg-[color-mix(in_srgb,var(--color-success)_18%,transparent)] text-[var(--color-success)]">
                <CheckCircle2 size={20} />
              </div>
              <div>
                <h1 className="text-xl font-semibold tracking-tight">Check your inbox</h1>
                <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                  We sent a setup link to{' '}
                  <span className="font-mono">{result.contactEmail}</span>. Click it to choose
                  your password and pick a theme — your firm goes live the moment you finish.
                </p>
                {!result.emailSent ? (
                  <p className="mt-3 rounded-[var(--radius-md)] border border-[var(--color-warning)]/40 bg-[color-mix(in_srgb,var(--color-warning)_10%,transparent)] p-2 text-xs">
                    Email delivery hiccupped: {result.emailError}. Contact{' '}
                    <a className="underline" href="mailto:support@onsective.com">
                      support@onsective.com
                    </a>{' '}
                    if you don&rsquo;t get the link in 5 minutes.
                  </p>
                ) : null}
              </div>
            </div>
          </Card>
          <p className="text-center text-xs text-[var(--color-text-muted)]">
            Already activated?{' '}
            <Link href="/sign-in" className="hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-mesh px-4 py-12">
      <div className="w-full max-w-lg space-y-4">
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            <ArrowLeft size={12} />
            Back
          </Link>
          <Logo />
        </div>

        <Card>
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-pill)] bg-[color-mix(in_srgb,var(--color-primary)_12%,transparent)] text-[var(--color-primary)]">
              <Sparkles size={18} />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Start your free trial</h1>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                14 days, no credit card. We&rsquo;ll email you a link to finish setup.
              </p>
            </div>
          </div>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <div>
              <FieldLabel htmlFor="ln" required>
                Firm legal name
              </FieldLabel>
              <Input
                id="ln"
                value={legalName}
                onChange={(e) => {
                  setLegalName(e.target.value);
                  if (!slug) setSlug(slugify(e.target.value));
                }}
                placeholder="Maple Immigration Law Professional Corporation"
              />
              <FieldError message={errors.legalName} />
            </div>

            <div>
              <FieldLabel htmlFor="dn" required>
                Display name (what clients see)
              </FieldLabel>
              <Input
                id="dn"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Maple Immigration"
              />
              <FieldError message={errors.displayName} />
            </div>

            <div>
              <FieldLabel htmlFor="slug" required>
                Workspace URL slug
              </FieldLabel>
              <div className="flex items-center gap-1">
                <span className="text-xs text-[var(--color-text-muted)]">
                  onsective.cloud/f/
                </span>
                <Input
                  id="slug"
                  value={slug}
                  onChange={(e) => setSlug(slugify(e.target.value))}
                  placeholder="maple-immigration"
                  className="flex-1"
                />
              </div>
              <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
                Only used internally for routing. You can&rsquo;t change it later.
              </p>
              <FieldError message={errors.slug} />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <FieldLabel htmlFor="cn" required>
                  Your name
                </FieldLabel>
                <Input
                  id="cn"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  placeholder="Sarah Patel"
                />
                <FieldError message={errors.contactName} />
              </div>
              <div>
                <FieldLabel htmlFor="ce" required>
                  Your email
                </FieldLabel>
                <Input
                  id="ce"
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder="sarah@firm.com"
                />
                <FieldError message={errors.contactEmail} />
              </div>
            </div>

            {globalError ? (
              <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] p-3 text-sm text-[var(--color-danger)]">
                {globalError}
              </div>
            ) : null}

            <Button type="submit" disabled={busy} className="w-full">
              {busy ? <Spinner /> : null}
              Send setup email
              <ArrowRight size={14} />
            </Button>

            <p className="text-center text-[11px] text-[var(--color-text-muted)]">
              By signing up you agree to our terms. Already have an account?{' '}
              <Link href="/sign-in" className="hover:underline">
                Sign in
              </Link>
              .
            </p>
          </form>
        </Card>
      </div>
    </main>
  );
}
