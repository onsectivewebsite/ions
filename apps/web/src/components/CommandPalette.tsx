'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Briefcase, Calendar, Inbox, Search, User, X } from 'lucide-react';
import { Card, Input } from '@onsecboad/ui';
import { rpcQuery } from '../lib/api';
import { getAccessToken } from '../lib/session';

type Lead = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  status: string;
  caseInterest: string | null;
};
type Client = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
};
type Case = {
  id: string;
  caseType: string;
  status: string;
  irccFileNumber: string | null;
  client: { firstName: string | null; lastName: string | null } | null;
};
type Appt = {
  id: string;
  scheduledAt: string;
  kind: string;
  status: string;
  client: { firstName: string | null; lastName: string | null } | null;
  lead: { firstName: string | null; lastName: string | null; id: string } | null;
};
type Results = {
  leads: Lead[];
  clients: Client[];
  cases: Case[];
  appointments: Appt[];
};

type Row = {
  href: string;
  label: string;
  detail: string;
  icon: 'lead' | 'client' | 'case' | 'appt';
};

function fullName(p: { firstName: string | null; lastName: string | null }): string {
  return [p.firstName, p.lastName].filter(Boolean).join(' ') || '—';
}

function rowsFromResults(r: Results | null): Row[] {
  if (!r) return [];
  const rows: Row[] = [];
  for (const l of r.leads) {
    rows.push({
      href: `/leads/${l.id}`,
      label: fullName(l),
      detail: [l.phone, l.email, l.caseInterest, l.status].filter(Boolean).join(' · '),
      icon: 'lead',
    });
  }
  for (const c of r.clients) {
    rows.push({
      href: `/clients/${c.id}`,
      label: fullName(c),
      detail: [c.phone, c.email].filter(Boolean).join(' · '),
      icon: 'client',
    });
  }
  for (const c of r.cases) {
    const subj = c.client ? fullName(c.client) : '—';
    rows.push({
      href: `/cases/${c.id}`,
      label: `${c.caseType.replace(/_/g, ' ')} · ${subj}`,
      detail: [c.status, c.irccFileNumber ? `IRCC ${c.irccFileNumber}` : null]
        .filter(Boolean)
        .join(' · '),
      icon: 'case',
    });
  }
  for (const a of r.appointments) {
    const subj = a.client ? fullName(a.client) : a.lead ? fullName(a.lead) : '—';
    rows.push({
      href: a.lead ? `/leads/${a.lead.id}` : '/appointments',
      label: `${new Date(a.scheduledAt).toLocaleString()} · ${subj}`,
      detail: `${a.kind} · ${a.status}`,
      icon: 'appt',
    });
  }
  return rows;
}

export function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Results | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Reset state on each open.
  useEffect(() => {
    if (!open) return;
    setQ('');
    setResults(null);
    setActive(0);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  // Debounced search.
  useEffect(() => {
    if (!open) return;
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setResults(null);
      return;
    }
    const id = setTimeout(async () => {
      setLoading(true);
      try {
        const token = getAccessToken();
        const r = await rpcQuery<Results>('search.global', { q: trimmed }, { token });
        setResults(r);
        setActive(0);
      } catch {
        setResults({ leads: [], clients: [], cases: [], appointments: [] });
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => clearTimeout(id);
  }, [open, q]);

  const rows = rowsFromResults(results);

  function pick(r: Row | undefined): void {
    if (!r) return;
    router.push(r.href);
    onClose();
  }

  function onKey(e: React.KeyboardEvent): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(rows.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(rows[active]);
    } else if (e.key === 'Escape') {
      onClose();
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[10vh]"
      onClick={onClose}
    >
      <Card
        className="w-full max-w-xl"
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-[var(--color-border-muted)] pb-3">
          <Search size={16} className="text-[var(--color-text-muted)]" />
          <Input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search leads, clients, cases, appointments…"
            className="flex-1 border-none bg-transparent !ring-0 focus:!ring-0"
          />
          <button
            onClick={onClose}
            className="rounded-[var(--radius-md)] p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)]"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        <div className="mt-3 max-h-[60vh] overflow-y-auto">
          {q.trim().length < 2 ? (
            <div className="px-2 py-8 text-center text-xs text-[var(--color-text-muted)]">
              Type 2+ characters to search. Use ↑ ↓ to navigate, Enter to open, Esc to close.
            </div>
          ) : loading && !results ? (
            <div className="px-2 py-6 text-center text-xs text-[var(--color-text-muted)]">
              Searching…
            </div>
          ) : rows.length === 0 ? (
            <div className="px-2 py-8 text-center text-xs text-[var(--color-text-muted)]">
              No matches.
            </div>
          ) : (
            <ul className="space-y-0.5">
              {rows.map((r, i) => (
                <li key={`${r.href}-${i}`}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(r)}
                    className={
                      'flex w-full items-center gap-3 rounded-[var(--radius-md)] px-2 py-2 text-left text-sm ' +
                      (i === active
                        ? 'bg-[color-mix(in_srgb,var(--color-primary)_10%,transparent)] text-[var(--color-text)]'
                        : 'hover:bg-[var(--color-surface-muted)]')
                    }
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]">
                      <RowIcon kind={r.icon} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{r.label}</span>
                      <span className="block truncate text-xs text-[var(--color-text-muted)]">
                        {r.detail}
                      </span>
                    </span>
                    <span className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
                      {r.icon}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}

function RowIcon({ kind }: { kind: Row['icon'] }) {
  if (kind === 'lead') return <Inbox size={14} />;
  if (kind === 'client') return <User size={14} />;
  if (kind === 'case') return <Briefcase size={14} />;
  return <Calendar size={14} />;
}
