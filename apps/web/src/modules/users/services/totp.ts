import 'server-only';
import { generateSecret, generateURI, verify } from 'otplib';
import QRCode from 'qrcode';

const ISSUER = 'IRCUB';

/** Allow one 30-second step either side for clock drift between the phone and the server. */
const TOLERANCE_SECONDS = 30;

export function createTotpSecret(): string {
  return generateSecret();
}

/** QR code (data URL) that authenticator apps such as Google Authenticator can scan. */
export function totpQrCode(email: string, secret: string): Promise<string> {
  return QRCode.toDataURL(generateURI({ issuer: ISSUER, label: email, secret }));
}

export async function verifyTotp(secret: string, token: string): Promise<boolean> {
  if (!/^\d{6}$/.test(token)) return false;
  try {
    const result = await verify({ secret, token, epochTolerance: TOLERANCE_SECONDS });
    return result.valid;
  } catch {
    return false;
  }
}
