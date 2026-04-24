import * as crypto from 'crypto';

export function verifyPassword(password: string): boolean {
  const stored = process.env.ADMIN_PASS_HASH || '';
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const computed = crypto.createHash('sha256').update(salt + password).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(hash, 'hex'));
}

function getSecret(): string {
  // Use ADMIN_PASS_HASH as JWT secret — guaranteed to be available since login works
  return process.env.ADMIN_PASS_HASH || process.env.JWT_SECRET || 'fallback';
}

export function createToken(username: string): string {
  const secret = getSecret();
  const payload = {
    sub: username,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 86400, // 24h
  };
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

export function verifyToken(token: string): { sub: string } | null {
  try {
    const secret = getSecret();
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, signature] = parts;
    const expected = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
    // Compare as strings — both are base64url encoded HMAC-SHA256
    if (signature !== expected) {
      console.log('[AUTH] Signature mismatch. sig length:', signature.length, 'expected length:', expected.length);
      return null;
    }
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return { sub: payload.sub };
  } catch (err: any) {
    console.error('[AUTH] verifyToken error:', err.message);
    return null;
  }
}
