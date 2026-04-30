'use client';
import { useEffect, useState } from 'react';
import { Copy, Mail, MessageSquare, QrCode, Send, X } from 'lucide-react';
import { Button, Card, Input, Label, Spinner } from '@onsecboad/ui';
import { rpcMutation, rpcQuery } from '../../lib/api';
import { getAccessToken } from '../../lib/session';

type Template = {
  id: string;
  name: string;
  caseType: string;
  description: string | null;
  isActive: boolean;
};

type CreateResp = {
  id: string;
  publicUrl: string;
  publicToken: string;
  expiresAt: string;
  emailSent: boolean;
  emailError: string | null;
  smsSent?: boolean;
  smsError?: string | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onSent?: (resp: CreateResp) => void;
  /** Either leadId or clientId must be set. */
  leadId?: string;
  clientId?: string;
  /** Prefill recipient (from the lead/client). */
  defaults: {
    name?: string;
    email?: string;
    phone?: string;
    caseType?: string;
  };
};

type DeliveryMethod = 'email' | 'sms' | 'qr' | 'staff';

export function SendIntakeModal({ open, onClose, onSent, leadId, clientId, defaults }: Props) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [tplId, setTplId] = useState('');
  const [name, setName] = useState(defaults.name ?? '');
  const [email, setEmail] = useState(defaults.email ?? '');
  const [phone, setPhone] = useState(defaults.phone ?? '');
  const [method, setMethod] = useState<DeliveryMethod>('email');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<CreateResp | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoadingTemplates(true);
    setErr(null);
    setResult(null);
    setTplId('');
    setName(defaults.name ?? '');
    setEmail(defaults.email ?? '');
    setPhone(defaults.phone ?? '');
    const token = getAccessToken();
    rpcQuery<Template[]>('intakeTemplate.list', undefined, { token })
      .then((rows) => {
        const active = rows.filter((r) => r.isActive);
        setTemplates(active);
        // Auto-pick a template that matches the lead's caseInterest, if any.
        const pref = defaults.caseType
          ? active.find((r) => r.caseType === defaults.caseType)
          : null;
        if (pref) setTplId(pref.id);
        else if (active[0]) setTplId(active[0].id);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : 'Failed to load templates'))
      .finally(() => setLoadingTemplates(false));
  }, [open, defaults.name, defaults.email, defaults.phone, defaults.caseType]);

  async function send(): Promise<void> {
    setErr(null);
    if (!tplId) {
      setErr('Pick an intake form template.');
      return;
    }
    if (method === 'email' && !email) {
      setErr('Need an email address to send by email.');
      return;
    }
    if (method === 'sms' && !phone) {
      setErr('Need a phone number to send by SMS.');
      return;
    }
    setBusy(true);
    try {
      const token = getAccessToken();
      const r = await rpcMutation<CreateResp>(
        'intake.createRequest',
        {
          templateId: tplId,
          leadId,
          clientId,
          recipientName: name || undefined,
          recipientEmail: email || undefined,
          recipientPhone: phone || undefined,
          sentVia: method,
        },
        { token },
      );
      setResult(r);
      if (onSent) onSent(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Send failed');
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-12">
      <Card className="w-full max-w-lg">
        <div className="flex items-center justify-between border-b border-[var(--color-border-muted)] pb-3">
          <div className="font-semibold">Send intake form</div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[var(--radius-md)] p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)]"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {result ? (
          <SuccessPanel result={result} method={method} email={email} phone={phone} />
        ) : (
          <div className="mt-4 space-y-4">
            <div>
              <Label htmlFor="tpl" className="mb-1 block">
                Form template
              </Label>
              <select
                id="tpl"
                value={tplId}
                onChange={(e) => setTplId(e.target.value)}
                disabled={loadingTemplates}
                className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
              >
                {loadingTemplates ? <option>Loading…</option> : null}
                {!loadingTemplates && templates.length === 0 ? (
                  <option value="">No active templates — create one in Settings</option>
                ) : null}
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {t.caseType.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
              {!loadingTemplates && templates.length === 0 ? (
                <a
                  href="/settings/intake-forms/new"
                  className="mt-1 inline-block text-xs text-[var(--color-primary)] hover:underline"
                >
                  Create your first intake form template →
                </a>
              ) : null}
            </div>

            <div>
              <Label className="mb-1 block">Send via</Label>
              <div className="grid grid-cols-2 gap-2">
                <MethodTab
                  active={method === 'email'}
                  onClick={() => setMethod('email')}
                  icon={<Mail size={14} />}
                  label="Email"
                />
                <MethodTab
                  active={method === 'sms'}
                  onClick={() => setMethod('sms')}
                  icon={<MessageSquare size={14} />}
                  label="SMS"
                />
                <MethodTab
                  active={method === 'qr'}
                  onClick={() => setMethod('qr')}
                  icon={<QrCode size={14} />}
                  label="QR / link"
                />
                <MethodTab
                  active={method === 'staff'}
                  onClick={() => setMethod('staff')}
                  icon={<Send size={14} />}
                  label="Hand the device"
                />
              </div>
              {method === 'sms' ? (
                <div className="mt-2 text-[11px] text-[var(--color-text-muted)]">
                  Delivers via your firm&rsquo;s Twilio. Not configured? You can still copy the
                  link from the success screen.
                </div>
              ) : null}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label className="mb-1 block">Recipient name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <Label className="mb-1 block">Email</Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="client@example.com"
                />
              </div>
              <div>
                <Label className="mb-1 block">Phone</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
            </div>

            {err ? (
              <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] p-2 text-xs text-[var(--color-danger)]">
                {err}
              </div>
            ) : null}

            <div className="flex justify-end gap-2 border-t border-[var(--color-border-muted)] pt-3">
              <Button variant="ghost" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={send} disabled={busy || !tplId}>
                {busy ? <Spinner /> : <Send size={14} />}
                {busy ? 'Sending…' : 'Send'}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function MethodTab({
  active,
  onClick,
  icon,
  label,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        'flex items-center justify-center gap-2 rounded-[var(--radius-md)] border px-3 py-2 text-xs font-medium transition-colors disabled:opacity-40 ' +
        (active
          ? 'border-[var(--color-primary)] bg-[color-mix(in_srgb,var(--color-primary)_10%,transparent)] text-[var(--color-primary)]'
          : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)]')
      }
    >
      {icon}
      {label}
    </button>
  );
}

