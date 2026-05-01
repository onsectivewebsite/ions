'use client';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, ArrowRight, Sparkles } from 'lucide-react';
import {
  Button,
  Card,
  Input,
  Label,
  Spinner,
  ThemeProvider,
  ThemeSwatchGrid,
  type Branding,
} from '@onsecboad/ui';
import { rpcMutation, rpcQuery } from '../../lib/api';
import { setAccessToken } from '../../lib/session';
import { Logo } from '../../components/Logo';
import {
  PasswordField,
  PasswordStrengthMeter,
  checkPassword,
} from '../../components/PasswordField';

type VerifyResp = {
  firmName: string;
  legalName: string;
  slug: string;
  adminEmail: string | null;
  adminName: string | null;
};

function SetupInner() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') ?? '';

  const [verify, setVerify] = useState<VerifyResp | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1: password
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const policy = checkPassword(password);

  // Step 2: branding (theme + optional logo). The logo file is held until
  // setup.complete returns an access token — the upload endpoint is
  // firm-scoped, so we can't upload until we're authenticated.
  const [branding, setBranding] = useState<Branding>({ themeCode: 'maple' });
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoErr, setLogoErr] = useState<string | null>(null);

  // Step 3: first branch
  const [branchName, setBranchName] = useState('Main');
  const [branchPhone, setBranchPhone] = useState('');
  const [branchAddress, setBranchAddress] = useState('');
  const [branchCity, setBranchCity] = useState('');
  const [branchProvince, setBranchProvince] = useState('');
  const [branchPostal, setBranchPostal] = useState('');

  useEffect(() => {
    if (!token) {
      setVerifyError('Missing setup token');
      return;
    }
    rpcQuery<VerifyResp>('setup.verifyToken', { token })
      .then(setVerify)
      .catch((err) => setVerifyError(err instanceof Error ? err.message : 'Invalid setup link'));
  }, [token]);

  function next(): void {
    setError(null);
    if (step === 1) {
      if (!policy.meetsPolicy) {
        setError('Password must be 8+ chars with upper, lower, and a digit.');
        return;
      }
      if (password !== confirm) {
        setError('Passwords do not match.');
        return;
      }
    }
    if (step === 3 && !branchName) {
      setError('Branch name is required.');
      return;
    }
    setStep((s) => (s < 4 ? ((s + 1) as 1 | 2 | 3 | 4) : s));
  }

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const r = await rpcMutation<{
        ok: true;
        accessToken: string;
        refreshToken: string;
        accessExpiresAt: string;
      }>('setup.complete', {
        token,
        password,
        branding,
        firstBranch: {
          name: branchName,
          phone: branchPhone || undefined,
          addressLine1: branchAddress || undefined,
          city: branchCity || undefined,
          province: branchProvince || undefined,
          postalCode: branchPostal || undefined,
          country: 'CA',
        },
      });
      setAccessToken(r.accessToken);
      // Optional logo upload — auth-gated so we can only do it now that
      // we have a token. Failure here is non-fatal: the firm setup is
      // already complete, the user can re-upload from /settings/branding.
      if (logoFile) {
        try {
          const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
          await fetch(`${apiBase}/api/v1/tenant/logo`, {
            method: 'POST',
            headers: {
              'Content-Type': logoFile.type,
              Authorization: `Bearer ${r.accessToken}`,
            },
            body: logoFile,
          });
        } catch {
          // swallow — they can fix it later from settings
        }
      }
      router.push('/onboarding/secure');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed');
    } finally {
      setSubmitting(false);
    }
  }

  if (verifyError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-mesh p-6">
        <Card className="max-w-md">
          <h1 className="text-base font-semibold">Setup link unavailable</h1>
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">{verifyError}</p>
          <Button className="mt-4 w-full" onClick={() => router.push('/sign-in')}>
            Back to sign-in
          </Button>
        </Card>
      </main>
    );
  }

  if (!verify) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-mesh">
        <Spinner />
      </main>
    );
  }

  return (
    <ThemeProvider branding={branding}>
      <main className="flex min-h-screen items-center justify-center bg-mesh px-4 py-12">
        <div className="w-full max-w-2xl space-y-6">
          <div className="flex items-center justify-between">
            <Logo />
            <div className="text-xs text-[var(--color-text-muted)]">Step {step} of 4</div>
          </div>

          <Card>
            <div className="mb-4">
              <div className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                {verify.firmName}
              </div>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">
                {step === 1
                  ? 'Choose your password'
                  : step === 2
                    ? 'Pick a theme & logo'
                    : step === 3
                      ? 'First branch'
                      : 'All set'}
              </h1>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                {step === 1
                  ? `Welcome${verify.adminName ? ', ' + verify.adminName : ''}. Set a password for ${verify.adminEmail ?? 'your account'}.`
                  : step === 2
                    ? 'Themes apply to the dashboard, client portal, and every email.'
                    : step === 3
                      ? 'Add the address for your first office. You can rename or add more later.'
                      : 'Confirm and finish setup.'}
              </p>
            </div>

            {step === 1 ? (
              <div className="space-y-4">
                <div>
                  <Label htmlFor="pw">New password</Label>
                  <div className="mt-1">
                    <PasswordField
                      id="pw"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="new-password"
                      autoFocus
                      placeholder="••••••••"
                    />
                  </div>
                  <PasswordStrengthMeter password={password} />
                </div>
                <div>
                  <Label htmlFor="cf">Confirm password</Label>
                  <div className="mt-1">
                    <PasswordField
                      id="cf"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      autoComplete="new-password"
                      placeholder="••••••••"
                    />
                  </div>
                  {confirm && confirm !== password ? (
                    <div className="mt-1 text-[11px] text-[var(--color-danger)]">
                      Doesn&rsquo;t match.
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {step === 2 ? (
              <div className="space-y-5">
                <ThemeSwatchGrid
                  selected={branding.themeCode}
                  onSelect={(code) => setBranding({ ...branding, themeCode: code })}
                />
                <div>
                  <Label className="mb-1 block">Firm logo (optional)</Label>
                  <p className="mb-2 text-xs text-[var(--color-text-muted)]">
                    PNG, JPG, SVG, or WebP — up to 2 MB. Shown in the sidebar, sign-in
                    page, and on every email we send. You can change it later in Settings.
                  </p>
                  <div className="flex items-center gap-3">
                    {logoFile ? (
                      <img
                        src={URL.createObjectURL(logoFile)}
                        alt="Logo preview"
                        className="h-12 w-12 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] object-contain p-1"
                      />
                    ) : (
                      <div className="grid h-12 w-12 place-items-center rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] text-xs text-[var(--color-text-muted)]">
                        none
                      </div>
                    )}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/svg+xml,image/webp"
                      onChange={(e) => {
                        setLogoErr(null);
                        const f = e.target.files?.[0] ?? null;
                        if (!f) {
                          setLogoFile(null);
                          return;
                        }
                        if (f.size > 2 * 1024 * 1024) {
                          setLogoErr('Logo must be ≤ 2 MB.');
                          return;
                        }
                        if (!/^image\/(png|jpeg|svg\+xml|webp)$/.test(f.type)) {
                          setLogoErr('Use PNG, JPG, SVG, or WebP.');
                          return;
                        }
                        setLogoFile(f);
                      }}
                      className="text-xs"
                    />
                    {logoFile ? (
                      <Button variant="ghost" size="sm" onClick={() => setLogoFile(null)}>
                        Remove
                      </Button>
                    ) : null}
                  </div>
                  {logoErr ? (
                    <div className="mt-1 text-[11px] text-[var(--color-danger)]">{logoErr}</div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {step === 3 ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <Label htmlFor="bname">Branch name *</Label>
                    <Input
                      id="bname"
                      value={branchName}
                      onChange={(e) => setBranchName(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="bphone">Phone</Label>
                    <Input
                      id="bphone"
                      value={branchPhone}
                      onChange={(e) => setBranchPhone(e.target.value)}
                      placeholder="+1 ___ ___ ____"
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="baddr">Street address</Label>
                  <Input
                    id="baddr"
                    value={branchAddress}
                    onChange={(e) => setBranchAddress(e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div>
                    <Label htmlFor="bcity">City</Label>
                    <Input
                      id="bcity"
                      value={branchCity}
                      onChange={(e) => setBranchCity(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="bprov">Province</Label>
                    <Input
                      id="bprov"
                      value={branchProvince}
                      onChange={(e) => setBranchProvince(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="bpost">Postal code</Label>
                    <Input
                      id="bpost"
                      value={branchPostal}
                      onChange={(e) => setBranchPostal(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            ) : null}

            {step === 4 ? (
              <div className="space-y-3 text-sm">
                <Row label="Firm">{verify.firmName}</Row>
                <Row label="Admin">{verify.adminEmail}</Row>
                <Row label="Theme">{branding.themeCode}</Row>
                <Row label="Branch">
                  {branchName}
                  {branchCity ? ` · ${branchCity}` : ''}
                  {branchProvince ? `, ${branchProvince}` : ''}
                </Row>
                <p className="mt-3 text-xs text-[var(--color-text-muted)]">
                  Submitting will activate your account and sign you out so you can sign in with the new password.
                </p>
              </div>
            ) : null}

            {error ? (
              <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] p-3 text-sm text-[var(--color-danger)]">
                {error}
              </div>
            ) : null}

            <div className="mt-6 flex items-center justify-between">
              <Button
                variant="ghost"
                disabled={step === 1 || submitting}
                onClick={() => setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3 | 4) : s))}
              >
                <ArrowLeft size={14} /> Back
              </Button>
              {step < 4 ? (
                <Button onClick={next} disabled={submitting}>
                  Next <ArrowRight size={14} />
                </Button>
              ) : (
                <Button onClick={submit} disabled={submitting}>
                  {submitting ? <Spinner /> : <Sparkles size={14} />}
                  Finish setup
                </Button>
              )}
            </div>
          </Card>

          <p className="text-center text-xs text-[var(--color-text-muted)]">
            © Onsective Inc. · Already done? <a href="/sign-in" className="hover:underline">Sign in</a>
          </p>
        </div>
      </main>
    </ThemeProvider>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[var(--color-border-muted)] py-2 last:border-0">
      <div className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">{label}</div>
      <div className="font-medium">{children}</div>
    </div>
  );
}

export default function SetupPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center text-sm text-[var(--color-text-muted)]">
          Loading…
        </main>
      }
    >
      <SetupInner />
    </Suspense>
  );
}
