'use client';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Save, Trash2 } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardTitle,
  Input,
  Label,
  Skeleton,
  Spinner,
  ThemeProvider,
  type Branding,
} from '@onsecboad/ui';
import { rpcMutation, rpcQuery } from '../../../../lib/api';
import { getAccessToken } from '../../../../lib/session';
import { AppShell } from '../../../../components/AppShell';

type Me = { kind: 'firm'; name: string; email: string; tenant: { displayName: string; branding: Branding } };

type DetectedField = { name: string; type: 'text' | 'checkbox' | 'radio' | 'unknown' };

type MappingRule = {
  pdfField: string;
  dataPath: string;
  kind?: 'text' | 'checkbox' | 'radio';
  equals?: string;
  radioOption?: string;
  format?: 'date_yyyymmdd' | 'date_dd_mm_yyyy' | 'phone_e164' | 'upper' | 'lower';
};

type Template = {
  id: string;
  name: string;
  caseType: string | null;
  description: string | null;
  fileName: string;
  isActive: boolean;
  detectedFieldsJson: DetectedField[];
  mappingJson: MappingRule[];
};

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

// Suggested data paths the lawyer can drop into a mapping. Mirrors the
// AI extraction schema from @onsecboad/ai.
const DATA_PATH_SUGGESTIONS = [
  'applicant.firstName',
  'applicant.lastName',
  'applicant.fullName',
  'applicant.dateOfBirth',
  'applicant.gender',
  'applicant.citizenship',
  'applicant.maritalStatus',
  'applicant.preferredLanguage',
  'passport.number',
  'passport.issuedAt',
  'passport.expiresAt',
  'passport.country',
  'contact.email',
  'contact.phone',
  'contact.address.line1',
  'contact.address.line2',
  'contact.address.city',
  'contact.address.province',
  'contact.address.postalCode',
  'contact.address.country',
  'financial.proofOfFundsCadCents',
  'financial.fundsSource',
];

