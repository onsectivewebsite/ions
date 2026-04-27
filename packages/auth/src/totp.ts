import { TOTP, Secret } from 'otpauth';
import QRCode from 'qrcode';

export type TotpEnrollment = {
  secret: string;
  uri: string;
  qrDataUrl: string;
};

export async function beginTotpEnroll(label: string, issuer = 'OnsecBoad'): Promise<TotpEnrollment> {
  const secret = new Secret({ size: 20 });
  const totp = new TOTP({ issuer, label, algorithm: 'SHA1', digits: 6, period: 30, secret });
  const uri = totp.toString();
  const qrDataUrl = await QRCode.toDataURL(uri, { margin: 1, width: 240 });
  return { secret: secret.base32, uri, qrDataUrl };
}

export function verifyTotp(secretBase32: string, token: string): boolean {
  const totp = new TOTP({
    issuer: 'OnsecBoad',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secretBase32),
  });
  const delta = totp.validate({ token, window: 1 });
  return delta !== null;
}
