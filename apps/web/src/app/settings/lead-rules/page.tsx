'use client';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Pencil,
  Plus,
  Trash2,
  Workflow,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardTitle,
  Input,
  Label,
  Skeleton,
  ThemeProvider,
  type Branding,
} from '@onsecboad/ui';
import { rpcMutation, rpcQuery } from '../../../lib/api';
import { getAccessToken } from '../../../lib/session';
import { AppShell, type ShellUser } from '../../../components/AppShell';

type Match = {
  source?: string;
  language?: string;
  caseInterest?: string;
  branchId?: string;
  hourRange?: [number, number];
};
type Action = {
  assignTo: 'round_robin' | 'user' | 'unassigned';
  userId?: string;
  branchId?: string;
};
type Rule = {
  id: string;
  name: string;
  priority: number;
  matchJson: Match;
  actionJson: Action;
  isActive: boolean;
};

type Branch = { id: string; name: string };
type UserRow = { id: string; name: string; email: string; branchId: string | null; status: string };
type Paged<T> = { items: T[]; total: number };

type Me = {
  kind: 'firm';
  name: string;
  email: string;
  tenant: { displayName: string; branding: Branding };
};

const SOURCES = ['', 'website', 'meta', 'tiktok', 'referral', 'walkin', 'manual', 'import'];
const LANGUAGES = ['', 'en', 'pa', 'hi', 'fr', 'es', 'zh', 'ar'];

