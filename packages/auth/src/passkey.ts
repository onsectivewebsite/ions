/**
 * WebAuthn passkey ceremony helpers. Thin wrapper around @simplewebauthn/server v10.
 * Returns plain values our routers can stash in Redis (challenge cache).
 */
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type GenerateRegistrationOptionsOpts,
  type GenerateAuthenticationOptionsOpts,
  type VerifyRegistrationResponseOpts,
  type VerifyAuthenticationResponseOpts,
} from '@simplewebauthn/server';

export type PasskeyEnv = {
  rpName: string;
  rpId: string;
  origin: string;
};

/** Matches @simplewebauthn/types AuthenticatorDevice (v10): credentialID is base64url-encoded. */
export type StoredAuthenticator = VerifyAuthenticationResponseOpts['authenticator'];

export async function buildRegistrationOptions(
  env: PasskeyEnv,
  user: { id: string; name: string; displayName: string },
  excludeCredentialIds: Buffer[] = [],
): ReturnType<typeof generateRegistrationOptions> {
  const opts: GenerateRegistrationOptionsOpts = {
    rpName: env.rpName,
    rpID: env.rpId,
    userID: new TextEncoder().encode(user.id),
    userName: user.name,
    userDisplayName: user.displayName,
    attestationType: 'none',
    excludeCredentials: excludeCredentialIds.map((id) => ({ id: id.toString('base64url') })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
  };
  return generateRegistrationOptions(opts);
}

export async function verifyRegistration(
  env: PasskeyEnv,
  expectedChallenge: string,
  attResponse: VerifyRegistrationResponseOpts['response'],
): ReturnType<typeof verifyRegistrationResponse> {
  return verifyRegistrationResponse({
    response: attResponse,
    expectedChallenge,
    expectedOrigin: env.origin,
    expectedRPID: env.rpId,
  });
}

export async function buildAuthenticationOptions(
  env: PasskeyEnv,
  allowCredentialIds: Buffer[] = [],
): ReturnType<typeof generateAuthenticationOptions> {
  const opts: GenerateAuthenticationOptionsOpts = {
    rpID: env.rpId,
    allowCredentials: allowCredentialIds.map((id) => ({ id: id.toString('base64url') })),
    userVerification: 'preferred',
  };
  return generateAuthenticationOptions(opts);
}

export async function verifyAuthentication(
  env: PasskeyEnv,
  expectedChallenge: string,
  authResponse: VerifyAuthenticationResponseOpts['response'],
  authenticator: StoredAuthenticator,
): ReturnType<typeof verifyAuthenticationResponse> {
  return verifyAuthenticationResponse({
    response: authResponse,
    expectedChallenge,
    expectedOrigin: env.origin,
    expectedRPID: env.rpId,
    authenticator,
  });
}
