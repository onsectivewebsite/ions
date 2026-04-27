'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Eye,
  Pencil,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardTitle,
  Input,
  Label,
  Spinner,
} from '@onsecboad/ui';
import { rpcMutation } from '../../lib/api';
import { getAccessToken } from '../../lib/session';
import { IntakeForm, type IntakeField } from './IntakeForm';

const FIELD_TYPES: IntakeField['type'][] = [
  'text',
  'email',
  'phone',
  'date',
  'number',
  'textarea',
  'select',
  'multiselect',
  'checkbox',
  'file',
];

const CASE_TYPES = [
  ['work_permit', 'Work permit'],
  ['study_permit', 'Study permit'],
  ['pr', 'Permanent residence'],
  ['visitor_visa', 'Visitor visa'],
  ['citizenship', 'Citizenship'],
  ['lmia', 'LMIA'],
  ['other', 'Other'],
] as const;

export type TemplateFormState = {
  id?: string;
  name: string;
  caseType: string;
  description: string;
  isActive: boolean;
  fields: IntakeField[];
};

const STARTER_FIELDS: IntakeField[] = [
  { key: 'first_name', label: 'First name', type: 'text', required: true },
  { key: 'last_name', label: 'Last name', type: 'text', required: true },
  { key: 'phone', label: 'Phone', type: 'phone', required: true },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'language', label: 'Preferred language', type: 'select', options: ['English', 'Punjabi', 'Hindi', 'French', 'Spanish'] },
];

