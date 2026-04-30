'use client';
import { use, useEffect, useState } from 'react';
import { CheckCircle2, FileWarning, Lock, Send } from 'lucide-react';
import { Button, Card, CardBody, Input, Label, Skeleton, ThemeProvider, type Branding } from '@onsecboad/ui';
import { Logo } from '../../../components/Logo';

type Field = {
  key: string;
  label: string;
  type:
    | 'text'
    | 'email'
    | 'phone'
    | 'date'
    | 'number'
    | 'textarea'
    | 'select'
    | 'multiselect'
    | 'checkbox'
    | 'file';
  required?: boolean;
  options?: string[];
  maxLength?: number;
  placeholder?: string;
  helpText?: string;
};

type Preview = {
  ok: true;
  firm: { displayName: string; branding: Branding };
  template: { id: string; name: string; description: string | null; caseType: string; fields: Field[] };
  recipient: { name: string | null; email: string | null; phone: string | null };
  locked: boolean;
  submitted: boolean;
  submittedAt: string | null;
  expiresAt: string;
  existingValues: Record<string, unknown> | null;
};

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export default function PublicIntakePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadError, setLoadError] = useState<{ error: string; message?: string } | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [submittedNow, setSubmittedNow] = useState(false);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function load(): Promise<void> {
    try {
      const res = await fetch(`${API_BASE}/api/v1/intake/${encodeURIComponent(token)}`);
      const j = (await res.json()) as Preview | { ok: false; error: string; message?: string };
      if ('ok' in j && j.ok) {
        setPreview(j);
        if (j.existingValues && typeof j.existingValues === 'object') {
          setValues(j.existingValues as Record<string, unknown>);
        }
      } else {
        setLoadError({ error: (j as { error: string }).error, message: (j as { message?: string }).message });
      }
    } catch (e) {
      setLoadError({ error: 'network', message: e instanceof Error ? e.message : 'Failed to load' });
    }
  }

  async function submit(): Promise<void> {
    setSubmitErr(null);
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/intake/${encodeURIComponent(token)}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values }),
      });
      const j = (await res.json()) as { ok: boolean; error?: string; message?: string };
      if (!res.ok || !j.ok) {
        throw new Error(j.message ?? j.error ?? 'Submit failed');
      }
      setSubmittedNow(true);
    } catch (e) {
      setSubmitErr(e instanceof Error ? e.message : 'Submit failed');
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) {
    const human =
      loadError.error === 'expired'
        ? 'This link has expired. Contact your firm to get a new one.'
        : loadError.error === 'cancelled'
          ? 'This form was cancelled. Contact your firm.'
          : loadError.error === 'not-found'
            ? 'This link is invalid. Double-check the URL or contact your firm.'
            : (loadError.message ?? 'Could not open this form.');
    return (
      <ErrorScreen
        icon={<FileWarning size={20} />}
        title="Form unavailable"
        message={human}
      />
    );
  }

  if (!preview) {
    return (
      <main className="mx-auto max-w-xl space-y-4 p-8">
        <Skeleton className="h-12" />
        <Skeleton className="h-64" />
      </main>
    );
  }

  if (submittedNow || preview.submitted) {
    return (
      <ThemeProvider branding={preview.firm.branding}>
        <main className="flex min-h-screen items-center justify-center bg-mesh px-4 py-12">
          <div className="w-full max-w-md space-y-4">
            <Logo />
            <Card>
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-pill)] bg-[color-mix(in_srgb,var(--color-success)_18%,transparent)] text-[var(--color-success)]">
                  <CheckCircle2 size={20} />
                </div>
                <div>
                  <h1 className="text-xl font-semibold tracking-tight">Submitted</h1>
                  <CardBody className="mt-1 text-sm text-[var(--color-text-muted)]">
                    Thanks — your answers were sent to{' '}
                    <span className="font-medium text-[var(--color-text)]">
                      {preview.firm.displayName}
                    </span>
                    . They&rsquo;ll reach out to schedule the next step. To make changes,
                    contact them and they can re-open this form for you.
                  </CardBody>
                </div>
              </div>
            </Card>
          </div>
        </main>
      </ThemeProvider>
    );
  }

  if (preview.locked) {
    return (
      <ThemeProvider branding={preview.firm.branding}>
        <main className="flex min-h-screen items-center justify-center bg-mesh px-4 py-12">
          <div className="w-full max-w-md space-y-4">
            <Logo />
            <Card>
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-pill)] bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]">
                  <Lock size={20} />
                </div>
                <div>
                  <h1 className="text-xl font-semibold tracking-tight">Form locked</h1>
                  <CardBody className="mt-1 text-sm text-[var(--color-text-muted)]">
                    You&rsquo;ve already submitted this form. {preview.firm.displayName} has
                    locked it to keep an audit trail. Contact them if you need changes — they
                    can re-open it for you.
                  </CardBody>
                </div>
              </div>
            </Card>
          </div>
        </main>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider branding={preview.firm.branding}>
      <main className="mx-auto max-w-2xl space-y-6 px-4 py-12">
        <div className="flex items-center justify-between">
          <Logo />
          <div className="text-xs text-[var(--color-text-muted)]">
            {preview.firm.displayName}
          </div>
        </div>

        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{preview.template.name}</h1>
          {preview.template.description ? (
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              {preview.template.description}
            </p>
          ) : null}
          <p className="mt-2 text-xs text-[var(--color-text-muted)]">
            Once you submit, the form locks. {preview.firm.displayName} can re-open it for you
            if anything needs to change.
          </p>
        </div>

        <Card>
          <div className="space-y-5">
            {preview.template.fields.map((f) => (
              <FieldInput
                key={f.key}
                field={f}
                value={values[f.key]}
                onChange={(v) => setValues({ ...values, [f.key]: v })}
              />
            ))}
          </div>

          {submitErr ? (
            <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] p-3 text-sm text-[var(--color-danger)]">
              {submitErr}
            </div>
          ) : null}

          <div className="mt-5 flex items-center justify-end">
            <Button onClick={submit} disabled={submitting}>
              <Send size={14} />
              {submitting ? 'Submitting…' : 'Submit and lock'}
            </Button>
          </div>
        </Card>

        <p className="text-center text-[11px] text-[var(--color-text-muted)]">
          Powered by OnsecBoad. {preview.firm.displayName} is responsible for what they do
          with your information.
        </p>
      </main>
    </ThemeProvider>
  );
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: Field;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const id = `f-${field.key}`;
  const required = !!field.required;
  const labelEl = (
    <Label htmlFor={id} className="flex items-center gap-1">
      {field.label}
      {required ? <span className="text-[var(--color-danger)]">*</span> : null}
    </Label>
  );

  const help = field.helpText ? (
    <div className="mt-1 text-[11px] text-[var(--color-text-muted)]">{field.helpText}</div>
  ) : null;

  const cmn = 'mt-1';

  if (field.type === 'textarea') {
    return (
      <div>
        {labelEl}
        <textarea
          id={id}
          rows={4}
          className="mt-1 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
          value={typeof value === 'string' ? value : ''}
          maxLength={field.maxLength}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
        {help}
      </div>
    );
  }
  if (field.type === 'select') {
    return (
      <div>
        {labelEl}
        <select
          id={id}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1 h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
        >
          <option value="">— pick one —</option>
          {(field.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        {help}
      </div>
    );
  }
  if (field.type === 'multiselect') {
    const arr = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div>
        {labelEl}
        <div className="mt-1 space-y-1">
          {(field.options ?? []).map((o) => {
            const checked = arr.includes(o);
            return (
              <label key={o} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    const next = e.target.checked ? [...arr, o] : arr.filter((x) => x !== o);
                    onChange(next);
                  }}
                />
                {o}
              </label>
            );
          })}
        </div>
        {help}
      </div>
    );
  }
  if (field.type === 'checkbox') {
    return (
      <div>
        <label className="flex items-center gap-2 text-sm">
          <input
            id={id}
            type="checkbox"
            checked={!!value}
            onChange={(e) => onChange(e.target.checked)}
          />
          {field.label}
          {required ? <span className="text-[var(--color-danger)]">*</span> : null}
        </label>
        {help}
      </div>
    );
  }
  const inputType =
    field.type === 'email'
      ? 'email'
      : field.type === 'phone'
        ? 'tel'
        : field.type === 'number'
          ? 'number'
          : field.type === 'date'
            ? 'date'
            : 'text';
  return (
    <div>
      {labelEl}
      <Input
        id={id}
        type={inputType}
        className={cmn}
        value={typeof value === 'string' ? value : ''}
        maxLength={field.maxLength}
        placeholder={field.placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {help}
    </div>
  );
}

function ErrorScreen({
  icon,
  title,
  message,
}: {
  icon: React.ReactNode;
  title: string;
  message: string;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-mesh p-6">
      <Card className="max-w-md">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-pill)] bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]">
            {icon}
          </div>
          <div>
            <h1 className="text-base font-semibold">{title}</h1>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">{message}</p>
          </div>
        </div>
      </Card>
    </main>
  );
}
