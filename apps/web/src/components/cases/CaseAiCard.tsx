'use client';
import { useEffect, useState } from 'react';
import { Bot, FileText, Pencil, RefreshCw, Save, Sparkles, X } from 'lucide-react';
import { Badge, Button, Card, CardTitle, Input, Spinner } from '@onsecboad/ui';
import { rpcMutation, rpcQuery } from '../../lib/api';
import { getAccessToken } from '../../lib/session';

type Status = 'EMPTY' | 'RUNNING' | 'READY' | 'FAILED';

type Provenance = { source: string; confidence: number };

type AiResp = {
  status: Status;
  caseType: string;
  data: Record<string, unknown>;
  provenance: Record<string, Provenance>;
  overrides: Record<string, unknown>;
  merged: Record<string, unknown>;
  uploadsConsidered: number;
  lastRunAt: string | null;
  lastError: string | null;
  lastMode: string | null;
};

const STATUS_TONE: Record<Status, 'success' | 'warning' | 'neutral' | 'danger'> = {
  EMPTY: 'neutral',
  RUNNING: 'warning',
  READY: 'success',
  FAILED: 'danger',
};

// Sections we render in a stable order. Keys here mirror the AI's output schema.
const SECTIONS: Array<{ key: string; label: string; fields: string[] }> = [
  {
    key: 'applicant',
    label: 'Applicant',
    fields: [
      'firstName',
      'lastName',
      'fullName',
      'dateOfBirth',
      'gender',
      'citizenship',
      'maritalStatus',
      'preferredLanguage',
    ],
  },
  {
    key: 'passport',
    label: 'Passport',
    fields: ['number', 'issuedAt', 'expiresAt', 'country'],
  },
  {
    key: 'contact',
    label: 'Contact',
    fields: ['email', 'phone'],
  },
  {
    key: 'financial',
    label: 'Financial',
    fields: ['proofOfFundsCadCents', 'fundsSource'],
  },
];

function getByPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (typeof cur !== 'object' || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function fmtValue(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return JSON.stringify(v);
}

function confidenceTone(c: number): 'success' | 'warning' | 'danger' {
  if (c >= 0.8) return 'success';
  if (c >= 0.5) return 'warning';
  return 'danger';
}

/**
 * AI extraction card. Renders only when the case is at least at
 * PENDING_DOCUMENTS — extraction needs uploaded files. Shows the merged
 * (extracted + overrides) view with per-field provenance + confidence.
 */
export function CaseAiCard({
  caseId,
  caseStatus,
  onError,
}: {
  caseId: string;
  caseStatus: string;
  onError: (m: string) => void;
}) {
  const [data, setData] = useState<AiResp | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  async function load(): Promise<void> {
    try {
      const token = getAccessToken();
      const r = await rpcQuery<AiResp>('caseAi.get', { caseId }, { token });
      setData(r);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to load AI data');
      setData(null);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  async function run(): Promise<void> {
    setBusy(true);
    try {
      const token = getAccessToken();
      await rpcMutation('caseAi.run', { caseId }, { token });
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'AI run failed');
      // load anyway to refresh status to FAILED
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function saveOverride(key: string, value: string | null): Promise<void> {
    setBusy(true);
    try {
      const token = getAccessToken();
      await rpcMutation('caseAi.setOverride', { caseId, key, value }, { token });
      setEditing(null);
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  // Hide the card on early-stage cases — there are no documents to read yet.
  const showCard =
    caseStatus !== 'PENDING_RETAINER' &&
    caseStatus !== 'PENDING_RETAINER_SIGNATURE' &&
    caseStatus !== 'WITHDRAWN' &&
    caseStatus !== 'ABANDONED';
  if (!showCard) return null;

  if (data === undefined) {
    return (
      <Card>
        <CardTitle>AI extraction</CardTitle>
        <div className="mt-3 text-xs text-[var(--color-text-muted)]">Loading…</div>
      </Card>
    );
  }
  if (data === null) return null;

  const isRunning = data.status === 'RUNNING' || busy;
  const merged = data.merged ?? {};

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <CardTitle>
            <Sparkles size={14} className="mr-1 inline-block text-[var(--color-primary)]" />
            AI extraction
          </CardTitle>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            Reads every uploaded document + the latest intake form, returns a structured view of
            the applicant. Lawyer reviews + edits before form-fill.
          </p>
        </div>
        <Badge tone={STATUS_TONE[data.status]}>{data.status}</Badge>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-[var(--color-text-muted)]">
        <span>
          {data.uploadsConsidered} document{data.uploadsConsidered === 1 ? '' : 's'} read
        </span>
        {data.lastRunAt ? <span>· {new Date(data.lastRunAt).toLocaleString()}</span> : null}
        {data.lastMode ? (
          <Badge tone={data.lastMode === 'real' ? 'success' : 'warning'}>
            {data.lastMode === 'real' ? 'real model' : 'dry-run'}
          </Badge>
        ) : null}
      </div>

      {data.status === 'FAILED' && data.lastError ? (
        <div className="mt-3 rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] p-2 text-xs text-[var(--color-danger)]">
          {data.lastError}
        </div>
      ) : null}

      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" disabled={isRunning} onClick={run}>
          {isRunning ? <Spinner /> : data.status === 'EMPTY' ? <Bot size={12} /> : <RefreshCw size={12} />}
          {data.status === 'EMPTY' ? 'Extract' : 'Re-run extraction'}
        </Button>
      </div>

      {data.status === 'READY' || Object.keys(merged).length > 0 ? (
        <div className="mt-4 space-y-4">
          {SECTIONS.map((sec) => {
            const sectionData = (merged[sec.key] ?? {}) as Record<string, unknown>;
            const presentFields = sec.fields.filter((f) => sectionData[f] !== undefined);
            if (presentFields.length === 0) return null;
            return (
              <div
                key={sec.key}
                className="rounded-[var(--radius-md)] border border-[var(--color-border-muted)] p-3"
              >
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                  {sec.label}
                </div>
                <ul className="space-y-2 text-sm">
                  {presentFields.map((f) => {
                    const path = `${sec.key}.${f}`;
                    const value = getByPath(merged, path);
                    const prov = data.provenance[path];
                    const overridden = data.overrides[path] !== undefined;
                    const isEditing = editing === path;
                    return (
                      <li key={path} className="flex items-start gap-3">
                        <div className="w-32 shrink-0 text-xs text-[var(--color-text-muted)]">
                          {f}
                        </div>
                        <div className="flex-1 min-w-0">
                          {isEditing ? (
                            <div className="flex items-center gap-2">
                              <Input
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                className="h-8"
                              />
                              <button
                                onClick={() => void saveOverride(path, editValue || null)}
                                className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-1.5 hover:bg-[var(--color-surface-muted)]"
                                aria-label="Save"
                                disabled={busy}
                              >
                                <Save size={12} />
                              </button>
                              <button
                                onClick={() => setEditing(null)}
                                className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-1.5 hover:bg-[var(--color-surface-muted)]"
                                aria-label="Cancel"
                              >
                                <X size={12} />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className="break-words">{fmtValue(value) || '—'}</span>
                              {overridden ? (
                                <Badge tone="neutral">edited</Badge>
                              ) : prov ? (
                                <Badge tone={confidenceTone(prov.confidence)}>
                                  {Math.round(prov.confidence * 100)}%
                                </Badge>
                              ) : null}
                              <button
                                onClick={() => {
                                  setEditing(path);
                                  setEditValue(fmtValue(value));
                                }}
                                className="ml-auto rounded-[var(--radius-md)] border border-[var(--color-border)] p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                                aria-label="Edit"
                              >
                                <Pencil size={11} />
                              </button>
                            </div>
                          )}
                          {prov?.source && !isEditing ? (
                            <div className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-[var(--color-text-muted)]">
                              <FileText size={9} />
                              {prov.source}
                            </div>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}

          {/* Travel / Employment / Education arrays — render as compact lists. */}
          <ArraySection
            title="Travel history"
            items={(merged.travel as Record<string, unknown>[]) ?? []}
            keys={['country', 'fromDate', 'toDate', 'purpose']}
          />
          <ArraySection
            title="Employment"
            items={(merged.employment as Record<string, unknown>[]) ?? []}
            keys={['employer', 'role', 'fromDate', 'toDate', 'country']}
          />
          <ArraySection
            title="Education"
            items={(merged.education as Record<string, unknown>[]) ?? []}
            keys={['institution', 'level', 'field', 'fromDate', 'toDate']}
          />
        </div>
      ) : data.status === 'EMPTY' ? (
        <div className="mt-4 py-6 text-center text-xs text-[var(--color-text-muted)]">
          Click <strong>Extract</strong> to read the case&apos;s uploaded documents and intake.
        </div>
      ) : null}
    </Card>
  );
}

function ArraySection({
  title,
  items,
  keys,
}: {
  title: string;
  items: Record<string, unknown>[];
  keys: string[];
}) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border-muted)] p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
        {title}
      </div>
      <ul className="space-y-2 text-sm">
        {items.map((it, idx) => (
          <li key={idx} className="rounded-[var(--radius-md)] bg-[var(--color-surface-muted)] px-2 py-1.5">
            {keys
              .map((k) => fmtValue(it[k]))
              .filter(Boolean)
              .join(' · ') || JSON.stringify(it)}
          </li>
        ))}
      </ul>
    </div>
  );
}
