/**
 * Zoho CRM client — sync de marketing leads + candidatos a CRM.
 *
 * Auth: usa el OAuth refresh-token compartido (`ZOHO_OAUTH_*` en env) — el mismo
 * que Recruit/Sign/Bookings. El refresh_token tiene que tener scope
 * `ZohoCRM.modules.ALL` (regenerar self-client con scope agregado).
 *
 * No-op si `ZOHO_CRM_API_URL` no está seteado.
 *
 * Pasa por circuit breaker `zoho_crm` (threshold 5, cooldown 60s).
 */

import { fetchWithTimeout } from './fetchWithTimeout';
import { withBreaker } from './circuitBreaker';
import { logger } from './logger';
import { env } from './env';
import { getZohoAuthHeader } from './zohoOAuth';

const log = logger('ZOHO_CRM');

const BREAKER_OPTS = { name: 'zoho_crm', threshold: 5, cooldownMs: 60_000 };
const TIMEOUT_MS = 15_000;

export type CrmResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; status?: number };

export type CreateLeadInput = {
  email: string;
  first_name?: string;
  last_name?: string;
  company?: string;
  phone?: string;
  lead_source?: string;        // ej: 'meta_ads', 'organic'
  utm_campaign?: string;
  description?: string;
  /** Tags a aplicar al lead. Default: ['SharkTalents'] — para que el CRM
   * compartido de Kuno pueda filtrar los leads que vienen de este producto. */
  tags?: string[];
  /** Layout ID de Zoho CRM (Setup → Customization → Layouts). Si está, asigna
   * un layout específico al lead. Útil cuando Kuno tiene layouts diferentes
   * por producto. */
  layout_id?: string;
  custom_fields?: Record<string, string | number | boolean | null>;
};

export type CrmLead = {
  id: string;
  status?: string;
  created_time?: string;
};

function isConfigured(): boolean {
  const e = env();
  return !!e.ZOHO_CRM_API_URL && !!process.env.ZOHO_OAUTH_REFRESH_TOKEN;
}

