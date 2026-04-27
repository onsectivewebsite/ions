'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowDown, ArrowLeft, ArrowUp, Plus, Save, Trash2 } from 'lucide-react';
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

const CASE_TYPES = [
  ['', 'Default (any case type)'],
  ['work_permit', 'Work permit'],
  ['study_permit', 'Study permit'],
  ['pr', 'Permanent residence'],
  ['visitor_visa', 'Visitor visa'],
  ['citizenship', 'Citizenship'],
  ['lmia', 'LMIA'],
  ['other', 'Other'],
] as const;

export type ChecklistItem = {
  key: string;
  label: string;
  description?: string;
  required?: boolean;
  accept?: string[];
  maxSizeMb?: number;
};

export type ChecklistTemplateState = {
  id?: string;
  name: string;
  caseType: string;
  description: string;
  items: ChecklistItem[];
  isActive: boolean;
  isDefault: boolean;
};

const STARTER_ITEMS: ChecklistItem[] = [
  { key: 'passport', label: 'Passport (bio page)', required: true, accept: ['.pdf', '.png', '.jpg'], maxSizeMb: 25 },
  { key: 'photo', label: 'Recent passport-size photo', required: true, accept: ['.png', '.jpg'], maxSizeMb: 10 },
  { key: 'proof_of_funds', label: 'Proof of funds (bank statement)', required: false, accept: ['.pdf'], maxSizeMb: 25 },
];