export function TemplateEditor({
  initial,
}: {
  initial?: TemplateFormState | null;
}) {
  const router = useRouter();
  const isNew = !initial;
  const [state, setState] = useState<TemplateFormState>(
    initial ?? {
      name: '',
      caseType: 'work_permit',
      description: '',
      isActive: true,
      fields: STARTER_FIELDS,
    },
  );
  const [editingFieldIdx, setEditingFieldIdx] = useState<number | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setField<K extends keyof TemplateFormState>(k: K, v: TemplateFormState[K]) {
    setState((prev) => ({ ...prev, [k]: v }));
  }

  function moveField(idx: number, dir: -1 | 1): void {
    const j = idx + dir;
    if (j < 0 || j >= state.fields.length) return;
    const next = state.fields.slice();
    [next[idx], next[j]] = [next[j]!, next[idx]!];
    setField('fields', next);
  }

  function addField(): void {
    const idx = state.fields.length;
    const newField: IntakeField = {
      key: `field_${idx + 1}`,
      label: `Field ${idx + 1}`,
      type: 'text',
    };
    setField('fields', [...state.fields, newField]);
    setEditingFieldIdx(idx);
  }

  function removeField(idx: number): void {
    setField(
      'fields',
      state.fields.filter((_, i) => i !== idx),
    );
    setEditingFieldIdx(null);
  }

  function updateField(idx: number, patch: Partial<IntakeField>): void {
    const next = state.fields.slice();
    next[idx] = { ...next[idx]!, ...patch };
    setField('fields', next);
  }

  const keysInUse = useMemo(() => new Set(state.fields.map((f) => f.key)), [state.fields]);
  const dupeKeys = state.fields.filter((f, i) => state.fields.findIndex((g) => g.key === f.key) !== i);

  async function save(): Promise<void> {
    setError(null);
    if (!state.name.trim()) {
      setError('Name is required.');
      return;
    }
    if (state.fields.length === 0) {
      setError('Add at least one field.');
      return;
    }
    if (dupeKeys.length > 0) {
      setError(`Duplicate field key: ${dupeKeys.map((d) => d.key).join(', ')}`);
      return;
    }
    setBusy(true);
    try {
      const token = getAccessToken();
      const payload = {
        name: state.name.trim(),
        caseType: state.caseType,
        description: state.description || undefined,
        fieldsJson: state.fields,
        isActive: state.isActive,
      };
      if (isNew) {
        const r = await rpcMutation<{ id: string }>('intakeTemplate.create', payload, { token });
        router.replace(`/settings/intake-forms/${r.id}`);
      } else {
        await rpcMutation('intakeTemplate.update', { id: state.id, ...payload }, { token });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    if (!state.id) return;
    if (!confirm('Delete this template? Past submissions block this — deactivate instead if it does.')) return;
    setBusy(true);
    setError(null);
    try {
      const token = getAccessToken();
      await rpcMutation('intakeTemplate.delete', { id: state.id }, { token });
      router.replace('/settings/intake-forms');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <div>
        <Link
          href="/settings/intake-forms"
          className="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        >
          <ArrowLeft size={12} />
          Back to intake forms
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          {isNew ? 'New intake template' : state.name || 'Intake template'}
        </h1>
      </div>

      {error ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] p-3 text-sm text-[var(--color-danger)]">
          {error}
        </div>
      ) : null}

      <Card>
        <CardTitle>Template details</CardTitle>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <Label>Name</Label>
            <Input
              value={state.name}
              onChange={(e) => setField('name', e.target.value)}
              placeholder="Work Permit Intake"
              required
            />
          </div>
          <div>
            <Label>Case type</Label>
            <select
              className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
              value={state.caseType}
              onChange={(e) => setField('caseType', e.target.value)}
            >
              {CASE_TYPES.map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <Label>Description (optional)</Label>
            <Input
              value={state.description}
              onChange={(e) => setField('description', e.target.value)}
              placeholder="Use this template for all initial work permit consults."
            />
          </div>
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={state.isActive}
              onChange={(e) => setField('isActive', e.target.checked)}
            />
            Active (available to receptionists)
          </label>
        </div>
      </Card>

      <Card>
        <div className="flex items-center justify-between">
          <CardTitle>Fields</CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => setShowPreview((s) => !s)}>
              <Eye size={14} /> {showPreview ? 'Hide preview' : 'Preview'}
            </Button>
            <Button onClick={addField}>
              <Plus size={14} /> Add field
            </Button>
          </div>
        </div>

        {showPreview ? (
          <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-border-muted)] p-4">
            <div className="mb-3 text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
              Live preview
            </div>
            <IntakeForm fields={state.fields} disabled />
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--color-border-muted)]">
            {state.fields.map((f, idx) => (
              <li key={idx} className="py-3">
                <div className="flex items-center gap-3">
                  <div className="flex flex-col gap-1">
                    <button
                      onClick={() => moveField(idx, -1)}
                      disabled={idx === 0}
                      className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                    >
                      <ArrowUp size={14} />
                    </button>
                    <button
                      onClick={() => moveField(idx, 1)}
                      disabled={idx === state.fields.length - 1}
                      className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                    >
                      <ArrowDown size={14} />
                    </button>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{f.label}</span>
                      <Badge tone="neutral">{f.type}</Badge>
                      {f.required ? <Badge tone="warning">required</Badge> : null}
                    </div>
                    <div className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                      key: <code className="font-mono">{f.key}</code>
                      {f.options?.length
                        ? ` · ${f.options.length} option${f.options.length === 1 ? '' : 's'}`
                        : ''}
                    </div>
                  </div>
                  <button
                    className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                    onClick={() => setEditingFieldIdx(editingFieldIdx === idx ? null : idx)}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-1.5 text-[var(--color-danger)] hover:bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)]"
                    onClick={() => removeField(idx)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                {editingFieldIdx === idx ? (
                  <FieldEditor
                    field={f}
                    keysInUse={keysInUse}
                    onChange={(patch) => updateField(idx, patch)}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="flex items-center justify-between">
        {!isNew ? (
          <Button variant="danger" onClick={() => void remove()} disabled={busy}>
            <Trash2 size={14} /> Delete template
          </Button>
        ) : (
          <span></span>
        )}
        <Button onClick={() => void save()} disabled={busy || !state.name}>
          {busy ? <Spinner /> : <Save size={14} />}
          {isNew ? 'Create template' : 'Save changes'}
        </Button>
      </div>
    </div>
  );
}

function FieldEditor({
  field,
  keysInUse,
  onChange,
}: {
  field: IntakeField;
  keysInUse: Set<string>;
  onChange: (patch: Partial<IntakeField>) => void;
}) {
  const isOptionType = field.type === 'select' || field.type === 'multiselect';
  return (
    <div className="mt-3 grid grid-cols-2 gap-3 rounded-[var(--radius-md)] border border-[var(--color-border-muted)] bg-[var(--color-surface-muted)] p-3">
      <div>
        <Label>Label</Label>
        <Input value={field.label} onChange={(e) => onChange({ label: e.target.value })} />
      </div>
      <div>
        <Label>Key (snake_case)</Label>
        <Input
          value={field.key}
          onChange={(e) => onChange({ key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })}
          invalid={[...keysInUse].filter((k) => k === field.key).length > 1}
        />
      </div>
      <div>
        <Label>Type</Label>
        <select
          className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
          value={field.type}
          onChange={(e) => onChange({ type: e.target.value as IntakeField['type'] })}
        >
          {FIELD_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <label className="inline-flex items-center gap-2 self-end pb-2 text-sm">
        <input
          type="checkbox"
          checked={field.required ?? false}
          onChange={(e) => onChange({ required: e.target.checked })}
        />
        Required
      </label>
      <div className="col-span-2">
        <Label>Placeholder / help</Label>
        <Input
          value={field.placeholder ?? ''}
          onChange={(e) => onChange({ placeholder: e.target.value })}
          placeholder="Hint text shown inside the input"
        />
      </div>
      {isOptionType ? (
        <div className="col-span-2">
          <Label>Options (one per line)</Label>
          <textarea
            className="min-h-[80px] w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm"
            value={(field.options ?? []).join('\n')}
            onChange={(e) =>
              onChange({
                options: e.target.value
                  .split('\n')
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
            placeholder={'Yes\nNo\nMaybe'}
          />
        </div>
      ) : null}
    </div>
  );
}