async function callCrm<T>(
  path: string,
  options: { method: 'GET' | 'POST' | 'PUT'; body?: unknown },
  traceId: string,
): Promise<CrmResult<T>> {
  if (!isConfigured()) {
    return { ok: false, error: 'Zoho CRM not configured (ZOHO_CRM_API_URL + ZOHO_OAUTH_REFRESH_TOKEN)' };
  }
  const authHeader = await getZohoAuthHeader(traceId);
  if (!authHeader) {
    return { ok: false, error: 'Zoho OAuth refresh failed (check refresh_token scope incluye ZohoCRM.modules.ALL)' };
  }
  const e = env();
  const url = `${e.ZOHO_CRM_API_URL.replace(/\/$/, '')}${path}`;

  try {
    const result = await withBreaker(BREAKER_OPTS, async () => {
      const response = await fetchWithTimeout(url, {
        method: options.method,
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        timeoutMs: TIMEOUT_MS,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        const err: Error & { status?: number } = new Error(`CRM ${response.status}: ${text.slice(0, 200)}`);
        err.status = response.status;
        throw err;
      }
      return (await response.json()) as T;
    });
    log.info('zoho crm call ok', { traceId, path });
    return { ok: true, data: result };
  } catch (err) {
    const e = err as Error & { status?: number };
    log.warn('zoho crm call failed', { traceId, path, error: e.message, status: e.status });
    return { ok: false, error: e.message, status: e.status };
  }
}

/**
 * Splitea un nombre completo en first_name + last_name. Heurística simple — para casos
 * con apellidos compuestos puede no ser perfecto.
 */
function splitName(fullName: string): { first_name: string; last_name: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { first_name: parts[0], last_name: '' };
  if (parts.length === 2) return { first_name: parts[0], last_name: parts[1] };
  return { first_name: parts[0], last_name: parts.slice(1).join(' ') };
}

/**
 * Search a lead by email. Returns the CRM lead id + current Lead_Status + Lead_Source if found,
 * null otherwise. No-op (returns null) if CRM is not configured or the search fails.
 *
 * Necesitamos Lead_Status porque el layout Sharktalents lo tiene como mandatorio,
 * y un UPDATE sin ese campo es rechazado con MANDATORY_NOT_FOUND. Lo leemos para
 * reenviarlo tal cual y no pisar el estado actual.
 */
async function findLeadByEmail(
  email: string,
  traceId: string,
): Promise<{ id: string; lead_status: string | null; lead_source: string | null } | null> {
  const e = env();
  const module = e.ZOHO_CRM_LEADS_MODULE;
  const result = await callCrm<{ data?: Array<{ id: string; Lead_Status?: string | null; Lead_Source?: string | null }> }>(
    `/${encodeURIComponent(module)}/search?email=${encodeURIComponent(email)}`,
    { method: 'GET' },
    traceId,
  );
  if (!result.ok) return null;
  const first = result.data.data?.[0];
  if (!first) return null;
  return {
    id: first.id,
    lead_status: first.Lead_Status ?? null,
    lead_source: first.Lead_Source ?? null,
  };
}

/**
 * Crea o actualiza un lead en Zoho CRM. Hace search-before-create por email para
 * evitar duplicados aunque Zoho no tenga Duplicate Detection configurada:
 *   - Si existe lead con ese email → PUT al ID existente (update con los datos nuevos)
 *   - Si no existe → POST (create)
 */
export async function createLead(input: CreateLeadInput, traceId: string): Promise<CrmResult<CrmLead>> {
  const e = env();
  const module = e.ZOHO_CRM_LEADS_MODULE;

  // Zoho CRM espera estructura específica
  const data: Record<string, unknown> = {
    Email: input.email,
    Last_Name: input.last_name || (input.first_name ? '' : input.email.split('@')[0]),
    Lead_Source: input.lead_source ?? 'SharkTalents',
    // Lead_Status default — el layout Sharktalents lo tiene como mandatorio.
    // Cris configuró las fases en CRM; arrancamos siempre en "Nuevo".
    // Si el nombre exacto del status difiere en el layout, override via input.custom_fields.
    Lead_Status: 'Nuevo',
  };
  if (input.first_name) data.First_Name = input.first_name;
  if (input.company) data.Company = input.company;
  // Setea Phone y Mobile con el mismo número — Zoho los tiene como campos separados
  // y el workflow de Cris mapea Móvil (Mobile) para mandar a SharkTalents.
  if (input.phone) {
    data.Phone = input.phone;
    data.Mobile = input.phone;
  }
  if (input.utm_campaign) data.Campaign_Source = input.utm_campaign;
  if (input.description) data.Description = input.description.slice(0, 32000);

  // Tags — Zoho CRM acepta array de {name: string}. Default 'SharkTalents' para que
  // el CRM compartido de Kuno pueda distinguir leads de este producto del resto.
  const tags = input.tags ?? ['SharkTalents'];
  if (tags.length > 0) {
    data.Tag = tags.map((name) => ({ name }));
  }

  // Layout — si Kuno tiene un layout específico para SharkTalents en CRM,
  // se asigna acá (env var ZOHO_CRM_LEAD_LAYOUT_ID).
  const layoutId = input.layout_id ?? process.env.ZOHO_CRM_LEAD_LAYOUT_ID;
  if (layoutId) {
    data.Layout = { id: layoutId };
  }

  if (input.custom_fields) {
    for (const [k, v] of Object.entries(input.custom_fields)) {
      data[k] = v;
    }
  }

  // Search-before-create: chequear si ya existe lead con este email
  const existing = await findLeadByEmail(input.email, traceId);

  let result: CrmResult<{ data: Array<{ details: { id: string }; status: string }> }>;
  if (existing) {
    // Lead existe → UPDATE. Preservar el estado actual y la fuente original:
    //   - Lead_Status: el layout Sharktalents lo tiene como mandatorio, así que SIEMPRE
    //     debe ir en el body o Zoho rechaza con MANDATORY_NOT_FOUND. Usamos el valor
    //     actual del lead (lo leímos en findLeadByEmail) para no pisar lo que Cris
    //     movió manualmente. Fallback 'Nuevo' si el lead nunca tuvo status.
    //   - Lead_Source: igual, preservar el original (ej: 'meta_ads', 'Zoho Bookings')
    //     salvo que venga explícito en custom_fields.
    //   - Last_Name: si el caller NO envió input.last_name, NO incluir en el UPDATE
    //     para no pisar el valor existente con el fallback (que es prefijo del email).
    //     En CREATE sí necesitamos el fallback porque Last_Name es mandatorio.
    const updateData = { ...data } as Record<string, unknown>;
    if (!input.custom_fields || !('Lead_Status' in input.custom_fields)) {
      updateData.Lead_Status = existing.lead_status || 'Nuevo';
    }
    if (!input.custom_fields || !('Lead_Source' in input.custom_fields)) {
      if (existing.lead_source) {
        updateData.Lead_Source = existing.lead_source;
      } else {
        delete updateData.Lead_Source;
      }
    }
    if (!input.last_name) {
      delete updateData.Last_Name;
    }
    log.info('crm lead exists, updating', { traceId, existingId: existing.id, email_masked: input.email.slice(0, 2) + '***', update_fields: Object.keys(updateData) });
    result = await callCrm<{ data: Array<{ details: { id: string }; status: string }> }>(
      `/${encodeURIComponent(module)}/${encodeURIComponent(existing.id)}`,
      { method: 'PUT', body: { data: [updateData] } },
      traceId,
    );
  } else {
    // Lead no existe → CREATE
    log.info('crm lead not found, creating', { traceId, email_masked: input.email.slice(0, 2) + '***' });
    result = await callCrm<{ data: Array<{ details: { id: string }; status: string }> }>(
      `/${encodeURIComponent(module)}`,
      { method: 'POST', body: { data: [data] } },
      traceId,
    );
  }

  if (!result.ok) return result;
  const first = result.data.data?.[0];
  if (!first || !first.details?.id) {
    return { ok: false, error: 'CRM returned no lead id' };
  }
  return {
    ok: true,
    data: { id: first.details.id, status: first.status },
  };
}

/**
 * Busca un Lead en Zoho CRM por email y devuelve los campos completos del registro,
 * incluyendo custom fields (RUC, dirección, etc).
 *
 * Útil para enriquecer datos en SharkTalents cuando se va a enviar un contrato y
 * la app necesita info que solo vive en CRM.
 *
 * Devuelve `null` (no error) si no encuentra match — eso es OK semánticamente,
 * el caller debe poder seguir con fallback a entrada manual.
 */
export async function findLeadInCrmByEmail(
  email: string,
  traceId: string,
): Promise<CrmResult<Record<string, unknown> | null>> {
  const e = env();
  const module = e.ZOHO_CRM_LEADS_MODULE;
  const path = `/${encodeURIComponent(module)}/search?email=${encodeURIComponent(email)}`;

  const result = await callCrm<{ data?: Array<Record<string, unknown>> }>(
    path,
    { method: 'GET' },
    traceId,
  );

  if (!result.ok) {
    // 204 No Content (no match) viene como error en algunos clients — normalizar.
    if (result.status === 204 || result.error.includes('204')) {
      return { ok: true, data: null };
    }
    return result;
  }

  const first = result.data.data?.[0];
  return { ok: true, data: first ?? null };
}

/**
 * Lista leads de Zoho CRM que tienen un tag específico — útil para
 * filtrar leads que pertenecen a SharkTalents (excluyendo otros productos de Kuno).
 *
 * El tag se setea automáticamente cuando SharkTalents crea un lead via outbox event
 * `lead.captured`. Para leads creados manualmente en CRM, Cris/Cristian deberían
 * agregar el tag a mano para que aparezcan acá.
 *
 * Limitación: Zoho CRM v2 search by tag tiene varios formatos. Probamos search by
 * `Tag` field con criteria; si tu CRM usa otro field name, ajustar.
 */
export async function listLeadsByTag(
  tag: string,
  traceId: string,
  limit = 200,
): Promise<CrmResult<Array<Record<string, unknown>>>> {
  const e = env();
  const module = e.ZOHO_CRM_LEADS_MODULE;

  // Zoho CRM v2 búsqueda por tag REAL — usamos criteria con `Tag.name`.
  // (Antes usábamos `word=` que es full-text search → matcheaba leads con
  // "SharkTalents" en Lead_Source, no en tags. Esto era inconsistente.)
  const criteria = `(Tag.name:equals:${tag})`;
  const params = new URLSearchParams({
    criteria,
    per_page: String(Math.min(limit, 200)),
  });
  const result = await callCrm<{ data?: Array<Record<string, unknown>> }>(
    `/${encodeURIComponent(module)}/search?${params.toString()}`,
    { method: 'GET' },
    traceId,
  );
  if (!result.ok) {
    if (result.status === 204 || result.error.includes('204')) {
      return { ok: true, data: [] };
    }
    // Fallback: si el `Tag.name` no funciona (algunas instancias Zoho lo nombran
    // diferente), intentar `Tag:equals` sin .name
    const fallbackResult = await callCrm<{ data?: Array<Record<string, unknown>> }>(
      `/${encodeURIComponent(module)}/search?criteria=${encodeURIComponent(`(Tag:equals:${tag})`)}&per_page=${Math.min(limit, 200)}`,
      { method: 'GET' },
      traceId,
    );
    if (fallbackResult.ok) {
      return { ok: true, data: fallbackResult.data.data ?? [] };
    }
    return result;
  }
  return { ok: true, data: result.data.data ?? [] };
}

export type CrmLayoutSummary = {
  id: string;
  name: string;
  api_name?: string;
  display_label?: string;
  status?: string;
  source?: string;
};

export type CrmFieldSummary = {
  api_name: string;
  field_label: string;
  data_type: string;
  custom_field: boolean;
  required: boolean;
  pick_list_values?: Array<{ display_value: string; actual_value: string }>;
};

/**
 * Lista todos los layouts disponibles para un módulo de Zoho CRM (default: Leads).
 * Devuelve nombre + id de cada uno — útil para identificar cuál es el layout específico
 * de SharkTalents y luego setearlo en env (ZOHO_CRM_LEAD_LAYOUT_ID).
 */
export async function listLayouts(
  traceId: string,
  module = 'Leads',
): Promise<CrmResult<CrmLayoutSummary[]>> {
  const result = await callCrm<{ layouts?: CrmLayoutSummary[] }>(
    `/settings/layouts?module=${encodeURIComponent(module)}`,
    { method: 'GET' },
    traceId,
  );
  if (!result.ok) return result;
  return { ok: true, data: result.data.layouts ?? [] };
}

/**
 * Lista todos los campos (incluyendo custom_fields) de un módulo de Zoho CRM.
 * Útil para descubrir qué campos custom existen (ej: RUC, dirección fiscal) sin
 * tener que entrar manualmente al setup del CRM.
 */
export async function listFields(
  traceId: string,
  module = 'Leads',
): Promise<CrmResult<CrmFieldSummary[]>> {
  const result = await callCrm<{ fields?: CrmFieldSummary[] }>(
    `/settings/fields?module=${encodeURIComponent(module)}`,
    { method: 'GET' },
    traceId,
  );
  if (!result.ok) return result;
  return { ok: true, data: result.data.fields ?? [] };
}

export async function updateLeadStatus(leadId: string, newStatus: string, traceId: string): Promise<CrmResult<CrmLead>> {
  const e = env();
  const module = e.ZOHO_CRM_LEADS_MODULE;

  return callCrm<CrmLead>(
    `/${encodeURIComponent(module)}/${encodeURIComponent(leadId)}`,
    {
      method: 'PUT',
      body: { data: [{ Lead_Status: newStatus }] },
    },
    traceId,
  );
}

export const _internal = { isConfigured, splitName };
