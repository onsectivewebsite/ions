'use client';
import { useEffect, useState } from 'react';
import { Bot, RefreshCcw, ShieldOff } from 'lucide-react';
import { Badge, Button, Card, CardTitle, Spinner } from '@onsecboad/ui';
import { rpcMutation, rpcQuery } from '../../lib/api';
import { getAccessToken } from '../../lib/session';

type RunStatus = 'RUNNING' | 'DONE' | 'ERROR' | 'SKIPPED';

type AgentRun = {
  id: string;
  mode: string;
  status: RunStatus;
  skipReason: string | null;
  costCents: number;
  steps: Array<{
    tool: string;
    ts: string;
    input?: Record<string, unknown>;
    output?: { messageId?: string; bodyPreview?: string; mode?: string };
  }>;
  result: { messageId?: string; missingItems?: string[]; error?: string } | null;
  kickedOffById: string | null;
  startedAt: string;
  endedAt: string | null;
};

const STATUS_TONE: Record<RunStatus, 'success' | 'warning' | 'neutral' | 'danger'> = {
  RUNNING: 'neutral',
  DONE: 'success',
  SKIPPED: 'warning',
  ERROR: 'danger',
};

function fmtMoney(cents: number): string {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(cents / 100);
}

export function AgentCard({
  caseId,
  caseStatus,
  onChanged,
  onError,
}: {
  caseId: string;
  caseStatus: string;
  onChanged: () => Promise<void>;
  onError: (m: string) => void;
}) {
  const [runs, setRuns] = useState<AgentRun[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function load(): Promise<void> {
    try {
      const token = getAccessToken();
      const r = await rpcQuery<AgentRun[]>('aiAgent.runs', { caseId, limit: 10 }, { token });
      setRuns(r);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load agent runs');
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  async function runNow(): Promise<void> {
    setBusy(true);
    try {
      const token = getAccessToken();
      const r = await rpcMutation<{ status: RunStatus; skipReason?: string }>(
        'aiAgent.runNow',
        { caseId },
        { token },
      );
      if (r.status === 'SKIPPED' && r.skipReason) {
        onError(`Agent skipped: ${r.skipReason}`);
      }
      await load();
      await onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Run failed');
    } finally {
      setBusy(false);
    }
  }

  // Hide the card entirely on cases where the agent will never apply.
  // Once a case has at least one run, keep showing so staff can audit.
  const eligibleStatus = caseStatus === 'PENDING_DOCUMENTS';
  if (!eligibleStatus && (runs?.length ?? 0) === 0) return null;

  // Naive cooldown check off the most-recent DONE/ERROR run. The server
  // is authoritative; this is for UX only.
  const last = (runs ?? []).find((r) => r.status === 'DONE' || r.status === 'ERROR');
  const cooldownActive = last
    ? Date.now() - new Date(last.endedAt ?? last.startedAt).getTime() < 24 * 60 * 60 * 1000
    : false;

  return (
    <Card>
      <div className="flex items-center justify-between">
        <CardTitle>
          <span className="inline-flex items-center gap-2">
            <Bot size={16} /> AI agent
          </span>
        </CardTitle>
        {eligibleStatus ? (
          <Button size="sm" onClick={() => void runNow()} disabled={busy || cooldownActive}>
            {busy ? <Spinner /> : <RefreshCcw size={12} />}
            Run agent now
          </Button>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-[var(--color-text-muted)]">
        When enabled in Settings → AI, the agent posts a friendly nudge to the client when required
        documents are still outstanding. 24-hour cooldown per case; off by default.
      </p>
      {cooldownActive ? (
        <div className="mt-2 flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
          <ShieldOff size={12} /> Cooldown active — last run was within 24 hours.
        </div>
      ) : null}

      <div className="mt-3">
        {runs === null ? (
          <div className="text-xs text-[var(--color-text-muted)]">Loading…</div>
        ) : runs.length === 0 ? (
          <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] py-6 text-center text-xs text-[var(--color-text-muted)]">
            No agent runs yet on this case.
          </div>
        ) : (
          <ul className="space-y-2">
            {runs.map((r) => (
              <RunRow key={r.id} run={r} />
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function RunRow({ run }: { run: AgentRun }) {
  const step = run.steps?.[0];
  const preview = step?.output?.bodyPreview;
  const summary =
    run.status === 'SKIPPED'
      ? run.skipReason ?? 'Skipped'
      : run.status === 'ERROR'
        ? run.result?.error ?? 'Error'
        : preview ?? 'Message posted';

  return (
    <li className="rounded-[var(--radius-md)] border border-[var(--color-border-muted)] p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge tone={STATUS_TONE[run.status]}>{run.status}</Badge>
          <span className="text-xs text-[var(--color-text-muted)]">
            {new Date(run.startedAt).toLocaleString()}
            {run.kickedOffById ? ' · manual' : ' · cron'}
          </span>
        </div>
        {run.costCents > 0 ? (
          <span className="text-xs text-[var(--color-text-muted)]">{fmtMoney(run.costCents)}</span>
        ) : null}
      </div>
      <p className="mt-2 line-clamp-2 text-sm">{summary}</p>
    </li>
  );
}