export function ChecklistEditor({ initial }: { initial?: ChecklistTemplateState | null }) {
  const router = useRouter();
  const isNew = !initial;
  const [s, setS] = useState<ChecklistTemplateState>(
    initial ?? {
      name: '',
      caseType: '',
      description: '',
      items: STARTER_ITEMS,
      isActive: true,
      isDefault: false,
    },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof ChecklistTemplateState>(k: K, v: ChecklistTemplateState[K]): void {
    setS((prev) => ({ ...prev, [k]: v }));
  }

  function moveItem(idx: number, dir: -1 | 1): void {
    const j = idx + dir;
    if (j < 0 || j >= s.items.length) return;
    const next = s.items.slice();
    [next[idx], next[j]] = [next[j]!, next[idx]!];
    set('items', next);
  }

  function updateItem(idx: number, patch: Partial<ChecklistItem>): void {
    const next = s.items.slice();
    next[idx] = { ...next[idx]!, ...patch };
    set('items', next);
  }

  function addItem(): void {
    const idx = s.items.length;
    set('items', [
      ...s.items,
      {
        key: `item_${idx + 1}`,
        label: `New item ${idx + 1}`,
        required: false,
        accept: ['.pdf'],
        maxSizeMb: 25,
      },
    ]);
  }

  function removeItem(idx: number): void {
    set(
      'items',
      s.items.filter((_, i) => i !== idx),
    );
  }

  async function save(): Promise<void> {
    setError(null);
    if (!s.name.trim()) {
      setError('Name is required.');
      return;
    }
    if (s.items.length === 0) {
      setError('Add at least one item.');
      return;
    }
    const dupes = s.items.filter(
      (it, i) => s.items.findIndex((x) => x.key === it.key) !== i,
    );
    if (dupes.length > 0) {
      setError(`Duplicate item keys: ${dupes.map((d) => d.key).join(', ')}`);
      return;
    }
    setBusy(true);
    try {
      const token = getAccessToken();
      const payload = {
        name: s.name.trim(),
        caseType: s.caseType ? s.caseType : null,
        description: s.description || undefined,
        itemsJson: s.items,
        isActive: s.isActive,
        isDefault: s.isDefault,
      };
      if (isNew) {
        const r = await rpcMutation<{ id: string }>(
          'documentChecklistTemplate.create',
          payload,
          { token },
        );
        router.replace(`/settings/document-checklists/${r.id}`);
      } else {
        await rpcMutation('documentChecklistTemplate.update', { id: s.id, ...payload }, { token });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    if (!s.id) return;
    if (!confirm('Delete this checklist? Past collections block this — deactivate instead if it does.'))
      return;
    setBusy(true);
    try {
      const token = getAccessToken();
      await rpcMutation('documentChecklistTemplate.delete', { id: s.id }, { token });
      router.replace('/settings/document-checklists');
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
          href="/settings/document-checklists"
          className="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        >
          <ArrowLeft size={12} />
          Back to checklists
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          {isNew ? 'New document checklist' : s.name || 'Document checklist'}
        </h1>
      </div>

      {error ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] p-3 text-sm text-[var(--color-danger)]">
          {error}
        </div>
      ) : null}

      <Card>
        <CardTitle>Details</CardTitle>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <Label>Name</Label>
            <Input value={s.name} onChange={(e) => set('name', e.target.value)} placeholder="Standard work permit checklist" required />
          </div>
          <div>
            <Label>Case type</Label>
            <select
              className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
              value={s.caseType}
              onChange={(e) => set('caseType', e.target.value)}
            >
              {CASE_TYPES.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <Label>Description</Label>
            <Input
              value={s.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="Used for all standard work permit files."
            />
          </div>
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={s.isActive} onChange={(e) => set('isActive', e.target.checked)} />
            Active
          </label>
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={s.isDefault} onChange={(e) => set('isDefault', e.target.checked)} />
            Default for this case type
          </label>
        </div>
      </Card>

      <Card>
        <div className="flex items-center justify-between">
          <CardTitle>Items</CardTitle>
          <Button onClick={addItem}>
            <Plus size={14} /> Add item
          </Button>
        </div>
        <ul className="mt-3 space-y-3">
          {s.items.map((it, idx) => (
            <li
              key={idx}
              className="rounded-[var(--radius-md)] border border-[var(--color-border-muted)] bg-[var(--color-surface-muted)] p-3"
            >
              <div className="flex items-start gap-3">
                <div className="flex flex-col gap-1">
                  <button
                    onClick={() => moveItem(idx, -1)}
                    disabled={idx === 0}
                    className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    onClick={() => moveItem(idx, 1)}
                    disabled={idx === s.items.length - 1}
                    className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                  >
                    <ArrowDown size={14} />
                  </button>
                </div>
                <div className="flex-1 grid grid-cols-2 gap-3">
                  <div>
                    <Label>Label</Label>
                    <Input value={it.label} onChange={(e) => updateItem(idx, { label: e.target.value })} />
                  </div>
                  <div>
                    <Label>Key (snake_case)</Label>
                    <Input
                      value={it.key}
                      onChange={(e) =>
                        updateItem(idx, {
                          key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
                        })
                      }
                    />
                  </div>
                  <div className="col-span-2">
                    <Label>Description (shown to client)</Label>
                    <Input
                      value={it.description ?? ''}
                      onChange={(e) => updateItem(idx, { description: e.target.value })}
                      placeholder="Optional helper text"
                    />
                  </div>
                  <div>
                    <Label>Accepted types</Label>
                    <Input
                      value={(it.accept ?? []).join(', ')}
                      onChange={(e) =>
                        updateItem(idx, {
                          accept: e.target.value
                            .split(',')
                            .map((x) => x.trim())
                            .filter(Boolean),
                        })
                      }
                      placeholder=".pdf, .png, .jpg"
                    />
                  </div>
                  <div>
                    <Label>Max size (MB)</Label>
                    <Input
                      type="number"
                      value={it.maxSizeMb ?? ''}
                      onChange={(e) =>
                        updateItem(idx, {
                          maxSizeMb: e.target.value ? Number(e.target.value) : undefined,
                        })
                      }
                      placeholder="25"
                    />
                  </div>
                  <label className="inline-flex items-center gap-2 self-end pb-2 text-sm">
                    <input
                      type="checkbox"
                      checked={it.required ?? false}
                      onChange={(e) => updateItem(idx, { required: e.target.checked })}
                    />
                    Required
                  </label>
                </div>
                <button
                  onClick={() => removeItem(idx)}
                  className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-1.5 text-[var(--color-danger)] hover:bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)]"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <div className="flex items-center justify-between">
        {!isNew ? (
          <Button variant="danger" onClick={() => void remove()} disabled={busy}>
            <Trash2 size={14} /> Delete
          </Button>
        ) : (
          <span></span>
        )}
        <div className="flex items-center gap-3">
          {s.isDefault ? <Badge tone="success">Default</Badge> : null}
          <Button onClick={() => void save()} disabled={busy || !s.name}>
            {busy ? <Spinner /> : <Save size={14} />}
            {isNew ? 'Create checklist' : 'Save changes'}
          </Button>
        </div>
      </div>
    </div>
  );
}
