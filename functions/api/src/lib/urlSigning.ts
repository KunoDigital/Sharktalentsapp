/**
 * URL signing con HMAC-SHA256 para tokens públicos (reportes, tests de candidato).
 *
 * Token format: base64url(payload).base64url(signature)
 * payload = JSON con { kind, ref, exp, ...claims }
 *
 * Uso:
 *   const token = signToken({ kind: 'test', ref: 'app_123', exp: in7days() });
 *   const claims = verifyToken(token);  // throws si inválido o expirado
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { env } from './env';
import { logger } from './logger';

const log = logger('URL_SIGNING');

export type TokenClaims = {
  kind: 'test' | 'report' | 'report_bundle' | 'portal' | 'demo_conductual' | 'demo_integridad' | 'exchange' | 'fit_choice' | 'fit_report';
  ref: string;          // ROWID al que apunta (Result para report, Job para report_bundle, etc.)
  exp: number;          // unix seconds
  [key: string]: unknown;
};

function b64urlEncode(buf: Buffer | string): string {
  const data = typeof buf === 'string' ? Buffer.from(buf, 'utf8') : buf;
  return data.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function b64urlDecode(s: string): Buffer {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') +
    '='.repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(padded, 'base64');
}

function sign(payload: string, secret: string): string {
  return b64urlEncode(createHmac('sha256', secret).update(payload).digest());
}

export function signToken(claims: TokenClaims, secret?: string): string {
  const key = secret ?? env().URL_SIGNING_SECRET;
  const payloadJson = JSON.stringify(claims);
  const payloadB64 = b64urlEncode(payloadJson);
  const signature = sign(payloadB64, key);
  return `${payloadB64}.${signature}`;
}

export class TokenError extends Error {
  reason: 'malformed' | 'invalid_signature' | 'expired' | 'wrong_kind';
  constructor(reason: TokenError['reason'], message: string) {
    super(message);
    this.name = 'TokenError';
    this.reason = reason;
  }
}

/**
 * `expectedKind` es OBLIGATORIO. Forzarlo previene token confusion vulnerabilities:
 * un token de tipo `report` no debe servir para `/test/:token` aunque la firma sea válida.
 *
 * Si en el futuro hace falta validar sin chequear kind (raro), usar verifyTokenAnyKind.
 */
export function verifyToken(token: string, expectedKind: TokenClaims['kind'], secret?: string): TokenClaims {
  const key = secret ?? env().URL_SIGNING_SECRET;
  const parts = token.split('.');
  if (parts.length !== 2) throw new TokenError('malformed', 'Token must be payload.signature');

  const [payloadB64, providedSig] = parts;
  const expectedSig = sign(payloadB64, key);

  // timing-safe compare
  const a = Buffer.from(providedSig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new TokenError('invalid_signature', 'Signature does not match');
  }

  let claims: TokenClaims;
  try {
    claims = JSON.parse(b64urlDecode(payloadB64).toString('utf8')) as TokenClaims;
  } catch (err) {
    // Importante: la firma ERA válida pero el payload no es JSON.
    // Esto pasa típicamente cuando: (a) el secret fue rotado y un atacante intenta
    // brute-force, (b) un bug interno generó un payload corrupto, (c) caso adversarial.
    // Loguearlo es importante porque un volumen alto de esto = signal de problema.
    log.warn('token payload not parseable but signature was valid', {
      payload_length: payloadB64.length,
      error: (err as Error).message,
    });
    throw new TokenError('malformed', 'Payload is not valid JSON');
  }

  if (typeof claims.exp !== 'number' || claims.exp < Math.floor(Date.now() / 1000)) {
    throw new TokenError('expired', 'Token has expired');
  }

  if (claims.kind !== expectedKind) {
    throw new TokenError('wrong_kind', `Expected kind=${expectedKind}, got ${claims.kind}`);
  }

  return claims;
}

// ---- Helpers de duración ----

export function expiresIn(seconds: number): number {
  return Math.floor(Date.now() / 1000) + seconds;
}

export const DAY_SEC = 86400;
export const WEEK_SEC = 7 * DAY_SEC;
