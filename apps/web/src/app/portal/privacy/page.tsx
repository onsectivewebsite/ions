'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Download,
  FileWarning,
  Shield,
  Trash2,
} from 'lucide-react';
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
import { getPortalToken } from '../../../lib/portal-session';
import { Logo } from '../../../components/Logo';

type PortalMe = {
  email: string;
  client: { firstName: string | null; lastName: string | null; phone: string };
  firm: { displayName: string; branding: Branding };
};

export default function PortalPrivacyPage() {
  const router = useRouter();
  const [me, setMe] = useState<PortalMe | null>(null);
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const [exportBytes, setExportBytes] = useState<number | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportErr, setExportErr] = useState<string | null>(null);

  const [reason, setReason] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [delBusy, setDelBusy] = useState(false);
  const [delErr, setDelErr] = useState<string | null>(null);
  const [purgeAt, setPurgeAt] = useState<string | null>(null);

  useEffect(() => {
    const token = getPortalToken();
    if (!token) {
      router.replace('/portal/sign-in');
      return;
    }
    rpcQuery<PortalMe>('portal.me', undefined, { token })
      .then(setMe)
      .catch(() => router.replace('/portal/sign-in'));
  }, [router]);

  async function exportData(): Promise<void> {
    setExportBusy(true);
    setExportErr(null);
    try {
      const token = getPortalToken();
      const r = await rpcMutation<{ url: string; sizeBytes: number }>(
        'portal.privacyExportSelf',
        undefined,
        { token },
      );
      setExportUrl(r.url);
      setExportBytes(r.sizeBytes);
    } catch (e) {
      setExportErr(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExportBusy(false);
    }
  }

  async function deleteAccount(): Promise<void> {
    if (confirmText !== 'DELETE' || reason.length < 2) return;
    setDelBusy(true);
    setDelErr(null);
    try {
      const token = getPortalToken();
      const r = await rpcMutation<{ ok: true; purgeAt: string }>(
        'portal.privacyRequestDeletionSelf',
        { reason, confirm: 'DELETE' },
        { token },
      );
      setPurgeAt(r.purgeAt);
    } catch (e) {
      setDelErr(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setDelBusy(false);
    }
  }

  if (!me) {
    return (
      <main className="mx-auto max-w-2xl space-y-4 p-8">
        <Skeleton className="h-12" />
        <Skeleton className="h-64" />
      </main>
    );
  }

  const branding = me.firm.branding ?? { themeCode: 'maple' };

  if (purgeAt) {
    return (
      <ThemeProvider branding={branding}>
        <main className="mx-auto max-w-xl space-y-6 px-4 py-12">
          <Logo />
          <Card>
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-pill)] bg-[color-mix(in_srgb,var(--color-warning)_18%,transparent)] text-[var(--color-warning)]">
                <FileWarning size={18} />
              </div>
              <div>
                <CardTitle>Deletion request received</CardTitle>
                <CardBody className="mt-1 text-sm text-[var(--color-text-muted)]">
                  Your account at {me.firm.displayName} will be permanently
                  deleted on{' '}
                  <span className="font-medium text-[var(--color-text)]">
                    {new Date(purgeAt).toLocaleDateString()}
                  </span>{' '}
                  ({Math.round(
                    (new Date(purgeAt).getTime() - Date.now()) / 86_400_000,
                  )}{' '}
                  days). You&rsquo;ve been signed out of the portal. To cancel
                  this within the grace period, contact {me.firm.displayName}{' '}
                  directly.
                </CardBody>
              </div>
            </div>
          </Card>
        </main>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider branding={branding}>
      <main className="mx-auto max-w-2xl space-y-6 px-4 py-12">
        <div className="flex items-center justify-between">
          <Link
            href="/portal/dashboard"
            className="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            <ArrowLeft size={12} />
            Back to portal
          </Link>
          <Logo />
        </div>

        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Privacy &amp; data</h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Your rights under PIPEDA. Issued by {me.firm.displayName} on behalf
            of OnsecBoad.
          </p>
        </div>

        <Card>
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-pill)] bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]">
              <Download size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <CardTitle>Download my data</CardTitle>
              <CardBody className="mt-1 text-sm text-[var(--color-text-muted)]">
                Generates a JSON bundle of every record we hold about you —
                cases, documents, messages, invoices, payments, IRCC
                correspondence. Link is valid for 1 hour.
              </CardBody>
              {exportErr ? (
                <div className="mt-2 text-xs text-[var(--color-danger)]">{exportErr}</div>
              ) : null}
              {exportUrl ? (
                <div className="mt-3 rounded-[var(--radius-md)] border border-[var(--color-success)]/30 bg-[color-mix(in_srgb,var(--color-success)_10%,transparent)] p-3 text-sm">
                  Export ready ({Math.round((exportBytes ?? 0) / 1024)} KB).{' '}
                  <a href={exportUrl} className="font-medium underline">
                    Download now
                  </a>
                </div>
              ) : null}
              <div className="mt-3">
                <Button onClick={exportData} disabled={exportBusy}>
                  <Download size={14} />
                  {exportBusy ? 'Preparing…' : 'Generate export'}
                </Button>
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-pill)] bg-[color-mix(in_srgb,var(--color-danger)_10%,transparent)] text-[var(--color-danger)]">
              <Trash2 size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <CardTitle>Delete my account</CardTitle>
              <CardBody className="mt-1 text-sm text-[var(--color-text-muted)]">
                We&rsquo;ll keep your records for a 30-day grace period in case
                you change your mind. After that, your personal info is
                permanently scrubbed (cases, invoices, and IRCC records are
                retained without identifying info to satisfy regulatory
                retention rules).
              </CardBody>
              <div className="mt-3 space-y-3">
                <label className="block text-xs">
                  <Label className="mb-1 block">Reason (required)</Label>
                  <Input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Why you want to delete"
                    maxLength={500}
                  />
                </label>
                <label className="block text-xs">
                  <Label className="mb-1 block">
                    Type DELETE to confirm
                  </Label>
                  <Input
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder="DELETE"
                  />
                </label>
                {delErr ? (
                  <div className="text-xs text-[var(--color-danger)]">{delErr}</div>
                ) : null}
                <Button
                  variant="danger"
                  onClick={deleteAccount}
                  disabled={delBusy || confirmText !== 'DELETE' || reason.length < 2}
                >
                  <Trash2 size={14} />
                  {delBusy ? 'Submitting…' : 'Delete my account'}
                </Button>
              </div>
            </div>
          </div>
        </Card>

        <p className="rounded-[var(--radius-md)] border border-[var(--color-border-muted)] bg-[var(--color-surface-muted)] p-3 text-xs text-[var(--color-text-muted)]">
          <Shield size={12} className="mr-1 inline-block" />
          Questions or complaints about how your data is handled? Contact{' '}
          {me.firm.displayName} directly. You can also escalate to the Office
          of the Privacy Commissioner of Canada at priv.gc.ca.
        </p>
      </main>
    </ThemeProvider>
  );
}
