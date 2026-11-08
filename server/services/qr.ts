import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { config } from '../config.js';
import type { AppDatabase } from '../db/connection.js';

const TOKEN_PREFIX = 'BRSQR.v1';

function signTokenUid(tokenUid: string): string {
  return crypto
    .createHmac('sha256', config.qrHmacSecret)
    .update(`${TOKEN_PREFIX}.${tokenUid}`)
    .digest('base64url');
}

export function hashToken(signedToken: string): string {
  return crypto.createHash('sha256').update(signedToken).digest('hex');
}

/**
 * Issues (or retrieves existing) unique, non-guessable QR token for a PAID order.
 * Never embeds student name, class, or any sensitive PII inside the QR payload.
 */
export function issueOrderQrToken(db: AppDatabase, orderId: number): {
  tokenUid: string;
  signedToken: string;
  issuedAt: string;
} {
  const existing = db.get<{
    token_uid: string;
    signed_token: string;
    issued_at: string;
    revoked_at: string | null;
  }>('SELECT token_uid, signed_token, issued_at, revoked_at FROM qr_verification_tokens WHERE order_id = ?', orderId);

  if (existing && !existing.revoked_at) {
    return {
      tokenUid: existing.token_uid,
      signedToken: existing.signed_token,
      issuedAt: existing.issued_at,
    };
  }

  const tokenUid = crypto.randomBytes(16).toString('base64url');
  const signature = signTokenUid(tokenUid);
  const signedToken = `${TOKEN_PREFIX}.${tokenUid}.${signature}`;
  const tokenHash = hashToken(signedToken);

  if (existing) {
    db.run(
      `UPDATE qr_verification_tokens
       SET token_uid = ?, token_hash = ?, signed_token = ?, is_used = 0, used_at = NULL, revoked_at = NULL, issued_at = datetime('now')
       WHERE order_id = ?`,
      tokenUid,
      tokenHash,
      signedToken,
      orderId
    );
  } else {
    db.run(
      `INSERT INTO qr_verification_tokens (order_id, token_uid, token_hash, signed_token)
       VALUES (?, ?, ?, ?)`,
      orderId,
      tokenUid,
      tokenHash,
      signedToken
    );
  }

  const row = db.get<{ issued_at: string }>(
    'SELECT issued_at FROM qr_verification_tokens WHERE order_id = ?',
    orderId
  );

  return {
    tokenUid,
    signedToken,
    issuedAt: row?.issued_at || new Date().toISOString(),
  };
}

/**
 * Cryptographically validates a scanned QR string using constant-time HMAC comparison.
 */
export function verifyQrSignature(rawQrText: string): { valid: boolean; tokenUid?: string } {
  if (!rawQrText || typeof rawQrText !== 'string') {
    return { valid: false };
  }
  const trimmed = rawQrText.trim();
  const parts = trimmed.split('.');
  // Format: BRSQR.v1.<tokenUid>.<signature>
  if (parts.length !== 4 || `${parts[0]}.${parts[1]}` !== TOKEN_PREFIX) {
    return { valid: false };
  }

  const tokenUid = parts[2];
  const providedSig = parts[3];
  if (!tokenUid || !providedSig || tokenUid.length < 16) {
    return { valid: false };
  }

  const expectedSig = signTokenUid(tokenUid);
  const a = Buffer.from(providedSig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length) {
    return { valid: false };
  }

  const matches = crypto.timingSafeEqual(a, b);
  return matches ? { valid: true, tokenUid } : { valid: false };
}

export async function generateQrDataUrl(signedToken: string): Promise<string> {
  return QRCode.toDataURL(signedToken, {
    errorCorrectionLevel: 'M',
    margin: 3,
    width: 360,
    color: {
      dark: '#0F2942',
      light: '#FFFFFF',
    },
  });
}
