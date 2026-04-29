'use client';
import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, BarChart3, Sparkles } from 'lucide-react';
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
import { rpcMutation, rpcQuery } from '../../../lib/api';
import { getAccessToken } from '../../../lib/session';
import { AppShell, type ShellUser } from '../../../components/AppShell';

type Me = {
  kind: 'firm';
  name: string;
  email: string;
  twoFAEnrolled: boolean;
  tenant: { displayName: string; branding: Branding };
};

type AiSettings = {
  tenantId: string;
  enabled: boolean;
  classifyAuto: boolean;
  formFillEnabled: boolean;
  agentEnabled: boolean;
  preferredModel: string;
  monthlyBudgetCents: number;
  redactionLevel: 'standard' | 'strict';
  monthToDateCostCents: number;
};

const MODELS = [
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (balanced — recommended)' },
  { id: 'claude-opus-4-7', label: 'Claude Opus 4.7 (highest quality, $$)' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 (fast + cheap, classify-only)' },
];

function fmtMoney(cents: number): string {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(cents / 100);
}

export default function AiSettingsPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [budget, setBudget] = useState('');
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(): Promise<void> {
    const token = getAccessToken();
    if (!token) {
      router.replace('/sign-in');
      return;
    }
    try {
      const [m, s] = await Promise.all([
        rpcQuery<Me>('user.me', undefined, { token }),
        rpcQuery<AiSettings>('aiSettings.get', undefined, { token }),
      ]);
      setMe(m);
      setSettings(s);
      setBudget(s.monthlyBudgetCents > 0 ? (s.monthlyBudgetCents / 100).toFixed(2) : '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load AI settings');
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function patch(input: Partial<AiSettings>): Promise<void> {
    if (!settings) return;
    setBusy(true);
    setError(null);
    try {
      const token = getAccessToken();
      const r = await rpcMutation<AiSettings>('aiSettings.update', input, { token });
      setSettings({ ...settings, ...r });
      setSavedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  async function saveBudget(e: FormEvent): Promise<void> {
    e.preventDefault();
    const cents = budget.trim() === '' ? 0 : Math.round(Number(budget) * 100);
    if (Number.isNaN(cents) || cents < 0) {
      setError('Budget must be a positive number');
      return;
    }
    await patch({ monthlyBudgetCents: cents });
  }

  if (!me || !settings) {
    return (
      <main className="grid min-h-screen grid-cols-[240px_1fr]">
        <div className="border-r border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <Skeleton className="h-6 w-32" />
        </div>
        <div className="space-y-4 p-8">
          <Skeleton className="h-12 w-64" />
          <Skeleton className="h-32" />
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
  const overBudget =
    settings.monthlyBudgetCents > 0 &&
    settings.monthToDateCostCents >= settings.monthlyBudgetCents;

  return (
    <ThemeProvider branding={branding}>
      <AppShell user={shellUser}>
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-[var(--color-text-muted)]">Settings · AI</div>
              <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight">
                <Sparkles size={20} className="text-[var(--color-primary)]" /> AI features
              </h1>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                Control how OnsecBoad uses AI on your firm&apos;s files. Toggles take effect immediately.
              </p>
            </div>
            <Link
              href="/settings/ai/usage"
              className="inline-flex items-center gap-1 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-2 text-xs hover:bg-[var(--color-surface-muted)]"
            >
              <BarChart3 size={12} /> Usage dashboard <ArrowRight size={12} />
            </Link>
          </div>

          {error ? (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] p-3 text-sm text-[var(--color-danger)]">
              {error}
            </div>
          ) : null}

          {savedAt ? (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-success)]/30 bg-[color-mix(in_srgb,var(--color-success)_8%,transparent)] p-2 text-xs text-[var(--color-success)]">
              Saved {savedAt.toLocaleTimeString()}.
            </div>
          ) : null}

          <Card>
            <CardTitle>Spend this month</CardTitle>
            <div className="mt-3 flex items-end gap-3">
              <div className="text-3xl font-semibold">
                {fmtMoney(settings.monthToDateCostCents)}
              </div>
              {settings.monthlyBudgetCents > 0 ? (
                <div className="pb-2 text-xs text-[var(--color-text-muted)]">
                  of {fmtMoney(settings.monthlyBudgetCents)} cap
                </div>
              ) : (
                <div className="pb-2 text-xs text-[var(--color-text-muted)]">no cap set</div>
              )}
              {overBudget ? <Badge tone="danger">Over budget — calls blocked</Badge> : null}
            </div>
          </Card>

          <Card>
            <CardTitle>Master switches</CardTitle>
            <div className="mt-3 space-y-3">
              <Toggle
                label="AI is enabled for this firm"
                description="Master kill switch. When off, every AI feature returns an error."
                value={settings.enabled}
                onChange={(v) => void patch({ enabled: v })}
                disabled={busy}
              />
              <Toggle
                label="Auto-classify uploaded documents"
                description="When clients upload, classify the file (passport, IELTS, etc) automatically."
                value={settings.classifyAuto}
                onChange={(v) => void patch({ classifyAuto: v })}
                disabled={busy || !settings.enabled}
              />
              <Toggle
                label="AI form-fill drafts"
                description="Filers can run the AI extraction + form-fill pipeline on a case."
                value={settings.formFillEnabled}
                onChange={(v) => void patch({ formFillEnabled: v })}
                disabled={busy || !settings.enabled}
              />
              <Toggle
                label="Autonomous agent (sends client messages)"
                description="Agent can SMS / email clients to chase missing documents. Off by default."
                value={settings.agentEnabled}
                onChange={(v) => void patch({ agentEnabled: v })}
                disabled={busy || !settings.enabled}
              />
            </div>
          </Card>

          <Card>
            <CardTitle>Preferred model</CardTitle>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              Used for extraction + form-fill. Classification (when added) uses Haiku regardless.
            </p>
            <select
              className="mt-3 h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
              value={settings.preferredModel}
              onChange={(e) => void patch({ preferredModel: e.target.value })}
              disabled={busy}
            >
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </Card>

          <Card>
            <CardTitle>Monthly budget cap</CardTitle>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              When the cap is hit, every AI call is blocked until the month rolls over. Leave blank
              for no cap.
            </p>
            <form onSubmit={saveBudget} className="mt-3 flex items-end gap-2">
              <div className="flex-1">
                <Label htmlFor="budget">Cap (CAD)</Label>
                <Input
                  id="budget"
                  type="number"
                  min="0"
                  step="0.01"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  placeholder="500.00"
                />
              </div>
              <Button type="submit" disabled={busy}>
                {busy ? <Spinner /> : null} Save cap
              </Button>
            </form>
          </Card>

          <Card>
            <CardTitle>PII redaction</CardTitle>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              Strict mode redacts emails, phone numbers, and passport-like patterns from prompts
              before they reach the model. Standard ships only the document bytes + intake values.
            </p>
            <select
              className="mt-3 h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
              value={settings.redactionLevel}
              onChange={(e) =>
                void patch({ redactionLevel: e.target.value as 'standard' | 'strict' })
              }
              disabled={busy}
            >
              <option value="standard">Standard</option>
              <option value="strict">Strict (PII redacted)</option>
            </select>
          </Card>
        </div>
      </AppShell>
    </ThemeProvider>
  );
}

function Toggle({
  label,
  description,
  value,
  onChange,
  disabled,
}: {
  label: string;
  description: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-start gap-3 rounded-[var(--radius-md)] border border-[var(--color-border-muted)] p-3 ${
        disabled ? 'opacity-50' : 'cursor-pointer hover:border-[var(--color-primary)]/40'
      }`}
    >
      <input
        type="checkbox"
        className="mt-1"
        checked={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="mt-0.5 text-xs text-[var(--color-text-muted)]">{description}</div>
      </div>
    </label>
  );
}
