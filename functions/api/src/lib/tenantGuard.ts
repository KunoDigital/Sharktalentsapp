/**
 * Tenant guards — defensas en runtime para asegurar que entidades multi-tenant
 * NUNCA se persistan sin tenant_id.
 *
 * Causa raíz del bug 2026-06-05 (drafts huérfanos): el handler
 * dispatchBriefingAutoDraft persistía drafts con `tenant_id: null` por código
 * viejo que asumía un flujo distinto. Cris no veía sus drafts porque la lista
 * filtra por tenant. Para evitar drift similar en el futuro: cualquier insert
 * de entidad multi-tenant debe pasar por este guard.
 *
 * Uso:
 *   import { assertTenantId } from '../lib/tenantGuard';
 *
 *   assertTenantId(tenantId, 'JobProfileDrafts.insert');
 *   await datastore(req).table('JobProfileDrafts').insertRow({ tenant_id: tenantId, ... });
 *
 * Si tenantId es null/undefined/empty, tira excepción ANTES del insert.
 * Mejor un error visible que data huérfana invisible.
 */
import { logger } from './logger';

const log = logger('TENANT_GUARD');

/**
 * Lanza error si tenantId no es un string no-vacío. Llamar ANTES de cualquier
 * insertRow/updateRow de una entidad multi-tenant.
 *
 * @param tenantId valor a validar
 * @param context descripción del lugar (ej. "JobProfileDrafts.insert from briefing handler")
 */
export function assertTenantId(tenantId: unknown, context: string): asserts tenantId is string {
  if (typeof tenantId !== 'string' || tenantId.length === 0) {
    log.error('TENANT GUARD VIOLATION — attempting to persist without tenant_id', {
      context,
      received_type: typeof tenantId,
      received_value: tenantId === null ? 'null' : tenantId === undefined ? 'undefined' : String(tenantId).slice(0, 50),
    });
    throw new Error(`Tenant guard violation at ${context}: tenant_id required (got ${tenantId === null ? 'null' : typeof tenantId})`);
  }
}

/**
 * Valida múltiples campos requeridos a la vez. Útil cuando además del tenant
 * hay otros campos críticos (ej. assessment_id en Results).
 *
 * @param fields objeto con nombre → valor
 * @param context descripción del lugar
 */
export function assertRequiredFields(
  fields: Record<string, unknown>,
  context: string,
): void {
  const missing: string[] = [];
  for (const [name, value] of Object.entries(fields)) {
    if (value === null || value === undefined || (typeof value === 'string' && value.length === 0)) {
      missing.push(name);
    }
  }
  if (missing.length > 0) {
    log.error('REQUIRED FIELDS GUARD VIOLATION', {
      context,
      missing_fields: missing.join(','),
    });
    throw new Error(`Required fields guard violation at ${context}: missing ${missing.join(', ')}`);
  }
}