export default function PdfTemplateEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [tpl, setTpl] = useState<Template | null>(null);
  const [name, setName] = useState('');
  const [caseType, setCaseType] = useState('');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [mapping, setMapping] = useState<MappingRule[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function load(): Promise<void> {
    const token = getAccessToken();
    if (!token) {
      router.replace('/sign-in');
      return;
    }
    try {
      const [m, t] = await Promise.all([
        rpcQuery<Me>('user.me', undefined, { token }),
        rpcQuery<Template>('pdfTemplate.get', { id }, { token }),
      ]);
      if (m.kind !== 'firm') {
        router.replace('/dashboard');
        return;
      }
      setMe(m);
      setTpl(t);
      setName(t.name);
      setCaseType(t.caseType ?? '');
      setDescription(t.description ?? '');
      setIsActive(t.isActive);
      setMapping(Array.isArray(t.mappingJson) ? t.mappingJson : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function setRule(idx: number, patch: Partial<MappingRule>): void {
    setMapping((prev) => prev.map((m, i) => (i === idx ? { ...m, ...patch } : m)));
  }

  function addRuleForField(field: DetectedField): void {
    if (mapping.some((m) => m.pdfField === field.name)) return;
    setMapping((prev) => [
      ...prev,
      {
        pdfField: field.name,
        dataPath: '',
        kind: field.type === 'unknown' ? 'text' : field.type,
      },
    ]);
  }

  function removeRule(idx: number): void {
    setMapping((prev) => prev.filter((_, i) => i !== idx));
  }

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const token = getAccessToken();
      await rpcMutation(
        'pdfTemplate.update',
        {
          id,
          name: name.trim(),
          caseType: caseType ? caseType : null,
          description: description || null,
          mappingJson: mapping.filter((m) => m.dataPath.trim().length > 0),
          isActive,
        },
        { token },
      );
      setInfo('Saved.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    if (!confirm('Delete this template? Active generated PDFs block this.')) return;
    setBusy(true);
    try {
      const token = getAccessToken();
      await rpcMutation('pdfTemplate.delete', { id }, { token });
      router.replace('/settings/pdf-templates');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  }

  if (!me || !tpl) {
    return (
      <main className="grid min-h-screen grid-cols-[240px_1fr]">
        <div className="border-r border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <Skeleton className="h-6 w-32" />
        </div>
        <div className="space-y-4 p-8">
          <Skeleton className="h-12" />
          <Skeleton className="h-64" />
        </div>
      </main>
    );
  }

  const detected = tpl.detectedFieldsJson ?? [];
  const mappedFields = new Set(mapping.map((m) => m.pdfField));
  const unmapped = detected.filter((f) => !mappedFields.has(f.name));

  return (
    <ThemeProvider branding={me.tenant.branding ?? { themeCode: 'maple' }}>
      <AppShell user={{ name: me.name, email: me.email, scope: 'firm', contextLabel: me.tenant.displayName }}>
        <div className="mx-auto w-full max-w-5xl space-y-6">
          <Link
            href="/settings/pdf-templates"
            className="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            <ArrowLeft size={12} />
            Back to PDF templates
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">{tpl.name}</h1>
          <p className="text-xs text-[var(--color-text-muted)]">
            Source PDF: {tpl.fileName} · {detected.length} detected field
            {detected.length === 1 ? '' : 's'} · {mapping.length} mapped
          </p>

          {error ? (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] p-3 text-sm text-[var(--color-danger)]">
              {error}
            </div>
          ) : null}
          {info ? (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-success)]/30 bg-[color-mix(in_srgb,var(--color-success)_10%,transparent)] p-3 text-sm text-[var(--color-success)]">
              {info}
            </div>
          ) : null}

          <Card>
            <CardTitle>Details</CardTitle>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <Label>Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <Label>Case type</Label>
                <select
                  className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
                  value={caseType}
                  onChange={(e) => setCaseType(e.target.value)}
                >
                  {CASE_TYPES.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2">
                <Label>Description</Label>
                <Input value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                Active
              </label>
            </div>
          </Card>

          <Card>
            <CardTitle>Field mapping ({mapping.length}/{detected.length})</CardTitle>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              Each row maps a PDF form field to a data path. Filling skips unmapped fields and
              missing data — IRCC forms often have hundreds of optional fields.
            </p>

            {mapping.length === 0 ? (
              <div className="mt-4 py-6 text-center text-xs text-[var(--color-text-muted)]">
                Click a detected field below to start mapping.
              </div>
            ) : (
              <ul className="mt-3 space-y-2">
                {mapping.map((m, idx) => (
                  <li
                    key={`${m.pdfField}-${idx}`}
                    className="rounded-[var(--radius-md)] border border-[var(--color-border-muted)] p-3"
                  >
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                      <div className="md:col-span-1">
                        <Label>PDF field</Label>
                        <Input value={m.pdfField} disabled className="font-mono text-xs" />
                      </div>
                      <div className="md:col-span-2">
                        <Label>Data path</Label>
                        <Input
                          list="data-path-suggestions"
                          value={m.dataPath}
                          onChange={(e) => setRule(idx, { dataPath: e.target.value })}
                          placeholder="applicant.firstName"
                          className="font-mono text-xs"
                        />
                      </div>
                      <div>
                        <Label>Kind</Label>
                        <select
                          className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
                          value={m.kind ?? 'text'}
                          onChange={(e) =>
                            setRule(idx, { kind: e.target.value as MappingRule['kind'] })
                          }
                        >
                          <option value="text">text</option>
                          <option value="checkbox">checkbox</option>
                          <option value="radio">radio</option>
                        </select>
                      </div>
                      {m.kind === 'text' ? (
                        <div className="md:col-span-2">
                          <Label>Format (optional)</Label>
                          <select
                            className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
                            value={m.format ?? ''}
                            onChange={(e) =>
                              setRule(idx, { format: (e.target.value || undefined) as MappingRule['format'] })
                            }
                          >
                            <option value="">— none —</option>
                            <option value="date_yyyymmdd">date YYYYMMDD</option>
                            <option value="date_dd_mm_yyyy">date dd/mm/yyyy</option>
                            <option value="phone_e164">phone E.164</option>
                            <option value="upper">UPPERCASE</option>
                            <option value="lower">lowercase</option>
                          </select>
                        </div>
                      ) : null}
                      {m.kind === 'checkbox' ? (
                        <div className="md:col-span-2">
                          <Label>Tick when value equals</Label>
                          <Input
                            value={m.equals ?? ''}
                            onChange={(e) => setRule(idx, { equals: e.target.value })}
                            placeholder="CAN"
                          />
                        </div>
                      ) : null}
                      {m.kind === 'radio' ? (
                        <div className="md:col-span-2">
                          <Label>Radio option to select</Label>
                          <Input
                            value={m.radioOption ?? ''}
                            onChange={(e) => setRule(idx, { radioOption: e.target.value })}
                            placeholder="Yes"
                          />
                        </div>
                      ) : null}
                      <div className="flex items-end justify-end">
                        <button
                          onClick={() => removeRule(idx)}
                          className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-1.5 text-[var(--color-danger)] hover:bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)]"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <datalist id="data-path-suggestions">
              {DATA_PATH_SUGGESTIONS.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>

            {unmapped.length > 0 ? (
              <div className="mt-4">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                  Detected but unmapped ({unmapped.length})
                </div>
                <div className="flex flex-wrap gap-1">
                  {unmapped.map((f) => (
                    <button
                      key={f.name}
                      onClick={() => addRuleForField(f)}
                      className="rounded-[var(--radius-pill)] border border-[var(--color-border)] px-2 py-0.5 font-mono text-[11px] text-[var(--color-text-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-text)]"
                    >
                      {f.name}{' '}
                      <Badge tone="neutral">{f.type}</Badge>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </Card>

          <div className="flex items-center justify-between">
            <Button variant="danger" onClick={() => void remove()} disabled={busy}>
              <Trash2 size={14} /> Delete
            </Button>
            <Button onClick={() => void save()} disabled={busy || !name.trim()}>
              {busy ? <Spinner /> : <Save size={14} />} Save changes
            </Button>
          </div>
        </div>
      </AppShell>
    </ThemeProvider>
  );
}