function SuccessPanel({
  result,
  method,
  email,
  phone,
}: {
  result: CreateResp;
  method: DeliveryMethod;
  email: string;
  phone: string;
}) {
  const [copied, setCopied] = useState(false);
  function copy(): void {
    void navigator.clipboard.writeText(result.publicUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <div className="mt-4 space-y-4">
      <div className="rounded-[var(--radius-md)] border border-[var(--color-success)]/30 bg-[color-mix(in_srgb,var(--color-success)_10%,transparent)] p-3 text-sm">
        {method === 'email' && result.emailSent
          ? `Email sent to ${email}.`
          : method === 'email' && result.emailError
            ? `Email send failed: ${result.emailError}. Copy the link below and send manually.`
            : method === 'sms' && result.smsSent
              ? `SMS sent to ${phone}.`
              : method === 'sms' && result.smsError
                ? `SMS send failed: ${result.smsError}. Copy the link below and send manually.`
                : method === 'sms'
                  ? `SMS to ${phone} is queued.`
                  : method === 'qr'
                    ? 'Show this QR / link to your client.'
                    : 'Hand the device to the client and open the link.'}
      </div>

      <div>
        <Label className="mb-1 block">Public link</Label>
        <div className="flex items-center gap-2">
          <Input value={result.publicUrl} readOnly className="font-mono text-xs" />
          <Button variant="secondary" onClick={copy}>
            <Copy size={14} />
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
        <div className="mt-1 text-[11px] text-[var(--color-text-muted)]">
          Expires {new Date(result.expiresAt).toLocaleString()}.
        </div>
      </div>

      {method === 'qr' || method === 'staff' ? (
        <div className="flex justify-center">
          <img
            alt="QR code for the intake link"
            className="h-48 w-48 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white p-2"
            src={`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(result.publicUrl)}`}
          />
        </div>
      ) : null}
    </div>
  );
}
