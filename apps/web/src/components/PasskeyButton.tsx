'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { startAuthentication, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import { Button, Spinner } from '@onsecboad/ui';
import { KeyRound } from 'lucide-react';
import { rpcMutation } from '../lib/api';

type Method = 'totp' | 'email_otp';
type AuthOptions = Parameters<typeof startAuthentication>[0];

export function PasskeyButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supported = typeof window !== 'undefined' && browserSupportsWebAuthn();

  async function onClick(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      const { challengeId, options } = await rpcMutation<{
        challengeId: string;
        options: AuthOptions;
      }>('auth.passkeyBeginAuthentication', undefined);

      const assertion = await startAuthentication(options);

      const verify = await rpcMutation<{ ticket: string; methods: Method[] }>(
        'auth.passkeyFinishAuthentication',
        { challengeId, response: assertion },
      );

      const params = new URLSearchParams({
        ticket: verify.ticket,
        methods: verify.methods.join(','),
      });
      router.push(`/sign-in/2fa?${params.toString()}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Passkey failed');
    } finally {
      setBusy(false);
    }
  }

  if (!supported) {
    return (
      <Button variant="secondary" disabled className="w-full">
        <KeyRound size={14} />
        Passkeys not supported on this device
      </Button>
    );
  }

  return (
    <div className="space-y-2">
      <Button variant="secondary" onClick={onClick} disabled={busy} className="w-full">
        {busy ? <Spinner /> : <KeyRound size={14} />}
        {busy ? 'Waiting for your passkey…' : 'Use a passkey'}
      </Button>
      {error ? (
        <p className="text-xs text-[var(--color-danger)]">{error}</p>
      ) : null}
    </div>
  );
}
