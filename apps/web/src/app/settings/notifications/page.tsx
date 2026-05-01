'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, Check, Clock, Mail, MessageSquare } from 'lucide-react';
import {
  Button,
  Card,
  CardBody,
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

type Prefs = {
  email: {
    leadAssigned: boolean;
    appointmentReminder: boolean;
    caseStatus: boolean;
    billingReceipt: boolean;
    weeklyDigest: boolean;
  };
  sms: {
    appointmentReminder: boolean;
    leadUrgent: boolean;
  };
};

const DEFAULTS: Prefs = {
  email: {
    leadAssigned: true,
    appointmentReminder: true,
    caseStatus: true,
    billingReceipt: true,
    weeklyDigest: false,
  },
  sms: {
    appointmentReminder: false,
    leadUrgent: false,
  },
};

type Me = {
  kind: 'firm';
  name: string;
  email: string;
  tenant: { displayName: string; branding: Branding };
};

export default function NotificationsPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      router.replace('/sign-in');
      return;
    }
    Promise.all([
      rpcQuery<Me>('user.me', undefined, { token }),
      rpcQuery<Prefs | null>('user.getNotificationPrefs', undefined, { token }),
    ])
      .then(([m, p]) => {
        setMe(m);
        setPrefs(p ?? DEFAULTS);
      })
      .catch(() => router.replace('/sign-in'));
  }, [router]);

  async function save(): Promise<void> {
    if (!prefs) return;
    setBusy(true);
    try {
      const token = getAccessToken();
      await rpcMutation('user.updateNotificationPrefs', prefs, { token });
      setSavedAt(new Date());
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  if (!me || !prefs) {
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

  function toggle<G extends keyof Prefs, K extends keyof Prefs[G]>(group: G, key: K): void {
    setPrefs((p) => {
      if (!p) return p;
      return { ...p, [group]: { ...p[group], [key]: !p[group][key] } } as Prefs;
    });
  }

  return (
    <ThemeProvider branding={branding}>
      <AppShell user={shellUser}>
        <div className="space-y-6">
          <div>
            <div className="text-xs text-[var(--color-text-muted)]">Settings</div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Notifications</h1>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Pick which events Onsective sends you. SMS requires a phone on file in your
              user profile.
            </p>
          </div>

          <Card>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-pill)] bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]">
                <Mail size={16} />
              </div>
              <div>
                <CardTitle>Email</CardTitle>
                <CardBody className="mt-1 text-xs text-[var(--color-text-muted)]">
                  Goes to {me.email}.
                </CardBody>
              </div>
            </div>
            <div className="mt-4 divide-y divide-[var(--color-border-muted)]">
              <Toggle
                label="Lead assigned to me"
                detail="When a lead is routed to your queue."
                checked={prefs.email.leadAssigned}
                onChange={() => toggle('email', 'leadAssigned')}
              />
              <Toggle
                label="Appointment reminder"
                detail="24 hours before each booking."
                checked={prefs.email.appointmentReminder}
                onChange={() => toggle('email', 'appointmentReminder')}
              />
              <Toggle
                label="Case status changes"
                detail="When a case you own moves between stages."
                checked={prefs.email.caseStatus}
                onChange={() => toggle('email', 'caseStatus')}
              />
              <Toggle
                label="Billing receipts"
                detail="Receipt + invoice emails for your firm's subscription."
                checked={prefs.email.billingReceipt}
                onChange={() => toggle('email', 'billingReceipt')}
              />
              <Toggle
                label="Weekly digest"
                detail="Monday morning summary of your queue + KPIs."
                checked={prefs.email.weeklyDigest}
                onChange={() => toggle('email', 'weeklyDigest')}
              />
            </div>
          </Card>

          <Card>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-pill)] bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]">
                <MessageSquare size={16} />
              </div>
              <div>
                <CardTitle>SMS</CardTitle>
                <CardBody className="mt-1 text-xs text-[var(--color-text-muted)]">
                  SMS pricing applies to your firm&rsquo;s Twilio bill.
                </CardBody>
              </div>
            </div>
            <div className="mt-4 divide-y divide-[var(--color-border-muted)]">
              <Toggle
                label="Appointment reminder"
                detail="Same 24h reminder, by SMS instead of email."
                checked={prefs.sms.appointmentReminder}
                onChange={() => toggle('sms', 'appointmentReminder')}
              />
              <Toggle
                label="Urgent lead routing"
                detail="When a high-priority lead lands in your queue outside hours."
                checked={prefs.sms.leadUrgent}
                onChange={() => toggle('sms', 'leadUrgent')}
              />
            </div>
          </Card>

          <div className="flex items-center justify-end gap-3">
            {savedAt ? (
              <span className="inline-flex items-center gap-1 text-xs text-[var(--color-success)]">
                <Check size={12} />
                Saved {savedAt.toLocaleTimeString()}
              </span>
            ) : null}
            <Button onClick={save} disabled={busy}>
              <Bell size={14} />
              {busy ? 'Saving…' : 'Save preferences'}
            </Button>
          </div>

          <ReminderConfigCard />
        </div>
      </AppShell>
    </ThemeProvider>
  );
}

