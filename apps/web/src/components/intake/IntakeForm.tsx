'use client';
import { useState, type FormEvent } from 'react';
import { Button, Input, Label, Spinner } from '@onsecboad/ui';

export type IntakeField = {
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
  placeholder?: string;
  helpText?: string;
  options?: string[];
  maxLength?: number;
};

/**
 * Renders an intake form from a template's `fieldsJson`. Same component
 * powers the live editor preview (read-only when `disabled`) and the actual
 * submission flow on /leads/[id].
 */
export function IntakeForm({
  fields,
  initial,
  disabled,
  busy,
  submitLabel = 'Submit intake',
  onSubmit,
}: {
  fields: IntakeField[];
  initial?: Record<string, unknown>;
  disabled?: boolean;
  busy?: boolean;
  submitLabel?: string;
  onSubmit?: (values: Record<string, unknown>) => Promise<void> | void;
}) {
  const [values, setValues] = useState<Record<string, unknown>>(initial ?? {});

  function setField(key: string, v: unknown): void {
    setValues((prev) => ({ ...prev, [key]: v }));
  }

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!onSubmit) return;
    await onSubmit(values);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {fields.map((f) => (
        <div key={f.key}>
          <Label htmlFor={`f-${f.key}`}>
            {f.label}
            {f.required ? <span className="text-[var(--color-danger)]">{' *'}</span> : null}
          </Label>
          {renderControl(f, values[f.key], (v) => setField(f.key, v), disabled)}
          {f.helpText ? (
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">{f.helpText}</p>
          ) : null}
        </div>
      ))}
      {onSubmit ? (
        <div className="flex justify-end pt-2">
          <Button type="submit" disabled={busy || disabled}>
            {busy ? <Spinner /> : null}
            {submitLabel}
          </Button>
        </div>
      ) : null}
    </form>
  );
}

function renderControl(
  f: IntakeField,
  value: unknown,
  set: (v: unknown) => void,
  disabled?: boolean,
) {
  const id = `f-${f.key}`;
  switch (f.type) {
    case 'textarea':
      return (
        <textarea
          id={id}
          className="min-h-[96px] w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm"
          value={(value as string) ?? ''}
          onChange={(e) => set(e.target.value)}
          placeholder={f.placeholder}
          maxLength={f.maxLength}
          required={f.required}
          disabled={disabled}
        />
      );
    case 'select':
      return (
        <select
          id={id}
          className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
          value={(value as string) ?? ''}
          onChange={(e) => set(e.target.value)}
          required={f.required}
          disabled={disabled}
        >
          <option value="">{f.placeholder ?? 'Select…'}</option>
          {(f.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    case 'multiselect': {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="flex flex-wrap gap-2">
          {(f.options ?? []).map((o) => {
            const on = selected.includes(o);
            return (
              <button
                key={o}
                type="button"
                disabled={disabled}
                onClick={() =>
                  set(on ? selected.filter((x) => x !== o) : [...selected, o])
                }
                className={
                  'rounded-[var(--radius-pill)] border px-3 py-1 text-xs ' +
                  (on
                    ? 'border-[var(--color-primary)] bg-[color-mix(in_srgb,var(--color-primary)_12%,transparent)] text-[var(--color-primary)]'
                    : 'border-[var(--color-border)] text-[var(--color-text-muted)]')
                }
              >
                {o}
              </button>
            );
          })}
        </div>
      );
    }
    case 'checkbox':
      return (
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            id={id}
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => set(e.target.checked)}
            disabled={disabled}
          />
          {f.placeholder ?? 'Yes'}
        </label>
      );
    case 'date':
      return (
        <Input
          id={id}
          type="date"
          value={(value as string) ?? ''}
          onChange={(e) => set(e.target.value)}
          required={f.required}
          disabled={disabled}
        />
      );
    case 'number':
      return (
        <Input
          id={id}
          type="number"
          value={(value as string) ?? ''}
          onChange={(e) => set(e.target.value)}
          placeholder={f.placeholder}
          required={f.required}
          disabled={disabled}
        />
      );
    case 'email':
      return (
        <Input
          id={id}
          type="email"
          value={(value as string) ?? ''}
          onChange={(e) => set(e.target.value)}
          placeholder={f.placeholder}
          required={f.required}
          disabled={disabled}
        />
      );
    case 'phone':
      return (
        <Input
          id={id}
          type="tel"
          value={(value as string) ?? ''}
          onChange={(e) => set(e.target.value)}
          placeholder={f.placeholder ?? '+1 416 555 0100'}
          required={f.required}
          disabled={disabled}
        />
      );
    case 'file':
      // Phase 4.1 doesn't ship file uploads yet — surface as a stub so admins
      // can lay out the form. Real upload via R2 lands with the document collection link.
      return (
        <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] p-3 text-xs text-[var(--color-text-muted)]">
          File upload — wired in a later slice. Capture the filename in this slice:
          <Input
            id={id}
            value={(value as string) ?? ''}
            onChange={(e) => set(e.target.value)}
            placeholder="filename or note"
            className="mt-2"
            disabled={disabled}
          />
        </div>
      );
    case 'text':
    default:
      return (
        <Input
          id={id}
          value={(value as string) ?? ''}
          onChange={(e) => set(e.target.value)}
          placeholder={f.placeholder}
          maxLength={f.maxLength}
          required={f.required}
          disabled={disabled}
        />
      );
  }
}
