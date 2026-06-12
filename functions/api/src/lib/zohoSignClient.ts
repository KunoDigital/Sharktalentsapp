/**
 * Cliente HTTP para Zoho Sign — firma electrónica de contratos / ofertas.
 *
 * Use case principal: cuando un candidato finalista acepta una oferta laboral, el cliente
 * cierra el deal mandando la oferta firmable. Zoho Sign maneja firma electrónica
 * con valor legal en LATAM (con tratado eIDAS para EU + ESIGN Act para USA).
 *
 * Endpoint Zoho Sign: https://sign.zoho.com/api/v1/
 *
 * No-op si `ZOHO_SIGN_API_URL` o `ZOHO_SIGN_OAUTH_TOKEN` no están seteados.
 *
 * Pasa por circuit breaker `zoho_sign` (threshold 5, cooldown 60s).
 */

import { fetchWithTimeout } from './fetchWithTimeout';
import { withBreaker } from './circuitBreaker';
import { logger } from './logger';
import { env } from './env';

const log = logger('ZOHO_SIGN');

const BREAKER_OPTS = { name: 'zoho_sign', threshold: 5, cooldownMs: 60_000 };
const TIMEOUT_MS = 20_000; // PDFs pueden tardar más

export type SignResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; status?: number };

export type CreateRequestInput = {
  template_id?: string;          // si tenés templates predefinidos
  document_url?: string;         // o URL de PDF a firmar
  document_buffer?: Buffer;      // o buffer in-memory
  document_filename?: string;
  signers: Array<{
    name: string;
    email: string;
    role?: string;               // 'employer', 'employee', 'witness'
  }>;
  subject: string;
  message?: string;
};

export type SignRequest = {
  request_id: string;
  status: 'sent' | 'in_progress' | 'completed' | 'declined' | 'expired';
  signing_urls?: Array<{ signer_email: string; url: string }>;
  created_time: string;
};

function isConfigured(): boolean {
  // Zoho Sign usa el mismo refresh token system que Recruit/CRM (vía zohoOAuth).
  // El refresh token de Cris (ZOHO_OAUTH_REFRESH_TOKEN) tiene que incluir scopes
  // de Sign: ZohoSign.documents.ALL, ZohoSign.templates.ALL, ZohoSign.requests.ALL.
  // Si no los tiene, hay que regenerarlo con esos scopes agregados.
  return !!process.env.ZOHO_OAUTH_CLIENT_ID
    && !!process.env.ZOHO_OAUTH_CLIENT_SECRET
    && !!process.env.ZOHO_OAUTH_REFRESH_TOKEN;
}

