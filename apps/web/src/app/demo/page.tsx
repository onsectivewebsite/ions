'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, CheckCircle2, Lock, Sparkles } from 'lucide-react';
import { Button, Card, CardBody, Input, Label } from '@onsecboad/ui';
import { Logo } from '../../components/Logo';
import { LocaleSwitcher, useT } from '../../i18n';

/**
 * Public demo of the intake-form experience. No backend, no DB, no auth —
 * pure client-side simulation so prospects can feel the flow before
 * signing up. The form fields mirror what a real firm's "work permit
 * intake" template might look like.
 */

type Field = {
  key: string;
  label: string;
  type: 'text' | 'email' | 'phone' | 'date' | 'select';
  required?: boolean;
  options?: string[];
  placeholder?: string;
};

const FIELDS: Field[] = [
  { key: 'firstName', label: 'First name', type: 'text', required: true },
  { key: 'lastName', label: 'Last name', type: 'text', required: true },
  { key: 'email', label: 'Email', type: 'email', required: true, placeholder: 'you@example.com' },
  { key: 'phone', label: 'Phone', type: 'phone', required: true, placeholder: '+1 416 555 0100' },
  { key: 'dob', label: 'Date of birth', type: 'date', required: true },
  {
    key: 'citizenship',
    label: 'Country of citizenship',
    type: 'select',
    required: true,
    options: ['India', 'Philippines', 'Nigeria', 'China', 'Pakistan', 'Other'],
  },
  {
    key: 'visaType',
    label: 'What are you applying for?',
    type: 'select',
    required: true,
    options: [
      'Work permit',
      'Study permit',
      'Permanent residence (Express Entry)',
      'PR sponsorship (family)',
      'Visitor visa',
      'Citizenship',
      'Not sure yet',
    ],
  },
  {
    key: 'currentLocation',
    label: 'Where are you currently?',
    type: 'select',
    required: true,
    options: ['Canada', 'Outside Canada'],
  },
];

export default function DemoIntakePage() {
  const { t } = useT();
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);

  function validate(): boolean {
    const next: Record<string, string> = {};
    for (const f of FIELDS) {
      if (f.required && !values[f.key]) {
        next[f.key] = `${f.label} is required`;
        continue;
      }
      if (f.type === 'email' && values[f.key] && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values[f.key]!)) {
        next[f.key] = 'Not a valid email';
      }
      if (f.type === 'phone' && values[f.key] && values[f.key]!.replace(/\D/g, '').length < 6) {
        next[f.key] = 'Not a valid phone';
      }
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function submit(): void {
    if (!validate()) return;
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-mesh px-4 py-12">
        <div className="w-full max-w-md space-y-4">
          <Link href="/">
            <Logo />
          </Link>
          <Card>
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-pill)] bg-[color-mix(in_srgb,var(--color-success)_18%,transparent)] text-[var(--color-success)]">
                <CheckCircle2 size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-base font-semibold">Submitted</div>
                <CardBody className="mt-1 text-sm text-[var(--color-text-muted)]">
                  Nice — that&rsquo;s exactly what your client sees. In a real firm, the
                  receptionist&rsquo;s screen lights up the moment this happens, the form
                  auto-locks, and the consultation can be booked.
                </CardBody>
                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                  <Link href="/sign-up" className="flex-1">
                    <Button className="w-full">
                      Start your free trial
                      <ArrowRight size={14} />
                    </Button>
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      setValues({});
                      setSubmitted(false);
                    }}
                    className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                  >
                    Try again
                  </button>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <div className="mb-6 flex items-center justify-between">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        >
          <ArrowLeft size={12} />
          Back
        </Link>
        <div className="flex items-center gap-3">
          <LocaleSwitcher />
          <Link href="/">
            <Logo />
          </Link>
        </div>
      </div>

      <div className="mb-6 rounded-[var(--radius-md)] border border-[var(--color-primary)]/40 bg-[color-mix(in_srgb,var(--color-primary)_8%,transparent)] p-3 text-xs">
        <div className="flex items-center gap-2 font-semibold text-[var(--color-primary)]">
          <Sparkles size={12} />
          {t('demo.eyebrow')}
        </div>
        <p className="mt-1 text-[var(--color-text-muted)]">{t('demo.note')}</p>
      </div>

      <h1 className="text-2xl font-semibold tracking-tight">{t('demo.title')}</h1>
      <p className="mt-1 text-sm text-[var(--color-text-muted)]">{t('demo.subhead')}</p>

      <Card className="mt-6">
        <div className="space-y-5">
          {FIELDS.map((f) => (
            <div key={f.key}>
              <Label htmlFor={`f-${f.key}`}>
                <span className="inline-flex items-center gap-1">
                  {f.label}
                  {f.required ? (
                    <span aria-hidden className="text-[var(--color-danger)]">
                      *
                    </span>
                  ) : null}
                </span>
              </Label>
              {f.type === 'select' ? (
                <select
                  id={`f-${f.key}`}
                  value={values[f.key] ?? ''}
                  onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                  className="mt-1 h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
                >
                  <option value="">— pick one —</option>
                  {f.options?.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  id={`f-${f.key}`}
                  type={f.type === 'phone' ? 'tel' : f.type}
                  value={values[f.key] ?? ''}
                  onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                  placeholder={f.placeholder}
                  className="mt-1"
                />
              )}
              {errors[f.key] ? (
                <div className="mt-1 text-[11px] text-[var(--color-danger)]">{errors[f.key]}</div>
              ) : null}
            </div>
          ))}
        </div>

        <div className="mt-6 flex items-center justify-between gap-3 border-t border-[var(--color-border-muted)] pt-4">
          <div className="text-[11px] text-[var(--color-text-muted)]">
            <Lock size={11} className="mr-1 inline-block" />
            In production, the form auto-locks once submitted.
          </div>
          <Button onClick={submit}>
            {t('demo.submit')}
            <ArrowRight size={14} />
          </Button>
        </div>
      </Card>
    </main>
  );
}