export default function LeadRulesPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [editing, setEditing] = useState<Rule | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(): Promise<void> {
    const token = getAccessToken();
    if (!token) return;
    try {
      const [r, m, b, u] = await Promise.all([
        rpcQuery<Rule[]>('leadRule.list', undefined, { token }),
        rpcQuery<Me>('user.me', undefined, { token }),
        rpcQuery<Paged<Branch>>('branch.list', { page: 1, includeInactive: false }, { token }).catch(
          () => ({ items: [], total: 0 }) as Paged<Branch>,
        ),
        rpcQuery<Paged<UserRow>>('user.list', { page: 1 }, { token }).catch(
          () => ({ items: [], total: 0 }) as Paged<UserRow>,
        ),
      ]);
      setRules(r);
      if (m.kind !== 'firm') {
        router.replace('/dashboard');
        return;
      }
      setMe(m);
      setBranches(b.items);
      setUsers(u.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    }
  }

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      router.replace('/sign-in');
      return;
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function move(id: string, dir: -1 | 1): Promise<void> {
    if (!rules) return;
    const idx = rules.findIndex((r) => r.id === id);
    if (idx < 0) return;
    const j = idx + dir;
    if (j < 0 || j >= rules.length) return;
    const next = rules.slice();
    [next[idx], next[j]] = [next[j]!, next[idx]!];
    setRules(next);
    try {
      const token = getAccessToken();
      await rpcMutation('leadRule.reorder', { orderedIds: next.map((r) => r.id) }, { token });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reorder failed');
      void load();
    }
  }

  async function remove(id: string): Promise<void> {
    if (!confirm('Delete this rule?')) return;
    try {
      const token = getAccessToken();
      await rpcMutation('leadRule.delete', { id }, { token });
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  async function toggle(rule: Rule): Promise<void> {
    try {
      const token = getAccessToken();
      await rpcMutation('leadRule.update', { id: rule.id, isActive: !rule.isActive }, { token });
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Toggle failed');
    }
  }

  if (!me || rules === null) {
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

  const branding = me.tenant.branding ?? { themeCode: 'maple' };
  const shellUser: ShellUser = {
    name: me.name,
    email: me.email,
    scope: 'firm',
    contextLabel: me.tenant.displayName,
  };

  return (
    <ThemeProvider branding={branding}>
      <AppShell user={shellUser}>
        <div className="mx-auto w-full max-w-4xl space-y-6">
          <div className="flex items-end justify-between">
            <div>
              <Link
                href="/settings"
                className="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              >
                <ArrowLeft size={12} />
                Back to settings
              </Link>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">Lead routing rules</h1>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                Rules apply to inbound leads in priority order. The first match wins. If none match,
                the lead falls through to round-robin among active telecallers in the inbound branch.
              </p>
            </div>
            <Button onClick={() => setEditing('new')}>
              <Plus size={14} /> New rule
            </Button>
          </div>

          {error ? (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] p-3 text-sm text-[var(--color-danger)]">
              {error}
            </div>
          ) : null}

          <Card>
            {rules.length === 0 ? (
              <div className="py-10 text-center text-sm text-[var(--color-text-muted)]">
                <Workflow size={28} className="mx-auto mb-2 opacity-40" />
                No rules yet. Without rules, leads round-robin to telecallers in the inbound branch.
              </div>
            ) : (
              <ul className="divide-y divide-[var(--color-border-muted)]">
                {rules.map((r, i) => (
                  <li key={r.id} className="flex items-center gap-3 py-3">
                    <div className="flex flex-col gap-1">
                      <button
                        className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                        disabled={i === 0}
                        onClick={() => void move(r.id, -1)}
                        aria-label="Move up"
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                        disabled={i === rules.length - 1}
                        onClick={() => void move(r.id, 1)}
                        aria-label="Move down"
                      >
                        <ArrowDown size={14} />
                      </button>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{r.name}</span>
                        <Badge tone={r.isActive ? 'success' : 'neutral'}>
                          {r.isActive ? 'Active' : 'Paused'}
                        </Badge>
                      </div>
                      <div className="mt-1 text-xs text-[var(--color-text-muted)]">
                        <RuleSummary rule={r} branches={branches} users={users} />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                        onClick={() => void toggle(r)}
                      >
                        {r.isActive ? 'Pause' : 'Resume'}
                      </button>
                      <button
                        className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                        onClick={() => setEditing(r)}
                        aria-label="Edit"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-1.5 text-[var(--color-danger)] hover:bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)]"
                        onClick={() => void remove(r.id)}
                        aria-label="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {editing ? (
          <RuleEditor
            initial={editing === 'new' ? null : editing}
            branches={branches}
            users={users}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              void load();
            }}
          />
        ) : null}
      </AppShell>
    </ThemeProvider>
  );
}

function RuleSummary({
  rule,
  branches,
  users,
}: {
  rule: Rule;
  branches: Branch[];
  users: UserRow[];
}) {
  const m = rule.matchJson ?? {};
  const a = rule.actionJson ?? { assignTo: 'round_robin' };
  const matchBits: string[] = [];
  if (m.source) matchBits.push(`source = ${m.source}`);
  if (m.language) matchBits.push(`language = ${m.language}`);
  if (m.caseInterest) matchBits.push(`case = ${m.caseInterest}`);
  if (m.branchId) {
    const b = branches.find((br) => br.id === m.branchId);
    matchBits.push(`branch = ${b?.name ?? m.branchId}`);
  }
  if (m.hourRange) matchBits.push(`hour ${m.hourRange[0]}–${m.hourRange[1]}`);

  let actionDesc = 'round-robin in branch';
  if (a.assignTo === 'unassigned') actionDesc = 'leave unassigned';
  else if (a.assignTo === 'user' && a.userId) {
    const u = users.find((x) => x.id === a.userId);
    actionDesc = `assign to ${u?.name ?? 'user'}`;
  }
  if (a.branchId && a.assignTo !== 'user') {
    const b = branches.find((br) => br.id === a.branchId);
    actionDesc += ` (${b?.name ?? a.branchId})`;
  }

  return (
    <span>
      <span className="font-medium">If</span> {matchBits.length ? matchBits.join(' & ') : 'every lead'}{' '}
      <span className="font-medium">→</span> {actionDesc}
    </span>
  );
}

function RuleEditor({
  initial,
  branches,
  users,
  onClose,
  onSaved,
}: {
  initial: Rule | null;
  branches: Branch[];
  users: UserRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [source, setSource] = useState(initial?.matchJson?.source ?? '');
  const [language, setLanguage] = useState(initial?.matchJson?.language ?? '');
  const [matchBranchId, setMatchBranchId] = useState(initial?.matchJson?.branchId ?? '');
  const [hourStart, setHourStart] = useState(
    initial?.matchJson?.hourRange ? String(initial.matchJson.hourRange[0]) : '',
  );
  const [hourEnd, setHourEnd] = useState(
    initial?.matchJson?.hourRange ? String(initial.matchJson.hourRange[1]) : '',
  );
  const [assignTo, setAssignTo] = useState<Action['assignTo']>(
    initial?.actionJson?.assignTo ?? 'round_robin',
  );
  const [userId, setUserId] = useState(initial?.actionJson?.userId ?? '');
  const [actionBranchId, setActionBranchId] = useState(initial?.actionJson?.branchId ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const eligibleUsers = useMemo(
    () =>
      users.filter(
        (u) =>
          u.status === 'ACTIVE' &&
          (!actionBranchId || u.branchId === actionBranchId),
      ),
    [users, actionBranchId],
  );

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const matchJson: Match = {};
      if (source) matchJson.source = source;
      if (language) matchJson.language = language;
      if (matchBranchId) matchJson.branchId = matchBranchId;
      if (hourStart && hourEnd) {
        matchJson.hourRange = [Number(hourStart), Number(hourEnd)];
      }
      const actionJson: Action = { assignTo };
      if (assignTo === 'user') {
        if (!userId) throw new Error('Pick a user to assign to');
        actionJson.userId = userId;
      }
      if (actionBranchId) actionJson.branchId = actionBranchId;

      const token = getAccessToken();
      if (initial) {
        await rpcMutation(
          'leadRule.update',
          { id: initial.id, name, matchJson, actionJson },
          { token },
        );
      } else {
        await rpcMutation('leadRule.create', { name, matchJson, actionJson }, { token });
      }
      onSaved();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{initial ? 'Edit rule' : 'New rule'}</h2>
          <button
            onClick={onClose}
            className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            Close
          </button>
        </div>
        {err ? (
          <div className="mb-3 rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] p-2 text-xs text-[var(--color-danger)]">
            {err}
          </div>
        ) : null}
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label>Rule name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Punjabi leads → Brampton"
              required
            />
          </div>

          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
              Match
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Selector label="Source" value={source} onChange={setSource} options={SOURCES} />
              <Selector label="Language" value={language} onChange={setLanguage} options={LANGUAGES} />
              <Selector
                label="Inbound branch"
                value={matchBranchId}
                onChange={setMatchBranchId}
                options={['', ...branches.map((b) => b.id)]}
                labelOf={(v) => (v ? branches.find((b) => b.id === v)?.name ?? v : 'Any')}
              />
              <div>
                <Label>Hour range (24h)</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    max={23}
                    value={hourStart}
                    onChange={(e) => setHourStart(e.target.value)}
                    placeholder="0"
                  />
                  <span className="text-xs text-[var(--color-text-muted)]">→</span>
                  <Input
                    type="number"
                    min={0}
                    max={23}
                    value={hourEnd}
                    onChange={(e) => setHourEnd(e.target.value)}
                    placeholder="24"
                  />
                </div>
              </div>
            </div>
          </div>

          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
              Action
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Selector
                label="Assign to"
                value={assignTo}
                onChange={(v) => setAssignTo(v as Action['assignTo'])}
                options={['round_robin', 'user', 'unassigned']}
                labelOf={(v) =>
                  v === 'round_robin' ? 'Round-robin' : v === 'user' ? 'Specific user' : 'Leave unassigned'
                }
              />
              <Selector
                label="Branch override"
                value={actionBranchId}
                onChange={setActionBranchId}
                options={['', ...branches.map((b) => b.id)]}
                labelOf={(v) => (v ? branches.find((b) => b.id === v)?.name ?? v : 'Use match branch')}
              />
              {assignTo === 'user' ? (
                <div className="col-span-2">
                  <Selector
                    label="User"
                    value={userId}
                    onChange={setUserId}
                    options={['', ...eligibleUsers.map((u) => u.id)]}
                    labelOf={(v) => {
                      const u = eligibleUsers.find((x) => x.id === v);
                      return u ? `${u.name} · ${u.email}` : 'Pick a user';
                    }}
                  />
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name}>
              {busy ? 'Saving…' : 'Save rule'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Selector({
  label,
  value,
  onChange,
  options,
  labelOf,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  labelOf?: (v: string) => string;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <select
        className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {labelOf ? labelOf(o) : o || 'Any'}
          </option>
        ))}
      </select>
    </div>
  );
}
