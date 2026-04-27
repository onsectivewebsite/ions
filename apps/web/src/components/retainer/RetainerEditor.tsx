'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Save, Trash2 } from 'lucide-react';
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

export type TemplateState = {
  id?: string;
  name: string;
  caseType: string; // '' = default
  description: string;
  contentMd: string;
  isActive: boolean;
  isDefault: boolean;
};

const MERGE_TAGS: Array<{ tag: string; desc: string }> = [
  { tag: '{{client.name}}', desc: 'Full client name' },
  { tag: '{{client.first_name}}', desc: 'Given name' },
  { tag: '{{client.last_name}}', desc: 'Family name' },
  { tag: '{{client.phone}}', desc: 'E.164 phone' },
  { tag: '{{client.email}}', desc: '' },
  { tag: '{{client.language}}', desc: 'Preferred language' },
  { tag: '{{lawyer.name}}', desc: 'Lawyer of record' },
  { tag: '{{lawyer.email}}', desc: '' },
  { tag: '{{firm.name}}', desc: 'Firm display name' },
  { tag: '{{firm.legal_name}}', desc: '' },
  { tag: '{{firm.address}}', desc: 'Multi-line firm address' },
  { tag: '{{case.case_type}}', desc: 'work permit, study permit, …' },
  { tag: '{{case.retainer_fee}}', desc: 'Formatted CAD' },
  { tag: '{{case.total_fee}}', desc: 'Formatted CAD' },
  { tag: '{{date.today}}', desc: 'YYYY-MM-DD' },
];

export function RetainerTemplateEditor({
  initial,
}: {
  initial?: TemplateState | null;
}) {
  const router = useRouter();
  const isNew = !initial;
  const [s, setS] = useState<TemplateState>(
    initial ?? {
      name: '',
      caseType: '',
      description: '',
      contentMd: '',
      isActive: true,
      isDefault: false,
    },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof TemplateState>(k: K, v: TemplateState[K]): void {
    setS((prev) => ({ ...prev, [k]: v }));
  }

  async function save(): Promise<void> {
    setError(null);
    if (!s.name.trim()) {
      setError('Name is required.');
      return;
    }
    if (s.contentMd.trim().length < 20) {
      setError('Content must be at least 20 characters.');
      return;
    }
    setBusy(true);
    try {
      const token = getAccessToken();
      const payload = {
        name: s.name.trim(),
        caseType: s.caseType ? s.caseType : null,
        description: s.description || undefined,
        contentMd: s.contentMd,
        isActive: s.isActive,
        isDefault: s.isDefault,
      };
      if (isNew) {
        const r = await rpcMutation<{ id: string }>('retainerTemplate.create', payload, { token });
        router.replace(`/settings/retainer-templates/${r.id}`);
      } else {
        await rpcMutation('retainerTemplate.update', { id: s.id, ...payload }, { token });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    if (!s.id) return;
    if (!confirm('Delete this template? Past agreements block this — deactivate instead if it does.')) return;
    setBusy(true);
    setError(null);
    try {
      const token = getAccessToken();
      await rpcMutation('retainerTemplate.delete', { id: s.id }, { token });
      router.replace('/settings/retainer-templates');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  }

  function insertTag(tag: string): void {
    set('contentMd', s.contentMd + tag);
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div>
        <Link
          href="/settings/retainer-templates"
          className="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        >
          <ArrowLeft size={12} />
          Back to retainer templates
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          {isNew ? 'New retainer template' : s.name || 'Retainer template'}
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
            <Input value={s.name} onChange={(e) => set('name', e.target.value)} placeholder="Standard retainer" required />
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
              placeholder="Use this for all standard work permit retainers."
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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_280px]">
        <Card>
          <div className="flex items-center justify-between">
            <CardTitle>Body (Markdown)</CardTitle>
            <span className="text-xs text-[var(--color-text-muted)]">
              {s.contentMd.length.toLocaleString()} chars
            </span>
          </div>
          <textarea
            className="mt-3 min-h-[480px] w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 font-mono text-xs"
            value={s.contentMd}
            onChange={(e) => set('contentMd', e.target.value)}
            placeholder="# Retainer Agreement..."
          />
        </Card>
        <div className="space-y-4">
          <Card>
            <CardTitle>Merge tags</CardTitle>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              Click to append. Substituted server-side when an agreement is rendered.
            </p>
            <ul className="mt-3 space-y-1 text-xs">
              {MERGE_TAGS.map((m) => (
                <li key={m.tag}>
                  <button
                    onClick={() => insertTag(m.tag)}
                    className="block w-full rounded-[var(--radius-md)] border border-[var(--color-border-muted)] p-1.5 text-left font-mono text-[11px] hover:bg-[var(--color-surface-muted)]"
                  >
                    {m.tag}
                    {m.desc ? (
                      <div className="mt-0.5 font-sans text-[10px] text-[var(--color-text-muted)]">
                        {m.desc}
                      </div>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <div className="flex items-center justify-between">
        {!isNew ? (
          <Button variant="danger" onClick={() => void remove()} disabled={busy}>
            <Trash2 size={14} /> Delete template
          </Button>
        ) : (
          <span></span>
        )}
        <div className="flex items-center gap-3">
          {s.isDefault ? <Badge tone="success">Default</Badge> : null}
          <Button onClick={() => void save()} disabled={busy || !s.name}>
            {busy ? <Spinner /> : <Save size={14} />}
            {isNew ? 'Create template' : 'Save changes'}
          </Button>
        </div>
      </div>
    </div>
  );
}