async function callSign<T>(
  path: string,
  options: { method: 'GET' | 'POST'; body?: unknown },
  traceId: string,
): Promise<SignResult<T>> {
  if (!isConfigured()) {
    return { ok: false, error: 'Zoho Sign not configured (necesita ZOHO_OAUTH_CLIENT_ID + ZOHO_OAUTH_CLIENT_SECRET + ZOHO_OAUTH_REFRESH_TOKEN)' };
  }
  const apiUrl = env().ZOHO_SIGN_API_URL || 'https://sign.zoho.com/api/v1';
  const url = `${apiUrl.replace(/\/$/, '')}${path}`;

  // Obtener access token vía refresh (mismo helper que usa Recruit/CRM).
  const { getZohoAuthHeader } = await import('./zohoOAuth.js');
  const auth = await getZohoAuthHeader(traceId);
  if (!auth) {
    return { ok: false, error: 'Could not get Zoho OAuth access token from refresh token' };
  }

  try {
    const result = await withBreaker(BREAKER_OPTS, async () => {
      const response = await fetchWithTimeout(url, {
        method: options.method,
        headers: {
          Authorization: auth,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        timeoutMs: TIMEOUT_MS,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        const err: Error & { status?: number } = new Error(`Sign ${response.status}: ${text.slice(0, 200)}`);
        err.status = response.status;
        throw err;
      }
      return (await response.json()) as T;
    });
    log.info('zoho sign call ok', { traceId, path });
    return { ok: true, data: result };
  } catch (err) {
    const e = err as Error & { status?: number };
    log.warn('zoho sign call failed', { traceId, path, error: e.message, status: e.status });
    return { ok: false, error: e.message, status: e.status };
  }
}

export async function createSignRequest(
  input: Omit<CreateRequestInput, 'document_buffer'>,
  traceId: string,
): Promise<SignResult<SignRequest>> {
  return callSign<SignRequest>('/requests', {
    method: 'POST',
    body: {
      template_id: input.template_id,
      document_url: input.document_url,
      subject: input.subject,
      message: input.message,
      signers: input.signers,
    },
  }, traceId);
}

export async function getSignRequest(requestId: string, traceId: string): Promise<SignResult<SignRequest>> {
  return callSign<SignRequest>(`/requests/${encodeURIComponent(requestId)}`, { method: 'GET' }, traceId);
}

export async function cancelSignRequest(requestId: string, traceId: string): Promise<SignResult<{ ok: boolean }>> {
  return callSign<{ ok: boolean }>(`/requests/${encodeURIComponent(requestId)}/cancel`, { method: 'POST' }, traceId);
}

/**
 * Manda el contrato standard SharkTalents usando el template pre-cargado en Sign.
 *
 * Pre-requisito: el template existe en Zoho Sign Console con los merge fields documentados
 * en `docs/contracts/zoho_sign_setup_guide.md`. Su ID va en env var
 * `ZOHO_SIGN_CONTRACT_TEMPLATE_ID`.
 *
 * Si el template_id no está configurado, devuelve 503-equivalente con mensaje claro.
 */
export type SendContractInput = {
  client_email: string;
  client_name: string;
  client_company: string;
  client_ruc_nit_ein?: string;
  client_address?: string;
  client_phone?: string;
  puesto_nombre: string;
  puesto_salario_usd: number;
  plazo_min_dias?: number;
  plazo_max_dias?: number;
  // Si querés override el template_id (ej: distinto contrato por tier de cliente)
  template_id_override?: string;
};

export async function sendContract(
  input: SendContractInput,
  traceId: string,
): Promise<SignResult<{ request_id: string; signing_url?: string }>> {
  // PATH A: si está configurada la URL del Deluge function en CRM, usar esa
  // (consume créditos complimentary de Zoho One — no requiere add-on credits).
  // Si no está configurada, fallback al PATH B (API directa — requiere add-on credits).
  const delugeUrl = process.env.ZOHO_DELUGE_CONTRACT_URL;
  if (delugeUrl) {
    return sendContractViaDeluge(delugeUrl, input, traceId);
  }

  // PATH B: legacy/fallback — Sign API directa (requiere comprar créditos)
  const templateId = input.template_id_override ?? env().ZOHO_SIGN_CONTRACT_TEMPLATE_ID;
  if (!templateId) {
    return { ok: false, error: 'ZOHO_SIGN_CONTRACT_TEMPLATE_ID no configurado. Cargá el contrato como Template en Zoho Sign y setá la env var.' };
  }

  const feeTotal = Math.round(input.puesto_salario_usd * 1.2 * 100) / 100;
  const feeTracto = Math.round((feeTotal / 2) * 100) / 100;

  // Zoho Sign API: endpoint /templates/{template_id}/createdocument con form-encoded.
  // El JSON va en field `data` y debe envolverse en `{ templates: { ... } }`.
  // https://www.zoho.com/sign/api/v1/createdocument.html
  const requestsBody = {
    templates: {
      request_name: `Contrato SharkTalents - ${input.client_company}`,
      notes: `Hola ${input.client_name}, este es el contrato para iniciar el proceso de búsqueda del puesto "${input.puesto_nombre}". Revisalo y firmalo desde el link de abajo. Si tenés dudas, respondé a este email.`,
      expiration_days: 15,
      // is_sequential viene del template, no se override acá.
      actions: [
        {
          // action_id viene del template — identificado vía GET /templates/{id} en setup inicial.
          // Default: el action_id del rol "cliente" del template `324029000000610003` (SharkTalents contract).
          // Si se cambia el template, también cambiar esto via env var ZOHO_SIGN_CONTRACT_CLIENTE_ACTION_ID.
          action_id: process.env.ZOHO_SIGN_CONTRACT_CLIENTE_ACTION_ID || '324029000000610045',
          recipient_name: input.client_name,
          recipient_email: input.client_email,
          action_type: 'SIGN',
          role: 'cliente',
        },
      ],
      // Merge fields del template — nombres deben matchear los Field Names del Sign Template Editor.
      field_data: {
        field_text_data: {
          cliente_nombre_representante: input.client_name,
          cliente_empresa: input.client_company,
          cliente_ruc_nit_ein: input.client_ruc_nit_ein ?? '',
          cliente_direccion: input.client_address ?? '',
          cliente_email: input.client_email,
          cliente_telefono: input.client_phone ?? '',
          puesto_nombre: input.puesto_nombre,
          puesto_salario_usd: String(input.puesto_salario_usd),
          fee_total_usd: String(feeTotal),
          fee_tracto_1_usd: String(feeTracto),
          fee_tracto_2_usd: String(feeTracto),
          plazo_min_dias: String(input.plazo_min_dias ?? 14),
          plazo_max_dias: String(input.plazo_max_dias ?? 30),
        },
        field_boolean_data: {},
        field_date_data: {},
      },
    },
  };

  // Send via form-encoded data field
  return callSignForm<{ request_id: string; signing_url?: string }>(
    `/templates/${encodeURIComponent(templateId)}/createdocument`,
    { method: 'POST', formData: { data: JSON.stringify(requestsBody) } },
    traceId,
  );
}

/**
 * Variant de callSign que usa application/x-www-form-urlencoded en vez de JSON.
 * Algunos endpoints de Zoho Sign (como /templates/{id}/createdocument) requieren
 * este formato — el JSON va dentro del field `data`.
 */
async function callSignForm<T>(
  path: string,
  options: { method: 'POST'; formData: Record<string, string> },
  traceId: string,
): Promise<SignResult<T>> {
  if (!process.env.ZOHO_OAUTH_CLIENT_ID || !process.env.ZOHO_OAUTH_CLIENT_SECRET || !process.env.ZOHO_OAUTH_REFRESH_TOKEN) {
    return { ok: false, error: 'Zoho Sign not configured (necesita ZOHO_OAUTH_CLIENT_ID + ZOHO_OAUTH_CLIENT_SECRET + ZOHO_OAUTH_REFRESH_TOKEN)' };
  }
  const apiUrl = env().ZOHO_SIGN_API_URL || 'https://sign.zoho.com/api/v1';
  const url = `${apiUrl.replace(/\/$/, '')}${path}`;

  const { getZohoAuthHeader } = await import('./zohoOAuth.js');
  const auth = await getZohoAuthHeader(traceId);
  if (!auth) {
    return { ok: false, error: 'Could not get Zoho OAuth access token from refresh token' };
  }

  const formBody = new URLSearchParams(options.formData).toString();

  try {
    const result = await withBreaker(BREAKER_OPTS, async () => {
      const response = await fetchWithTimeout(url, {
        method: options.method,
        headers: {
          Authorization: auth,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        body: formBody,
        timeoutMs: TIMEOUT_MS,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        const err: Error & { status?: number } = new Error(`Sign ${response.status}: ${text.slice(0, 400)}`);
        err.status = response.status;
        throw err;
      }
      return (await response.json()) as T;
    });
    log.info('zoho sign form call ok', { traceId, path });
    return { ok: true, data: result };
  } catch (err) {
    const e = err as Error & { status?: number };
    log.warn('zoho sign form call failed', { traceId, path, error: e.message, status: e.status });
    return { ok: false, error: e.message, status: e.status };
  }
}

/**
 * PATH A — Llama el Deluge function `enviarContratoSharkTalents` expuesto vía REST API en CRM.
 *
 * Por qué: la Sign API directa (PATH B) requiere PAID add-on credits (error 12000).
 * El Deluge function corre dentro del entorno Zoho One y consume los créditos
 * complimentary del plan (5 envelopes/user/mes en plan Suite).
 *
 * El backend solo manda los parámetros simples; toda la lógica de armar el payload
 * de Sign (template_id, action_id, field_data, fees calculados) vive en Deluge.
 *
 * URL viene de env var `ZOHO_DELUGE_CONTRACT_URL` (incluye zapikey).
 */
async function sendContractViaDeluge(
  url: string,
  input: SendContractInput,
  traceId: string,
): Promise<SignResult<{ request_id: string; signing_url?: string }>> {
  // Zoho Functions REST API toma los args como query string, NO como body form-encoded.
  // Spec: /functions/{name}/actions/execute?auth_type=apikey&zapikey=X&arg1=v1&arg2=v2
  const args = new URLSearchParams({
    client_email: input.client_email,
    client_name: input.client_name,
    client_company: input.client_company,
    client_ruc: input.client_ruc_nit_ein ?? '',
    client_phone: input.client_phone ?? '',
    client_address: input.client_address ?? '',
    puesto_nombre: input.puesto_nombre,
    puesto_salario_usd: String(input.puesto_salario_usd),
  }).toString();
  const urlWithArgs = `${url}${url.includes('?') ? '&' : '?'}${args}`;

  try {
    const result = await withBreaker(BREAKER_OPTS, async () => {
      const response = await fetchWithTimeout(urlWithArgs, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
        },
        timeoutMs: TIMEOUT_MS,
      });
      const text = await response.text().catch(() => '');
      if (!response.ok) {
        const err: Error & { status?: number } = new Error(`Deluge sign ${response.status}: ${text.slice(0, 400)}`);
        err.status = response.status;
        throw err;
      }
      // Deluge `invokeUrl` devuelve la respuesta de Sign API (JSON con `requests.request_id`).
      // El wrapper de Zoho Functions agrega un envelope `{ code, details: { output: "..." } }`.
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { parsed = text; }
      const output = extractDelugeOutput(parsed);
      const signError = parseSignErrorResponse(output);
      if (signError) {
        throw new Error(`Sign ${signError.code}: ${signError.message}${signError.fields ? ' — fields: ' + signError.fields : ''}`);
      }
      const signData = parseSignDocumentResponse(output);
      if (!signData) {
        throw new Error(`Deluge respuesta inesperada: ${JSON.stringify(output).slice(0, 800)}`);
      }
      return signData;
    });
    log.info('zoho sign via deluge ok', { traceId, request_id: result.request_id });
    return { ok: true, data: result };
  } catch (err) {
    const e = err as Error & { status?: number };
    log.warn('zoho sign via deluge failed', { traceId, error: e.message, status: e.status });
    return { ok: false, error: e.message, status: e.status };
  }
}

function extractDelugeOutput(raw: unknown): unknown {
  // Zoho Functions REST API devuelve { code: "success", details: { output: "<string>" } }.
  // El output es string si el Deluge function retorna string — necesitamos re-parsear.
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const details = obj['details'] as Record<string, unknown> | undefined;
    if (details && 'output' in details) {
      const output = details['output'];
      if (typeof output === 'string') {
        try { return JSON.parse(output); } catch { return output; }
      }
      return output;
    }
  }
  return raw;
}

function parseSignErrorResponse(raw: unknown): { code: number; message: string; fields?: string } | null {
  // Sign API errors: { code: 4021, message: "...", fields: [{ field_id, field_label?, field_name?, code }] }
  // code 0 = success ("Document submitted..."), NO es error.
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const code = obj['code'];
  const message = obj['message'];
  if (typeof code !== 'number' || typeof message !== 'string') return null;
  if (code === 0) return null;
  const fields = obj['fields'];
  let fieldsStr: string | undefined;
  if (Array.isArray(fields)) {
    fieldsStr = fields.map((f: Record<string, unknown>) =>
      `${f['field_label'] ?? f['field_name'] ?? f['field_id'] ?? '?'} (code ${f['code'] ?? '?'})`
    ).join(', ');
  }
  return { code, message, fields: fieldsStr };
}

function parseSignDocumentResponse(raw: unknown): { request_id: string; signing_url?: string } | null {
  // Zoho Sign /createdocument devuelve { requests: { request_id, request_status, actions: [{ sign_url? }] } }.
  // Cuando viene del Deluge, a veces solo llega { code: 0, message: "Document has been submitted..." }
  // sin el envelope requests — lo tratamos como éxito y devolvemos request_id vacío.
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const requests = obj['requests'] as Record<string, unknown> | undefined;
  if (requests && typeof requests === 'object') {
    const requestId = requests['request_id'];
    if (typeof requestId === 'string') {
      const actions = requests['actions'] as Array<Record<string, unknown>> | undefined;
      const signingUrl = Array.isArray(actions) && actions[0] && typeof actions[0]['sign_url'] === 'string'
        ? (actions[0]['sign_url'] as string)
        : undefined;
      return { request_id: requestId, signing_url: signingUrl };
    }
  }
  // Fallback: code 0 sin requests envelope = éxito sin request_id detallado.
  if (obj['code'] === 0 && typeof obj['message'] === 'string') {
    return { request_id: '' };
  }
  return null;
}

export const _internal = { isConfigured, sendContractViaDeluge, extractDelugeOutput, parseSignDocumentResponse };
