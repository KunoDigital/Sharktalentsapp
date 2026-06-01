/**
 * Generación, hashing y validación de API keys (para clientes que integran via API pública).
 *
 * Format de key: `st_live_<32 chars random>` (ej: `st_live_a8b3c9...`).
 * En BD se guarda `key_hash` (sha256 del valor completo) — NUNCA la key plana.
 * Solo el primer prefix de 10 chars (`st_live_a8`) se guarda para mostrar en UI.
 *
 * Uso típico:
 *   const { plainKey, row } = await issueApiKey({ tenantId, name, createdByUser });
 *   // plainKey se devuelve UNA vez al usuario; ya no se puede recuperar.
 *   // En requests posteriores, validar con `validateApiKey(req)`.
 */
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { logger } from './logger';

const log = logger('API_KEYS');

export const KEY_PREFIX_LENGTH = 10;

export type ApiKeyRow = {
  ROWID: string;
  tenant_id: string;
  name: string;
  key_hash: string;
  key_prefix: string;
  created_by_user: string;
  permissions: string; // JSON array de scopes
  rate_limit_per_min: number;
  last_used_at: string | null;
  expires_at: string | null;
  is_active: boolean;
  revoked_at: string | null;
  created_at: string;
};

export type ApiKeyPermission = 'jobs:read' | 'jobs:write' | 'candidates:read' | 'candidates:write' | 'applications:read' | 'applications:write' | 'reports:read' | '*';

export const ALL_PERMISSIONS: readonly ApiKeyPermission[] = [
  'jobs:read', 'jobs:write',
  'candidates:read', 'candidates:write',
  'applications:read', 'applications:write',
  'reports:read', '*',
] as const;

export function isValidPermission(p: unknown): p is ApiKeyPermission {
  return typeof p === 'string' && (ALL_PERMISSIONS as readonly string[]).includes(p);
}

/**
 * Genera una nueva API key plana. Devuelve el valor completo + su hash + prefix.
 * El valor completo solo es visible UNA vez al user; en BD persiste el hash.
 */
export function generateApiKey(): { plainKey: string; keyHash: string; keyPrefix: string } {
  const random = randomBytes(24).toString('base64url'); // 32 chars
  const plainKey = `st_live_${random}`;
  const keyHash = sha256(plainKey);
  const keyPrefix = plainKey.slice(0, KEY_PREFIX_LENGTH);
  return { plainKey, keyHash, keyPrefix };
}

export function hashApiKey(plainKey: string): string {
  return sha256(plainKey);
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Compara hash provisto contra hash esperado en timing-constant time.
 * Necesario para evitar side-channel attacks.
 */
export function compareHashes(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

export function isKeyActive(row: Pick<ApiKeyRow, 'is_active' | 'revoked_at' | 'expires_at'>): boolean {
  if (!row.is_active) return false;
  if (row.revoked_at) return false;
  if (row.expires_at && new Date(row.expires_at) < new Date()) return false;
  return true;
}

/**
 * Parsea el campo `permissions` (JSON array). Si está vacío o malformado,
 * default a `[]` (key sin permisos = no puede hacer nada útil).
 */
export function parsePermissions(raw: string | null | undefined): ApiKeyPermission[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidPermission);
  } catch {
    log.debug('permissions parse failed', { raw });
    return [];
  }
}

export function hasPermission(perms: ApiKeyPermission[], required: ApiKeyPermission): boolean {
  if (perms.includes('*')) return true;
  return perms.includes(required);
}