type ReminderConfig = {
  sendLong: boolean;
  sendShort: boolean;
  longHours: number;
  shortMinutes: number;
};

function ReminderConfigCard() {
  const [cfg, setCfg] = useState<ReminderConfig>({
    sendLong: true,
    sendShort: true,
    longHours: 24,
    shortMinutes: 60,
  });
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const token = getAccessToken();
    rpcQuery<ReminderConfig | null>('tenant.reminderConfigGet', undefined, { token })
      .then((c) => {
        if (c) setCfg(c);
      })
      .catch(() => {
        /* fall back to defaults */
      });
  }, []);

  async function save(): Promise<void> {
    setBusy(true);
    setErr(null);
    try {
      const token = getAccessToken();
      await rpcMutation('tenant.reminderConfigUpdate', cfg, { token });
      setSavedAt(new Date());
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-pill)] bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]">
          <Clock size={16} />
        </div>
        <div>
          <CardTitle>Appointment reminders (firm-wide)</CardTitle>
          <CardBody className="mt-1 text-xs text-[var(--color-text-muted)]">
            How far in advance reminders go out to clients. Applies to every
            booking. Requires settings.write to change.
          </CardBody>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <label className="flex items-start gap-3 rounded-[var(--radius-md)] border border-[var(--color-border-muted)] p-3">
          <input
            type="checkbox"
            checked={cfg.sendLong}
            onChange={(e) => setCfg({ ...cfg, sendLong: e.target.checked })}
            className="mt-1 h-4 w-4 cursor-pointer accent-[var(--color-primary)]"
          />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">Long-lead reminder</div>
            <div className="mt-0.5 text-xs text-[var(--color-text-muted)]">
              Default 24 hours before. Useful for confirmations.
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Input
                type="number"
                min={1}
                max={168}
                value={cfg.longHours}
                onChange={(e) => setCfg({ ...cfg, longHours: Number(e.target.value) || 24 })}
                disabled={!cfg.sendLong}
                className="w-20"
              />
              <span className="text-xs text-[var(--color-text-muted)]">hours before</span>
            </div>
          </div>
        </label>

        <label className="flex items-start gap-3 rounded-[var(--radius-md)] border border-[var(--color-border-muted)] p-3">
          <input
            type="checkbox"
            checked={cfg.sendShort}
            onChange={(e) => setCfg({ ...cfg, sendShort: e.target.checked })}
            className="mt-1 h-4 w-4 cursor-pointer accent-[var(--color-primary)]"
          />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">Short-lead reminder</div>
            <div className="mt-0.5 text-xs text-[var(--color-text-muted)]">
              Default 60 minutes before. Last-call nudge so people show up.
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Input
                type="number"
                min={5}
                max={720}
                value={cfg.shortMinutes}
                onChange={(e) => setCfg({ ...cfg, shortMinutes: Number(e.target.value) || 60 })}
                disabled={!cfg.sendShort}
                className="w-20"
              />
              <span className="text-xs text-[var(--color-text-muted)]">minutes before</span>
            </div>
          </div>
        </label>
      </div>

      {err ? (
        <div className="mt-3 rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] p-2 text-xs text-[var(--color-danger)]">
          {err}
        </div>
      ) : null}

      <div className="mt-4 flex items-center justify-end gap-3">
        {savedAt ? (
          <span className="inline-flex items-center gap-1 text-xs text-[var(--color-success)]">
            <Check size={12} />
            Saved {savedAt.toLocaleTimeString()}
          </span>
        ) : null}
        <Button onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save reminder config'}
        </Button>
      </div>
    </Card>
  );
}

function Toggle({
  label,
  detail,
  checked,
  onChange,
}: {
  label: string;
  detail: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{label}</div>
        <div className="mt-0.5 text-xs text-[var(--color-text-muted)]">{detail}</div>
      </div>
      <div className="pt-1">
        <input
          type="checkbox"
          checked={checked}
          onChange={onChange}
          className="h-4 w-4 cursor-pointer accent-[var(--color-primary)]"
        />
      </div>
    </label>
  );
}
