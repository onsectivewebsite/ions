import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { createHash, randomBytes } from 'node:crypto';

export type AccessClaims = {
  sub: string;
  scope: 'platform' | 'firm' | 'client';
  tenantId?: string;
  roleId?: string;
  branchId?: string;
};

export type TokenPair = {
  accessToken: string;
  refreshToken: string;
  refreshTokenHash: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
};

function key(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signAccessToken(
  claims: AccessClaims,
  secret: string,
  ttlSec: number,
): Promise<{ token: string; expiresAt: Date }> {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const token = await new SignJWT(claims as unknown as JWTPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(key(secret));
  return { token, expiresAt: new Date(exp * 1000) };
}

export async function verifyAccessToken<T extends AccessClaims = AccessClaims>(
  token: string,
  secret: string,
): Promise<T> {
  const { payload } = await jwtVerify(token, key(secret));
  return payload as unknown as T;
}

export function generateRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(48).toString('base64url');
  const hash = createHash('sha256').update(token).digest('hex');
  return { token, hash };
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
