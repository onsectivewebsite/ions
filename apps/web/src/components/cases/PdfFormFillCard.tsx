'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Download, FileText, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { Badge, Button, Card, CardTitle, Spinner } from '@onsecboad/ui';
import { rpcMutation, rpcQuery } from '../../lib/api';
import { getAccessToken } from '../../lib/session';

type Template = {
  id: string;
  name: string;
  description: string | null;
  caseType: string | null;
  fileName: string;
  mappingJson: unknown[];
};

type Generated = {
  id: string;
  fileName: string;
  sizeBytes: number;
  generatedAt: string;
  template: { id: string; name: string; caseType: string | null };
};

/**
 * "Generate IRCC PDFs" card. Lists active per-case-type templates that
 * have at least one mapping rule + the case's already-generated PDFs.
 * Generation requires CaseAiData.status === 'READY' (validated server-side).
 */
export function PdfFormFillCard({
  caseId,
  caseType,
  caseStatus,
  onError,
}: {
  caseId: string;
  caseType: string;
  caseStatus: string;
  onError: (m: string) => void;
}) {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [generated, setGenerated] = useState<Generated[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load(): Promise<void> {
    try {
      const token = getAccessToken();
      const [t, g] = await Promise.all([
        rpcQuery<Template[]>('pdfTemplate.listForCaseType', { caseType }, { token }),
        rpcQuery<Generated[]>('pdfTemplate.listGeneratedForCase', { caseId }, { token }),
      ]);
      setTemplates(t);
      setGenerated(g);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to load PDF templates');
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId, caseType]);

  async function generate(templateId: string): Promise<void> {
    setBusyId(templateId);
    try {
      const token = getAccessToken();
      await rpcMutation('pdfTemplate.generate', { caseId, templateId }, { token });
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Generate failed');
    } finally {
      setBusyId(null);
    }
  }

  async function download(id: string): Promise<void> {
    try {
      const token = getAccessToken();
      const r = await rpcQuery<{ url: string }>(
        'pdfTemplate.signedDownloadUrl',
        { id },
        { token },
      );
      window.open(r.url, '_blank');
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Download failed');
    }
  }

  async function remove(id: string): Promise<void> {
    if (!confirm('Delete this generated PDF?')) return;
    setBusyId(id);
    try {
      const token = getAccessToken();
      await rpcMutation('pdfTemplate.deleteGenerated', { id }, { token });
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setBusyId(null);
    }
  }

  // Hide entirely on cases that haven't reached document collection yet.
  const showCard =
    caseStatus !== 'PENDING_RETAINER' &&
    caseStatus !== 'PENDING_RETAINER_SIGNATURE' &&
    caseStatus !== 'WITHDRAWN' &&
    caseStatus !== 'ABANDONED';
  if (!showCard) return null;

  if (templates === null || generated === null) {
    return (
      <Card>
        <CardTitle>IRCC form-fill</CardTitle>
        <div className="mt-3 text-xs text-[var(--color-text-muted)]">Loading…</div>
      </Card>
    );
  }

  const generatedByTemplate = new Map<string, Generated>();
  for (const g of generated) generatedByTemplate.set(g.template.id, g);

  return (
    <Card>
      <CardTitle>
        <Sparkles size={14} className="mr-1 inline-block text-[var(--color-primary)]" />
        IRCC form-fill
      </CardTitle>
      <p className="mt-1 text-xs text-[var(--color-text-muted)]">
        Fills your firm&apos;s mapped PDF templates with the AI-extracted case data. Re-generating
        replaces the prior version on disk.
      </p>

      {templates.length === 0 ? (
        <div className="mt-3 rounded-[var(--radius-md)] border border-[var(--color-border-muted)] bg-[var(--color-surface-muted)] p-3 text-xs text-[var(--color-text-muted)]">
          No mapped templates for this case type. Add one in{' '}
          <Link href="/settings/pdf-templates" className="text-[var(--color-primary)] hover:underline">
            Settings → PDF templates
          </Link>
          .
        </div>
      ) : (
        <ul className="mt-3 space-y-2">
          {templates.map((t) => {
            const prior = generatedByTemplate.get(t.id);
            const busy = busyId === t.id;
            return (
              <li
                key={t.id}
                className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-border-muted)] p-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{t.name}</span>
                    {t.caseType ? <Badge tone="neutral">{t.caseType.replace('_', ' ')}</Badge> : null}
                    {prior ? <Badge tone="success">generated</Badge> : null}
                  </div>
                  {t.description ? (
                    <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{t.description}</p>
                  ) : null}
                  {prior ? (
                    <div className="mt-1 text-[11px] text-[var(--color-text-muted)]">
                      Last: {new Date(prior.generatedAt).toLocaleString()} ·{' '}
                      {(prior.sizeBytes / 1024).toFixed(0)} KB
                    </div>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  {prior ? (
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void download(prior.id)}
                        disabled={busy}
                      >
                        <Download size={12} /> Download
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void generate(t.id)}
                        disabled={busy}
                      >
                        {busy ? <Spinner /> : <RefreshCw size={12} />} Re-generate
                      </Button>
                      <button
                        onClick={() => void remove(prior.id)}
                        className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-1.5 text-[var(--color-danger)] hover:bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)]"
                        disabled={busy}
                      >
                        <Trash2 size={12} />
                      </button>
                    </>
                  ) : (
                    <Button size="sm" onClick={() => void generate(t.id)} disabled={busy}>
                      {busy ? <Spinner /> : <FileText size={12} />} Generate
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Stand-alone generated PDFs for templates that have since been
          inactivated or whose case-type changed — show under a separate header
          so the user doesn't lose track. */}
      {(() => {
        const orphans = generated.filter((g) => !templates.some((t) => t.id === g.template.id));
        if (orphans.length === 0) return null;
        return (
          <div className="mt-4 border-t border-[var(--color-border-muted)] pt-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
              Other generated PDFs
            </div>
            <ul className="space-y-1.5 text-xs">
              {orphans.map((g) => (
                <li
                  key={g.id}
                  className="flex items-center justify-between rounded-[var(--radius-md)] bg-[var(--color-surface-muted)] px-2 py-1.5"
                >
                  <div>
                    <span className="font-medium">{g.template.name}</span>
                    <span className="ml-2 text-[10px] text-[var(--color-text-muted)]">
                      {new Date(g.generatedAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => void download(g.id)}
                      className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                    >
                      <Download size={11} />
                    </button>
                    <button
                      onClick={() => void remove(g.id)}
                      className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-1 text-[var(--color-danger)]"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        );
      })()}
    </Card>
  );
}
