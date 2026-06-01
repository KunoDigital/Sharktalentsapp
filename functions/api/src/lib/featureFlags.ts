/**
 * Feature flags por tenant. Leídos de `Tenants.features_enabled` (JSON array de strings).
 *
 * Uso:
 *   import { requireFeature } from './lib/featureFlags';
 *   await requireFeature(ctx, 'mcp');  // throws ForbiddenError si no habilitado
 *
 * Flags conocidos:
 *   - 'api'           — API pública con keys (default: true)
 *   - 'mcp'           — MCP Server activo
 *   - 'custom_branding' — branding custom en portal cliente / reporte
 *   - 'video_questions' — videos dinámicos del candidato
 *   - 'bot_warm'      — bot decisor en modo warm (auto-aplicar con flag)
 *   - 'bot_hot'       — bot decisor en modo hot (siempre auto-aplicar)
 *
 * Si el tenant no tiene `features_enabled` o es JSON inválido, default = ['api'].
 */
import type { RequestContext } from './context';
import { ForbiddenError } from './errors';
import { logger } from './logger';
import { zcql } from './db';
import { escapeSql, unwrapRows } from './dbHelpers';

const log = logger('FEATURE_FLAGS');

export type FeatureFlag =
  | 'api' | 'mcp' | 'custom_branding'
  | 'video_questions' | 'bot_warm' | 'bot_hot';

const ALL_FLAGS: readonly FeatureFlag[] = [
  'api', 'mcp', 'custom_branding', 'video_questions', 'bot_warm', 'bot_hot',
] as const;

const DEFAULT_FLAGS: FeatureFlag[] = ['api'];

export function isValidFlag(s: unknown): s is FeatureFlag {
  return typeof s === 'string' && (ALL_FLAGS as readonly string[]).includes(s);
}

export function parseFeatureFlags(raw: string | null | undefined): FeatureFlag[] {
  if (!raw) return [...DEFAULT_FLAGS];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_FLAGS];
    return parsed.filter(isValidFlag);
  } catch {
    log.debug('features_enabled parse failed', { raw });
    return [...DEFAULT_FLAGS];
  }
}

export function hasFeature(flags: FeatureFlag[], required: FeatureFlag): boolean {
  return flags.includes(required);
}

/**
 * Lee features_enabled del tenant actual. Resultado memoizado en ctx para evitar
 * múltiples queries en una sola request.
 */
export async function getFeatureFlags(ctx: RequestContext): Promise<FeatureFlag[]> {
  const cached = (ctx as RequestContext & { _featureFlags?: FeatureFlag[] })._featureFlags;
  if (cached) return cached;

  const tenantId = ctx.tenantId;
  if (!tenantId) return [...DEFAULT_FLAGS];

  type Row = { features_enabled?: string | null };
  const q = `SELECT features_enabled FROM Tenants WHERE ROWID = '${escapeSql(tenantId)}' LIMIT 1`;
  const rows = unwrapRows<Row>((await zcql(ctx.req).executeZCQLQuery(q)) as unknown[], 'Tenants');
  const flags = parseFeatureFlags(rows[0]?.features_enabled);

  (ctx as RequestContext & { _featureFlags?: FeatureFlag[] })._featureFlags = flags;
  return flags;
}

/**
 * Throw 403 si el tenant no tiene el feature habilitado.
 * Llamar después de `requireTenant(ctx)`.
 */
export async function requireFeature(ctx: RequestContext, flag: FeatureFlag): Promise<void> {
  const flags = await getFeatureFlags(ctx);
  if (!hasFeature(flags, flag)) {
    log.warn('feature gate denied', { traceId: ctx.traceId, tenantId: ctx.tenantId, flag });
    throw new ForbiddenError(
      `Feature "${flag}" no habilitado para este tenant. Contactar soporte para activar.`,
    );
  }
}

export const _internal = { ALL_FLAGS, DEFAULT_FLAGS };
